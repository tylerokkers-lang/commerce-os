-- =============================================================================
-- 0024_global_markets.sql
-- Milestone 9: global market intelligence & international expansion.
--
-- The marketplace *catalog* (which platforms exist, in which countries, at
-- what LIVE/DEMO/PLANNED status) is deliberately NOT a table here — it is a
-- closed, versioned TypeScript registry (`src/lib/markets/catalog.ts`),
-- exactly the same pattern `marketplaces/connectors/registry.ts` already
-- uses for connector descriptors. This migration adds only the genuine,
-- changing FACTS a global expansion assessment needs: exchange rates (a
-- history, never overwritten), a supplier's real shipping capability per
-- destination country, a product's compliance verdict scoped to one market
-- (never a global boolean), and the expansion engine's own versioned
-- output. All four are read-only through RLS — see 0025 — because nothing
-- in this milestone writes them from the UI; every write is server-side,
-- from the monitors/handlers this migration exists to support.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Exchange rates: a fact with provenance, append-only history.
-- -----------------------------------------------------------------------------
-- 1 unit of base_currency = rate units of quote_currency, as observed by
-- `source` at `observed_at` (which can lag `retrieved_at`, the moment this
-- application actually recorded it). Never overwritten, so "what rate did
-- we believe at time X" stays answerable — the same reasoning
-- `supplier_price_history` already established for supplier cost.

create table exchange_rates (
  id       bigserial primary key,
  org_id   uuid not null references organisations(id) on delete cascade,

  base_currency  char(3) not null,
  quote_currency char(3) not null,
  rate           numeric(18,8) not null check (rate > 0),

  source       text not null,
  observed_at  timestamptz not null,
  retrieved_at timestamptz not null default now(),

  is_demo    boolean not null default false,
  created_at timestamptz not null default now()
);

create index exchange_rates_pair_idx
  on exchange_rates(org_id, base_currency, quote_currency, observed_at desc);

create trigger exchange_rates_no_update before update on exchange_rates
  for each row execute function forbid_mutation();
create trigger exchange_rates_no_delete before delete on exchange_rates
  for each row execute function forbid_mutation();

-- -----------------------------------------------------------------------------
-- Supplier shipping capability per destination country.
-- -----------------------------------------------------------------------------
-- Distinct from `suppliers.ships_from_country` (the supplier's own origin,
-- Milestone 3): this is the destination side — can this supplier actually
-- deliver INTO a given country, and at what real cost/time/reliability.
-- No existing column captures this, so a small, honestly-scoped new table
-- is genuinely required, not a duplicate of anything already in the schema.

create table supplier_market_capabilities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  country_code char(2) not null,

  can_ship            boolean not null default false,
  shipping_cost_minor bigint,
  shipping_currency   char(3),
  delivery_days_min   int,
  delivery_days_max   int,
  cancellation_rate_pct numeric(5,2) check (cancellation_rate_pct between 0 and 100),

  last_verified_at timestamptz,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, supplier_id, country_code)
);

create index supplier_market_capabilities_supplier_idx
  on supplier_market_capabilities(supplier_id);

create trigger supplier_market_capabilities_touch before update on supplier_market_capabilities
  for each row execute function touch_updated_at();

-- -----------------------------------------------------------------------------
-- Market-scoped compliance assessments.
-- -----------------------------------------------------------------------------
-- Deliberately parallel to `compliance_records` (Milestone 2), never a
-- replacement for it: `compliance_records` is keyed by (product, channel)
-- for the channels this business actually operates in today (Shopify UK,
-- Amazon UK); this table is keyed by (product, market_key) for the wider
-- world of country/marketplace combinations Milestone 9 can evaluate,
-- including ones with no live channel at all. `market_key` is a value from
-- the TypeScript catalog (e.g. "amazon_de"), not a foreign key — the
-- catalog is code, not a table, per this file's header comment. Where a
-- market_key corresponds to a real, already-assessed channel (e.g. the UK
-- markets), the assessment here is produced by delegating to the existing
-- `assessCompliance` engine, never a duplicate ruleset.

create table market_compliance_assessments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  market_key   text not null,
  country_code char(2) not null,

  verdict           compliance_verdict not null default 'not_assessed',
  checks            jsonb not null default '[]'::jsonb,
  blocking_reasons  text[] not null default '{}',
  missing_facts     text[] not null default '{}',

  ruleset_version text not null,
  assessed_at     timestamptz not null default now(),

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, product_id, market_key)
);

create index market_compliance_assessments_product_idx
  on market_compliance_assessments(org_id, product_id);

create trigger market_compliance_assessments_touch before update on market_compliance_assessments
  for each row execute function touch_updated_at();

-- -----------------------------------------------------------------------------
-- Market expansion assessments: the expansion engine's own versioned output.
-- -----------------------------------------------------------------------------
-- Append-only history, like `product_scores`/`supplier_price_history` — a
-- new row every time the engine re-runs, never an overwrite, so a monitor
-- can compare "what did we conclude last time" against "what is true now"
-- (exactly the pattern `monitor_observations` already uses for other
-- facts) and the CEO dashboard can show when a market's status genuinely
-- changed. `native_*` figures stay in the market's own currency; `fx_*`
-- fields are populated only when a comparison-currency figure was also
-- computed, and are null together, never partially, so a stored row can
-- never imply an FX conversion happened when it did not.

create type market_expansion_recommendation as enum (
  'ready', 'promising', 'requires_review', 'blocked', 'insufficient_facts'
);

create table market_expansion_assessments (
  id         bigserial primary key,
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  market_key   text not null,
  country_code char(2) not null,
  currency     char(3) not null,

  recommendation market_expansion_recommendation not null,
  score          int not null check (score between 0 and 100),
  score_components jsonb not null default '[]'::jsonb,

  native_profit_minor bigint,
  native_margin_pct   numeric(6,2),

  comparison_currency     char(3),
  comparison_profit_minor bigint,
  fx_rate_used            numeric(18,8),
  fx_observed_at          timestamptz,
  check ((comparison_currency is null) = (comparison_profit_minor is null)),

  blockers      text[] not null default '{}',
  missing_facts text[] not null default '{}',

  -- The exact `market_recheck` job payload (compliance context, cost
  -- inputs, supplier id, comparison currency) that produced this row —
  -- stored so `handleFxRecheck` can re-enqueue a genuine recheck for every
  -- assessment a currency movement affects, without a second live-fact
  -- assembly path. Never read by anything except the job it feeds.
  source_payload jsonb not null default '{}'::jsonb,

  engine_version text not null,
  assessed_at    timestamptz not null default now(),

  is_demo    boolean not null default false,
  created_at timestamptz not null default now()
);

create index market_expansion_assessments_product_idx
  on market_expansion_assessments(org_id, product_id, market_key, assessed_at desc);

create trigger market_expansion_assessments_no_update before update on market_expansion_assessments
  for each row execute function forbid_mutation();
create trigger market_expansion_assessments_no_delete before delete on market_expansion_assessments
  for each row execute function forbid_mutation();
