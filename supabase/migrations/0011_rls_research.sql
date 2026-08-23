-- =============================================================================
-- 0011_rls_research.sql
-- Row level security for the tables added in 0010.
--
-- Same model as 0009: members read their own org, owners and admins write,
-- and anything the system computes or records as history is read-only through
-- RLS so it can only be written by trusted server-side code.
-- =============================================================================

do $$
declare
  t text;
  -- Written only by the service role: run history, lifecycle history, and
  -- computed projections. A user editing these by hand would break the audit
  -- trail's meaning.
  read_only_tables constant text[] := array[
    'research_runs', 'product_stage_transitions', 'opportunity_projections'
  ];
  managed_tables constant text[] := array[
    'research_providers', 'research_runs', 'product_stage_transitions',
    'opportunity_projections', 'differentiation_suggestions'
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
