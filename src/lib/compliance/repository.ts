import 'server-only'

import type { ComplianceIssue } from '@/lib/core/domain'
import { demoComplianceIssues } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Compliance issues are anything that is not a clean pass: outright failures
 * and anything needing human review. Both block a launch (§14).
 */
export async function getComplianceIssues(): Promise<readonly ComplianceIssue[]> {
  const session = await requireSession()
  if (session.isDemo) return demoComplianceIssues()

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('compliance_records')
    .select('product_id, channel, verdict, blocking_reasons, assessed_at, products(sku, title)')
    .eq('org_id', session.orgId)
    .in('verdict', ['fail', 'review_required'])
    .order('assessed_at', { ascending: false })

  if (error) throw new Error(`Could not load compliance records: ${error.message}`)

  return (data ?? []).map((row) => {
    const product = row.products as unknown as { sku: string; title: string } | null
    return {
      productId: row.product_id,
      sku: product?.sku ?? 'unknown',
      title: product?.title ?? 'Unknown product',
      channel: row.channel,
      verdict: row.verdict,
      blockingReasons: row.blocking_reasons ?? [],
      assessedAt: row.assessed_at,
    }
  })
}
