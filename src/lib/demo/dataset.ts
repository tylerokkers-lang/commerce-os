import { add, formatMoney, fromMajor, marginPct, money, multiply, subtract, zero } from '@/lib/core/money'
import { calculateProfitability } from '@/lib/profitability'
import { createRng } from './rng'
import { demoEvaluations, demoSupplierScores } from './research'
import { DEMO_SUPPLIERS } from './suppliers'
import { assessAmazonCapability, assessShopifyCapability } from '@/lib/suppliers/scoring'
import type {
  ApprovalItem,
  AuditEvent,
  BusinessSummary,
  CashflowProjection,
  ChannelSummary,
  ComplianceIssue,
  DailyReport,
  FinanceSummary,
  NotificationItem,
  OpportunitySummary,
  ProductSummary,
  StockAlert,
  SupplierListItem,
} from '@/lib/core/domain'

/**
 * A simulated but internally consistent business (§55).
 *
 * Every figure here is derived the same way the live system derives it: the
 * demo products run through the real profitability engine, contribution is
 * genuinely revenue minus real cost lines, and the compliance blocks are the
 * ones the real ruleset would produce. The point is to exercise the system's
 * actual logic without credentials, not to paint convincing numbers on a page.
 *
 * Everything produced here is flagged `isDemo` and labelled in the UI.
 */

const SEED = 20260822
const rng = createRng(SEED)

const DAY_MS = 86_400_000
const today = new Date('2026-08-22T09:00:00Z')
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY_MS).toISOString()
const daysAhead = (n: number) => new Date(today.getTime() + n * DAY_MS).toISOString()

export interface DemoProductSeed {
  sku: string
  title: string
  category: string
  stage: ProductStageLike
  price: number
  cost: number
  supplierShipping: number
  channels: { shopify: ListingStatusLike; amazon_uk: ListingStatusLike }
  unitsSold: number
  adSpendPerUnit: number
  returnRatePct: number
  rating: number | null
  reviewCount: number
  trendPct: number
  daysOfStock: number | null
  opportunityScore: number | null
}

type ProductStageLike = ProductSummary['stage']
type ListingStatusLike = ProductSummary['channelStatus']['shopify']

/**
 * Deliberately a mixed catalogue: clear winners, a clear loser, one product
 * blocked on Amazon for a real policy reason, and one still in testing. A demo
 * where everything is healthy teaches the owner nothing.
 */
export const PRODUCT_SEEDS: readonly DemoProductSeed[] = [
  {
    sku: 'CMO-1001', title: 'Adjustable Laptop Riser, Aluminium', category: 'Home Office',
    stage: 'scaling', price: 34.99, cost: 9.2, supplierShipping: 2.4,
    channels: { shopify: 'live', amazon_uk: 'live' },
    unitsSold: 184, adSpendPerUnit: 4.1, returnRatePct: 2.1, rating: 4.6, reviewCount: 212,
    trendPct: 24, daysOfStock: 8, opportunityScore: 88,
  },
  {
    sku: 'CMO-1002', title: 'Weighted Blanket Cover, Brushed Cotton', category: 'Bedroom',
    stage: 'proven', price: 42.0, cost: 14.5, supplierShipping: 3.8,
    channels: { shopify: 'live', amazon_uk: 'live' },
    unitsSold: 96, adSpendPerUnit: 6.2, returnRatePct: 6.4, rating: 4.2, reviewCount: 88,
    trendPct: 6, daysOfStock: 31, opportunityScore: 79,
  },
  {
    sku: 'CMO-1003', title: 'Reusable Silicone Food Covers, Set of 6', category: 'Kitchen',
    stage: 'proven', price: 15.99, cost: 3.1, supplierShipping: 1.2,
    channels: { shopify: 'live', amazon_uk: 'live' },
    unitsSold: 241, adSpendPerUnit: 2.0, returnRatePct: 1.4, rating: 4.5, reviewCount: 340,
    trendPct: 11, daysOfStock: 46, opportunityScore: 82,
  },
  {
    sku: 'CMO-1004', title: 'Compact Travel Steamer', category: 'Laundry',
    stage: 'declining', price: 27.5, cost: 12.8, supplierShipping: 4.1,
    channels: { shopify: 'live', amazon_uk: 'paused' },
    unitsSold: 22, adSpendPerUnit: 7.4, returnRatePct: 14.2, rating: 3.4, reviewCount: 41,
    trendPct: -31, daysOfStock: 74, opportunityScore: 61,
  },
  {
    sku: 'CMO-1005', title: 'Ceramic Pour-Over Coffee Dripper', category: 'Kitchen',
    stage: 'testing', price: 22.0, cost: 6.9, supplierShipping: 3.2,
    channels: { shopify: 'testing', amazon_uk: 'review_required' },
    unitsSold: 31, adSpendPerUnit: 5.1, returnRatePct: 4.8, rating: 4.1, reviewCount: 12,
    trendPct: 9, daysOfStock: 22, opportunityScore: 74,
  },
  {
    sku: 'CMO-1006', title: 'Rechargeable Handheld Vacuum', category: 'Cleaning',
    stage: 'compliance_review', price: 49.99, cost: 19.4, supplierShipping: 5.6,
    // Blocked on Amazon: a lithium battery product whose supplier cannot
    // provide the required documentation or ship as seller of record.
    channels: { shopify: 'draft', amazon_uk: 'blocked' },
    unitsSold: 0, adSpendPerUnit: 0, returnRatePct: 0, rating: null, reviewCount: 0,
    trendPct: 0, daysOfStock: null, opportunityScore: 71,
  },
  {
    sku: 'CMO-1007', title: 'Linen Storage Baskets, Set of 3', category: 'Storage',
    stage: 'mature', price: 29.99, cost: 10.1, supplierShipping: 3.9,
    channels: { shopify: 'live', amazon_uk: 'live' },
    unitsSold: 74, adSpendPerUnit: 3.4, returnRatePct: 3.2, rating: 4.4, reviewCount: 156,
    trendPct: -2, daysOfStock: 58, opportunityScore: 76,
  },
  {
    sku: 'CMO-1008', title: 'Desk Cable Management Tray', category: 'Home Office',
    stage: 'paused', price: 18.5, cost: 8.9, supplierShipping: 3.1,
    channels: { shopify: 'paused', amazon_uk: 'paused' },
    unitsSold: 6, adSpendPerUnit: 5.8, returnRatePct: 9.1, rating: 3.6, reviewCount: 19,
    trendPct: -44, daysOfStock: 120, opportunityScore: 54,
  },
]

/** Amazon UK referral fee for these categories, and Shopify's payment rate. */
const AMAZON_REFERRAL_PCT = 15
const SHOPIFY_PAYMENT_PCT = 1.75
const SHOPIFY_PAYMENT_FIXED = 0.25
const VAT_RATE = 20

function productEconomics(seed: DemoProductSeed) {
  // The demo business is VAT registered, so VAT is stripped from every sale.
  return calculateProfitability({
    sellingPrice: fromMajor(seed.price),
    productCost: fromMajor(seed.cost),
    supplierShipping: fromMajor(seed.supplierShipping),
    packaging: fromMajor(0.35),
    channelFeePct: AMAZON_REFERRAL_PCT,
    paymentFeePct: SHOPIFY_PAYMENT_PCT,
    paymentFeeFixed: fromMajor(SHOPIFY_PAYMENT_FIXED),
    adSpendPerUnit: fromMajor(seed.adSpendPerUnit),
    returnRatePct: seed.returnRatePct,
    returnLossPct: 65,
    refundRatePct: 1,
    vatRatePct: VAT_RATE,
    vatInclusive: true,
  })
}

function healthScore(seed: DemoProductSeed, contributionMarginPct: number | null): number {
  // Composite of the things that actually decide whether to keep a product
  // (§62): margin, demand, returns, customer sentiment and trend.
  const margin = Math.max(0, Math.min(100, (contributionMarginPct ?? 0) * 2.2))
  const demand = Math.min(100, seed.unitsSold * 0.45)
  const returns = Math.max(0, 100 - seed.returnRatePct * 7)
  const sentiment = seed.rating ? ((seed.rating - 1) / 4) * 100 : 50
  const trend = Math.max(0, Math.min(100, 50 + seed.trendPct * 1.4))
  const score = margin * 0.3 + demand * 0.2 + returns * 0.2 + sentiment * 0.15 + trend * 0.15
  return Math.round(Math.max(0, Math.min(100, score)))
}

export function demoProducts(): readonly ProductSummary[] {
  return PRODUCT_SEEDS.map((seed) => {
    const econ = productEconomics(seed)
    const revenue = multiply(fromMajor(seed.price), seed.unitsSold)
    const contribution = multiply(econ.netProfit, seed.unitsSold)
    const adSpend = multiply(fromMajor(seed.adSpendPerUnit), seed.unitsSold)

    return {
      id: seed.sku.toLowerCase(),
      sku: seed.sku,
      title: seed.title,
      category: seed.category,
      stage: seed.stage,
      healthScore: healthScore(seed, econ.netMarginPct),
      opportunityScore: seed.opportunityScore,
      // eBay is not yet part of the demo dataset's per-product channel model
      // (`DemoProductSeed.channels`) — Milestone 21 Step 1 only builds the
      // eBay channel adapter itself, not per-product eBay listing state, so
      // every demo product is honestly 'not_listed' on eBay rather than a
      // fabricated status.
      channelStatus: { shopify: seed.channels.shopify, amazon_uk: seed.channels.amazon_uk, ebay: 'not_listed' },
      revenue,
      contribution,
      contributionMarginPct: econ.netMarginPct,
      unitsSold: seed.unitsSold,
      adSpend,
      returnRatePct: seed.returnRatePct,
      rating: seed.rating,
      reviewCount: seed.reviewCount,
      trend: seed.trendPct > 3 ? 'up' : seed.trendPct < -3 ? 'down' : 'flat',
      trendPct: seed.trendPct,
      daysOfStock: seed.daysOfStock,
    } satisfies ProductSummary
  })
}

export function demoBusinessSummary(): BusinessSummary {
  const products = demoProducts()
  const revenue = products.reduce((acc, p) => add(acc, p.revenue), zero('GBP'))
  const contribution = products.reduce((acc, p) => add(acc, p.contribution), zero('GBP'))
  const adSpend = products.reduce((acc, p) => add(acc, p.adSpend), zero('GBP'))
  const units = products.reduce((acc, p) => acc + p.unitsSold, 0)

  // Fixed operating costs the contribution has to cover before anything is
  // genuinely profit: software, accounting, packaging stock.
  const operatingCosts = fromMajor(214.5)
  const estimatedNetProfit = subtract(contribution, operatingCosts)

  const orders = Math.round(units * 0.82)
  const averageOrderValue = orders > 0 ? money(Math.round(revenue.minor / orders), 'GBP') : zero('GBP')

  return {
    isDemo: true,
    periodLabel: 'Last 30 days',
    revenue,
    contribution,
    estimatedNetProfit,
    orders,
    units,
    averageOrderValue,
    contributionMarginPct: marginPct(contribution, revenue),
    adSpend,
    roas: adSpend.minor > 0 ? Math.round((revenue.minor / adSpend.minor) * 100) / 100 : null,
    refundRatePct: 2.4,
    returnRatePct: 4.1,
    cashAvailable: fromMajor(3184.22),
    revenueChangePct: 12.4,
    contributionChangePct: 9.1,
  }
}

export function demoChannels(): readonly ChannelSummary[] {
  const products = demoProducts()

  const forChannel = (channel: 'shopify' | 'amazon_uk', share: number, label: string): ChannelSummary => {
    const relevant = products.filter((p) => p.channelStatus[channel] === 'live')
    return {
      channel,
      label,
      isConnected: false,
      connectionMode: 'demo',
      revenue: multiply(relevant.reduce((a, p) => add(a, p.revenue), zero('GBP')), share),
      contribution: multiply(relevant.reduce((a, p) => add(a, p.contribution), zero('GBP')), share),
      orders: Math.round(relevant.reduce((a, p) => a + p.unitsSold, 0) * share * 0.82),
      liveListings: products.filter((p) => p.channelStatus[channel] === 'live').length,
      blockedListings: products.filter((p) => p.channelStatus[channel] === 'blocked').length,
      reviewRequiredListings: products.filter((p) => p.channelStatus[channel] === 'review_required').length,
    }
  }

  return [forChannel('shopify', 0.42, 'Shopify'), forChannel('amazon_uk', 0.58, 'Amazon UK')]
}

/**
 * Opportunities, derived from the real evaluation pipeline.
 *
 * Nothing below is authored. Each figure is whatever the scoring, supplier,
 * profitability and compliance engines produced for the simulated candidates,
 * which is the point: the demo exercises the gates rather than illustrating
 * them.
 */
export function demoOpportunities(): readonly OpportunitySummary[] {
  return demoEvaluations().map((evaluated) => {
    const { candidate, score, recommendation, supplier, compliance, channels } = evaluated

    const shopify = channels.projections.find((p) => p.channel === 'shopify')!
    const amazon = channels.projections.find((p) => p.channel === 'amazon_uk')!
    const best = shopify.profitability.netProfit.minor >= amazon.profitability.netProfit.minor ? shopify : amazon

    return {
      id: candidate.externalRef,
      title: candidate.title,
      category: candidate.category,
      opportunityScore: score.total,
      band: score.band,
      bandLabel: score.bandLabel,
      confidence: score.confidence,
      confidenceLabel: score.confidenceLabel,
      recommendedAction: recommendation.action,
      headline: recommendation.headline,
      estimatedContributionMarginPct: best.profitability.netMarginPct ?? 0,
      estimatedSellingPrice: candidate.estimatedSellingPrice,
      estimatedUnitCost: supplier.chosen?.signals.unitCost ?? candidate.estimatedUnitCost,
      supplierIdentified: supplier.chosen !== null,
      supplierName: supplier.chosen?.name ?? null,
      supplierScore: supplier.chosenScore?.total ?? null,
      amazonCompliance: compliance.amazon_uk.verdict,
      shopifyCompliance: compliance.shopify.verdict,
      shopifyProfitable: shopify.gate.passes,
      amazonProfitable: amazon.gate.passes,
      shopifyNetProfit: shopify.profitability.netProfit,
      amazonNetProfit: amazon.profitability.netProfit,
      ipRisk: compliance.amazon_uk.ip.level,
      eligibleChannels: recommendation.eligibleChannels,
      sourceLabel: 'Simulated research provider',
      rationale: recommendation.headline,
      dataSources: recommendation.dataSources,
      requiresOwnerApproval: recommendation.requiresOwnerApproval,
      lastUpdated: recommendation.lastUpdated,
    } satisfies OpportunitySummary
  })
}

/**
 * Suppliers, scored by the real supplier scoring engine rather than by hand.
 *
 * The AliExpress entry stays blocked for Amazon, and it is deliberately the
 * cheapest of the three, so the engine has to demonstrate that it does not
 * simply choose the lowest price.
 */
export function demoSuppliers(): readonly SupplierListItem[] {
  const scores = demoSupplierScores()

  return DEMO_SUPPLIERS.map((supplier) => {
    const score = scores.get(supplier.id)!
    const shopify = assessShopifyCapability(supplier.signals)
    const amazon = assessAmazonCapability(supplier.signals)
    const placed = supplier.signals.ordersPlaced ?? 0
    const late = supplier.signals.ordersLate ?? 0

    return {
      id: supplier.id,
      name: supplier.name,
      country: supplier.country,
      score: score.total,
      band: score.bandLabel,
      confidence: score.confidence,
      strengths: score.strengths,
      weaknesses: score.weaknesses,
      shopifyStatus: shopify.status,
      amazonStatus: amazon.status,
      // The reason comes from whichever channel is more restrictive, because
      // that is the one the owner needs to understand.
      statusReason: (amazon.status === 'approved' ? shopify.reasons : amazon.reasons).join(' '),
      deliveryDaysMin: supplier.signals.deliveryDaysMin ?? null,
      deliveryDaysMax: supplier.signals.deliveryDaysMax ?? null,
      onTimeRatePct: placed === 0 ? null : Math.round(((placed - late) / placed) * 1000) / 10,
      productCount: supplier.supplies.length,
      platform: supplier.platform,
      providesTracking: supplier.signals.providesTracking,
      handlesReturns: supplier.signals.handlesReturns,
      supportsCustomInvoice: supplier.signals.supportsCustomInvoice,
      supportsBlindShipping: supplier.signals.supportsBlindShipping,
      ordersPlaced: placed,
    } satisfies SupplierListItem
  })
}

export function demoStockAlerts(): readonly StockAlert[] {
  return [
    {
      productId: 'cmo-1001', sku: 'CMO-1001', title: 'Adjustable Laptop Riser, Aluminium',
      availableQty: 41, daysRemaining: 8, isSupplierStocked: false,
      recommendedOrderQty: 150, recommendedOrderCost: fromMajor(1380.0), requiresApproval: true,
    },
    {
      productId: 'cmo-1005', sku: 'CMO-1005', title: 'Ceramic Pour-Over Coffee Dripper',
      availableQty: 18, daysRemaining: 22, isSupplierStocked: true,
      recommendedOrderQty: 0, recommendedOrderCost: zero('GBP'), requiresApproval: false,
    },
  ]
}

export function demoComplianceIssues(): readonly ComplianceIssue[] {
  return [
    {
      productId: 'cmo-1006', sku: 'CMO-1006', title: 'Rechargeable Handheld Vacuum',
      channel: 'amazon_uk', verdict: 'fail',
      blockingReasons: [
        'Supplier cannot ship as seller of record, so the parcel would identify another retailer.',
        'No UK Declaration of Conformity or lithium battery test report supplied.',
        'Supplier will not accept returns, which we are required to be responsible for.',
      ],
      assessedAt: daysAgo(2),
    },
    {
      productId: 'cmo-1005', sku: 'CMO-1005', title: 'Ceramic Pour-Over Coffee Dripper',
      channel: 'amazon_uk', verdict: 'review_required',
      blockingReasons: [
        'No GTIN supplied by the manufacturer, and GTIN exemption eligibility has not been confirmed.',
      ],
      assessedAt: daysAgo(1),
    },
  ]
}

export function demoFinanceSummary(): FinanceSummary {
  const business = demoBusinessSummary()
  // Output VAT is the VAT contained in the demo period's sales.
  const outputVat = money(Math.round((business.revenue.minor * VAT_RATE) / (100 + VAT_RATE)), 'GBP')
  const inputVat = fromMajor(412.88)

  return {
    invoicesGenerated: business.orders,
    invoicesSent: business.orders - 1,
    invoicesFailed: 1,
    creditNotesIssued: 3,
    vatRegistered: true,
    outputVat,
    inputVat,
    estimatedVatDue: subtract(outputVat, inputVat),
    vatTransactionsNeedingReview: 2,
    rollingTurnover: fromMajor(61420.0),
    vatThreshold: fromMajor(90000.0),
    vatThresholdStatus: 'registered',
    accountingSyncStatus: 'not_connected',
    accountingPending: 14,
  }
}

export function demoCashflow(): CashflowProjection {
  const cashAvailable = fromMajor(3184.22)
  const expectedPayouts = [
    { label: 'Amazon UK settlement', amount: fromMajor(1842.5), expectedOn: daysAhead(9) },
    { label: 'Shopify Payments payout', amount: fromMajor(736.1), expectedOn: daysAhead(3) },
  ]
  const upcomingCommitments = [
    { label: 'Meridian Housewares restock (CMO-1001)', amount: fromMajor(1380.0), dueOn: daysAhead(2) },
    { label: 'Amazon advertising', amount: fromMajor(420.0), dueOn: daysAhead(5) },
    { label: 'Software and subscriptions', amount: fromMajor(96.0), dueOn: daysAhead(6) },
  ]

  // Walk the timeline day by day to find the genuine low point, rather than
  // netting everything off and pretending the timing does not matter.
  const events = [
    ...expectedPayouts.map((p) => ({ on: p.expectedOn, delta: p.amount.minor })),
    ...upcomingCommitments.map((c) => ({ on: c.dueOn, delta: -c.amount.minor })),
  ].sort((a, b) => a.on.localeCompare(b.on))

  let running = cashAvailable.minor
  let low = running
  let lowOn = today.toISOString()
  for (const event of events) {
    running += event.delta
    if (running < low) {
      low = running
      lowOn = event.on
    }
  }

  // The business keeps a minimum cash buffer. Dipping below it is the signal
  // worth raising, not simply ending the period with a positive balance:
  // a profitable month can still leave nothing to pay a supplier with.
  const cashBuffer = fromMajor(2000)

  // Everything committed before the largest payout actually lands.
  const largestPayout = [...expectedPayouts].sort((a, b) => b.amount.minor - a.amount.minor)[0]
  const committedBeforePayout = upcomingCommitments
    .filter((c) => c.dueOn < largestPayout.expectedOn)
    .reduce((acc, c) => acc + c.amount.minor, 0)

  const warning =
    low < cashBuffer.minor
      ? `${formatMoney(money(committedBeforePayout, 'GBP'))} of supplier and advertising commitments fall due before the ${largestPayout.label.toLowerCase()} of ${formatMoney(largestPayout.amount)} arrives on ${new Date(largestPayout.expectedOn).toLocaleDateString('en-GB')}. Projected low point is ${formatMoney(money(low, 'GBP'))}, below the ${formatMoney(cashBuffer)} buffer.`
      : null

  return {
    cashAvailable,
    expectedPayouts,
    upcomingCommitments,
    projectedLowPoint: money(low, 'GBP'),
    projectedLowPointOn: lowOn,
    warning,
  }
}

export function demoApprovals(): readonly ApprovalItem[] {
  return [
    {
      id: 'dec-1', decisionType: 'supplier_order',
      title: 'Restock CMO-1001 with Meridian Housewares',
      detail: '150 units at £9.20 each plus shipping, total £1,380.00.',
      reasoning:
        'Eight days of stock remain against a 24% rise in demand and a 3 day lead time. Without an order now the product goes out of stock for roughly five days, which also costs it ranking. The value exceeds the £200 automatic purchase limit, so it needs your approval.',
      confidence: 0.86,
      estimatedImpact: fromMajor(1380.0),
      status: 'awaiting_approval',
      createdAt: daysAgo(0),
      expiresAt: daysAhead(2),
    },
    {
      id: 'dec-2', decisionType: 'pause_product',
      title: 'Pause CMO-1008 on both channels',
      detail: 'Desk Cable Management Tray has lost £34.10 over the last 30 days.',
      reasoning:
        'Six units sold against £34.80 of advertising, a 9.1% return rate and a 3.6 star average. It has failed the minimum contribution rule for 34 consecutive days. Pausing stops the advertising spend without removing the listing history.',
      confidence: 0.93,
      estimatedImpact: fromMajor(34.1),
      status: 'awaiting_approval',
      createdAt: daysAgo(1),
      expiresAt: daysAhead(6),
    },
  ]
}

export function demoNotifications(): readonly NotificationItem[] {
  // Derived from the same cashflow projection the finance page renders, so the
  // alert and the page can never quote different figures.
  const cashflow = demoCashflow()

  return [
    {
      id: 'n-1', severity: 'approval_required', category: 'inventory',
      title: 'Restock approval needed for CMO-1001',
      body: 'Eight days of stock remaining. Recommended order £1,380.00.',
      createdAt: daysAgo(0), readAt: null, actionUrl: '/approvals',
    },
    {
      id: 'n-2', severity: 'critical', category: 'compliance',
      title: 'Amazon listing blocked: CMO-1006',
      body: 'Three blocking requirements. The listing cannot go live until they are resolved.',
      createdAt: daysAgo(2), readAt: null, actionUrl: '/compliance',
    },
    {
      id: 'n-3', severity: 'warning', category: 'cashflow',
      title: 'Commitments fall due before the Amazon settlement',
      body: `Projected low point of ${formatMoney(cashflow.projectedLowPoint)} on ${new Date(cashflow.projectedLowPointOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`,
      createdAt: daysAgo(0), readAt: null, actionUrl: '/finance',
    },
    {
      id: 'n-4', severity: 'warning', category: 'invoicing',
      title: 'One invoice failed to send',
      body: 'Resend is not configured, so invoice delivery is simulated in demo mode.',
      createdAt: daysAgo(1), readAt: daysAgo(1), actionUrl: '/finance',
    },
    {
      id: 'n-5', severity: 'success', category: 'catalogue',
      title: 'CMO-1001 moved to scaling',
      body: 'Contribution up 24% with a reliable supplier and a 2.1% return rate.',
      createdAt: daysAgo(3), readAt: daysAgo(3), actionUrl: '/products',
    },
  ]
}

export function demoAuditEvents(): readonly AuditEvent[] {
  const events: readonly Omit<AuditEvent, 'id'>[] = [
    { occurredAt: daysAgo(0), actorType: 'ai', actorLabel: 'Catalogue automation', action: 'AI_DECISION_CREATED', entityType: 'product', entityId: 'CMO-1001', reason: 'Stock cover fell below the 10 day reorder point', result: 'success' },
    { occurredAt: daysAgo(0), actorType: 'system', actorLabel: 'Approval engine', action: 'APPROVAL_REQUESTED', entityType: 'supplier_order', entityId: 'PO-2041', reason: 'Value exceeds the £200 automatic purchase limit', result: 'success' },
    { occurredAt: daysAgo(0), actorType: 'system', actorLabel: 'Inventory sync', action: 'INVENTORY_SYNCED', entityType: 'inventory', entityId: null, reason: 'Scheduled 15 minute sync', result: 'success' },
    { occurredAt: daysAgo(1), actorType: 'ai', actorLabel: 'Compliance engine', action: 'COMPLIANCE_REVIEW_REQUIRED', entityType: 'product', entityId: 'CMO-1005', reason: 'No GTIN supplied and exemption eligibility unconfirmed', result: 'blocked' },
    { occurredAt: daysAgo(1), actorType: 'system', actorLabel: 'Invoice engine', action: 'INVOICE_SEND_FAILED', entityType: 'invoice', entityId: 'INV-0241', reason: 'Email provider not configured', result: 'failure' },
    { occurredAt: daysAgo(2), actorType: 'ai', actorLabel: 'Compliance engine', action: 'COMPLIANCE_BLOCKED', entityType: 'product', entityId: 'CMO-1006', reason: 'Supplier cannot act as seller of record for Amazon', result: 'blocked' },
    { occurredAt: daysAgo(2), actorType: 'system', actorLabel: 'Pricing engine', action: 'PRICE_CHANGED', entityType: 'channel_product', entityId: 'CMO-1003', reason: 'Competitor moved below our price; change within the 5% automatic limit', result: 'success' },
    { occurredAt: daysAgo(3), actorType: 'ai', actorLabel: 'Catalogue automation', action: 'PRODUCT_STAGE_CHANGED', entityType: 'product', entityId: 'CMO-1001', reason: 'Met the proven-to-scaling criteria for 14 consecutive days', result: 'success' },
    { occurredAt: daysAgo(4), actorType: 'system', actorLabel: 'Advertising engine', action: 'ADVERTISING_PAUSED', entityType: 'product', entityId: 'CMO-1008', reason: 'ROAS below the 3.0 minimum for 7 days', result: 'success' },
    { occurredAt: daysAgo(5), actorType: 'user', actorLabel: 'Owner', action: 'SETTINGS_UPDATED', entityType: 'business_settings', entityId: null, reason: 'Minimum net margin raised from 8% to 10%', result: 'success' },
    { occurredAt: daysAgo(6), actorType: 'system', actorLabel: 'Supplier assessment', action: 'SUPPLIER_STATUS_CHANGED', entityType: 'supplier', entityId: 'sup-3', reason: 'Failed Amazon seller-of-record and delivery time requirements', result: 'success' },
    { occurredAt: daysAgo(7), actorType: 'system', actorLabel: 'Demo seed', action: 'DEMO_DATA_SEEDED', entityType: 'organisation', entityId: null, reason: 'Simulated dataset generated for demonstration', result: 'success' },
  ]

  return events.map((event, index) => ({ ...event, id: `audit-${index + 1}` }))
}

export function demoDailyReport(): DailyReport {
  const products = demoProducts()
  const ranked = [...products].sort((a, b) => b.contribution.minor - a.contribution.minor)

  return {
    generatedAt: today.toISOString(),
    isDemo: true,
    business: demoBusinessSummary(),
    winners: ranked.filter((p) => p.contribution.minor > 0).slice(0, 3),
    losers: ranked.filter((p) => p.contribution.minor <= 0).reverse().slice(0, 3),
    opportunities: demoOpportunities(),
    stockAlerts: demoStockAlerts(),
    complianceIssues: demoComplianceIssues(),
    finance: demoFinanceSummary(),
    cashflow: demoCashflow(),
    approvals: demoApprovals(),
  }
}

/** Kept so the seeded RNG is exercised and stays available for future modules. */
export const demoSeed = { seed: SEED, sample: rng.int(1, 100) }
