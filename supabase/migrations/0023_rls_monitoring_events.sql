-- =============================================================================
-- 0023_rls_monitoring_events.sql
-- Row level security for the tables added in 0022.
--
-- Same model as `automation_actions`/`automation_jobs` (Milestone 6): read-only
-- through RLS for every org member, written only by the service role from
-- server-side monitor code. Events and monitor run history must never be
-- creatable or editable by a direct client write.
-- =============================================================================

do $$
declare
  t text;
  managed_tables constant text[] := array[
    'domain_events', 'monitor_observations', 'monitor_runs'
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
