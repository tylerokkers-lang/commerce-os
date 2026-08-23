-- =============================================================================
-- 0015_marketplace_connectors.sql
-- Milestone 4: the marketplace connector foundation.
--
-- `channels` and `channel_products` already exist from 0005 and already carry
-- connection state (`is_connected`, `connection_mode`, `last_success_at`,
-- `last_failure_at`, `last_error`, `next_retry_at`) and per-listing status.
-- This migration extends them rather than creating a parallel table, and adds
-- the run history, discrepancy, webhook-idempotency and listing-workflow
-- tables that extension needs.
-- =============================================================================

-- The five states the owner actually needs to see (§ Milestone 4 brief).
-- Distinct from `connector_status` (used for supplier connectors): a
-- marketplace connection is either working, not configured, degraded,
-- erroring, or deliberately running in demo mode — five states, not seven,
-- because "rate_limited" and "disabled" are folded into "degraded" and
-- "not_configured" respectively for a marketplace, where the owner cares
-- about "can I trust this right now", not the fine detail of why not.
create type marketplace_connection_status as enum (
  'demo', 'not_configured', 'connected', 'degraded', 'error'
);

alter table channels
  add column status marketplace_connection_status not null default 'not_configured',
  add column api_version text,
  add column rate_limit_per_minute int,
  add column consecutive_failures int not null default 0,
  add column cached_listing_count int not null default 0,
  add column cached_order_count int not null default 0,
  add column webhook_endpoint_configured boolean not null default false;

-- Run history, mirroring research_runs / supplier_connector_runs exactly.
create table channel_sync_runs (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,

  sync_type text not null,              -- 'listings' | 'inventory' | 'orders' | 'fees' | 'reconciliation'
  status    text not null default 'running',   -- running | success | partial | failed
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,

  items_checked int not null default 0,
  items_updated int not null default 0,
  discrepancies_found int not null default 0,

  requests_made int not null default 0,
  error   text,
  summary jsonb not null default '{}'::jsonb,

  -- A retried or duplicated scheduler tick must not double-count a run (§70).
  idempotency_key text,
  unique (org_id, channel_id, idempotency_key)
);

create index channel_sync_runs_channel_idx on channel_sync_runs(channel_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Reconciliation (Commerce OS's record vs the marketplace's own record)
-- -----------------------------------------------------------------------------
-- Deliberately never resolved by assuming one side is right. A discrepancy is
-- recorded with both values and sits open until a sync or a person closes it.

create type discrepancy_field as enum (
  'stock', 'price', 'listing_status', 'order_status', 'fulfilment_status', 'tracking'
);

create table channel_discrepancies (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  channel_product_id uuid references channel_products(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  sync_run_id uuid references channel_sync_runs(id) on delete set null,

  field         discrepancy_field not null,
  our_value     text not null,          -- stringified: neither side is assumed numeric
  marketplace_value text not null,
  our_recorded_at        timestamptz not null,
  marketplace_reported_at timestamptz not null,

  status     text not null default 'open',   -- open | resolved | ignored
  resolution text,                            -- how it was resolved, when it was
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),

  detected_at timestamptz not null default now(),

  constraint discrepancy_has_subject check (
    channel_product_id is not null or order_id is not null
  )
);

create index channel_discrepancies_open_idx
  on channel_discrepancies(org_id, channel_id, status) where status = 'open';

-- -----------------------------------------------------------------------------
-- Idempotent webhook ingestion
-- -----------------------------------------------------------------------------
-- The unique constraint is the idempotency mechanism: a marketplace resending
-- the same event (which every major marketplace's webhook system explicitly
-- warns can happen) inserts nothing the second time, rather than being
-- processed twice.

create table channel_webhook_events (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,

  event_type       text not null,     -- 'orders/create' | 'inventory_levels/update' | ...
  external_event_id text not null,    -- the marketplace's own id for this delivery
  payload          jsonb not null,

  status      text not null default 'received',  -- received | processed | failed | ignored_duplicate
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error       text,

  unique (org_id, channel_id, external_event_id)
);

create index channel_webhook_events_channel_idx
  on channel_webhook_events(channel_id, received_at desc);

-- -----------------------------------------------------------------------------
-- Marketplace listing workflow (distinct from channel_products.status)
-- -----------------------------------------------------------------------------
-- `channel_products.status` (channel_listing_status: not_listed / draft /
-- review_required / blocked / testing / live / paused / removed) is the
-- coarse status the rest of the application already renders. This is the
-- finer-grained workflow that DRIVES it: the specific path a listing takes
-- from being discovered as a candidate through to being published, with its
-- own state machine and its own append-only history, exactly like
-- `product_stage_transitions` for the product lifecycle itself.

create type marketplace_listing_state as enum (
  'discovered', 'evaluating', 'approved', 'ready_to_list',
  'pending_approval', 'published', 'paused', 'ended', 'blocked'
);

alter table channel_products
  add column workflow_state marketplace_listing_state not null default 'discovered';

create table channel_listing_transitions (
  id       bigserial primary key,
  org_id   uuid not null references organisations(id) on delete cascade,
  channel_product_id uuid not null references channel_products(id) on delete cascade,

  from_state marketplace_listing_state,     -- null on first entry
  to_state   marketplace_listing_state not null,

  reason     text not null,
  actor_type actor_type not null default 'system',
  actor_user_id uuid references auth.users(id),
  actor_label   text,

  -- What was true at the moment of the decision, for replay.
  evidence   jsonb not null default '{}'::jsonb,
  ai_decision_id uuid references ai_decisions(id) on delete set null,

  occurred_at timestamptz not null default now()
);

create index channel_listing_transitions_listing_idx
  on channel_listing_transitions(channel_product_id, occurred_at desc);

create trigger channel_listing_transitions_no_update before update on channel_listing_transitions
  for each row execute function forbid_mutation();
create trigger channel_listing_transitions_no_delete before delete on channel_listing_transitions
  for each row execute function forbid_mutation();
