import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Static regression guard for two Milestone: automation control plane
 * additions to `publicationService.ts` — `server-only` (imports
 * `createServerSupabase` transitively), so it cannot be imported directly
 * here, and has no existing unit-test harness to extend (no test in this
 * repo mocks `createServerSupabase` across the several tables
 * `assembleShopifyPublicationPreview` reads). Same technique
 * `product-import-facts-persistence.test.ts` already uses for equally
 * un-importable server-only orchestration files: assert on the real source
 * text rather than fabricate a mock harness whose fidelity nothing else
 * would catch drifting from the real Supabase client's behaviour.
 *
 * 1. Dry-run capability (design requirement §4): `dryRunCreateShopifyDraft`
 *    reports exactly what `createDraft` would do without ever calling
 *    `createListing`.
 * 2. Verification (SUBMIT -> VERIFY -> RECONCILE, extended to publication):
 *    a successful `createListing` is followed by a read-back via
 *    `verifyListingState`, gated by `capabilities.verifyWrites`, and the
 *    result is recorded rather than assumed.
 */

const SERVICE_PATH = 'src/lib/marketplaces/shopify/publicationService.ts'

describe('publicationService.ts: automation control-plane additions', () => {
  const source = readFileSync(SERVICE_PATH, 'utf8')

  it('exports a dry-run entry point for Shopify draft creation', () => {
    expect(source).toMatch(/export async function dryRunCreateShopifyDraft/)
  })

  it('the dry run never calls createListing — it only prepares the payload and evaluates eligibility', () => {
    const fnMatch = source.match(/export async function dryRunCreateShopifyDraft[\s\S]*?\n}\n/)
    expect(fnMatch).not.toBeNull()
    expect(fnMatch![0]).not.toMatch(/\.createListing\(/)
  })

  it('the dry run reports the exact payload createDraft would send, via the same shared preparation helper', () => {
    const fnMatch = source.match(/export async function dryRunCreateShopifyDraft[\s\S]*?\n}\n/)
    expect(fnMatch![0]).toMatch(/prepareShopifyDraftPayload\(orgId, productId, selectedPriceMinor\)/)
  })

  it('createDraft and the dry run share one payload-preparation helper, never two independently-maintained copies', () => {
    const createDraftMatch = source.match(/export async function createDraft[\s\S]*?\n}\n/)
    expect(createDraftMatch).not.toBeNull()
    expect(createDraftMatch![0]).toMatch(/prepareShopifyDraftPayload\(orgId, productId, selectedPriceMinor\)/)
    // The payload-building fields (variant/media assembly) must live only in the shared helper, not duplicated inline in createDraft.
    expect(createDraftMatch![0]).not.toMatch(/buildShopifyProductPayload\(/)
  })

  it('a successful listing creation is followed by a real read-back via verifyListingState, gated by the verifyWrites capability', () => {
    const createDraftMatch = source.match(/export async function createDraft[\s\S]*?\n}\n/)
    expect(createDraftMatch![0]).toMatch(/capabilities\.verifyWrites/)
    expect(createDraftMatch![0]).toMatch(/\.verifyListingState\(result\.value\.externalId!?\)/)
  })

  it('verification failure or uncertainty is recorded, never silently discarded, and the write is never presented as unconditionally confirmed', () => {
    const createDraftMatch = source.match(/export async function createDraft[\s\S]*?\n}\n/)
    expect(createDraftMatch![0]).toMatch(/verificationStatus/)
    // The three honest outcomes from the connector interface's own verifyListingState contract.
    expect(createDraftMatch![0]).toMatch(/'verified'/)
    expect(createDraftMatch![0]).toMatch(/'failed'/)
    expect(createDraftMatch![0]).toMatch(/'uncertain'/)
  })

  it('verification status reaches the audit trail, never only an internal variable no one can see', () => {
    const createDraftMatch = source.match(/export async function createDraft[\s\S]*?\n}\n/)
    const auditCallMatch = createDraftMatch![0].match(/action: 'LISTING_CREATED'[\s\S]*?\}\)/)
    expect(auditCallMatch).not.toBeNull()
    expect(auditCallMatch![0]).toMatch(/verificationStatus/)
  })

  it('all three operator-triggered writes (createDraft, publishLive, pauseListing) are gated by the real policy engine before touching a connector', () => {
    for (const fnName of ['createDraft', 'publishLive', 'pauseListing']) {
      const match = source.match(new RegExp(`export async function ${fnName}[\\s\\S]*?\\n}\\n`))
      expect(match, fnName).not.toBeNull()
      expect(match![0], fnName).toMatch(/gatePublicationAction\(/)
    }
  })

  it('the shared policy gate actually calls evaluateAutomationPolicy — the real kill switch and business-settings checks, never a hand-rolled verdict', () => {
    const gateMatch = source.match(/async function gatePublicationAction[\s\S]*?\n}\n/)
    expect(gateMatch).not.toBeNull()
    expect(gateMatch![0]).toMatch(/evaluateAutomationPolicy\(/)
  })

  it('every real connector write/verify call (createListing, setListingStatus x2, verifyListingState) is routed through the circuit breaker, never called directly', () => {
    expect(source).not.toMatch(/(?<!withMarketplaceConnectorGate\(orgId, getShopifyConnector\(\), \(\) => )getShopifyConnector\(\)\.createListing\(/)
    const setListingStatusCalls = source.match(/getShopifyConnector\(\)\.setListingStatus\(/g) ?? []
    const gatedSetListingStatusCalls = source.match(/withMarketplaceConnectorGate\(orgId, getShopifyConnector\(\), \(\) => getShopifyConnector\(\)\.setListingStatus\(/g) ?? []
    expect(setListingStatusCalls.length).toBe(2)
    expect(gatedSetListingStatusCalls.length).toBe(2)
  })

  it('pauseListing uses a stable idempotency key, not a timestamp — a genuine retry of a failed pause must be recognised as the same action', () => {
    const pauseMatch = source.match(/export async function pauseListing[\s\S]*?\n}\n/)
    // The real, live statement — not the doc comment above it explaining what the old, timestamp-based key used to be.
    expect(pauseMatch![0]).toMatch(/\n {2}const idempotencyKey = `pause-\$\{productId\}`\n/)
  })

  it('publishLive and pauseListing both verify against the marketplace before ever writing channel_products as live/paused, and refuse when unverified', () => {
    const publishMatch = source.match(/export async function publishLive[\s\S]*?\n}\n/)
    expect(publishMatch![0]).toMatch(/verifyListingState/)
    expect(publishMatch![0]).toMatch(/if \(!verified\)/)

    const pauseMatch = source.match(/export async function pauseListing[\s\S]*?\n}\n/)
    expect(pauseMatch![0]).toMatch(/verifyListingState/)
    expect(pauseMatch![0]).toMatch(/if \(!verified\)/)
  })

  it('never fails a whole listing creation just because verification could not run — accepted is not conflated with confirmed, but recording is unconditional', () => {
    const createDraftMatch = source.match(/export async function createDraft[\s\S]*?\n}\n/)
    // writeChannelProductRow must still run after the verify block, not be gated behind `verified === true`.
    const verifyIndex = createDraftMatch![0].indexOf('verificationStatus')
    const successWriteIndex = createDraftMatch![0].indexOf('external_id: result.value.externalId,')
    expect(verifyIndex).toBeGreaterThan(-1)
    expect(successWriteIndex).toBeGreaterThan(verifyIndex)
  })

  /**
   * Milestone: autonomous decision & capability layer, Part 12. Before this,
   * `publishLive` only ever called `recordAudit` — no notification existed
   * for "product published" or "publication failed" anywhere in the codebase,
   * despite both being on the brief's explicit notification list. Static
   * source-text assertions, same technique as the rest of this file, since
   * this module cannot be imported into Vitest.
   */
  it('publishLive notifies on success (published) and on both failure paths (submit rejected, unverified) — never only auditing silently', () => {
    const publishMatch = source.match(/export async function publishLive[\s\S]*?\n}\n/)![0]

    // Submit-rejected failure path.
    const submitFailIndex = publishMatch.indexOf("reason: `Live publication failed.`")
    const submitNotifyIndex = publishMatch.indexOf('Publication failed for')
    expect(submitFailIndex).toBeGreaterThan(-1)
    expect(submitNotifyIndex).toBeGreaterThan(submitFailIndex)

    // Unverified-after-submission failure path.
    const unverifiedFailIndex = publishMatch.indexOf("error: 'Unverified after submission.'")
    const unverifiedNotifyIndex = publishMatch.indexOf('Publication verification failed for')
    expect(unverifiedFailIndex).toBeGreaterThan(-1)
    expect(unverifiedNotifyIndex).toBeGreaterThan(unverifiedFailIndex)

    // Success path — only reachable after verified === true.
    const successAuditIndex = publishMatch.indexOf("action: 'LISTING_PUBLISHED'")
    const successNotifyIndex = publishMatch.indexOf('is now published')
    expect(successAuditIndex).toBeGreaterThan(-1)
    expect(successNotifyIndex).toBeGreaterThan(successAuditIndex)

    expect(publishMatch).toMatch(/severity: 'critical', category: 'catalogue'/)
    expect(publishMatch).toMatch(/severity: 'success', category: 'catalogue'/)
  })
})
