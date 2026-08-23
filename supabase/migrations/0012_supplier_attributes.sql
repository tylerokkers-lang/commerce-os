-- =============================================================================
-- 0012_supplier_attributes.sql
-- The supplier attributes the scoring engine needs (§12, §13).
--
-- These are split between what a supplier *claims* (policy, quoted lead times)
-- and what we have *observed* (orders placed, orders late, defects). The
-- scoring engine treats the two very differently: a claim is worth something,
-- an observation is worth much more, and a supplier with no history is scored
-- with lower confidence rather than being assumed reliable.
-- =============================================================================

alter table suppliers
  -- Stated policy
  add column returns_policy       text,
  add column returns_window_days  int check (returns_window_days >= 0),
  add column accepts_faulty_returns boolean not null default false,
  add column min_order_value_minor bigint check (min_order_value_minor >= 0),
  add column supports_own_branding boolean not null default false,
  add column notes                text,

  -- Observed performance. Null means no history, which is not the same as zero.
  add column orders_placed  int not null default 0 check (orders_placed >= 0),
  add column orders_late    int not null default 0 check (orders_late >= 0),
  add column orders_defective int not null default 0 check (orders_defective >= 0),
  add column quality_rating numeric(3,2) check (quality_rating between 1 and 5),
  add column communication_rating numeric(3,2) check (communication_rating between 1 and 5),

  -- Cached from the most recent supplier_scores row so lists can sort without
  -- a lateral join. The scores table remains the source of truth.
  add column current_score int check (current_score between 0 and 100),
  add column current_score_at timestamptz,

  add constraint late_orders_within_placed check (orders_late <= orders_placed),
  add constraint defective_orders_within_placed check (orders_defective <= orders_placed);

-- A supplier's observed on-time rate, derived rather than stored, so it cannot
-- disagree with the counts it comes from.
create or replace function supplier_on_time_rate(s suppliers)
returns numeric
language sql
immutable
as $$
  select case
    when s.orders_placed = 0 then null
    else round(((s.orders_placed - s.orders_late)::numeric / s.orders_placed) * 100, 2)
  end
$$;

create index suppliers_score_idx on suppliers(org_id, current_score desc nulls last);
