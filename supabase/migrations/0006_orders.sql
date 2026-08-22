-- =============================================================================
-- 0006_orders.sql
-- Customers, orders, fulfilment, shipments, payments, refunds.
-- =============================================================================

create table customers (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  email        citext,
  first_name   text,
  last_name    text,
  phone        text,

  -- Marketplace customers are pseudonymised by Amazon; we keep whatever the
  -- API actually gives us rather than inventing a fuller record.
  source_channel channel_key,
  external_id    text,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_org_email_idx on customers(org_id, email);

create table addresses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,

  name       text,
  company    text,
  line1      text,
  line2      text,
  city       text,
  region     text,
  postcode   text,
  country    char(2) not null default 'GB',
  phone      text,
  created_at timestamptz not null default now()
);

create type order_status as enum (
  'pending', 'paid', 'awaiting_fulfilment', 'partially_fulfilled',
  'fulfilled', 'delivered', 'cancelled', 'refunded', 'partially_refunded', 'failed'
);

create table orders (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  order_number text not null,
  channel      channel_key not null,
  external_id  text,                    -- Shopify order id / Amazon order id

  customer_id  uuid references customers(id) on delete set null,
  shipping_address_id uuid references addresses(id) on delete set null,
  billing_address_id  uuid references addresses(id) on delete set null,

  status  order_status not null default 'pending',

  -- Money in. Every figure is what the customer actually paid.
  subtotal_minor  bigint not null default 0,
  shipping_minor  bigint not null default 0,
  discount_minor  bigint not null default 0,
  tax_minor       bigint not null default 0,
  total_minor     bigint not null default 0,
  currency        char(3) not null default 'GBP',

  -- Money out. Populated as real costs land, not estimated at order time.
  cogs_minor            bigint not null default 0,
  supplier_shipping_minor bigint not null default 0,
  channel_fees_minor    bigint not null default 0,
  payment_fees_minor    bigint not null default 0,
  refunded_minor        bigint not null default 0,

  placed_at    timestamptz not null default now(),
  fulfilled_at timestamptz,
  delivered_at timestamptz,

  -- One external order can only ever create one internal order (§70)
  idempotency_key text not null,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, order_number),
  unique (org_id, idempotency_key),
  unique (org_id, channel, external_id)
);

create index orders_org_placed_idx on orders(org_id, placed_at desc);
create index orders_org_status_idx on orders(org_id, status);

create table order_items (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references organisations(id) on delete cascade,
  order_id  uuid not null references orders(id) on delete cascade,

  product_id uuid references products(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,

  -- Snapshotted so an invoice reprinted in three years still reads correctly
  -- even if the catalogue entry has since changed or been removed.
  sku         text not null,
  description text not null,

  quantity          int not null check (quantity > 0),
  unit_price_minor  bigint not null check (unit_price_minor >= 0),
  discount_minor    bigint not null default 0,
  tax_rate_pct      numeric(5,2) not null default 0,
  tax_minor         bigint not null default 0,
  line_total_minor  bigint not null,

  unit_cost_minor   bigint,             -- COGS at the time of sale
  created_at        timestamptz not null default now()
);

create index order_items_order_idx on order_items(order_id);

-- -----------------------------------------------------------------------------
-- Fulfilment (§24)
-- -----------------------------------------------------------------------------

create type fulfilment_status as enum (
  'pending', 'awaiting_supplier', 'submitted', 'accepted',
  'shipped', 'delivered', 'failed', 'cancelled'
);

create table fulfilments (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,

  supplier_id uuid references suppliers(id) on delete set null,
  status      fulfilment_status not null default 'pending',

  cost_minor           bigint not null default 0,
  shipping_cost_minor  bigint not null default 0,
  currency             char(3) not null default 'GBP',

  supplier_reference text,
  submitted_at  timestamptz,
  shipped_at    timestamptz,
  delivered_at  timestamptz,
  failure_reason text,
  attempt_count int not null default 0,

  -- Prevents a retried job from ordering the same goods twice (§70)
  idempotency_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create table fulfilment_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations(id) on delete cascade,
  fulfilment_id uuid not null references fulfilments(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  quantity      int not null check (quantity > 0)
);

create table shipments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations(id) on delete cascade,
  fulfilment_id uuid not null references fulfilments(id) on delete cascade,

  carrier         text,
  service         text,
  tracking_number text,
  tracking_url    text,

  shipped_at    timestamptz,
  delivered_at  timestamptz,
  promised_by   date,             -- delivery promise made to the customer
  last_status   text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shipments_fulfilment_idx on shipments(fulfilment_id);

-- -----------------------------------------------------------------------------
-- Payments and refunds (§38 — records are never deleted, only offset)
-- -----------------------------------------------------------------------------

create type payment_status as enum ('pending', 'authorised', 'captured', 'failed', 'refunded', 'partially_refunded');

create table payments (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,

  provider     text not null,          -- 'shopify_payments' | 'amazon' | ...
  external_id  text,
  status       payment_status not null default 'pending',

  gross_minor  bigint not null,
  fee_minor    bigint not null default 0,
  net_minor    bigint not null,
  currency     char(3) not null default 'GBP',

  captured_at  timestamptz,
  payout_expected_on date,             -- feeds the cashflow engine (§48)
  payout_received_on date,

  created_at timestamptz not null default now(),
  unique (org_id, provider, external_id)
);

create type refund_reason as enum (
  'customer_changed_mind', 'damaged', 'not_as_described', 'not_delivered',
  'late_delivery', 'faulty', 'goodwill', 'pricing_error', 'other'
);

create table refunds (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  payment_id uuid references payments(id) on delete set null,

  amount_minor bigint not null check (amount_minor > 0),
  tax_minor    bigint not null default 0,
  currency     char(3) not null default 'GBP',
  reason       refund_reason not null default 'other',
  note         text,
  is_full_refund boolean not null default false,

  external_id  text,
  idempotency_key text not null,
  created_at   timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create trigger customers_touch before update on customers
  for each row execute function touch_updated_at();
create trigger orders_touch before update on orders
  for each row execute function touch_updated_at();
create trigger fulfilments_touch before update on fulfilments
  for each row execute function touch_updated_at();
create trigger shipments_touch before update on shipments
  for each row execute function touch_updated_at();
