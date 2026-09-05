import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Milestone: close the production autonomy gap — capability honesty.
 *
 * A capability flag is a hard gate: `priceExecution.ts`, `recovery.ts` and
 * `productHandlers.ts` all check one immediately before calling the
 * corresponding connector method, and `MarketplaceCapabilities`'s own type
 * documentation defines them as "can THIS CONNECTOR do it", not "does the
 * marketplace support it".
 *
 * The audit for this milestone found the real Amazon connector declaring
 * `writeListings`, `syncInventory`, `readFees` and `verifyWrites` as `true`
 * while every one of the underlying methods returned `not_supported` or
 * "not yet implemented". That combination is worse than a missing feature:
 * it makes the execution reaper attempt a verification the connector cannot
 * perform and then record the result as a *failed verification* rather than
 * as "this connector cannot verify at all".
 *
 * Static source assertions rather than calling the methods, deliberately:
 * a genuinely-implemented method returns a "not configured" error in a test
 * environment with no credentials, which is indistinguishable at runtime
 * from a stub. The source is not ambiguous. Same technique
 * `publication-control-plane.test.ts` already uses for the same reason.
 */

interface ConnectorUnderTest {
  path: string
  label: string
}

const REAL_CONNECTORS: readonly ConnectorUnderTest[] = [
  { path: 'src/lib/marketplaces/connectors/shopify.ts', label: 'Shopify' },
  { path: 'src/lib/marketplaces/connectors/amazon.ts', label: 'Amazon UK' },
  { path: 'src/lib/marketplaces/connectors/ebay.ts', label: 'eBay' },
]

/** Which methods must be genuinely implemented for a given capability to be honest. */
const CAPABILITY_METHODS: Readonly<Record<string, readonly string[]>> = {
  writeListings: ['updateListingPrice', 'setListingStatus'],
  verifyWrites: ['verifyListingState'],
  createListings: ['createListing'],
  readFees: ['fetchFees'],
}

function declaredCapabilities(source: string): Record<string, boolean> {
  const block = source.match(/capabilities:\s*\{([\s\S]*?)\n\s{2}\}/)
  if (!block) throw new Error('No capabilities block found')
  const flags: Record<string, boolean> = {}
  for (const m of block[1].matchAll(/^\s*(\w+):\s*(true|false)/gm)) flags[m[1]] = m[2] === 'true'
  return flags
}

/** The body of one method, up to the start of the next one. */
function methodBody(source: string, method: string): string | null {
  const start = source.search(new RegExp(`^\\s{2}async ${method}\\(`, 'm'))
  if (start === -1) return null
  const rest = source.slice(start)
  const next = rest.slice(1).search(/^\s{2}(async |\/\*\*)/m)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

/** A method that does nothing but report it cannot do the thing. */
function isUnimplemented(body: string): boolean {
  return /reason:\s*'not_supported'/.test(body) || /not yet implemented/i.test(body)
}

describe('marketplace connector capability honesty', () => {
  for (const connector of REAL_CONNECTORS) {
    const source = readFileSync(connector.path, 'utf8')
    const flags = declaredCapabilities(source)

    for (const [capability, methods] of Object.entries(CAPABILITY_METHODS)) {
      it(`${connector.label}: "${capability}" is only declared true when ${methods.join('/')} ${methods.length > 1 ? 'are' : 'is'} genuinely implemented`, () => {
        if (!flags[capability]) return // Declaring false is always honest — it can only under-promise.

        for (const method of methods) {
          const body = methodBody(source, method)
          expect(body, `${connector.label}.${method} should exist when ${capability} is true`).not.toBeNull()
          expect(
            isUnimplemented(body!),
            `${connector.label} declares ${capability}: true, but ${method}() only reports that it cannot do it. Fix the descriptor, never the other way round.`,
          ).toBe(false)
        }
      })
    }
  }

  it('the real Amazon connector no longer claims writes or verification it cannot perform', () => {
    const flags = declaredCapabilities(readFileSync('src/lib/marketplaces/connectors/amazon.ts', 'utf8'))
    expect(flags.writeListings).toBe(false)
    expect(flags.verifyWrites).toBe(false)
    expect(flags.syncInventory).toBe(false)
    expect(flags.readFees).toBe(false)
    // The two it genuinely does implement stay true — this is an honesty
    // fix, not a blanket disabling.
    expect(flags.readListings).toBe(true)
    expect(flags.ingestOrders).toBe(true)
  })

  /**
   * Without this block the loop above would be vacuous: every real
   * connector now declares `false` for all four audited capabilities, so
   * every case returns early and nothing is actually asserted. The demo
   * connectors are the control group — they declare these capabilities
   * `true` AND genuinely implement them, so they must PASS the identical
   * check. If the detector above ever broke (say, by treating every method
   * as unimplemented), this is what would catch it.
   */
  describe('the detector itself is exercised by connectors that genuinely implement their declared writes', () => {
    const DEMOS: readonly ConnectorUnderTest[] = [
      { path: 'src/lib/marketplaces/connectors/shopifyDemo.ts', label: 'Shopify (demo)' },
      { path: 'src/lib/marketplaces/connectors/amazonDemo.ts', label: 'Amazon UK (demo)' },
    ]

    for (const demo of DEMOS) {
      const source = readFileSync(demo.path, 'utf8')
      const flags = declaredCapabilities(source)

      it(`${demo.label} declares writeListings/verifyWrites and passes the same honesty check`, () => {
        expect(flags.writeListings, 'this control case is only meaningful if the demo declares the capability').toBe(true)
        expect(flags.verifyWrites).toBe(true)

        for (const method of [...CAPABILITY_METHODS.writeListings, ...CAPABILITY_METHODS.verifyWrites]) {
          const body = methodBody(source, method)
          expect(body, `${demo.label}.${method} should exist`).not.toBeNull()
          expect(isUnimplemented(body!), `${demo.label}.${method} is genuinely implemented, so the detector must not flag it`).toBe(false)
        }
      })
    }

    it('the detector does recognise an unimplemented method when it sees one', () => {
      expect(isUnimplemented("return err({ reason: 'not_supported', detail: 'nope' })")).toBe(true)
      expect(isUnimplemented('return err(`not yet implemented in this connector.`)')).toBe(true)
      expect(isUnimplemented('const res = await fetch(url); return ok(res)')).toBe(false)
    })
  })

  it('no real connector can create marketplace listings, so no candidate can be published autonomously', () => {
    for (const connector of REAL_CONNECTORS) {
      const flags = declaredCapabilities(readFileSync(connector.path, 'utf8'))
      expect(flags.createListings, `${connector.label} must not declare createListings`).toBe(false)
    }
  })
})
