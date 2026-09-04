-- =============================================================================
-- 0048_supplier_source_url_type.sql
-- Supplier product verification link. `supplier_products.source_url`
-- (0046) already holds a supplier's own link when one is known, but
-- carried no signal for what kind of claim that link makes — a real
-- product page and an official search route are genuinely different
-- claims and must never be presented to the operator as the same thing.
--
-- Nullable, no default, and only ever set alongside `source_url` itself
-- (never independently) — `null` means "no link on file at all" (the
-- existing, unaffected state); once a link IS on file, this says whether
-- it is:
--   'product' — presented as the exact product page. Only ever set from
--     a real, supplier-provided or human-provided URL (never a
--     constructed guess).
--   'search'  — the supplier's own official search route, pre-filled
--     with the stored reference/SKU — Commerce OS cannot guarantee the
--     result is the exact product; the operator confirms that manually.
-- =============================================================================

alter table supplier_products
  add column source_url_type text check (source_url_type is null or source_url_type in ('product', 'search'));
