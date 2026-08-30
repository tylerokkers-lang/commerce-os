-- =============================================================================
-- 0040_shopify_publication.sql
-- Controlled Shopify product publication (Milestone: Phase 6 of the
-- customer-facing store, following Phase 5's supplier discovery).
--
-- Audited first, and found almost everything already built:
--   - `channel_products` (0005, Milestone 1) already has `external_id`/
--     `external_sku`/`listing_url`/`status`/`price_minor`/`compare_at_minor`/
--     `fulfilment_supplier_id`/`last_synced_at`/`sync_error` — the entire
--     "PRODUCT ↔ SHOPIFY MAPPING" the brief asks for. No new columns.
--   - `workflow_state marketplace_listing_state` (0015, Milestone 4) —
--     discovered/evaluating/approved/ready_to_list/pending_approval/
--     published/paused/ended/blocked — already added to `channel_products`,
--     already has a matching pure state machine
--     (`src/lib/marketplaces/listingLifecycle.ts`'s `planListingTransition`)
--     and an append-only history table (`channel_listing_transitions`,
--     also 0015, with an `evidence jsonb` column for exactly "what was
--     true at the moment of the decision"). Confirmed unused by any
--     application code before this milestone. This is the brief's entire
--     "PRODUCT PUBLICATION STATE MACHINE" section — reused outright, no
--     second state machine.
--   - `assessPublicationReadiness` (`src/lib/marketplaces/publicationGate.ts`,
--     Milestone 4) is the brief's "PRODUCT ELIGIBILITY GATE", reused
--     wholesale by the new `shopify/eligibility.ts` rather than
--     re-derived.
-- Only one genuinely new setting was needed.
-- =============================================================================

alter table business_settings
  add column min_product_images int not null default 1 check (min_product_images >= 0);
