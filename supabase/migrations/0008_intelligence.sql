-- =============================================================================
-- 0008_intelligence.sql
-- Compliance, performance, advertising, AI decisions, automation, notifications.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Compliance (§14, §58, §59, §60)
-- -----------------------------------------------------------------------------
-- A compliance record is per product PER CHANNEL. The system never states that
-- something is "Amazon guaranteed compliant" — only pass / fail / review with
-- the evidence that produced the verdict.

create type compliance_verdict as enum ('pass', 'fail', 'review_required', 'not_assessed');

create table compliance_records (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel    channel_key not null,

  verdict     compliance_verdict not null default 'not_assessed',
  -- Every individual check with its own verdict and evidence, so the owner can
  -- see exactly which requirement failed rather than an opaque rejection.
  checks      jsonb not null default '[]'::jsonb,
  blocking_reasons text[] not null default '{}',

  ruleset_version text not null,
  supplier_id  uuid references suppliers(id) on delete set null,

  ip_risk        text not null default 'unknown',    -- low | medium | high | unknown
  restricted_category boolean not null default false,
  requires_documentation boolean not null default false,

  assessed_at timestamptz not null default now(),
  assessed_by actor_type not null default 'system',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,

  is_demo    boolean not null default false,
  unique (org_id, product_id, channel)
);

create index compliance_records_verdict_idx on compliance_records(org_id, channel, verdict);

create table compliance_documents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  compliance_record_id uuid references compliance_records(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,

  doc_type   text not null,
  title      text not null,
  storage_path text,
  issued_on  date,
  expires_on date,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Performance and advertising (§27, §33)
-- -----------------------------------------------------------------------------

create table product_performance (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel    channel_key not null,
  period_date date not null,

  impressions int not null default 0,
  clicks      int not null default 0,
  units_sold  int not null default 0,
  orders      int not null default 0,

  revenue_minor      bigint not null default 0,
  cogs_minor         bigint not null default 0,
  fees_minor         bigint not null default 0,
  ad_spend_minor     bigint not null default 0,
  refunds_minor      bigint not null default 0,
  contribution_minor bigint not null default 0,

  returns_count int not null default 0,
  refunds_count int not null default 0,
  review_count  int not null default 0,
  rating_avg    numeric(3,2),

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, product_id, channel, period_date)
);

create index product_performance_lookup_idx on product_performance(org_id, period_date desc);

-- Composite catalogue-management metric (§62), recomputed rather than edited.
create table product_health (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  score      int not null check (score between 0 and 100),
  band       text not null,
  components jsonb not null,
  weights_version text not null,
  computed_at timestamptz not null default now()
);

create index product_health_product_idx on product_health(product_id, computed_at desc);

create table advertising (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  channel    channel_key not null,
  product_id uuid references products(id) on delete set null,

  campaign_name text,
  external_id   text,
  period_date   date not null,

  spend_minor   bigint not null default 0,
  revenue_minor bigint not null default 0,
  clicks        int not null default 0,
  impressions   int not null default 0,
  conversions   int not null default 0,

  daily_budget_minor bigint,
  is_paused     boolean not null default false,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, channel, external_id, period_date)
);

-- -----------------------------------------------------------------------------
-- AI decisions and automation (§46, §47, §63)
-- -----------------------------------------------------------------------------

create type decision_status as enum (
  'recommended', 'awaiting_approval', 'approved', 'rejected',
  'executed', 'failed', 'expired', 'superseded'
);

create table ai_decisions (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  decision_type text not null,       -- 'pause_product' | 'change_price' | ...
  entity_type   text not null,
  entity_id     text,

  status     decision_status not null default 'recommended',
  -- The inputs are stored so a decision can be audited and replayed exactly.
  inputs     jsonb not null default '{}'::jsonb,
  recommendation jsonb not null,
  reasoning  text not null,
  confidence numeric(4,3) check (confidence between 0 and 1),
  rules_considered text[] not null default '{}',

  estimated_impact_minor bigint,
  automation_level_required automation_level not null default 'supervised',
  requires_owner_approval boolean not null default true,
  compliance_status compliance_verdict not null default 'not_assessed',

  model      text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  executed_at timestamptz,
  execution_error text,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index ai_decisions_org_status_idx on ai_decisions(org_id, status, created_at desc);

-- Deferred FK from 0001: audit entries can now point at the decision that caused them.
alter table audit_logs
  add constraint audit_logs_ai_decision_fk
  foreign key (ai_decision_id) references ai_decisions(id) on delete set null;

create table automation_rules (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  rule_key   text not null,
  label      text not null,
  description text,
  category   text not null,          -- 'catalogue' | 'pricing' | 'advertising' | ...

  is_enabled boolean not null default true,
  -- Conditions and actions are data, not code, so thresholds stay configurable
  -- without a deployment (§63).
  conditions jsonb not null default '{}'::jsonb,
  actions    jsonb not null default '{}'::jsonb,
  required_level automation_level not null default 'supervised',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, rule_key)
);

create table automation_runs (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  job_key    text not null,            -- 'inventory_sync' | 'daily_report' | ...
  status     text not null default 'running',  -- running | success | failed | skipped
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,

  items_processed int not null default 0,
  items_failed    int not null default 0,
  decisions_created int not null default 0,

  error   text,
  summary jsonb not null default '{}'::jsonb,
  -- Stops a scheduler double-firing from running the same job twice (§70)
  idempotency_key text,
  unique (org_id, job_key, idempotency_key)
);

create index automation_runs_org_idx on automation_runs(org_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Notifications and documents (§44, §52)
-- -----------------------------------------------------------------------------

create type notification_severity as enum ('info', 'success', 'warning', 'critical', 'approval_required');

create table notifications (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  severity notification_severity not null default 'info',
  category text not null,
  title    text not null,
  body     text,

  entity_type text,
  entity_id   text,
  ai_decision_id uuid references ai_decisions(id) on delete set null,
  action_url  text,

  read_at      timestamptz,
  emailed_at   timestamptz,
  email_error  text,
  dedupe_key   text,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);

create index notifications_org_unread_idx on notifications(org_id, created_at desc) where read_at is null;

create table documents (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  doc_type   text not null,
  title      text not null,
  storage_path text not null,
  mime_type  text,
  size_bytes bigint,

  related_type text,
  related_id   text,
  product_id   uuid references products(id) on delete set null,
  supplier_id  uuid references suppliers(id) on delete set null,
  order_id     uuid references orders(id) on delete set null,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create trigger automation_rules_touch before update on automation_rules
  for each row execute function touch_updated_at();
