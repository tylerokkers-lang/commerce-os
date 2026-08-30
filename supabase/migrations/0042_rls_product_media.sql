-- =============================================================================
-- 0042_rls_product_media.sql
-- Row level security for product_media (0041) — the standard managed-table
-- model from 0009/0034/0036: org members read, owner/admin write, owner
-- delete. `product_media` is mutable current-state written directly by
-- operator actions (approve/reject/set-primary/remove/manual-attach), not
-- a system-only computed table like `product_intelligence` — the same
-- distinction 0038's own comment draws between the two shapes.
-- =============================================================================

alter table product_media enable row level security;

create policy product_media_read on product_media
  for select using (org_id in (select auth_org_ids()));

create policy product_media_insert on product_media
  for insert with check (auth_has_role(org_id, array['owner','admin']::member_role[]));

create policy product_media_update on product_media
  for update using (auth_has_role(org_id, array['owner','admin']::member_role[]))
  with check (auth_has_role(org_id, array['owner','admin']::member_role[]));

create policy product_media_delete on product_media
  for delete using (auth_has_role(org_id, array['owner']::member_role[]));
