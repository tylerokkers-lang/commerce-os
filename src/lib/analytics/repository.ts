import 'server-only'

import { zero } from '@/lib/core/money'
import type {
  BusinessSummary,
  CashflowProjection,
  ChannelSummary,
  DailyReport,
} from '@/lib/core/domain'
import {
  demoBusinessSummary,
  demoCashflow,
  demoChannels,
  demoDailyReport,
} from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'

/**
 * Reporting reads.
 *
 * Demo and live both return the same shapes. In live mode a business with no
 * trading history returns genuine zeros rather than borrowing demo figures:
 * an empty dashboard on day one is the truthful answer.
 */

const EMPTY_SUMMARY: BusinessSummary = {
  isDemo: false,
  periodLabel: 'Last 30 days',
  revenue: zero('GBP'),
  contribution: zero('GBP'),
  estimatedNetProfit: zero('GBP'),
  orders: 0,
  units: 0,
  averageOrderValue: zero('GBP'),
  contributionMarginPct: null,
  adSpend: zero('GBP'),
  roas: null,
  refundRatePct: 0,
  returnRatePct: 0,
  cashAvailable: zero('GBP'),
  revenueChangePct: null,
  contributionChangePct: null,
}

export async function getBusinessSummary(): Promise<BusinessSummary> {
  const session = await requireSession()
  if (session.isDemo) return demoBusinessSummary()

  // Live aggregation lands in Milestone 3 alongside the Shopify order sync.
  // Until orders exist there is nothing to aggregate, and inventing a figure
  // here would be exactly the failure mode this system is meant to avoid.
  return EMPTY_SUMMARY
}

export async function getChannelSummaries(): Promise<readonly ChannelSummary[]> {
  const session = await requireSession()
  if (session.isDemo) return demoChannels()

  return [
    { channel: 'shopify', label: 'Shopify', isConnected: false, connectionMode: 'live', revenue: zero('GBP'), contribution: zero('GBP'), orders: 0, liveListings: 0, blockedListings: 0, reviewRequiredListings: 0 },
    { channel: 'amazon_uk', label: 'Amazon UK', isConnected: false, connectionMode: 'live', revenue: zero('GBP'), contribution: zero('GBP'), orders: 0, liveListings: 0, blockedListings: 0, reviewRequiredListings: 0 },
  ]
}

export async function getCashflow(): Promise<CashflowProjection> {
  const session = await requireSession()
  if (session.isDemo) return demoCashflow()

  return {
    cashAvailable: zero('GBP'),
    expectedPayouts: [],
    upcomingCommitments: [],
    projectedLowPoint: zero('GBP'),
    projectedLowPointOn: new Date().toISOString(),
    warning: null,
  }
}

export async function getDailyReport(): Promise<DailyReport> {
  const session = await requireSession()
  if (session.isDemo) return demoDailyReport()

  const [business, cashflow] = await Promise.all([getBusinessSummary(), getCashflow()])
  return {
    generatedAt: new Date().toISOString(),
    isDemo: false,
    business,
    winners: [],
    losers: [],
    opportunities: [],
    stockAlerts: [],
    complianceIssues: [],
    finance: {
      invoicesGenerated: 0, invoicesSent: 0, invoicesFailed: 0, creditNotesIssued: 0,
      vatRegistered: false, outputVat: zero('GBP'), inputVat: zero('GBP'),
      estimatedVatDue: zero('GBP'), vatTransactionsNeedingReview: 0,
      rollingTurnover: zero('GBP'), vatThreshold: zero('GBP'),
      vatThresholdStatus: 'safe', accountingSyncStatus: 'not_connected', accountingPending: 0,
    },
    cashflow,
    approvals: [],
  }
}
