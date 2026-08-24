-- =============================================================================
-- 0025_rls_global_markets.sql
-- Row level security for the tables added in 0024.
--
-- All four are read-only through RLS: every org member can read them, but
-- only the service role writes, from server-side monitors/handlers. None of
-- them has a UI edit form in this milestone, so there is no case for
-- owner/admin insert/update access the way `supplier_products` or
-- `compliance_records` have — writing "the current exchange rate" or "the
-- market compliance verdict" by hand through the UI is exactly the kind of
-- unattributed fact this milestone's brief explicitly warns against.
-- =============================================================================

do $$
declare
  t text;
  managed_tables constant text[] := array[
    'exchange_rates', 'supplier_market_capabilities',
    'market_compliance_assessments', 'market_expansion_assessments'
  ];
begin
  foreach t in array managed_tables loop
    execute format('alter table %I enable row level security', t);

    execute format(
      'create policy %I on %I for select using (org_id in (select auth_org_ids()))',
      t || '_read', t
    );
  end loop;
end;
$$;
