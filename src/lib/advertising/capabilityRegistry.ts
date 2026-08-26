import type { AdvertisingCapabilities, AdvertisingConnectorSummary } from './connectors/types'

/**
 * The provider capability registry (Milestone 19).
 *
 * Pure and side-effect-free — it never calls a connector or a database
 * itself. It takes the exact `AdvertisingConnectorSummary` the registry
 * (`connectors/registry.ts`) and the UI already build (implementation
 * status, configuration, connection health, read verification, write
 * verification) and answers, per capability, the two questions this
 * milestone's brief insists must never be conflated:
 *
 *   "Can this connector theoretically perform this action?" (`implemented`)
 *   "Has this exact capability been verified against a real provider?" (`verified`)
 *
 * Extends the existing architecture rather than duplicating it: no second
 * connector registry, no second verification store. `deriveCapabilityStatus`
 * reads the connector's own `capabilities` flags and the read/write
 * verification records `verification.ts`/`writeVerification.ts` already
 * persist (Phase 12 — reused, not a new source of truth).
 */

export type AdvertisingCapabilityName = 'readCampaigns' | 'verifyCampaignState' | 'pauseCampaign' | 'setBudget'

export const ADVERTISING_CAPABILITY_NAMES: readonly AdvertisingCapabilityName[] = ['readCampaigns', 'verifyCampaignState', 'pauseCampaign', 'setBudget']

/** Which `AdvertisingCapabilities` flag governs each named capability — `verifyCampaignState` is gated by `verifyWrites`, not a same-named flag. */
const CAPABILITY_FLAG: Record<AdvertisingCapabilityName, keyof AdvertisingCapabilities> = {
  readCampaigns: 'readCampaigns',
  verifyCampaignState: 'verifyWrites',
  pauseCampaign: 'pauseCampaign',
  setBudget: 'setBudget',
}

/**
 * Phase 6 — the one classification every execution gate and every piece of
 * UI in this module cares about. A read capability can be exercised more
 * freely (Phase 6: "read operations may be permitted with an explicitly
 * unverified connector"); a write capability is held to the stricter bar
 * this milestone exists to enforce.
 */
export type AdvertisingCapabilityKind = 'read' | 'write'

export const CAPABILITY_KIND: Record<AdvertisingCapabilityName, AdvertisingCapabilityKind> = {
  readCampaigns: 'read',
  verifyCampaignState: 'read',
  pauseCampaign: 'write',
  setBudget: 'write',
}

/**
 * Phase 2 — the eight states the brief names, derived deterministically
 * and in this exact priority order (each check below only runs once the
 * ones above it have been ruled out):
 *
 *   1. STUB / NOT_IMPLEMENTED    — the connector's own `capabilities` flag
 *      for this exact capability is `false`. `demo_ads` and `amazon_ads`'s
 *      own honest declarations decide this, never guessed here — e.g.
 *      Amazon Ads' real descriptor declares `verifyWrites: false` (a real
 *      per-campaign state read-back is not implemented, distinct from
 *      the async report pipeline `readCampaigns: true` now uses — see
 *      `amazonAds.ts`'s own comment), so `verifyCampaignState` is
 *      `NOT_IMPLEMENTED` for Amazon Ads even though `readCampaigns`/
 *      `pauseCampaign`/`setBudget` are all `true`.
 *   2. MISCONFIGURED             — `isConfigured()` is false but at least
 *      one required credential is present (a partial/malformed configuration,
 *      distinct from "nothing has been entered at all").
 *   3. UNAVAILABLE               — configured, but the connector's own
 *      connection health reports `error` or `degraded`.
 *   4. IMPLEMENTED_UNVERIFIED    — implemented, but not configured at all
 *      yet (no credentials entered) — matches Amazon Ads' real state in
 *      this environment exactly: `pauseCampaign`/`setBudget` are real,
 *      working code against an unconfirmed API contract, with zero
 *      credentials configured to even attempt a call.
 *   5. CREDENTIALS_CONFIGURED    — implemented, configured, connection
 *      healthy (or demo), but this exact capability has no verification
 *      record of the kind it needs yet.
 *   6. READ_VERIFIED             — a `kind: 'read'` capability whose read
 *      verification record shows a passing result.
 *   7. WRITE_VERIFIED            — a `kind: 'write'` capability whose
 *      *write* verification record shows a passing result — never implied
 *      by a passing *read* verification, however strong.
 */
export type AdvertisingCapabilityStatusLabel =
  | 'NOT_IMPLEMENTED' | 'STUB' | 'MISCONFIGURED' | 'UNAVAILABLE'
  | 'IMPLEMENTED_UNVERIFIED' | 'CREDENTIALS_CONFIGURED' | 'READ_VERIFIED' | 'WRITE_VERIFIED'

export interface AdvertisingCapabilityStatus {
  provider: string
  capability: AdvertisingCapabilityName
  kind: AdvertisingCapabilityKind
  implemented: boolean
  configured: boolean
  requiresCredentials: readonly string[]
  canRead: boolean
  canWrite: boolean
  /** True only when `status` is `READ_VERIFIED` (for a read capability) or `WRITE_VERIFIED` (for a write capability) — never true merely because the connector is implemented and configured. */
  verified: boolean
  status: AdvertisingCapabilityStatusLabel
  limitations: readonly string[]
}

export interface DeriveCapabilityStatusInput {
  provider: string
  capability: AdvertisingCapabilityName
  implementationStatus: 'implemented' | 'stub'
  capabilityFlag: boolean
  isConfigured: boolean
  missingCredentials: readonly string[]
  requiredCredentials: readonly string[]
  connectionStatus: 'not_configured' | 'demo' | 'connected' | 'degraded' | 'error'
  readVerified: boolean
  writeVerified: boolean
}

function limitationsFor(input: DeriveCapabilityStatusInput, status: AdvertisingCapabilityStatusLabel): readonly string[] {
  if (status === 'STUB') return ['No integration is written for this platform yet.']
  if (status === 'NOT_IMPLEMENTED') return [`${input.provider} does not implement this capability — see the connector's own module comment for why.`]
  if (status === 'MISCONFIGURED') return [`Missing: ${input.missingCredentials.join(', ')}.`]
  if (status === 'UNAVAILABLE') return ['The connection is configured but currently unhealthy — see connection health for detail.']
  return []
}

export function deriveCapabilityStatus(input: DeriveCapabilityStatusInput): AdvertisingCapabilityStatus {
  const kind = CAPABILITY_KIND[input.capability]
  const isDemo = input.connectionStatus === 'demo'

  let status: AdvertisingCapabilityStatusLabel
  if (!input.capabilityFlag) {
    status = input.implementationStatus === 'stub' ? 'STUB' : 'NOT_IMPLEMENTED'
  } else if (!input.isConfigured && !isDemo) {
    // A demo connector is always "configured" in practice (`isConfigured()`
    // is hardcoded true for it), so this branch is real-provider-only.
    status = input.missingCredentials.length < input.requiredCredentials.length && input.requiredCredentials.length > 0
      ? 'MISCONFIGURED'
      : 'IMPLEMENTED_UNVERIFIED'
  } else if (input.connectionStatus === 'error' || input.connectionStatus === 'degraded') {
    status = 'UNAVAILABLE'
  } else if (kind === 'read' && (input.readVerified || isDemo)) {
    status = 'READ_VERIFIED'
  } else if (kind === 'write' && (input.writeVerified || isDemo)) {
    status = 'WRITE_VERIFIED'
  } else {
    status = 'CREDENTIALS_CONFIGURED'
  }

  const implemented = input.capabilityFlag
  const verified = status === 'READ_VERIFIED' || status === 'WRITE_VERIFIED'

  return {
    provider: input.provider,
    capability: input.capability,
    kind,
    implemented,
    configured: input.isConfigured || isDemo,
    requiresCredentials: input.requiredCredentials,
    canRead: implemented && kind === 'read',
    canWrite: implemented && kind === 'write',
    verified,
    status,
    limitations: limitationsFor(input, status),
  }
}

/**
 * Phase 4 — `getProviderCapabilityStatus`, built directly from an
 * `AdvertisingConnectorSummary` (already assembled by
 * `connectors/registry.ts#advertisingConnectorSummaries` /
 * `advertising/repository.ts`) so this never re-fetches or re-derives
 * anything the existing architecture already computed.
 */
export function getProviderCapabilityStatus(summary: AdvertisingConnectorSummary, capability: AdvertisingCapabilityName): AdvertisingCapabilityStatus {
  const kind = CAPABILITY_KIND[capability]
  const readVerified = summary.verificationStatus === 'read_access_verified' || summary.verificationStatus === 'data_retrieval_verified' || summary.verificationStatus === 'end_to_end_sync_verified'
  const writeVerified = summary.writeVerificationStatus === 'verified'

  return deriveCapabilityStatus({
    provider: summary.label,
    capability,
    implementationStatus: summary.implementationStatus,
    capabilityFlag: summary.capabilities[CAPABILITY_FLAG[capability]],
    isConfigured: summary.isConfigured,
    missingCredentials: summary.missingCredentials,
    requiredCredentials: summary.requiredCredentials,
    connectionStatus: summary.status,
    readVerified: kind === 'read' && readVerified,
    writeVerified: kind === 'write' && writeVerified,
  })
}

/** Every capability's status for one connector summary, in `ADVERTISING_CAPABILITY_NAMES` order — what `/advertising`'s per-connector capability breakdown renders. */
export function getAllCapabilityStatuses(summary: AdvertisingConnectorSummary): readonly AdvertisingCapabilityStatus[] {
  return ADVERTISING_CAPABILITY_NAMES.map((capability) => getProviderCapabilityStatus(summary, capability))
}

export type ExecutionCapabilityGateResult = { allowed: true } | { allowed: false; reason: string }

/**
 * Phase 5/6/13/14 — the execution-time safety gate: an approved campaign
 * action may only actually call a connector's write method once the exact
 * write capability it needs is `WRITE_VERIFIED` for real provider,
 * `WRITE_VERIFIED` for demo (`deriveCapabilityStatus` treats a `demo`
 * connection as inherently verified — see that function's own comment),
 * never merely because the connector is implemented or configured.
 * `advertisingApprovalExecutor.ts`'s `executeApprovedCampaignAction` calls
 * this immediately before `submitCampaignAction`, the same place every
 * other execution-time revalidation check already lives.
 */
export function checkExecutionCapabilityGate(input: {
  provider: string
  capability: AdvertisingCapabilityName
  implementationStatus: 'implemented' | 'stub'
  capabilityFlag: boolean
  isConfigured: boolean
  connectionStatus: 'not_configured' | 'demo' | 'connected' | 'degraded' | 'error'
  writeVerificationStatus: 'not_tested' | 'verified' | 'failed'
}): ExecutionCapabilityGateResult {
  const status = deriveCapabilityStatus({
    provider: input.provider,
    capability: input.capability,
    implementationStatus: input.implementationStatus,
    capabilityFlag: input.capabilityFlag,
    isConfigured: input.isConfigured,
    missingCredentials: [],
    requiredCredentials: [],
    connectionStatus: input.connectionStatus,
    readVerified: false,
    writeVerified: input.writeVerificationStatus === 'verified',
  })

  if (status.verified) return { allowed: true }
  return {
    allowed: false,
    reason: `${input.provider}'s "${input.capability}" write capability is not verified (current status: ${status.status}) — execution is blocked until it is. See advertising/writeVerification.ts.`,
  }
}
