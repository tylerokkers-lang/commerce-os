-- =============================================================================
-- 0013_supplier_connectors.sql
-- Milestone 3: the supplier connector framework.
--
-- Mirrors the research provider architecture from 0010 deliberately: a
-- connector is declared with a source type, required credentials, rate
-- limits and usage terms, and an org's actual use of one is a separate row
-- from the connector's existence, so "this connector type exists" and "we
-- have configured it" are never conflated.
--
-- A connector is not a supplier. A supplier can be worked with through more
-- than one connector over its lifetime (starting on a CSV, later moving to an
-- API), and a connector implementation can serve more than one supplier.
-- =============================================================================

create type connector_source_type as enum ('api', 'feed', 'csv', 'manual', 'custom');

-- Deliberately the same vocabulary as provider_status (0010): a connector
-- with no credentials is not_configured, one switched off is disabled, and
-- the rest is only ever true once it has actually run.
create type connector_status as enum (
  'not_configured', 'disabled', 'ready', 'healthy', 'degraded', 'failing', 'rate_limited'
);

create table supplier_connectors (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  connector_key text not null,        -- which connector implementation, e.g. 'manual'
  label         text not null,
  source_type   connector_source_type not null,

  status        connector_status not null default 'not_configured',
  is_enabled    boolean not null default false,

  -- Names only. Values live in the environment, never in the database (§54).
  required_credentials text[] not null default '{}',

  rate_limit_per_minute int,
  rate_limit_per_day    int,
  min_seconds_between_runs int not null default 300,

  -- Connection details that are not secrets: a feed URL, a warehouse code.
  -- Never a token, a key, or a password.
  config jsonb not null default '{}'::jsonb,

  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error      text,
  next_allowed_at timestamptz,
  consecutive_failures int not null default 0,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, supplier_id, connector_key)
);

create index supplier_connectors_supplier_idx on supplier_connectors(supplier_id);

create table supplier_connector_runs (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  connector_id uuid not null references supplier_connectors(id) on delete cascade,

  status   text not null default 'running',   -- running | success | partial | failed | skipped
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,

  products_checked  int not null default 0,
  products_updated  int not null default 0,
  stock_changes_detected int not null default 0,
  price_changes_detected int not null default 0,

  requests_made int not null default 0,
  error   text,
  summary jsonb not null default '{}'::jsonb,

  -- A scheduler firing twice must not double-count a run (§70).
  idempotency_key text,
  unique (org_id, connector_id, idempotency_key)
);

create index supplier_connector_runs_connector_idx
  on supplier_connector_runs(connector_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Stock freshness, dispatch estimates and observed fulfilment quality
-- -----------------------------------------------------------------------------
-- Added to supplier_products rather than duplicated onto suppliers, because
-- these are properties of one supplier's offer on one product, not of the
-- supplier as a whole: dispatch time and stock behaviour can differ sharply
-- between two products from the same supplier.

alter table supplier_products
  add column stock_checked_at    timestamptz,
  add column dispatch_days_min   int,
  add column dispatch_days_max   int,
  add column cancellation_rate_pct numeric(5,2) check (cancellation_rate_pct between 0 and 100),
  add column fulfilment_success_rate_pct numeric(5,2) check (fulfilment_success_rate_pct between 0 and 100),
  add column last_connector_run_id uuid references supplier_connector_runs(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Price change history (append-only)
-- -----------------------------------------------------------------------------
-- A supplier's price is not one fact; it is a sequence of facts over time.
-- Recording every change, rather than overwriting supplier_products with the
-- latest figure, is what lets "detect a supplier price increase" (the
-- Milestone 6 automation example) be a query over history instead of a
-- comparison against a value nobody kept.

create type price_change_source as enum ('connector_sync', 'manual', 'demo');

create table supplier_price_history (
  id       bigserial primary key,
  org_id   uuid not null references organisations(id) on delete cascade,
  supplier_product_id uuid not null references supplier_products(id) on delete cascade,

  previous_unit_cost_minor bigint,        -- null on the first recorded price
  new_unit_cost_minor      bigint not null check (new_unit_cost_minor >= 0),
  currency char(3) not null default 'GBP',

  change_pct numeric(6,2),                -- signed; positive is an increase
  source     price_change_source not null default 'manual',
  connector_run_id uuid references supplier_connector_runs(id) on delete set null,

  detected_at timestamptz not null default now()
);

create index supplier_price_history_product_idx
  on supplier_price_history(supplier_product_id, detected_at desc);

-- History. Never rewritten, same as audit_logs and inventory_movements.
create trigger supplier_price_history_no_update before update on supplier_price_history
  for each row execute function forbid_mutation();
create trigger supplier_price_history_no_delete before delete on supplier_price_history
  for each row execute function forbid_mutation();

create trigger supplier_connectors_touch before update on supplier_connectors
  for each row execute function touch_updated_at();
