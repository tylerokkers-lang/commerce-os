import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * A `'use server'` file may only export async functions — Next.js's own
 * documented rule (https://nextjs.org/docs/messages/invalid-use-server-value).
 * `shippingActions.ts`, `mediaActions.ts`, `publicationActions.ts` and
 * `actions.ts` each violated this by exporting a plain `initial*State`
 * constant alongside their real actions — found live, not by inspection:
 * these files transitively import `server-only`/`next/headers`'s
 * `cookies()`, so nothing here can import them directly the way an
 * ordinary Vitest test would (the same reason no test already covered
 * this file). Next's build/dev bundler is the only thing that actually
 * enforces the rule, and only once the specific action-bundle chunk is
 * evaluated — which is exactly why this went undetected from Phase 9
 * until a real browser session finally clicked the button. This test is
 * a static, source-level stand-in: it cannot invoke the actions, but it
 * can permanently guard against the exact export shape that broke them,
 * without needing Next's own transform to run.
 */

const PRODUCT_ACTION_FILES = [
  'src/app/(dashboard)/products/actions.ts',
  'src/app/(dashboard)/products/shippingActions.ts',
  'src/app/(dashboard)/products/mediaActions.ts',
  'src/app/(dashboard)/products/publicationActions.ts',
] as const

/** Matches a top-level `export const/let/var <name>` — a plain value export, never legal in a 'use server' file. `export async function`/`export function`/`export interface`/`export type` are all unaffected. */
const PLAIN_VALUE_EXPORT = /^export\s+(?:const|let|var)\s+\w+/m

describe('use server files export only async functions (Next.js\'s own rule)', () => {
  it.each(PRODUCT_ACTION_FILES)('%s has the "use server" directive', (path) => {
    const source = readFileSync(path, 'utf8')
    expect(source.trimStart().startsWith("'use server'")).toBe(true)
  })

  it.each(PRODUCT_ACTION_FILES)('%s exports no plain const/let/var value — only functions and types', (path) => {
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(PLAIN_VALUE_EXPORT)
  })

  it.each(PRODUCT_ACTION_FILES)('%s still exports at least one async function (the fix did not remove the real actions)', (path) => {
    const source = readFileSync(path, 'utf8')
    expect(source).toMatch(/^export async function \w+/m)
  })
})

describe('the relocated state constants are the correct home, mirroring the existing DecisionChangeState pattern', () => {
  it('state.ts (not a "use server" file) now holds all four initial-state constants and their types', () => {
    const source = readFileSync('src/app/(dashboard)/products/state.ts', 'utf8')
    expect(source.trimStart().startsWith("'use server'")).toBe(false)
    for (const name of ['initialIntelligenceState', 'initialShippingState', 'initialMediaState', 'initialPublicationState']) {
      expect(source).toContain(`export const ${name}`)
    }
    for (const name of ['IntelligenceActionState', 'ShippingActionState', 'MediaActionState', 'PublicationActionState']) {
      expect(source).toContain(`export interface ${name}`)
    }
  })

  it('every consuming client component imports the initial-state constant from ./state, not from the action file', () => {
    const consumers: Record<string, string> = {
      'src/app/(dashboard)/products/ProductIntelligencePanel.tsx': 'initialIntelligenceState',
      'src/app/(dashboard)/products/ShippingPanel.tsx': 'initialShippingState',
      'src/app/(dashboard)/products/MediaPanel.tsx': 'initialMediaState',
      'src/app/(dashboard)/products/ShopifyPublicationPanel.tsx': 'initialPublicationState',
    }
    for (const [path, constName] of Object.entries(consumers)) {
      const source = readFileSync(path, 'utf8')
      expect(source).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${constName}\\b[^}]*\\}\\s*from\\s*'\\./state'`))
      // The constant must never still be imported from the action file it used to live in.
      const actionFileImport = new RegExp(`from\\s*'\\./(?:actions|shippingActions|mediaActions|publicationActions)'`)
      const importBlockMatch = source.match(new RegExp(`import\\s*\\{[^}]*\\}\\s*${actionFileImport.source}`))
      if (importBlockMatch) expect(importBlockMatch[0]).not.toContain(constName)
    }
  })
})
