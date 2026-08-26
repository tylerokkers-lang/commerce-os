-- =============================================================================
-- 0031_advertising_report_tracking.sql
-- Asynchronous advertising report tracking (Milestone 20).
--
-- Amazon Ads' Reporting API (the only source of spend/impressions/clicks/
-- conversions — see amazonAds.ts's own module comment) is asynchronous:
-- create a report job, poll until it finishes, then download the result.
-- That lifecycle can span multiple maintenance runs (a report created in
-- one 15-minute cycle may only finish in a later one — Phase 4), so its
-- state must survive across separate HTTP requests and separate server
-- instances. In-memory/module-level state cannot do this; it must persist.
--
-- Extends `advertising_connections` (migration 0026) rather than creating
-- a new table: that table is already exactly "one row of tracked state per
-- (org, provider)" — the same granularity a report request naturally has,
-- since this codebase's advertising connectors are each configured from a
-- single, environment-wide set of credentials (one real Amazon Ads account
-- per deployment, `unique(org_id, provider)` already enforced). A new table
-- keyed the same way would be a duplicate, not a genuine addition.
--
-- Generic column names (not `amazon_` prefixed): any future async-reporting
-- provider (Meta/Google/TikTok, if ever implemented for real) can reuse the
-- exact same columns rather than each provider inventing its own tracking
-- shape. Only Amazon Ads uses them today.
-- =============================================================================

alter table advertising_connections
  add column report_status text not null default 'not_requested'
    check (report_status in ('not_requested', 'requested', 'processing', 'completed', 'failed', 'expired')),
  add column report_id text,
  add column report_requested_at timestamptz,
  add column report_completed_at timestamptz,
  add column report_window_start date,
  add column report_window_end date,
  add column report_error text;

comment on column advertising_connections.report_status is
  'The async report lifecycle state for this org+provider (Milestone 20) — a genuinely different fact from connection status or verification status. Only ever advanced by advertising/amazonAdsReportPipeline.ts.';
comment on column advertising_connections.report_id is
  'The provider''s own report identifier, if one has been requested and not yet superseded. Never a secret.';
