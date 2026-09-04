-- =============================================================================
-- 0046_supplier_url_and_naming.sql
-- Product-catalogue correction: supplier product URL + clean naming.
--
-- SUPPLIER URL. Audited first, not assumed: CJdropshipping's real
-- `/product/query` and `/product/listV2` responses (live-verified against a
-- real, already-imported product) and CJ's own published field
-- documentation both confirm neither endpoint returns a product-page URL,
-- and no documented pattern exists to construct one. `supplier_products`
-- (0003) has never had anywhere to hold one anyway. `source_url` is
-- therefore added nullable, no default — genuinely absent for CJ today,
-- but real and populated the moment a connector that DOES report one
-- (or a manually-entered candidate whose operator pastes a link) is
-- captured. `connector_key`/`connector_product_ref` close a second, real
-- gap found alongside it: the connector and the supplier's own product
-- reference (CJ's `pid`) were only ever held transiently in
-- `product_research.raw_signals` (JSON, on the discovery-staging table)
-- and never copied onto the supplier product record itself — so refetching
-- a supplier's live detail for an already-imported product, or simply
-- answering "what exact supplier listing does this correspond to", always
-- required reaching back into a different table's JSON blob. Storing all
-- three directly on `supplier_products` — the record that already owns
-- `supplier_sku` — keeps supplier identity in the one place it belongs,
-- per the "preferred ownership is the supplier product record" rule this
-- milestone's brief states explicitly.
--
-- NAMING. `products.title` (0002) is the one field every catalogue view,
-- Product Intelligence card and dashboard already reads as "the product's
-- name" — it stays exactly that role, but from this migration on its
-- value is Commerce OS's own clean, generated name, never the supplier's
-- raw text directly. `supplier_title` is new: the untouched, verbatim
-- supplier-provided title, preserved permanently on the product's own
-- record (not only in `product_research`, which is a staging table with
-- no guarantee of remaining linked forever) so "what was the supplier
-- actually calling this" stays answerable from the product itself, always.
-- Nullable — a manually-created product with no supplier origin has none.
-- =============================================================================

alter table supplier_products
  add column source_url text check (source_url is null or source_url ~ '^https?://'),
  add column connector_key text,
  add column connector_product_ref text;

alter table products
  add column supplier_title text;
