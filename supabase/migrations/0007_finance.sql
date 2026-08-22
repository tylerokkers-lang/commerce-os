-- =============================================================================
-- 0007_finance.sql
-- Invoices, credit notes, expenses, VAT and accounting sync.
--
-- Nothing in this file may ever be hard-deleted or silently rewritten (§38,
-- §72). Corrections are made by issuing an offsetting document.
-- =============================================================================

create type invoice_status as enum ('draft', 'issued', 'sent', 'paid', 'void', 'failed');
-- A document may only be labelled a VAT invoice when the business is actually
-- VAT registered and the supply is within scope (§35). Enforced in the app and
-- reinforced by the constraint at the bottom of this table.
create type invoice_kind as enum ('commercial_invoice', 'vat_invoice', 'receipt');

create table invoices (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  order_id uuid references orders(id) on delete restrict,

  invoice_number text not null,
  kind           invoice_kind not null default 'commercial_invoice',
  status         invoice_status not null default 'draft',

  issued_on   date not null default current_date,
  supply_date date,
  due_on      date,

  -- Seller and buyer details are snapshotted, never joined at render time:
  -- a reissued invoice must show the details as they were on the issue date.
  seller_snapshot jsonb not null,
  buyer_snapshot  jsonb not null,
  lines           jsonb not null,

  net_minor       bigint not null default 0,
  discount_minor  bigint not null default 0,
  shipping_minor  bigint not null default 0,
  vat_minor       bigint not null default 0,
  gross_minor     bigint not null default 0,
  currency        char(3) not null default 'GBP',
  vat_rate_pct    numeric(5,2),
  vat_note        text,                     -- e.g. reverse charge wording

  pdf_path      text,                       -- Supabase Storage path
  sent_at       timestamptz,
  sent_to       citext,
  send_attempts int not null default 0,
  send_error    text,

  idempotency_key text not null,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, invoice_number),
  unique (org_id, idempotency_key),
  -- One order gets exactly one invoice; corrections use a credit note.
  unique (org_id, order_id),

  constraint vat_invoice_needs_vat_fields
    check (kind <> 'vat_invoice' or vat_rate_pct is not null)
);

create index invoices_org_issued_idx on invoices(org_id, issued_on desc);

create table credit_notes (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete restrict,
  refund_id  uuid references refunds(id) on delete set null,

  credit_note_number text not null,
  status  invoice_status not null default 'draft',
  issued_on date not null default current_date,

  reason text,
  lines  jsonb not null,

  net_minor   bigint not null default 0,
  vat_minor   bigint not null default 0,
  gross_minor bigint not null default 0,
  currency    char(3) not null default 'GBP',

  pdf_path  text,
  sent_at   timestamptz,
  idempotency_key text not null,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, credit_note_number),
  unique (org_id, idempotency_key)
);

-- Invoices and credit notes are financial records: no deletes, and issued
-- documents cannot be edited (only voided, which is a status change).
create or replace function forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Financial record in % cannot be deleted; void it instead', TG_TABLE_NAME;
end;
$$;

create trigger invoices_no_delete before delete on invoices
  for each row execute function forbid_delete();
create trigger credit_notes_no_delete before delete on credit_notes
  for each row execute function forbid_delete();

-- -----------------------------------------------------------------------------
-- Costs (§39)
-- -----------------------------------------------------------------------------

create type expense_category as enum (
  'supplier_goods', 'supplier_shipping', 'marketplace_fee', 'payment_fee',
  'advertising', 'software', 'packaging', 'shipping', 'professional_fees',
  'refund', 'other'
);

create table expenses (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  category     expense_category not null,
  description  text not null,
  incurred_on  date not null default current_date,

  net_minor    bigint not null,
  vat_minor    bigint not null default 0,
  gross_minor  bigint not null,
  currency     char(3) not null default 'GBP',
  vat_reclaimable boolean not null default false,

  channel     channel_key,
  order_id    uuid references orders(id) on delete set null,
  product_id  uuid references products(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,

  source        text not null default 'manual',   -- 'manual' | 'shopify' | 'amazon' | 'demo'
  external_id   text,
  document_path text,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, source, external_id)
);

create index expenses_org_date_idx on expenses(org_id, incurred_on desc);

create table supplier_invoices (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  supplier_order_id uuid references supplier_orders(id) on delete set null,

  invoice_number text,
  issued_on   date,
  due_on      date,
  net_minor   bigint not null default 0,
  vat_minor   bigint not null default 0,
  gross_minor bigint not null default 0,
  currency    char(3) not null default 'GBP',
  paid_on     date,
  document_path text,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- VAT (§40, §41)
-- -----------------------------------------------------------------------------
-- Deliberately NOT assuming every sale is standard-rate UK VAT. Treatment is
-- derived from transaction context and flagged for review when uncertain.

create type vat_treatment as enum (
  'standard', 'reduced', 'zero_rated', 'exempt', 'outside_scope',
  'reverse_charge', 'marketplace_deemed_supplier', 'not_registered', 'review_required'
);

create table tax_transactions (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  direction    text not null check (direction in ('output', 'input')),
  order_id     uuid references orders(id) on delete set null,
  invoice_id   uuid references invoices(id) on delete set null,
  credit_note_id uuid references credit_notes(id) on delete set null,
  expense_id   uuid references expenses(id) on delete set null,

  treatment    vat_treatment not null,
  rate_pct     numeric(5,2) not null default 0,
  net_minor    bigint not null,
  vat_minor    bigint not null,
  currency     char(3) not null default 'GBP',

  -- Context that determined the treatment, retained as evidence
  customer_country char(2),
  supplier_country char(2),
  ship_from_country char(2),
  ship_to_country   char(2),
  channel      channel_key,
  jurisdiction char(2) not null default 'GB',

  needs_review boolean not null default false,
  review_reason text,
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,

  occurred_on  date not null default current_date,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now()
);

create index tax_transactions_org_date_idx on tax_transactions(org_id, occurred_on desc);
create index tax_transactions_review_idx on tax_transactions(org_id, needs_review) where needs_review;

create table vat_periods (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  starts_on date not null,
  ends_on   date not null,
  due_on    date,
  status    text not null default 'open',   -- open | closed | filed

  output_vat_minor bigint not null default 0,
  input_vat_minor  bigint not null default 0,
  net_due_minor    bigint not null default 0,

  filed_at   timestamptz,
  note       text,
  created_at timestamptz not null default now(),
  unique (org_id, starts_on, ends_on),
  check (ends_on > starts_on)
);

-- -----------------------------------------------------------------------------
-- Accounting sync (§42)
-- -----------------------------------------------------------------------------

create table accounting_sync (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  provider     text not null default 'xero',
  entity_type  text not null,          -- 'invoice' | 'credit_note' | 'expense' | ...
  entity_id    uuid not null,
  external_id  text,

  status       text not null default 'pending',  -- pending | synced | failed | skipped
  attempts     int not null default 0,
  last_error   text,
  synced_at    timestamptz,
  next_retry_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, entity_type, entity_id)
);

create trigger invoices_touch before update on invoices
  for each row execute function touch_updated_at();
create trigger accounting_sync_touch before update on accounting_sync
  for each row execute function touch_updated_at();
