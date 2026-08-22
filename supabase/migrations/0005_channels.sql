-- =============================================================================
-- 0005_channels.sql
-- Sales channels and per-channel product listings (§21).
--
-- Shopify and Amazon are deliberately NOT merged into one storefront concept.
-- Every product carries an independent status on each channel.
-- =============================================================================

create type channel_listing_status as enum (
  'not_listed', 'draft', 'review_required', 'blocked',
  'testing', 'live', 'paused', 'removed'
);

create table channels (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references organisations(id) on delete cascade,
  key       channel_key not null,
  label     text not null,
  is_enabled boolean not null default false,

  -- Credential presence only. Secrets live in the environment / vault,
  -- never in a database column (§54).
  is_connected     boolean not null default false,
  connection_mode  text not null default 'demo',    -- 'demo' | 'live'
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  last_error       text,
  next_retry_at    timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table channel_products (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,

  status         channel_listing_status not null default 'not_listed',
  status_reason  text,

  external_id    text,           -- Shopify product id / Amazon ASIN
  external_sku   text,
  listing_url    text,

  price_minor        bigint check (price_minor >= 0),
  compare_at_minor   bigint check (compare_at_minor >= 0),
  min_price_minor    bigint check (min_price_minor >= 0),  -- never price below this
  currency           char(3) not null default 'GBP',

  -- Which supplier fulfils this specific channel listing. Channel-aware by
  -- design: a listing can only point at a supplier approved for its channel.
  fulfilment_supplier_id uuid references suppliers(id) on delete set null,

  last_synced_at timestamptz,
  sync_error     text,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, channel_id, product_id, variant_id)
);

create index channel_products_status_idx on channel_products(org_id, status);
create index channel_products_product_idx on channel_products(product_id);

-- Channel-specific attributes that have nowhere sensible to live generically.
create table amazon_listings (
  channel_product_id uuid primary key references channel_products(id) on delete cascade,
  org_id             uuid not null references organisations(id) on delete cascade,
  asin               text,
  seller_sku         text,
  marketplace_id     text not null default 'A1F83G8C2ARO7P',  -- Amazon UK
  fulfilment_channel text not null default 'MFN',             -- MFN | AFN (FBA)
  condition          text not null default 'new',
  gtin_exempt        boolean not null default false,
  browse_node        text,
  updated_at         timestamptz not null default now()
);

create table shopify_listings (
  channel_product_id uuid primary key references channel_products(id) on delete cascade,
  org_id             uuid not null references organisations(id) on delete cascade,
  shopify_product_id text,
  shopify_variant_id text,
  handle             text,
  published          boolean not null default false,
  updated_at         timestamptz not null default now()
);

create trigger channels_touch before update on channels
  for each row execute function touch_updated_at();
create trigger channel_products_touch before update on channel_products
  for each row execute function touch_updated_at();
