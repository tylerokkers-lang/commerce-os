-- =============================================================================
-- 0009_rls.sql
-- Row Level Security (§54).
--
-- Model:
--   * Every org-scoped table is readable by any member of that org.
--   * Writes are restricted to 'owner' and 'admin'.
--   * Append-only and no-delete rules from earlier migrations still apply on
--     top of these policies via triggers; RLS and triggers are independent
--     layers and both must pass.
--   * The service role bypasses RLS. Server-side automation uses it, which is
--     exactly why the service key must never reach the browser.
-- =============================================================================

alter table organisations enable row level security;
alter table memberships   enable row level security;

create policy organisations_read on organisations
  for select using (id in (select auth_org_ids()));

create policy organisations_write on organisations
  for update using (auth_has_role(id, array['owner']::member_role[]))
  with check (auth_has_role(id, array['owner']::member_role[]));

-- A member can see who else is in their org; only owners can change membership.
create policy memberships_read on memberships
  for select using (org_id in (select auth_org_ids()));

create policy memberships_manage on memberships
  for all using (auth_has_role(org_id, array['owner']::member_role[]))
  with check (auth_has_role(org_id, array['owner']::member_role[]));

-- -----------------------------------------------------------------------------
-- Standard org-scoped tables
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  read_only_tables constant text[] := array[
    -- History that the UI must never mutate directly. Writes to these go
    -- through the service role in server-side code only.
    'audit_logs', 'inventory_movements', 'ai_decisions', 'automation_runs',
    'product_scores', 'supplier_scores', 'product_health', 'tax_transactions'
  ];
  managed_tables constant text[] := array[
    'business_settings', 'config_values',
    'products', 'product_variants', 'product_identifiers', 'product_research',
    'product_scores', 'product_content',
    'suppliers', 'supplier_scores', 'supplier_products', 'supplier_documents',
    'supplier_orders', 'supplier_order_items',
    'inventory', 'inventory_movements',
    'channels', 'channel_products', 'amazon_listings', 'shopify_listings',
    'customers', 'addresses', 'orders', 'order_items',
    'fulfilments', 'fulfilment_items', 'shipments', 'payments', 'refunds',
    'invoices', 'credit_notes', 'expenses', 'supplier_invoices',
    'vat_periods', 'tax_transactions', 'accounting_sync',
    'compliance_records', 'compliance_documents',
    'product_performance', 'product_health', 'advertising',
    'ai_decisions', 'automation_rules', 'automation_runs',
    'notifications', 'documents',
    'audit_logs'
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

-- Notifications are the one exception: any member may mark their org's
-- notifications as read without needing write access to anything else.
create policy notifications_mark_read on notifications
  for update using (org_id in (select auth_org_ids()))
  with check (org_id in (select auth_org_ids()));
