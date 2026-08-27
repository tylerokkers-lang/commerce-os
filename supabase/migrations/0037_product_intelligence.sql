-- =============================================================================
-- 0037_product_intelligence.sql
-- Product enrichment, quality/risk/opportunity scoring, capital-aware
-- ranking and a deterministic recommendation (Milestone: product
-- intelligence — "master prompt" Phase 4, following HANDOVER.md §56's
-- headless storefront work).
--
-- Audited first, and two tables already existed for exactly this and had
-- never been written to by any code: `product_scores` (0002 — versioned,
-- append-only, `total_score`/`band`/`components`/`weights_version`,
-- already keyed on `product_id`) is precisely the shape the existing
-- 19-component `scoreOpportunity` engine (`src/lib/products/scoring.ts`)
-- was built to persist into — this milestone finally wires that write, no
-- new opportunity-score table. `product_health` (0008 — the identical
-- score/band/components/weights_version shape, product-only) is reused
-- for the Product Quality Score below, matching its name: the quality
-- score genuinely is a measure of how healthy a product's own data is,
-- not of its market opportunity. Neither table's schema changes.
--
-- Risk scoring had no existing home, so `product_risk_scores` below
-- mirrors their exact shape for consistency rather than inventing a
-- different one. Capital-aware ranking, the profitability breakdown, and
-- the final deterministic recommendation are genuinely new concepts with
-- no prior storage anywhere — `product_intelligence` below is the only
-- new "current state" table this milestone adds, and it stores pointers
-- to the three score rows it was computed from rather than copying their
-- breakdowns, so there is exactly one place each score's full "why"
-- lives.
--
-- This is a genuinely new decision layer, not a duplicate of the
-- operator-decision system: `channel_product_decisions` (0035) is the
-- operator's own permission per channel; `product_decision_transitions`
-- (0033) is the operator's overall call; `product_intelligence` is
-- neither — it is the system's own advisory read of "is this product
-- commercially worth carrying at all", which a human then weighs when
-- making the decisions above. It never writes to either decision table.
--
-- Reuses, rather than reimplements, `calculateProfitability`/
-- `assessProfitabilityGate` (`src/lib/profitability`) for every cost
-- figure — this migration adds no new profitability formula, only a place
-- to persist that engine's own output.
-- =============================================================================

create type product_recommendation as enum (
  'strong_candidate', 'candidate', 'review_required', 'low_priority', 'do_not_sell'
);

-- -----------------------------------------------------------------------------
-- Settings this milestone genuinely needs and `business_settings` (0001)
-- did not yet have. `min_gross_margin_pct` and `min_opportunity_score`
-- already existed there since 0001 but were never read by any analysis
-- code until this milestone (see automation/settingsTypes.ts) — not
-- re-added here, only wired in application code.
--
-- The three capital columns are deliberately nullable with no default: an
-- operator's real available capital is a fact about their specific
-- business that cannot be guessed at, and treating an unset value as zero
-- would make every product look capital-starved, while treating it as
-- unlimited would defeat the entire point of this milestone. Application
-- code must treat null as "not yet configured" and say so honestly,
-- never substitute a number.
-- -----------------------------------------------------------------------------

alter table business_settings
  add column min_quality_score int not null default 60 check (min_quality_score between 0 and 100),
  add column max_risk_score int not null default 70 check (max_risk_score between 0 and 100),
  add column target_net_margin_pct numeric(5,2) not null default 35.00,
  add column advertising_allowance_pct numeric(5,2) not null default 15.00,
  add column available_operating_capital_minor bigint check (available_operating_capital_minor is null or available_operating_capital_minor >= 0),
  add column cash_buffer_minor bigint check (cash_buffer_minor is null or cash_buffer_minor >= 0),
  add column max_supplier_cost_minor bigint check (max_supplier_cost_minor is null or max_supplier_cost_minor >= 0),
  add constraint target_margin_not_below_minimum check (target_net_margin_pct >= min_net_margin_pct);

-- -----------------------------------------------------------------------------
-- Risk scoring — mirrors product_scores/product_health's exact shape.
-- Versioned and append-only for the same reason those two are: a risk
-- assessment must be replayable against the inputs that actually produced
-- it, never silently overwritten.
-- -----------------------------------------------------------------------------

create table product_risk_scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  score int not null check (score between 0 and 100),  -- higher = MORE risk, unlike product_scores/product_health where higher is better
  band text not null,                                    -- low | medium | high | severe
  components jsonb not null,
  weights_version text not null,
  computed_at timestamptz not null default now()
);

create index product_risk_scores_product_idx on product_risk_scores(product_id, computed_at desc);

-- -----------------------------------------------------------------------------
-- Current state: one row per product, replaced wholesale on every
-- recalculation (the "why" behind today's recommendation). References the
-- specific product_scores/product_health/product_risk_scores rows it was
-- computed from, so the full breakdown behind each number is always one
-- join away rather than copied here. History of every past recommendation
-- lives in product_intelligence_history below — this table is never the
-- audit trail itself.
-- -----------------------------------------------------------------------------

create table product_intelligence (
  id bigserial primary key,
  org_id uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  quality_score_id uuid not null references product_health(id) on delete cascade,
  opportunity_score_id uuid not null references product_scores(id) on delete cascade,
  risk_score_id uuid not null references product_risk_scores(id) on delete cascade,

  capital_requirement_minor bigint,               -- null when cost data is incomplete — never a guessed figure
  capital_efficiency_score int check (capital_efficiency_score is null or capital_efficiency_score between 0 and 100),
  capital_breakdown jsonb not null,

  profitability_breakdown jsonb not null,          -- calculateProfitability()'s own CostLine[] output, persisted for display
  recommended_price_minor bigint,
  minimum_viable_price_minor bigint,
  currency char(3) not null default 'GBP',

  recommendation product_recommendation not null,
  recommendation_reason text not null,

  engine_version text not null,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, product_id)
);

create index product_intelligence_org_recommendation_idx
  on product_intelligence(org_id, recommendation);

create trigger product_intelligence_touch before update on product_intelligence
  for each row execute function touch_updated_at();

-- -----------------------------------------------------------------------------
-- Append-only history — a summary snapshot of every past recalculation,
-- exactly the `channel_decision_transitions` (0035) precedent. The three
-- score totals are copied here (not just referenced) so "how did the
-- recommendation change over time" is answerable with a single query;
-- each row's full breakdown remains available via its score-table row.
-- -----------------------------------------------------------------------------

create table product_intelligence_history (
  id bigserial primary key,
  org_id uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  quality_score int not null,
  opportunity_score int not null,
  risk_score int not null,
  capital_requirement_minor bigint,
  capital_efficiency_score int,
  recommendation product_recommendation not null,
  recommendation_reason text not null,

  trigger text not null,                           -- e.g. 'manual_recalculation', 'initial_calculation'
  engine_version text not null,
  actor_type actor_type not null default 'system',
  actor_user_id uuid references auth.users(id),
  actor_label text,
  occurred_at timestamptz not null default now()
);

create index product_intelligence_history_product_idx
  on product_intelligence_history(product_id, occurred_at desc);

create trigger product_intelligence_history_no_update before update on product_intelligence_history
  for each row execute function forbid_mutation();
create trigger product_intelligence_history_no_delete before delete on product_intelligence_history
  for each row execute function forbid_mutation();
