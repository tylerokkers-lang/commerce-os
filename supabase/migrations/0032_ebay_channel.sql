-- =============================================================================
-- 0032_ebay_channel.sql
-- eBay as a marketplace channel (Milestone 21).
--
-- `channel_key` (migration 0003) has held exactly `('shopify', 'amazon_uk')`
-- since Milestone 4 — every marketplace-connector table, RLS policy and
-- generic order/fulfilment column already keyed on this enum needs no
-- structural change at all to support a third value; `alter type ... add
-- value` is additive by construction (same pattern `product_stage` already
-- used in migration 0010 to add `'rejected'`).
--
-- No new table: eBay reuses `channels`, `channel_products`,
-- `advertising_connections`-equivalent connection tracking is not needed
-- here because marketplace connection state already lives in application
-- code (`marketplaceConnectorSummary`, derived from real facts, never a
-- database column claiming "connected") — the same reason Shopify/Amazon
-- never needed a connection-state table either.
-- =============================================================================

alter type channel_key add value 'ebay';
