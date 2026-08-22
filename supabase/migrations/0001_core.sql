-- =============================================================================
-- 0001_core.sql
-- Extensions, tenancy, identity, business settings, audit log.
--
-- Money convention (applies to EVERY migration in this project):
--   All monetary values are stored as BIGINT in MINOR UNITS (pence for GBP).
--   Never store money as float/numeric-with-rounding. Column names always end
--   in `_minor` so this is impossible to misread at a call site.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- Tenancy
-- -----------------------------------------------------------------------------
-- The system is built for a single owner-operated business, but every table is
-- org-scoped anyway. RLS needs a tenancy anchor to key policies off, and this
-- keeps a second brand or a separate legal entity from requiring a rewrite.

create table organisations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          citext not null unique,
  base_currency char(3) not null default 'GBP',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create type member_role as enum ('owner', 'admin', 'analyst', 'viewer');

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_idx on memberships(user_id);

-- Helper used by every RLS policy. SECURITY DEFINER so the policy can read
-- memberships without recursing into memberships' own policy.
create or replace function auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from memberships where user_id = auth.uid()
$$;

create or replace function auth_has_role(target_org uuid, allowed member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid()
      and org_id = target_org
      and role = any(allowed)
  )
$$;

-- -----------------------------------------------------------------------------
-- Business settings (§66) — one row per org
-- -----------------------------------------------------------------------------

create type automation_level as enum ('manual', 'assisted', 'supervised', 'autonomous');

create table business_settings (
  org_id uuid primary key references organisations(id) on delete cascade,

  -- Legal identity, used on invoices (§35, §36)
  legal_name        text,
  trading_name      text,
  address_line1     text,
  address_line2     text,
  city              text,
  postcode          text,
  country           char(2) not null default 'GB',
  email             citext,
  phone             text,
  website           text,
  company_number    text,

  -- VAT. `vat_registered` gates whether we may issue a VAT invoice at all (§35).
  vat_registered      boolean not null default false,
  vat_number          text,
  vat_registered_from date,
  vat_scheme          text,

  -- Brand
  logo_path      text,
  favicon_path   text,
  brand_primary  text not null default '#0F172A',
  brand_accent   text not null default '#2563EB',
  invoice_footer text,
  invoice_terms  text,

  -- Invoice numbering (§70 — must never collide or repeat)
  invoice_prefix       text not null default 'INV-',
  invoice_next_number  bigint not null default 1,
  credit_note_prefix   text not null default 'CN-',
  credit_note_next_number bigint not null default 1,

  -- Automation & financial control limits (§47)
  automation_level                automation_level not null default 'assisted',
  min_gross_margin_pct            numeric(5,2) not null default 25.00,
  min_net_margin_pct              numeric(5,2) not null default 10.00,
  min_opportunity_score           int not null default 70,
  max_auto_purchase_minor         bigint not null default 20000,   -- £200
  max_auto_price_change_pct       numeric(5,2) not null default 5.00,
  max_daily_ad_spend_minor        bigint not null default 5000,    -- £50
  max_auto_ad_increase_pct        numeric(5,2) not null default 20.00,
  min_roas                        numeric(6,2) not null default 3.00,
  max_delivery_days               int not null default 7,
  max_return_rate_pct             numeric(5,2) not null default 5.00,

  blocked_categories  text[] not null default '{}',
  allowed_categories  text[] not null default '{}',
  preferred_countries char(2)[] not null default '{GB}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vat_number_requires_registration
    check (vat_number is null or vat_registered = true)
);

-- -----------------------------------------------------------------------------
-- Configurable thresholds (§41, §63) — never hard-code tax or policy numbers
-- -----------------------------------------------------------------------------

create table config_values (
  org_id      uuid not null references organisations(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  description text,
  effective_from date not null default current_date,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  primary key (org_id, key, effective_from)
);

-- -----------------------------------------------------------------------------
-- Audit log (§45) — append-only
-- -----------------------------------------------------------------------------

create type actor_type as enum ('user', 'system', 'ai', 'integration');

create table audit_logs (
  id            bigserial primary key,
  org_id        uuid not null references organisations(id) on delete cascade,
  occurred_at   timestamptz not null default now(),

  actor_type    actor_type not null,
  actor_user_id uuid references auth.users(id),
  actor_label   text,

  action        text not null,          -- e.g. 'PRICE_CHANGED'
  entity_type   text not null,          -- e.g. 'product'
  entity_id     text,

  previous_value jsonb,
  new_value      jsonb,
  reason         text,
  rule_key       text,                  -- automation rule that triggered it
  ai_decision_id uuid,                  -- FK added in 0008 once the table exists
  result         text not null default 'success',
  error          text,
  metadata       jsonb not null default '{}'::jsonb
);

create index audit_logs_org_time_idx on audit_logs(org_id, occurred_at desc);
create index audit_logs_entity_idx on audit_logs(org_id, entity_type, entity_id);
create index audit_logs_action_idx on audit_logs(org_id, action, occurred_at desc);

-- Append-only enforcement (§72): financial and audit history is never rewritten.
create or replace function forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
end;
$$;

create trigger audit_logs_no_update before update on audit_logs
  for each row execute function forbid_mutation();
create trigger audit_logs_no_delete before delete on audit_logs
  for each row execute function forbid_mutation();

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organisations_touch before update on organisations
  for each row execute function touch_updated_at();
create trigger business_settings_touch before update on business_settings
  for each row execute function touch_updated_at();
