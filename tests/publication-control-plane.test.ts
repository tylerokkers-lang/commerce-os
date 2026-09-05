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
    expect(createDraftMatch![0]).toMatch(/\.verifyListingState\(result\.value\.externalId\)/)
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

  it('never fails a whole listing creation just because verification could not run — accepted is not conflated with confirmed, but recording is unconditional', () => {
    const createDraftMatch = source.match(/export async function createDraft[\s\S]*?\n}\n/)
    // writeChannelProductRow must still run after the verify block, not be gated behind `verified === true`.
    const verifyIndex = createDraftMatch![0].indexOf('verificationStatus')
    const successWriteIndex = createDraftMatch![0].indexOf('external_id: result.value.externalId,')
    expect(verifyIndex).toBeGreaterThan(-1)
    expect(successWriteIndex).toBeGreaterThan(verifyIndex)
  })
})
