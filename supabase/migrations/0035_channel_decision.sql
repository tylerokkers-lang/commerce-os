-- =============================================================================
-- 0035_channel_decision.sql
-- Channel-level operator decisions (Milestone: channel-level decisions,
-- HANDOVER.md §53's recommended next step after the product-level decision
-- system, §50/0033).
--
-- A product can be `add` overall while independently `block` on one
-- channel — these are genuinely two different gates a caller may need to
-- check, never one collapsed value (the exact distinction §53 stated).
-- Reuses the existing `product_decision` enum unchanged (add/block/test/
-- watch/hold/remove/review) rather than inventing a second, parallel one —
-- the same operator permission concept, at finer granularity.
--
-- `channel_products` (0005) already models per-channel *listing state*
-- (not_listed/draft/live/...) — a workflow position written by sync code.
-- This is deliberately a separate concept: an operator *permission*,
-- independent of whether a listing row exists yet (you can BLOCK a channel
-- before ever attempting to list on it). Keyed on the bare `channel_key`
-- enum, not a `channel_products.id` FK, for exactly that reason.
-- =============================================================================

create table channel_product_decisions (
  id bigserial primary key,
  org_id uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel channel_key not null,
  decision product_decision not null default 'review',
  decision_reason text,
  decision_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, product_id, channel)
);

create table channel_decision_transitions (
  id bigserial primary key,
  org_id uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel channel_key not null,
  from_decision product_decision,        -- null on first entry for this (product, channel)
  to_decision   product_decision not null,
  reason text not null,
  actor_type actor_type not null default 'user',
  actor_user_id uuid references auth.users(id),
  actor_label text,
  occurred_at timestamptz not null default now()
);

create index channel_decision_transitions_product_channel_idx
  on channel_decision_transitions(product_id, channel, occurred_at desc);

create trigger channel_decision_transitions_no_update before update on channel_decision_transitions
  for each row execute function forbid_mutation();
create trigger channel_decision_transitions_no_delete before delete on channel_decision_transitions
  for each row execute function forbid_mutation();

create trigger channel_product_decisions_touch_updated_at before update on channel_product_decisions
  for each row execute function touch_updated_at();
