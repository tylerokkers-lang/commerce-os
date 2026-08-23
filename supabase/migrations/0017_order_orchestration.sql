-- =============================================================================
-- 0017_order_orchestration.sql
-- Milestone 5: order and fulfilment orchestration.
--
-- `orders`, `order_items`, `fulfilments`, `fulfilment_items`, `shipments`,
-- `payments` and `refunds` already exist from 0006, fully idempotent and
-- RLS-covered. This migration adds only what orchestrating them needs: an
-- optional risk signal on orders, a configurable refund approval limit
-- (the same pattern as `max_auto_purchase_minor`), and append-only transition
-- history for both the order and fulfilment state machines, mirroring
-- `product_stage_transitions` and `channel_listing_transitions` exactly.
-- =============================================================================

alter table orders
  -- "Fraud/risk status where available" — nullable and explicitly separate
  -- from is-it-paid, because a connector that does not report risk (neither
  -- Shopify nor Amazon does through the read-only calls built in Milestone 4)
  -- must leave this null rather than imply a status nobody actually assessed.
  add column risk_level text check (risk_level in ('low', 'medium', 'high', 'unknown')),
  add column risk_assessed_at timestamptz;

alter table business_settings
  -- Same shape as max_auto_purchase_minor: money leaving the business
  -- automatically needs its own explicit, configurable ceiling, distinct from
  -- the ceiling on money committed to a supplier order.
  add column max_auto_refund_minor bigint not null default 5000;  -- £50

create table order_status_transitions (
  id       bigserial primary key,
  org_id   uuid not null references organisations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,

  from_status order_status,        -- null on first entry
  to_status   order_status not null,

  reason      text not null,
  actor_type  actor_type not null default 'system',
  actor_user_id uuid references auth.users(id),
  actor_label   text,

  evidence    jsonb not null default '{}'::jsonb,
  ai_decision_id uuid references ai_decisions(id) on delete set null,

  occurred_at timestamptz not null default now()
);

create index order_status_transitions_order_idx
  on order_status_transitions(order_id, occurred_at desc);

create trigger order_status_transitions_no_update before update on order_status_transitions
  for each row execute function forbid_mutation();
create trigger order_status_transitions_no_delete before delete on order_status_transitions
  for each row execute function forbid_mutation();

create table fulfilment_status_transitions (
  id       bigserial primary key,
  org_id   uuid not null references organisations(id) on delete cascade,
  fulfilment_id uuid not null references fulfilments(id) on delete cascade,

  from_status fulfilment_status,
  to_status   fulfilment_status not null,

  reason      text not null,
  actor_type  actor_type not null default 'system',
  actor_user_id uuid references auth.users(id),
  actor_label   text,

  evidence    jsonb not null default '{}'::jsonb,
  ai_decision_id uuid references ai_decisions(id) on delete set null,

  occurred_at timestamptz not null default now()
);

create index fulfilment_status_transitions_fulfilment_idx
  on fulfilment_status_transitions(fulfilment_id, occurred_at desc);

create trigger fulfilment_status_transitions_no_update before update on fulfilment_status_transitions
  for each row execute function forbid_mutation();
create trigger fulfilment_status_transitions_no_delete before delete on fulfilment_status_transitions
  for each row execute function forbid_mutation();
