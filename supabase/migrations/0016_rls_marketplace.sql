-- =============================================================================
-- 0016_rls_marketplace.sql
-- Row level security for the tables added in 0015.
--
-- Same model as every prior RLS migration: members read their org's rows,
-- owners and admins write, and run/history/event tables are read-only through
-- RLS because only trusted server-side code (the service role) should ever
-- write a sync run, a discrepancy, a webhook event, or a listing transition.
-- =============================================================================

do $$
declare
  t text;
  read_only_tables constant text[] := array[
    'channel_sync_runs', 'channel_discrepancies', 'channel_webhook_events',
    'channel_listing_transitions'
  ];
  managed_tables constant text[] := array[
    'channel_sync_runs', 'channel_discrepancies', 'channel_webhook_events',
    'channel_listing_transitions'
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

-- channel_discrepancies is read-only for inserts (service role) but an
-- owner/admin must be able to resolve one (update its status/resolution).
create policy channel_discrepancies_resolve on channel_discrepancies
  for update using (auth_has_role(org_id, array['owner','admin']::member_role[]))
  with check (auth_has_role(org_id, array['owner','admin']::member_role[]));
