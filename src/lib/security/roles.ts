import type { SessionContext } from './session'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The pure role-check logic `session.ts`'s `canWrite`/`canApprove`/
 * `requireWriteAccess` are built on — extracted here, with no `server-only`
 * import, so it can be tested directly. `session.ts` has `import 'server-only'`
 * at its top, and (confirmed empirically, same as every other server-only
 * file in this codebase) that makes the whole module unimportable in
 * Vitest — no test anywhere imports it. The `SessionContext` type import
 * above is `import type`, fully erased at compile time, so it never
 * triggers that resolution.
 */

const WRITE_ROLES: readonly Enums<'member_role'>[] = ['owner', 'admin']

export const canWrite = (session: SessionContext): boolean => WRITE_ROLES.includes(session.role)
export const canApprove = (session: SessionContext): boolean => session.role === 'owner'
