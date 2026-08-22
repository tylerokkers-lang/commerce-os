import 'server-only'

import { zero } from '@/lib/core/money'
import type { FinanceSummary } from '@/lib/core/domain'
import { demoFinanceSummary } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'

export async function getFinanceSummary(): Promise<FinanceSummary> {
  const session = await requireSession()
  if (session.isDemo) return demoFinanceSummary()

  // Live figures arrive with the invoice and VAT engines in Milestones 7 and 8.
  return {
    invoicesGenerated: 0,
    invoicesSent: 0,
    invoicesFailed: 0,
    creditNotesIssued: 0,
    vatRegistered: false,
    outputVat: zero('GBP'),
    inputVat: zero('GBP'),
    estimatedVatDue: zero('GBP'),
    vatTransactionsNeedingReview: 0,
    rollingTurnover: zero('GBP'),
    vatThreshold: zero('GBP'),
    vatThresholdStatus: 'safe',
    accountingSyncStatus: 'not_connected',
    accountingPending: 0,
  }
}
