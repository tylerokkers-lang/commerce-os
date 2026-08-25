-- =============================================================================
-- 0028_advertising_verification_status.sql
-- Provider verification status (Milestone 16, Phase 10).
--
-- `advertising_connections.status` (migration 0026) already tracks
-- connection status (not_configured/demo/connected/degraded/error) — a
-- live, best-effort snapshot re-derived on every sync attempt. Verification
-- status is a genuinely different, more conservative dimension: it only
-- ever advances when a deliberate verification check has actually run and
-- actually passed (Phase 9's read-only connection test,
-- `advertising/verification.ts`), never inferred from "the last sync
-- happened to succeed." No existing column can represent this without
-- conflating the two, which is exactly what the brief warns against
-- ("avoid creating contradictory or misleading combinations") — a
-- connection can read `status: connected` (this sync's credentials worked)
-- while `verification_status` still reads `not_tested` (nobody has ever
-- deliberately run the staged verification check), and the two must never
-- be collapsed into one field.
-- =============================================================================

alter table advertising_connections
  add column verification_status text not null default 'not_tested'
    check (verification_status in ('not_tested', 'authentication_verified', 'read_access_verified', 'data_retrieval_verified', 'end_to_end_sync_verified', 'failed')),
  add column verified_at timestamptz,
  add column verification_detail text;

comment on column advertising_connections.verification_status is
  'Only advances when a deliberate verification check (advertising/verification.ts) has actually run and actually passed — never inferred from an ordinary sync succeeding.';
