-- =============================================================================
-- 0039_supplier_discovery.sql
-- Supplier discovery & product ingestion (Phase 5 of the customer-facing
-- store, following Phase 4's product intelligence milestone).
--
-- Audited first, and this table already carried almost everything Phase 5
-- needed — a second, closer read of `product_research` after 0010
-- (Milestone 2) found more than the 0002 CREATE TABLE alone showed:
--   - `candidate_status` already exists (`new`/`scored`/`promoted`/
--     `rejected`/`duplicate`/`archived`) — this migration reuses it
--     directly (`new`→pending, `duplicate`→possible duplicate,
--     `promoted`→imported, `rejected`→rejected) rather than adding a
--     second, near-identical enum, which an earlier draft of this
--     migration nearly did before `npm run db:verify` caught the
--     `type "candidate_status" already exists` collision.
--   - `estimated_unit_cost_minor`/`estimated_shipping_minor`/`currency`
--     already exist — reused directly, no `unit_cost_minor`/
--     `shipping_cost_minor` duplicates added.
--   - `rejected_reason` already exists and is reused for both a rejection
--     and a duplicate-match explanation (one "why this status" field,
--     not two near-identical ones).
--   - `product_id` (nullable, already there) is the exact "may or may not
--     have become a real product yet" shape a product candidate needs,
--     and `research_source` already includes `'supplier_catalogue'`.
-- The table was completely unused by any application code before this
-- migration (confirmed by grepping `src/`, finding zero references
-- outside generated types) — exactly the same "found and reused, not
-- duplicated" situation Phase 4 found with `product_scores`/`product_health`.
--
-- Only three columns were genuinely missing: a supplier link (no FK from
-- `product_research` to `suppliers` existed at all), a supplier SKU, and
-- a self-reference for "which existing candidate/product does this match."
--
-- `supplier_products` (0003) already supports multiple supplier offers per
-- product (`unique (org_id, supplier_id, product_id, variant_id)`), which
-- is the entire "PRODUCT SOURCE HISTORY / SUPPLIER OFFER MODEL"
-- requirement — nothing new needed there either. Once a candidate is
-- imported, it becomes one real `products` row (stage 'discovered') plus
-- one real `supplier_products` row, and Phase 4's
-- `computeProductIntelligence` runs on it completely unchanged.
--
-- Most discovery *criteria* already exist on `business_settings`:
-- `max_supplier_cost_minor`/`min_net_margin_pct`/`max_delivery_days`/
-- `max_risk_score`/`min_quality_score`/`available_operating_capital_minor`
-- (Phase 4, 0037) and `blocked_categories`/`allowed_categories`/
-- `preferred_countries` (Milestone 1, 0001) — none of these are
-- duplicated here. Only the two genuinely new run-size limits are added.
-- =============================================================================

alter table product_research
  add column supplier_id uuid references suppliers(id) on delete set null,
  add column supplier_sku text,
  add column duplicate_of uuid references product_research(id) on delete set null;

create index product_research_supplier_idx on product_research(supplier_id);

alter table business_settings
  add column max_candidates_per_discovery_run int not null default 20 check (max_candidates_per_discovery_run > 0),
  add column max_products_pending_review int not null default 50 check (max_products_pending_review > 0);
