-- =============================================================================
-- 0034_rls_product_decision.sql
-- Row level security for product_decision_transitions (0033).
--
-- `products` itself already has RLS from 0009 (owner/admin write) — a new
-- column needs no new policy. Only the new transitions table does, and it
-- follows 0011's exact model: read-only through RLS (written only by
-- trusted server-side code via the service role), same as
-- product_stage_transitions.
-- =============================================================================

do $$
declare
  t text;
  read_only_tables constant text[] := array['product_decision_transitions'];
  managed_tables constant text[] := array['product_decision_transitions'];
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
