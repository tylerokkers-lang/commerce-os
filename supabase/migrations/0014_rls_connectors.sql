-- =============================================================================
-- 0014_rls_connectors.sql
-- Row level security for the tables added in 0013.
--
-- Same model as 0009 and 0011: members read their org's rows, owners and
-- admins write, and run history is read-only through RLS because only
-- trusted server-side code (the service role) should ever write a sync
-- history record.
-- =============================================================================

do $$
declare
  t text;
  read_only_tables constant text[] := array[
    'supplier_connector_runs', 'supplier_price_history'
  ];
  managed_tables constant text[] := array[
    'supplier_connectors', 'supplier_connector_runs', 'supplier_price_history'
  ];
begin
  foreach t in array managed_tables loop
    execute format('alter table %I enable row level security', t);

    execute format(
      'create policy %I on %I for select using (org_id in (select auth_org_ids()))',
      t || '_read', t
    );

    if not (t = any(read_only_tables)) then
      execute format(
        'create policy %I on %I for insert with check (auth_has_role(org_id, array[''owner'',''admin'']::member_role[]))',
        t || '_insert', t
      );
      execute format(
        'create policy %I on %I for update using (auth_has_role(org_id, array[''owner'',''admin'']::member_role[])) with check (auth_has_role(org_id, array[''owner'',''admin'']::member_role[]))',
        t || '_update', t
      );
      execute format(
        'create policy %I on %I for delete using (auth_has_role(org_id, array[''owner'']::member_role[]))',
        t || '_delete', t
      );
    end if;
  end loop;
end;
$$;
