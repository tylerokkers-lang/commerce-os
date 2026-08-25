-- =============================================================================
-- 0030_advertising_write_verification.sql
-- Write-capability verification, genuinely separate from read verification
-- (Milestone 19, Phase 3/6).
--
-- Migration 0028 added `verification_status`/`verified_at`/`verification_detail`
-- to `advertising_connections`, driven by `verifyProviderReadOnly`
-- (`advertising/verificationCheck.ts`) — a deliberately read-only check
-- (`isConfigured`/`getConnectionHealth`/`fetchCampaigns`, never a write).
-- That column set can never represent write verification without
-- conflating "we confirmed reads work" with "we confirmed writes work" —
-- exactly the ambiguity this milestone's brief repeatedly warns against
-- ("READ VERIFIED ≠ WRITE VERIFIED"). A parallel, equally narrow column
-- set is the honest fix, not a broadened `verification_status` enum.
--
-- `write_verification_status` only ever advances via an explicit, isolated
-- write-verification run (`advertising/writeVerification.ts`) — never
-- inferred from a passing read verification, never automatic, and (per
-- this milestone's brief) never invoked by any scheduled job. No
-- `end_to_end_sync_verified`-equivalent value exists here: there is
-- exactly one real write-capable action pair this connector interface
-- exposes (pause / set budget), so "verified" vs "not" is sufficient —
-- adding finer-grained states here without a second write capability to
-- distinguish them would be complexity with no real referent.
-- =============================================================================

alter table advertising_connections
  add column write_verification_status text not null default 'not_tested'
    check (write_verification_status in ('not_tested', 'verified', 'failed')),
  add column write_verified_at timestamptz,
  add column write_verification_detail text;

comment on column advertising_connections.write_verification_status is
  'Only advances via an explicit, isolated write-verification run (advertising/writeVerification.ts) — never inferred from read verification, never automatic/scheduled.';
