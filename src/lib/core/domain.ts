import type { Money } from '@/lib/core/money'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * View models the dashboard renders.
 *
 * Demo mode and live mode both produce these shapes, so no UI component ever
 * needs to know which one it is looking at. The only difference the UI sees is
 * the `isDemo` flag, which it uses to label simulated figures (§55).
 */

export type ChannelKey = Enums<'channel_key'>
export type ProductStage = Enums<'product_stage'>
export type ListingStatus = Enums<'channel_listing_status'>
export type ComplianceVerdict = Enums<'compliance_verdict'>
export type ApprovalStatus = Enums<'approval_status'>
export type NotificationSeverity = Enums<'notification_severity'>
export type DecisionStatus = Enums<'decision_status'>

export interface BusinessSummary {
  isDemo: boolean
  periodLabel: string
  revenue: Money
  /** Contribution, not gross revenue. The figure that matters (§3). */
  contribution: Money
  estimatedNetProfit: Money
  orders: number
  units: number
  averageOrderValue: Money
  contributionMarginPct: number | null
  adSpend: Money
  roas: number | null
  refundRatePct: number
  returnRatePct: number
  cashAvailable: Money
  /** Change against the equivalent previous period, as a percentage. */
  revenueChangePct: number | null
  contributionChangePct: number | null
}

export interface ChannelSummary {
  channel: ChannelKey
  label: string
  isConnected: boolean
  connectionMode: 'demo' | 'live'
  revenue: Money
  contribution: Money
  orders: number
  liveListings: number
  blockedListings: number
  reviewRequiredListings: number
}

export interface ProductSummary {
  id: string
  sku: string
  title: string
  category: string | null
  stage: ProductStage
  healthScore: number
  opportunityScore: number | null
  /** Independent status per channel (§21) — never collapsed into one. */
  channelStatus: Record<ChannelKey, ListingStatus>
  revenue: Money
  contribution: Money
  contributionMarginPct: number | null
  unitsSold: number
  adSpend: Money
  returnRatePct: number
  rating: number | null
  reviewCount: number
  trend: 'up' | 'flat' | 'down'
  trendPct: number
  daysOfStock: number | null
}

export interface OpportunitySummary {
  id: string
  title: string
  category: string
  opportunityScore: number
  band: string
  estimatedContributionMarginPct: number
  estimatedSellingPrice: Money
  estimatedUnitCost: Money
  supplierIdentified: boolean
  amazonCompliance: ComplianceVerdict
  shopifyCompliance: ComplianceVerdict
  sourceLabel: string
  rationale: string
}

export interface SupplierSummary {
  id: string
  name: string
  country: string | null
  score: number
  shopifyStatus: ApprovalStatus
  amazonStatus: ApprovalStatus
  statusReason: string | null
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  onTimeRatePct: number | null
  productCount: number
}

export interface StockAlert {
  productId: string
  sku: string
  title: string
  availableQty: number
  daysRemaining: number
  isSupplierStocked: boolean
  recommendedOrderQty: number
  recommendedOrderCost: Money
  requiresApproval: boolean
}

export interface ComplianceIssue {
  productId: string
  sku: string
  title: string
  channel: ChannelKey
  verdict: ComplianceVerdict
  blockingReasons: readonly string[]
  assessedAt: string
}

export interface FinanceSummary {
  invoicesGenerated: number
  invoicesSent: number
  invoicesFailed: number
  creditNotesIssued: number
  vatRegistered: boolean
  outputVat: Money
  inputVat: Money
  estimatedVatDue: Money
  vatTransactionsNeedingReview: number
  rollingTurnover: Money
  vatThreshold: Money
  vatThresholdStatus: 'safe' | 'approaching' | 'review_required' | 'registered'
  accountingSyncStatus: 'connected' | 'not_connected' | 'failing'
  accountingPending: number
}

export interface CashflowProjection {
  cashAvailable: Money
  expectedPayouts: readonly { label: string; amount: Money; expectedOn: string }[]
  upcomingCommitments: readonly { label: string; amount: Money; dueOn: string }[]
  projectedLowPoint: Money
  projectedLowPointOn: string
  /** Set when commitments land before payouts do (§48). */
  warning: string | null
}

export interface ApprovalItem {
  id: string
  decisionType: string
  title: string
  detail: string
  reasoning: string
  confidence: number | null
  estimatedImpact: Money | null
  status: DecisionStatus
  createdAt: string
  expiresAt: string | null
}

export interface NotificationItem {
  id: string
  severity: NotificationSeverity
  category: string
  title: string
  body: string | null
  createdAt: string
  readAt: string | null
  actionUrl: string | null
}

export interface AuditEvent {
  id: string
  occurredAt: string
  actorType: Enums<'actor_type'>
  actorLabel: string | null
  action: string
  entityType: string
  entityId: string | null
  reason: string | null
  result: string
}

export interface IntegrationHealth {
  key: string
  label: string
  status: 'connected' | 'demo' | 'not_configured' | 'error'
  missingCredentials: readonly string[]
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  nextRetryAt: string | null
}

/** The daily briefing (§49) — only what genuinely needs the owner. */
export interface DailyReport {
  generatedAt: string
  isDemo: boolean
  business: BusinessSummary
  winners: readonly ProductSummary[]
  losers: readonly ProductSummary[]
  opportunities: readonly OpportunitySummary[]
  stockAlerts: readonly StockAlert[]
  complianceIssues: readonly ComplianceIssue[]
  finance: FinanceSummary
  cashflow: CashflowProjection
  approvals: readonly ApprovalItem[]
}
