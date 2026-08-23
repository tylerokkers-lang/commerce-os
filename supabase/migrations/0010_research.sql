-- =============================================================================
-- 0010_research.sql
-- Milestone 2: research providers, the opportunity pipeline, lifecycle history,
-- identifier validation and IP risk.
--
-- Nothing here scrapes anything. Providers are declarative descriptions of
-- authorised sources, and the system records what each one is permitted to do
-- so that a provider cannot quietly exceed its remit.
-- =============================================================================

-- A candidate can be rejected outright, which is distinct from a product that
-- traded and was later removed. Both states must exist for the audit trail to
-- read honestly.
alter type product_stage add value if not exists 'rejected' after 'declining';

-- -----------------------------------------------------------------------------
-- Research providers (§7)
-- -----------------------------------------------------------------------------

create type provider_source_type as enum (
  'official_api',        -- first-party marketplace or platform API
  'licensed_dataset',    -- data we have paid for and may use under licence
  'permitted_public',    -- public data whose terms explicitly allow this use
  'supplier_feed',       -- a catalogue a supplier has given us
  'manual_entry',        -- typed in by a person
  'simulated'            -- demo only, never represents real market data
);

create type provider_status as enum (
  'not_configured',      -- credentials absent
  'disabled',            -- configured but switched off by the owner
  'ready',               -- configured, enabled, no run yet
  'healthy',             -- last run succeeded
  'degraded',            -- last run partially failed
  'failing',             -- last run failed
  'rate_limited'         -- backing off until the window resets
);

create table research_providers (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  provider_key text not null,
  label        text not null,
  description  text,
  source_type  provider_source_type not null,

  status       provider_status not null default 'not_configured',
  is_enabled   boolean not null default false,

  -- Names only. Values live in the environment, never in the database (§54).
  required_credentials text[] not null default '{}',

  -- Declared limits. The scheduler honours these rather than discovering them
  -- by being throttled.
  rate_limit_per_minute int,
  rate_limit_per_day    int,
  min_seconds_between_runs int not null default 60,

  -- What this provider is permitted to do, recorded so the boundary is
  -- explicit rather than assumed. `terms_url` is the source of that claim.
  terms_url            text,
  permitted_use_note   text,
  respects_robots      boolean not null default true,

  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error      text,
  next_allowed_at timestamptz,
  consecutive_failures int not null default 0,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider_key)
);

create table research_runs (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  provider_id uuid not null references research_providers(id) on delete cascade,

  status   text not null default 'running',   -- running | success | partial | failed | skipped
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,

  candidates_found    int not null default 0,
  candidates_accepted int not null default 0,
  candidates_rejected int not null default 0,

  requests_made int not null default 0,
  error   text,
  summary jsonb not null default '{}'::jsonb,

  -- A scheduler firing twice must not double-count a run (§70).
  idempotency_key text,
  unique (org_id, provider_id, idempotency_key)
);

create index research_runs_provider_idx on research_runs(provider_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Research candidates
-- -----------------------------------------------------------------------------
-- `product_research` already exists from 0002. These columns give the pipeline
-- structured values to score against instead of digging through raw JSON, and
-- give a candidate its own status before it ever becomes a product.

create type candidate_status as enum (
  'new', 'scored', 'promoted', 'rejected', 'duplicate', 'archived'
);

alter table product_research
  add column provider_id uuid references research_providers(id) on delete set null,
  add column run_id      uuid references research_runs(id) on delete set null,
  add column status      candidate_status not null default 'new',
  add column rejected_reason text,
  -- Estimates, clearly named as such. These are inputs to a projection, not
  -- observed trading figures.
  add column estimated_price_minor        bigint check (estimated_price_minor >= 0),
  add column estimated_unit_cost_minor    bigint check (estimated_unit_cost_minor >= 0),
  add column estimated_shipping_minor     bigint check (estimated_shipping_minor >= 0),
  add column estimated_monthly_units      int check (estimated_monthly_units >= 0),
  add column currency char(3) not null default 'GBP',
  -- Review and feedback evidence behind the complaint analysis (§10).
  add column review_sample jsonb not null default '[]'::jsonb,
  add column review_count  int,
  add column rating_avg    numeric(3,2) check (rating_avg between 0 and 5);

create index product_research_status_idx on product_research(org_id, status);

-- -----------------------------------------------------------------------------
-- Lifecycle history (§28) — every stage change, with its reason
-- -----------------------------------------------------------------------------

create table product_stage_transitions (
  id       bigserial primary key,
  org_id   uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  from_stage product_stage,          -- null on the first entry into the pipeline
  to_stage   product_stage not null,

  reason     text not null,
  actor_type actor_type not null default 'system',
  actor_user_id uuid references auth.users(id),
  actor_label   text,

  -- What the system knew at the moment it moved, so a decision can be replayed.
  opportunity_score int check (opportunity_score between 0 and 100),
  evidence   jsonb not null default '{}'::jsonb,
  ai_decision_id uuid references ai_decisions(id) on delete set null,

  occurred_at timestamptz not null default now()
);

create index product_stage_transitions_product_idx
  on product_stage_transitions(product_id, occurred_at desc);

-- History, like the audit log, is never rewritten.
create trigger product_stage_transitions_no_update before update on product_stage_transitions
  for each row execute function forbid_mutation();
create trigger product_stage_transitions_no_delete before delete on product_stage_transitions
  for each row execute function forbid_mutation();

-- -----------------------------------------------------------------------------
-- Identifier validation (§17)
-- -----------------------------------------------------------------------------
-- An identifier is never invented. It is either validated against the format
-- and check digit its standard defines, or it is explicitly unverified.

create type identifier_validation as enum (
  'valid',                 -- format and check digit both pass
  'invalid_format',
  'invalid_check_digit',
  'unverified',            -- present, but nothing has confirmed it
  'exempt'                 -- a recorded, evidenced GTIN exemption
);

alter table product_identifiers
  add column validation identifier_validation not null default 'unverified',
  add column validation_note text,
  add column validated_at timestamptz;

-- -----------------------------------------------------------------------------
-- IP risk (§59)
-- -----------------------------------------------------------------------------

alter table compliance_records
  add column ip_risk_reasons text[] not null default '{}',
  add column ip_assessed_at timestamptz;

-- -----------------------------------------------------------------------------
-- Per-channel profitability projections
-- -----------------------------------------------------------------------------
-- Stored per channel because a product can be viable on Shopify and not on
-- Amazon, and the difference has to be visible rather than averaged away.
-- Every figure comes from the single profitability engine; nothing here
-- recalculates margin independently.

create table opportunity_projections (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  research_id uuid references product_research(id) on delete cascade,
  product_id  uuid references products(id) on delete cascade,
  channel  channel_key not null,

  supplier_id uuid references suppliers(id) on delete set null,

  selling_price_minor bigint not null,
  landed_cost_minor   bigint not null,
  net_revenue_minor   bigint not null,
  contribution_minor  bigint not null,
  net_profit_minor    bigint not null,
  break_even_price_minor bigint not null,
  currency char(3) not null default 'GBP',

  gross_margin_pct       numeric(6,2),
  contribution_margin_pct numeric(6,2),
  net_margin_pct         numeric(6,2),

  gate_passes  boolean not null,
  gate_failures text[] not null default '{}',
  gate_warnings text[] not null default '{}',

  -- The exact cost assumptions used, so a projection can be re-run and
  -- compared against what actually happened once the product trades.
  assumptions jsonb not null default '{}'::jsonb,
  engine_version text not null,

  computed_at timestamptz not null default now(),
  is_demo boolean not null default false,

  constraint projection_has_subject check (research_id is not null or product_id is not null)
);

create index opportunity_projections_lookup_idx
  on opportunity_projections(org_id, channel, computed_at desc);

-- -----------------------------------------------------------------------------
-- Differentiation suggestions (§11) — original ideas only
-- -----------------------------------------------------------------------------

create type differentiation_kind as enum (
  'bundle', 'packaging', 'instructions', 'accessories', 'positioning',
  'quality', 'support', 'warranty', 'variation', 'value'
);

create table differentiation_suggestions (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  research_id uuid references product_research(id) on delete cascade,
  product_id  uuid references products(id) on delete cascade,

  kind        differentiation_kind not null,
  suggestion  text not null,
  -- The complaint theme this answers, so a suggestion is traceable to evidence
  -- rather than invented.
  addresses_complaint text,
  evidence_strength text not null default 'weak',   -- weak | moderate | strong
  estimated_cost_minor bigint,

  generated_by text not null default 'rules',
  created_at timestamptz not null default now(),

  constraint differentiation_has_subject check (research_id is not null or product_id is not null)
);

create trigger research_providers_touch before update on research_providers
  for each row execute function touch_updated_at();
