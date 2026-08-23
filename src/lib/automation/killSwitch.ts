import 'server-only'

import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { SessionContext } from '@/lib/security/session'
import type { AutomationCategory } from './types'

/**
 * The emergency stop (brief §14).
 *
 * Deliberately routed through `createServiceSupabase` rather than the
 * caller's session-scoped client: `business_settings` writes are otherwise
 * restricted to owner/admin by RLS (see 0009's `managed_tables` loop), and a
 * pause/resume must be auditable and unambiguous regardless of that policy
 * layer, exactly like every other write in this codebase that goes through
 * `recordAudit`.
 *
 * Every call here is a no-op in demo mode beyond returning what *would*
 * happen — there is no database to persist a pause against, matching the
 * pattern every other write-capable module in this app already follows.
 */

export interface KillSwitchResult {
  applied: boolean
  message: string
}

export async function pauseAllAutomation(session: SessionContext, reason: string): Promise<KillSwitchResult> {
  if (session.isDemo) {
    return { applied: false, message: 'Demo mode has no database — this would pause all automation for real once Supabase is connected.' }
  }
  const supabase = createServiceSupabase()
  const { error } = await supabase
    .from('business_settings')
    .update({ automation_paused: true, automation_paused_at: new Date().toISOString(), automation_paused_reason: reason })
    .eq('org_id', session.orgId)
  if (error) throw new Error(`Could not pause automation: ${error.message}`)

  await recordAudit({
    orgId: session.orgId,
    action: 'AUTOMATION_PAUSED',
    entityType: 'business_settings',
    entityId: session.orgId,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
    reason: `Automation paused: ${reason}`,
    newValue: { automation_paused: true },
  })

  return { applied: true, message: 'All automation is paused.' }
}

export async function resumeAllAutomation(session: SessionContext): Promise<KillSwitchResult> {
  if (session.isDemo) {
    return { applied: false, message: 'Demo mode has no database — this would resume automation for real once Supabase is connected.' }
  }
  const supabase = createServiceSupabase()
  const { error } = await supabase
    .from('business_settings')
    .update({ automation_paused: false, automation_paused_at: null, automation_paused_reason: null })
    .eq('org_id', session.orgId)
  if (error) throw new Error(`Could not resume automation: ${error.message}`)

  await recordAudit({
    orgId: session.orgId,
    action: 'AUTOMATION_RESUMED',
    entityType: 'business_settings',
    entityId: session.orgId,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
    reason: 'Automation resumed',
    newValue: { automation_paused: false },
  })

  return { applied: true, message: 'Automation has resumed.' }
}

export async function setCategoryPaused(
  session: SessionContext,
  category: AutomationCategory,
  paused: boolean,
  currentCategories: readonly AutomationCategory[],
): Promise<KillSwitchResult> {
  if (session.isDemo) {
    return {
      applied: false,
      message: `Demo mode has no database — this would ${paused ? 'pause' : 'resume'} "${category}" automation for real once Supabase is connected.`,
    }
  }
  const next = paused
    ? Array.from(new Set([...currentCategories, category]))
    : currentCategories.filter((c) => c !== category)

  const supabase = createServiceSupabase()
  const { error } = await supabase
    .from('business_settings')
    .update({ automation_paused_categories: next })
    .eq('org_id', session.orgId)
  if (error) throw new Error(`Could not update category pause: ${error.message}`)

  await recordAudit({
    orgId: session.orgId,
    action: 'AUTOMATION_LEVEL_CHANGED',
    entityType: 'business_settings',
    entityId: session.orgId,
    actorType: 'user',
    actorUserId: session.userId,
    actorLabel: session.email,
    reason: `Automation category "${category}" ${paused ? 'paused' : 'resumed'}`,
    previousValue: { automation_paused_categories: currentCategories },
    newValue: { automation_paused_categories: next },
  })

  return { applied: true, message: `"${category}" automation ${paused ? 'paused' : 'resumed'}.` }
}
