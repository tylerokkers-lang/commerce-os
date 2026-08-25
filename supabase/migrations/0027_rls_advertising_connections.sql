-- =============================================================================
-- 0027_rls_advertising_connections.sql
-- Row level security for the table added in 0026.
--
-- Read-only through RLS, the same pattern as 0025's four tables: every org
-- member can read connection state, but only the service role writes, from
-- the sync engine (`advertising/sync.ts`) and job handlers
-- (`automation/handlers/advertisingHandlers.ts`). There is no UI edit form
-- for "is this platform connected" in this milestone — that fact is only
-- ever observed (a sync attempt succeeded or failed), never hand-set.
-- =============================================================================

alter table advertising_connections enable row level security;

create policy advertising_connections_read on advertising_connections
  for select using (org_id in (select auth_org_ids()));
