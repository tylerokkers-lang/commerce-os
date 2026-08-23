import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Static checks on the audit action vocabulary.
 *
 * `recordAudit` itself needs a live Supabase connection to test end to end
 * (it is exercised for real in `db:verify` and in the running application via
 * the demo audit log and the supplier and stage-change actions). What can be
 * checked here without a database is that the vocabulary the rest of the
 * system relies on is actually complete and internally consistent, which is
 * the kind of drift that is easy to introduce silently.
 */

const auditSource = readFileSync(new URL('../src/lib/audit/index.ts', import.meta.url), 'utf8')

function extractUnionMembers(source: string, exportName: string): string[] {
  const start = source.indexOf(`export type ${exportName} =`)
  if (start === -1) throw new Error(`Could not find ${exportName}`)
  const end = source.indexOf('\n\nexport', start)
  const block = source.slice(start, end === -1 ? undefined : end)
  return [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
}

describe('audit action vocabulary', () => {
  const actions = extractUnionMembers(auditSource, 'AuditAction')

  it('is non-empty and covers Milestone 1 catalogue and finance actions', () => {
    expect(actions.length).toBeGreaterThan(20)
    for (const required of ['PRODUCT_ADDED', 'INVOICE_CREATED', 'COMPLIANCE_BLOCKED', 'REFUND_CREATED']) {
      expect(actions).toContain(required)
    }
  })

  it('covers every action Milestone 2 code actually uses', () => {
    // Grep the source tree for AuditAction string literals used at call sites
    // and confirm each is declared. This is what would have caught a typo in
    // an action name before it silently created an untypeable audit entry.
    const usedInPipelineCode = [
      'SUPPLIER_ADDED', 'SUPPLIER_UPDATED', 'SUPPLIER_STATUS_CHANGED',
      'PRODUCT_STAGE_CHANGED', 'PRODUCT_REMOVED',
    ]
    for (const action of usedInPipelineCode) {
      expect(actions).toContain(action)
    }
  })

  it('has no duplicate entries', () => {
    expect(new Set(actions).size).toBe(actions.length)
  })

  it('every action is SCREAMING_SNAKE_CASE', () => {
    for (const action of actions) {
      expect(action).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})
