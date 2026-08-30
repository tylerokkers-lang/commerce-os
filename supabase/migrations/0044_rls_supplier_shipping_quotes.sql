-- =============================================================================
-- 0044_rls_supplier_shipping_quotes.sql
-- Row level security for supplier_shipping_quotes (0043) — mirrors 0038's
-- product_intelligence model exactly: system-computed, read-only through
-- RLS, written only by the service role. No insert/update/delete policy
-- exists for the org-scoped client; the shipping-quote orchestrator
-- writes with the service-role client, which bypasses RLS entirely.
-- =============================================================================

alter table supplier_shipping_quotes enable row level security;

create policy supplier_shipping_quotes_read on supplier_shipping_quotes
  for select using (org_id in (select auth_org_ids()));
