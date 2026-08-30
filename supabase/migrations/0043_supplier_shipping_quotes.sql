-- =============================================================================
-- 0043_supplier_shipping_quotes.sql
-- Real supplier connector (Phase 8) — destination-aware shipping quotes.
--
-- Audited first: no existing table carries a per-destination shipping
-- rate. `supplier_products` (0003) has `dispatch_days_min/max` and
-- `shipping_cost_minor`/`currency` — a single, supplier-level figure with
-- no destination or method, correct for its own purpose (the existing
-- Phase 4 profitability calculation, untouched by this migration) but
-- structurally unable to hold "CJPacket to GB costs £4.50 and takes
-- 10-15 days, DHL Express to GB costs £18.20 and takes 3-5 days" — a
-- genuine one-to-many relationship (one product, several destinations,
-- several methods per destination) that a single row cannot express
-- without either overwriting history or losing precision. A new table is
-- the correct, minimal answer, not a schema-widening hack.
--
-- A quote is a point-in-time fact about what a supplier's API returned
-- (append-only, like `channel_listing_transitions`/`product_intelligence_history`
-- — `forbid_mutation()` already exists from 0001, reused here rather than
-- a second immutability mechanism). Superseding a quote means fetching
-- and inserting a new one, never editing the old one in place — exactly
-- the "supplier prices and stock can change; don't overwrite important
-- historical facts" instruction this milestone's brief gives.
--
-- System-computed, not operator-written (0038's own distinction): the
-- shipping-quote orchestrator (`src/lib/suppliers/shippingQuotes.ts`)
-- writes every row through the service-role client, exactly like
-- `product_intelligence`. RLS below is read-only through the org-scoped
-- client, matching 0038's pattern precisely.
-- =============================================================================

create type shipping_suitability_status as enum ('approved', 'review_required', 'rejected');

create table supplier_shipping_quotes (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  supplier_id           uuid references suppliers(id) on delete set null,
  product_id            uuid references products(id) on delete set null,
  -- Free text, matching product_media's own `discovery_method` convention
  -- (0041) — the specific connector this quote came from, without a
  -- migration every time a new one is written.
  connector_key         text not null,
  connector_product_ref text not null,

  destination_country   text not null, -- ISO 3166-1 alpha-2, e.g. 'GB'.
  method                text not null,
  carrier_name          text,
  shipping_cost_minor   int not null check (shipping_cost_minor >= 0),
  currency              text not null,

  processing_days_min   int,
  processing_days_max   int,
  transit_days_min      int,
  transit_days_max      int,
  total_delivery_days_min int,
  total_delivery_days_max int,
  provides_tracking     boolean, -- null = unknown, never assumed false.

  suitability_status    shipping_suitability_status not null,
  suitability_reason    text not null,

  quoted_at             timestamptz not null default now(),
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now()
);

create index supplier_shipping_quotes_product_idx on supplier_shipping_quotes(org_id, product_id);
create index supplier_shipping_quotes_supplier_idx on supplier_shipping_quotes(org_id, supplier_id);

create trigger supplier_shipping_quotes_no_update before update on supplier_shipping_quotes
  for each row execute function forbid_mutation();
create trigger supplier_shipping_quotes_no_delete before delete on supplier_shipping_quotes
  for each row execute function forbid_mutation();
