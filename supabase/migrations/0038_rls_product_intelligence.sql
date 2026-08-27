-- =============================================================================
-- 0038_rls_product_intelligence.sql
-- Row level security for product_risk_scores, product_intelligence and
-- product_intelligence_history (0037) — mirrors the exact model 0009
-- already applies to product_scores/product_health (both read-only
-- through RLS, written only by the service role — their policies are
-- untouched here since they already exist).
--
-- All three of these tables are system-computed, not operator-written, so
-- each gets only a select policy: the assembler
-- (`src/lib/products/intelligence/assemble.ts`) writes every one of them
-- with the service-role client, which bypasses RLS entirely, exactly like
-- every other engine-written table in this schema (0009's own comment:
-- "writes to these go through the service role in server-side code
-- only"). No insert/update/delete policy is created for any of them.
-- =============================================================================

do $$
declare
  t text;
  tables constant text[] := array['product_risk_scores', 'product_intelligence', 'product_intelligence_history'];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select using (org_id in (select auth_org_ids()))',
      t || '_read', t
    );
  end loop;
end;
$$;
