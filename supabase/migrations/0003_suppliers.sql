-- =============================================================================
-- 0003_suppliers.sql
-- Suppliers, their per-channel approval, offers, scoring and documents.
-- =============================================================================

-- A supplier is approved PER CHANNEL, never globally (§25). A supplier that is
-- fine for Shopify can be entirely unusable for Amazon.
create type channel_key as enum ('shopify', 'amazon_uk');
create type approval_status as enum ('approved', 'blocked', 'review_required', 'not_assessed');

create table suppliers (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  name          text not null,
  company_name  text,
  website       text,
  contact_email citext,
  contact_phone text,
  country       char(2),
  platform      text,                    -- 'aliexpress' | 'direct' | 'wholesaler' | ...

  -- Capability flags that drive Amazon eligibility (§15, §16)
  supports_blind_shipping     boolean not null default false,  -- no third-party retailer branding
  supports_custom_packaging   boolean not null default false,
  supports_custom_invoice     boolean not null default false,  -- our name as seller of record
  provides_tracking           boolean not null default false,
  handles_returns             boolean not null default false,
  ships_from_country          char(2),
  typical_delivery_days_min   int,
  typical_delivery_days_max   int,

  -- Per-channel approval. Defaults are deliberately restrictive.
  shopify_status approval_status not null default 'not_assessed',
  amazon_status  approval_status not null default 'not_assessed',
  status_reason  text,
  last_assessed_at timestamptz,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index suppliers_org_idx on suppliers(org_id);

-- Supplier scoring (§13). Versioned like product scores.
create table supplier_scores (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  total_score int not null check (total_score between 0 and 100),
  components  jsonb not null,      -- cost / delivery / reliability / quality / returns / compliance / tracking
  weights_version text not null,
  rationale   text,
  scored_at   timestamptz not null default now()
);

create index supplier_scores_supplier_idx on supplier_scores(supplier_id, scored_at desc);

-- What a supplier will actually sell us, and at what price.
create table supplier_products (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  variant_id  uuid references product_variants(id) on delete cascade,

  supplier_sku    text,
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  shipping_cost_minor bigint not null default 0 check (shipping_cost_minor >= 0),
  currency        char(3) not null default 'GBP',
  moq             int not null default 1 check (moq >= 1),
  lead_time_days  int,
  stock_qty       int,
  in_stock        boolean not null default true,

  is_preferred    boolean not null default false,
  last_verified_at timestamptz,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, supplier_id, product_id, variant_id)
);

create index supplier_products_product_idx on supplier_products(product_id);

-- Compliance and contractual paperwork (§12, §58)
create type supplier_document_type as enum (
  'invoice', 'contract', 'certificate_of_conformity', 'safety_datasheet',
  'test_report', 'insurance', 'authorisation_letter', 'other'
);

create table supplier_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,

  doc_type    supplier_document_type not null,
  title       text not null,
  storage_path text,                   -- Supabase Storage object path
  issued_on   date,
  expires_on  date,
  created_at  timestamptz not null default now()
);

-- Purchase orders raised against a supplier (§48 cash commitments)
create type supplier_order_status as enum (
  'draft', 'awaiting_approval', 'approved', 'placed', 'confirmed',
  'shipped', 'received', 'cancelled', 'failed'
);

create table supplier_orders (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,

  reference   text not null,
  status      supplier_order_status not null default 'draft',

  subtotal_minor bigint not null default 0,
  shipping_minor bigint not null default 0,
  tax_minor      bigint not null default 0,
  total_minor    bigint not null default 0,
  currency       char(3) not null default 'GBP',

  -- Set when the value exceeds max_auto_purchase_minor (§47 level 3)
  requires_approval boolean not null default false,
  approved_by  uuid references auth.users(id),
  approved_at  timestamptz,

  -- Guarantees a retry can never place the same order twice (§70)
  idempotency_key text not null,

  expected_at  date,
  placed_at    timestamptz,
  received_at  timestamptz,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, reference),
  unique (org_id, idempotency_key)
);

create table supplier_order_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  supplier_order_id uuid not null references supplier_orders(id) on delete cascade,
  product_id        uuid references products(id) on delete set null,
  variant_id        uuid references product_variants(id) on delete set null,
  -- Kept even if the product row is later removed, so history stays readable
  description       text not null,
  quantity          int not null check (quantity > 0),
  unit_cost_minor   bigint not null check (unit_cost_minor >= 0),
  line_total_minor  bigint not null
);

create trigger suppliers_touch before update on suppliers
  for each row execute function touch_updated_at();
create trigger supplier_products_touch before update on supplier_products
  for each row execute function touch_updated_at();
create trigger supplier_orders_touch before update on supplier_orders
  for each row execute function touch_updated_at();
