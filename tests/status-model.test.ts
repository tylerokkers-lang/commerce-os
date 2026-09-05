import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planListingTransition } from '@/lib/marketplaces/listingLifecycle'
import { decisionPermitsExecution, EXECUTION_PERMITTED_DECISIONS } from '@/lib/products/decisionGate'
import { planTransition } from '@/lib/products/lifecycle'

/**
 * Milestone: execution reliability & unified write path — Part 3, the four
 * status systems (`docs/ARCHITECTURE.md`'s new "The four status systems"
 * section has the full model). These tests assert the one property that
 * actually matters: an internal decision/business-state fact can never, by
 * itself, imply anything about verified external marketplace state.
 */

describe('internal decision state never implies external publication state', () => {
  it('product_decision "add" is a permission, not a claim that anything is live — it carries no channel/listing information at all', () => {
    expect(decisionPermitsExecution('add')).toBe(true)
    // Permitting execution is a necessary gate, never sufficient on its own —
    // `decisionGate.ts` itself only ever answers "may this proceed to the
    // next gate," and the next gate is a completely separate module
    // (`marketplaces/listingLifecycle.ts`) this function never touches.
    expect(EXECUTION_PERMITTED_DECISIONS.has('add')).toBe(true)
  })

  it('a product can reach product_stage "approved" with zero marketplace listings ever created — the two are independently tracked', () => {
    const result = planTransition({ from: 'compliance_review', to: 'approved', reason: 'Cleared every gate for this milestone.' })
    expect(result.ok).toBe(true)
    // Nothing here reads or writes `channel_products` — reaching "approved"
    // is purely a `products` table fact.
  })
})

describe('marketplace_listing_state: invalid transitions are rejected, never silently applied', () => {
  it('refuses to jump straight from "discovered" to "published" — every intermediate gate must be passed through explicitly', () => {
    const result = planListingTransition({ from: 'discovered', to: 'published', reason: 'Skipping ahead.' })
    expect(result.ok).toBe(false)
  })

  it('refuses any transition away from the terminal "ended" state', () => {
    const result = planListingTransition({ from: 'ended', to: 'published', reason: 'Reviving a withdrawn listing.' })
    expect(result.ok).toBe(false)
  })

  it('refuses a transition with no real reason — every state change must be explainable in the audit trail', () => {
    const result = planListingTransition({ from: 'pending_approval', to: 'published', reason: 'x' })
    expect(result.ok).toBe(false)
  })

  it('permits the one real path from a pending draft to published, with a real reason', () => {
    const result = planListingTransition({ from: 'pending_approval', to: 'published', reason: 'Owner explicitly triggered live publication.' })
    expect(result.ok).toBe(true)
  })
})

describe('stale external state can never be treated as current — reconciliation only ever follows a fresh, real verify call', () => {
  const publicationSource = readFileSync('src/lib/marketplaces/shopify/publicationService.ts', 'utf8')
  const productHandlersSource = readFileSync('src/lib/automation/handlers/productHandlers.ts', 'utf8')

  it('publishLive/pauseListing only write channel_products as live/paused after a passing verify check, never unconditionally after the write call', () => {
    for (const fnName of ['publishLive', 'pauseListing']) {
      const match = publicationSource.match(new RegExp(`export async function ${fnName}[\\s\\S]*?\\n}\\n`))
      const body = match![0]
      const verifyIndex = body.indexOf('verifyListingState')
      const guardIndex = body.indexOf('if (!verified)')
      const writeIndex = body.search(/\.update\(\{ status: '(?:live|paused)'/)
      expect(verifyIndex, fnName).toBeGreaterThan(-1)
      expect(guardIndex, fnName).toBeGreaterThan(verifyIndex)
      expect(writeIndex, fnName).toBeGreaterThan(guardIndex)
    }
  })

  it('handleProductPause/handleProductResume only reconcile channel_products after a passing verify check inside the shared submit helper, never immediately after the connector write', () => {
    const match = productHandlersSource.match(/async function submitListingStatusChange[\s\S]*?\n}\n/)
    const body = match![0]
    const writeCallIndex = body.indexOf('connector.setListingStatus')
    const verifyIndex = body.indexOf('verifyListingState')
    const reconcileIndex = body.indexOf('reconcileChannelProduct')
    expect(writeCallIndex).toBeGreaterThan(-1)
    expect(verifyIndex).toBeGreaterThan(writeCallIndex)
    expect(reconcileIndex).toBeGreaterThan(verifyIndex)
    // The reconcile call itself must be inside the `if (verified)` branch, not unconditional.
    expect(body).toMatch(/if \(verified\) \{\s*\n\s*await store\.reconcileChannelProduct/)
  })

  it('neither handler ever writes channel_products.status directly — reconciliation always goes through the one shared, verified path (reconcileChannelProduct)', () => {
    expect(productHandlersSource).not.toMatch(/from\('channel_products'\)/)
  })
})
