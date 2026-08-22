-- =============================================================================
-- 0004_inventory.sql
-- Single source of truth for stock (§22), plus an append-only movement ledger.
-- =============================================================================

-- In the inventory-free launch model (§23) most products have no owned stock at
-- all; availability is the supplier's. `is_supplier_stocked` distinguishes the
-- two so the reorder engine does not raise purchase orders for dropshipped SKUs.

create table inventory (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  location   text not null default 'default',

  on_hand_qty   int not null default 0,
  reserved_qty  int not null default 0 check (reserved_qty >= 0),
  incoming_qty  int not null default 0 check (incoming_qty >= 0),

  is_supplier_stocked boolean not null default true,

  reorder_point    int not null default 0,
  safety_stock     int not null default 0,
  reorder_quantity int not null default 0,
  lead_time_days   int,

  is_demo    boolean not null default false,
  updated_at timestamptz not null default now(),

  unique (org_id, product_id, variant_id, location)
);

-- Available stock is derived, never stored, so it cannot drift out of step.
create or replace function inventory_available(inv inventory)
returns int
language sql
immutable
as $$
  select greatest(inv.on_hand_qty - inv.reserved_qty, 0)
$$;

create index inventory_product_idx on inventory(product_id);

create type movement_reason as enum (
  'purchase_received', 'sale', 'reservation', 'reservation_released',
  'return', 'adjustment', 'damage', 'loss', 'recount', 'supplier_sync', 'demo_seed'
);

-- Append-only. Stock levels are reconstructable from this ledger.
create table inventory_movements (
  id           bigserial primary key,
  org_id       uuid not null references organisations(id) on delete cascade,
  inventory_id uuid not null references inventory(id) on delete cascade,

  reason       movement_reason not null,
  quantity_delta int not null,
  balance_after  int not null,

  reference_type text,
  reference_id   text,
  note           text,

  -- A retried sync must not double-count stock (§70)
  idempotency_key text,
  actor_type   actor_type not null default 'system',
  occurred_at  timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create index inventory_movements_inv_idx on inventory_movements(inventory_id, occurred_at desc);

create trigger inventory_movements_no_update before update on inventory_movements
  for each row execute function forbid_mutation();
create trigger inventory_movements_no_delete before delete on inventory_movements
  for each row execute function forbid_mutation();

create trigger inventory_touch before update on inventory
  for each row execute function touch_updated_at();
