-- =============================================================================
-- 0036_rls_channel_decision.sql
-- Row level security for channel_product_decisions and
-- channel_decision_transitions (0035) — mirrors 0034's exact model.
--
-- channel_product_decisions is current-state, like `products` itself
-- (0009): owner/admin may write it directly, so the executor can use the
-- user-scoped client the same way `decisionExecutor.ts` writes to
-- `products.decision` — no service-role write needed for the current-state
-- row. channel_decision_transitions is read-only through RLS, same as
-- product_decision_transitions.
-- =============================================================================

do $$
declare
  t text;
  read_only_tables constant text[] := array['channel_decision_transitions'];
  managed_tables constant text[] := array['channel_product_decisions', 'channel_decision_transitions'];
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
