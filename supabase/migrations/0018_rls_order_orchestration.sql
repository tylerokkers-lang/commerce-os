-- =============================================================================
-- 0018_rls_order_orchestration.sql
-- Row level security for the tables added in 0017.
--
-- Same model as every prior RLS migration: transition history is read-only
-- through RLS, written only by the service role, exactly like
-- product_stage_transitions and channel_listing_transitions.
-- =============================================================================

do $$
declare
  t text;
  managed_tables constant text[] := array[
    'order_status_transitions', 'fulfilment_status_transitions'
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
