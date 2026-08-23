'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/security/session'
import { pauseAllAutomation, resumeAllAutomation, setCategoryPaused } from '@/lib/automation/killSwitch'
import { getAutomationSettings } from '@/lib/automation/settings'
import type { AutomationCategory } from '@/lib/automation/types'

/** The kill switch (brief §14). Owner-only, same as approving a decision. */

export async function pauseAll(formData: FormData): Promise<void> {
  const session = await requireSession()
  if (session.role !== 'owner') throw new Error('Only the owner may pause automation.')
  const reason = String(formData.get('reason') ?? 'Paused from the Automation page')
  await pauseAllAutomation(session, reason)
  revalidatePath('/automation')
}

export async function resumeAll(): Promise<void> {
  const session = await requireSession()
  if (session.role !== 'owner') throw new Error('Only the owner may resume automation.')
  await resumeAllAutomation(session)
  revalidatePath('/automation')
}

export async function toggleCategory(formData: FormData): Promise<void> {
  const session = await requireSession()
  if (session.role !== 'owner') throw new Error('Only the owner may change category automation.')

  const category = String(formData.get('category')) as AutomationCategory
  const paused = formData.get('paused') === 'true'
  const settings = await getAutomationSettings(session)
  await setCategoryPaused(session, category, paused, settings.automationPausedCategories)
  revalidatePath('/automation')
}
