import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { assessMediaReadiness, type MediaReadinessResult } from './mediaScore'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Read-side access to `product_media` (Milestone: product media
 * intelligence, Phase 7) — the UI's source for the media list, and the
 * one place `assessMediaReadiness` is called against real rows, so the
 * Shopify eligibility gate (Phase 6) and the admin UI always agree.
 */

export type ProductMediaRow = Database['public']['Tables']['product_media']['Row']

export interface ProductMediaWithReadiness {
  media: readonly ProductMediaRow[]
  readiness: MediaReadinessResult
}

export async function getProductMedia(orgId: string, productId: string): Promise<ProductMediaWithReadiness> {
  const supabase = await createServerSupabase()

  const [{ data: rows }, settings] = await Promise.all([
    supabase
      .from('product_media')
      .select('*')
      .eq('org_id', orgId)
      .eq('product_id', productId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    getAutomationSettingsForOrg(orgId),
  ])

  const media = rows ?? []
  const readiness = assessMediaReadiness(
    media.map((m) => ({ role: m.role, validationStatus: m.validation_status })),
    settings.minProductImages,
  )

  return { media, readiness }
}

/** Used by the Shopify publication payload builder — approved media only, ordered, primary first. */
export async function getApprovedMediaForPublication(orgId: string, productId: string): Promise<readonly ProductMediaRow[]> {
  const supabase = await createServerSupabase()
  const { data: rows } = await supabase
    .from('product_media')
    .select('*')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('validation_status', 'approved')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  const media = rows ?? []
  const primary = media.filter((m) => m.role === 'primary')
  const rest = media.filter((m) => m.role !== 'primary')
  return [...primary, ...rest]
}
