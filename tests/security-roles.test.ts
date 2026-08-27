import { describe, expect, it } from 'vitest'
import { canWrite, canApprove } from '@/lib/security/roles'
import type { SessionContext } from '@/lib/security/session'

function session(role: SessionContext['role']): SessionContext {
  return { isDemo: false, userId: 'user-1', email: 'user@example.com', orgId: 'org-1', orgName: 'Test Co', role }
}

/**
 * `changeProductDecision` (`products/actions.ts`) and
 * `POST /api/products/[id]/decision` both gate on `requireWriteAccess()`,
 * which is `canWrite` plus a throw — this is the pure logic underneath
 * both, extracted specifically so "an unauthorised user cannot change a
 * product's decision" is a provable fact, not an assumption. Neither
 * `requireWriteAccess` nor the Server Action itself can be imported into
 * Vitest at all (`session.ts` has `import 'server-only'`), matching every
 * other server-only file in this codebase.
 */
describe('canWrite / canApprove (the role check every product-decision write path is built on)', () => {
  it('owner can write', () => {
    expect(canWrite(session('owner'))).toBe(true)
  })

  it('admin can write', () => {
    expect(canWrite(session('admin'))).toBe(true)
  })

  it('a viewer cannot write — this is the exact check that must reject an unauthorised product-decision change', () => {
    expect(canWrite(session('viewer'))).toBe(false)
  })

  it('an analyst cannot write either', () => {
    expect(canWrite(session('analyst'))).toBe(false)
  })

  it('only owner can approve', () => {
    expect(canApprove(session('owner'))).toBe(true)
    expect(canApprove(session('admin'))).toBe(false)
    expect(canApprove(session('viewer'))).toBe(false)
  })
})
