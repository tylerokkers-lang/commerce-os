-- =============================================================================
-- 0026_advertising_connectors.sql
-- Advertising platform connector foundation (Milestone 15).
--
-- Two additive changes, neither of which touches or duplicates anything
-- Milestone 14 already built on top of the `advertising` table:
--
--   1. `advertising` gains four nullable columns so a real synced row can
--      carry which ad platform it came from, the external account it came
--      from, its real currency, and when it was last synced. Existing rows
--      (hand-entered or from Milestone 14's demo scenarios) simply have
--      these as null — a real, honest "unknown provenance" rather than a
--      guessed value. `channel` (the sales channel this spend is
--      attributed to) is unchanged and still required; `provider` (which
--      ad platform actually ran the campaign) is a genuinely different axis
--      — a TikTok Ads campaign can drive traffic to the Shopify channel,
--      so the two must never be conflated into one column.
--
--   2. A new `advertising_connections` table — one row per org per ad
--      platform, tracking connection/sync state only (is it connected, is
--      it demo or live, when did it last sync, how many consecutive
--      failures). This is the same shape and the same reason `channels`
--      exists separately from `orders`/`channel_products`: connection
--      *state* and campaign *data* are different concerns with different
--      cardinality (one state row per platform vs. many data rows per
--      campaign per day). It is not a second `advertising` table — it has
--      no spend/revenue/impressions column at all.
--
-- `automation_action_type` also gains four values so a campaign action can
-- become a real, typed `automation_actions`/`ai_decisions` row through the
-- existing engine, rather than a parallel one: `pause_campaign`,
-- `increase_ad_budget`, `decrease_ad_budget` (spend-changing, never
-- auto-permitted this milestone — see `automation/advertisingAutomation.ts`),
-- and `review_campaign` (a pure escalation, the same kind of action
-- `request_approval` already is).
-- =============================================================================

alter table advertising
  add column provider              text,
  add column external_account_id   text,
  add column currency              text,
  add column synced_at             timestamptz;

comment on column advertising.provider is
  'Which ad platform this row came from (amazon_ads/meta_ads/google_ads/tiktok_ads/manual) — null for pre-Milestone-15 rows of unknown provenance, never guessed.';
comment on column advertising.synced_at is
  'When a real connector sync last wrote this exact row. Null for hand-entered/demo rows — the staleness check in advertisingAutomation.ts treats null the same as "too old", never as "fresh".';

alter table advertising
  add constraint advertising_provider_check
  check (provider is null or provider in ('amazon_ads', 'meta_ads', 'google_ads', 'tiktok_ads', 'manual'));

alter type automation_action_type add value 'pause_campaign';
alter type automation_action_type add value 'increase_ad_budget';
alter type automation_action_type add value 'decrease_ad_budget';
alter type automation_action_type add value 'review_campaign';

create table advertising_connections (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  provider   text not null check (provider in ('amazon_ads', 'meta_ads', 'google_ads', 'tiktok_ads')),

  -- Which sales channel this platform's campaigns are attributed to — an
  -- ad platform's own API has no concept of `channel_key`, and
  -- `advertising.channel` is `not null`, so the sync engine needs this
  -- explicitly rather than guessing. Null until set, and the sync engine
  -- (`advertising/sync.ts`) refuses to write any row for a connection with
  -- no channel configured — a missing-configuration safety gate, not a
  -- default assumption.
  channel    channel_key,

  -- Presence/status only — never a secret. Same rule as `channels.is_connected`
  -- (§54): the real credential lives in the environment, never a database column.
  is_connected      boolean not null default false,
  connection_mode   text not null default 'demo' check (connection_mode in ('demo', 'live')),
  external_account_id text,

  status             text not null default 'not_configured'
    check (status in ('not_configured', 'demo', 'connected', 'degraded', 'error')),
  last_sync_at       timestamptz,
  last_success_at    timestamptz,
  last_failure_at    timestamptz,
  last_error         text,
  consecutive_failures int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, provider)
);

create trigger advertising_connections_touch_updated_at
  before update on advertising_connections
  for each row execute function touch_updated_at();
