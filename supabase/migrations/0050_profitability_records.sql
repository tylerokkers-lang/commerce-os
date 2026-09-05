-- =============================================================================
-- 0050_profitability_records.sql
-- Milestone: continuous candidate lifecycle — the persisted profitability
-- verdict.
--
-- Audited first, and this is the ONE genuinely missing fact table:
--
--   * `compliance_records` (0008) already stores a current, per-(product,
--     channel) compliance verdict with its own `verdict` enum, `checks`,
--     `blocking_reasons`, `ruleset_version` and `assessed_at`. Nothing has
--     ever written to it (zero rows in production), but the SHAPE is
--     correct and complete — so compliance needs no migration at all, only
--     a writer. This table is deliberately its mirror image so the two
--     read the same way.
--
--   * Profitability has no equivalent. `product_intelligence` (0037) stores
--     `profitability_breakdown` (the per-line cost breakdown) and a
--     `recommendation`, but (a) it is keyed per-product, not per-product-
--     per-channel, and (b) it discards the gate verdict itself:
--     `assessProfitabilityGate`'s pass/fail is computed in
--     `products/intelligence/assemble.ts` and
--     `marketplaces/channelReadiness.ts`, used to feed a recommendation,
--     and then thrown away. `recommendation = 'do_not_sell'` is NOT a
--     usable substitute: it also fires for "no supplier assigned", so
--     reading it as "profitability failed" would conflate two different
--     facts.
--
-- The lifecycle gate (`products/lifecycle.ts`'s `checkGates`) needs
-- `profitablePassesAnyChannel` as a real, current, queryable fact before a
-- candidate may reach `approved`. That is what this table provides.
--
-- Tri-state on purpose. `ProfitabilityGate` in the engine is a boolean
-- (`passes: true | false`), which structurally cannot distinguish "we
-- calculated this and it failed" from "we could not calculate it at all"
-- (no price on file, no supplier cost, eBay's fee schedule not wired up).
-- Collapsing those two into `false` would be safe for blocking but would
-- make "unknown" indistinguishable from "failed" to an operator, and would
-- silently satisfy a future reader looking for a real negative verdict.
-- `not_assessed` is therefore a first-class value, exactly as
-- `compliance_verdict` already models it.
--
-- System-computed, not operator-written: written only through the
-- service-role client by the profitability recheck path, with RLS
-- read-only for org members — the same model 0038 (`product_intelligence`)
-- and 0044 (`supplier_shipping_quotes`) already establish.
-- =============================================================================

create type profitability_verdict as enum ('pass', 'fail', 'not_assessed');

create table profitability_records (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel    channel_key not null,

  verdict    profitability_verdict not null default 'not_assessed',
  -- Why it failed, or why it could not be assessed. Empty on a pass.
  failure_reasons text[] not null default '{}',

  -- The assessment itself. Null when `verdict = 'not_assessed'` — never a
  -- zero standing in for "unknown", per docs/PRINCIPLES.md §1.
  gross_margin_pct numeric(6,2),
  net_margin_pct   numeric(6,2),

  -- What it was judged against, so a stored verdict can always be
  -- explained without re-reading whatever business_settings happens to say
  -- today. A verdict computed under different thresholds is a different
  -- fact, and this is how a reader can tell.
  min_gross_margin_pct numeric(5,2),
  min_net_margin_pct   numeric(5,2),

  -- The real inputs the verdict was computed from (provenance). Null
  -- individually where that specific input was genuinely unavailable.
  selling_price_minor  bigint,
  unit_cost_minor      bigint,
  shipping_cost_minor  bigint,
  currency             text,

  -- Which supplier's economics this verdict describes; a verdict computed
  -- against a different supplier is not transferable.
  supplier_id uuid references suppliers(id) on delete set null,

  -- Matches `product_intelligence.engine_version`'s purpose exactly.
  engine_version text not null,

  assessed_at timestamptz not null default now(),
  assessed_by actor_type not null default 'system',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One current fact per product per channel, mirroring
  -- `compliance_records`'s own `unique (org_id, product_id, channel)`.
  -- History lives in `automation_actions`/`audit_logs`, which already
  -- record every recheck; a second history table would duplicate them.
  unique (org_id, product_id, channel)
);

create index profitability_records_verdict_idx on profitability_records(org_id, channel, verdict);
create index profitability_records_assessed_at_idx on profitability_records(org_id, assessed_at desc);

alter table profitability_records enable row level security;

create policy profitability_records_read on profitability_records
  for select using (org_id in (select auth_org_ids()));
