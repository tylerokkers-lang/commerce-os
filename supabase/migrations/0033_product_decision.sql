-- =============================================================================
-- 0033_product_decision.sql
-- The per-product operator decision (ADD/BLOCK/TEST/WATCH/HOLD/REMOVE/REVIEW).
--
-- `products.stage` (0002/0010) is a discovery-to-trading PIPELINE POSITION —
-- a strict, mostly-linear graph (`products/lifecycle.ts`'s `ALLOWED` map
-- explicitly refuses anything not modelled). It is not, and must not become,
-- an operator PERMISSION gate: the two concepts are different (where a
-- candidate is in its journey vs. what the operator has decided to allow),
-- and overloading `stage` would corrupt a working, tested state machine
-- `publicationGate.ts` already depends on. This adds a distinct column on
-- the same, existing `products` table instead — extending the canonical
-- model, never a duplicate product table.
--
-- Default `'review'` (not `'add'`) makes "a newly discovered product is
-- never automatically approved for selling" true by construction, for
-- whenever a live discovery-insert path is eventually built.
--
-- `product_decision_transitions` mirrors `product_stage_transitions` (0010)
-- exactly: append-only, `forbid_mutation()`-guarded, one row per real
-- decision CHANGE (never a same-to-same row).
-- =============================================================================

create type product_decision as enum ('add', 'block', 'test', 'watch', 'hold', 'remove', 'review');

alter table products
  add column decision product_decision not null default 'review',
  add column decision_reason text,
  add column decision_changed_at timestamptz not null default now();

create table product_decision_transitions (
  id bigserial primary key,
  org_id uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  from_decision product_decision,        -- null on first entry
  to_decision   product_decision not null,

  reason text not null,
  actor_type actor_type not null default 'user',
  actor_user_id uuid references auth.users(id),
  actor_label text,

  occurred_at timestamptz not null default now()
);

create index product_decision_transitions_product_idx
  on product_decision_transitions(product_id, occurred_at desc);

create trigger product_decision_transitions_no_update before update on product_decision_transitions
  for each row execute function forbid_mutation();
create trigger product_decision_transitions_no_delete before delete on product_decision_transitions
  for each row execute function forbid_mutation();
