import { fromMajor } from '@/lib/core/money'
import { ok, type Result } from '@/lib/core/result'
import type {
  FetchOptions,
  FetchOutcome,
  ProviderDescriptor,
  ResearchCandidate,
  ResearchProvider,
} from './types'

/**
 * The simulated research provider (§55).
 *
 * Exists so the entire discovery pipeline can be exercised without a single
 * credential. Its `sourceType` is `simulated`, which the scoring engine treats
 * as the weakest possible evidence, so demo opportunities never report high
 * confidence. That is the correct outcome: invented data should not produce
 * conviction.
 *
 * The catalogue below is deliberately awkward. It contains a candidate that
 * passes everywhere, one that is viable on Shopify and blocked on Amazon, one
 * carrying real IP risk, one with regulatory duties, and one that scores well
 * on demand while failing on money. A demo where everything succeeds proves
 * nothing about the gates.
 */

const DESCRIPTOR: ProviderDescriptor = {
  key: 'demo',
  label: 'Simulated research data',
  description:
    'A fixed set of realistic product candidates used to exercise the discovery, scoring, supplier, compliance and profitability pipeline without any external service.',
  sourceType: 'simulated',
  requiredCredentials: [],
  rateLimit: {
    requestsPerMinute: null,
    requestsPerDay: null,
    minSecondsBetweenRuns: 0,
  },
  usagePolicy: {
    termsUrl: null,
    permittedUseNote:
      'Generated locally. Contains no third-party data, makes no network requests, and represents no real marketplace.',
    respectsRobots: true,
    authenticatedFirstParty: false,
  },
}

/**
 * Barcodes used in the simulated catalogue.
 *
 * These sit in the GS1 "restricted distribution" prefix range (20 to 29), which
 * is reserved for in-store and internal use and is never allocated to a real
 * global product. They carry correct check digits so the validation path can be
 * exercised end to end, and they cannot collide with any real item.
 *
 * This is fixture data. Nothing in the application generates identifiers, and
 * the only lawful sources for a live listing remain the manufacturer, the
 * supplier, GS1, or a recorded exemption.
 */
const DEMO_RESTRICTED_EANS = {
  knifeRail: '2000000000015',
  footrest: '2000000000022',
} as const

const CANDIDATES: readonly ResearchCandidate[] = [
  {
    externalRef: 'demo-magnetic-knife-rail',
    title: 'Magnetic Knife Rail, Solid Walnut',
    category: 'Kitchen',
    brand: null,
    description:
      'Wall-mounted magnetic strip for kitchen knives, solid hardwood with concealed neodymium magnets.',
    estimatedSellingPrice: fromMajor(32.0),
    estimatedUnitCost: fromMajor(8.6),
    estimatedShippingCost: fromMajor(2.2),
    estimatedMonthlyUnits: 1400,
    monthlySearchVolume: 9600,
    searchTrendPct: 31,
    trendDurationMonths: 18,
    seasonalityIndex: 0.22,
    competitorCount: 14,
    topCompetitorReviewCount: 2400,
    reviewCount: 5100,
    ratingAvg: 4.1,
    expectedReturnRatePct: 3.2,
    productComplexity: 0.15,
    supplierHint: {
      name: 'Meridian Housewares Ltd',
      country: 'GB',
      platform: 'direct',
      deliveryDaysMin: 2,
      deliveryDaysMax: 3,
    },
    reviewSample: [
      { rating: 2, body: 'The magnets are far too weak. My chef knife slides straight off if I am not careful.', verifiedPurchase: true },
      { rating: 3, body: 'Good looking bar but the screws included are useless in plasterboard. Had to buy proper fixings.', verifiedPurchase: true },
      { rating: 5, body: 'Beautiful piece of wood, holds everything I own.', verifiedPurchase: true },
      { rating: 2, body: 'Arrived with a chip out of one corner, packaging was a thin box with no padding.', verifiedPurchase: true },
      { rating: 4, body: 'Instructions were a single diagram with no words. Worked it out but it took a while.', verifiedPurchase: true },
      { rating: 5, body: 'Frees up a whole drawer. Very happy.', verifiedPurchase: true },
      { rating: 1, body: 'Magnets came loose from the wood after two months.', verifiedPurchase: true },
      { rating: 4, body: 'Solid, though I wish it came with a longer option for more knives.', verifiedPurchase: true },
    ],
    raw: {
      note: 'Simulated. Not derived from any real marketplace.',
      imagesFromSupplier: false,
      identifiers: [
        {
          idType: 'ean',
          value: DEMO_RESTRICTED_EANS.knifeRail,
          source: 'supplier',
          validation: 'valid',
        },
      ],
    },
  },
  {
    externalRef: 'demo-underdesk-footrest',
    title: 'Under-Desk Footrest, Memory Foam',
    category: 'Home Office',
    brand: null,
    description: 'Angled memory foam footrest with a washable cover and a non-slip base.',
    estimatedSellingPrice: fromMajor(29.99),
    estimatedUnitCost: fromMajor(7.4),
    estimatedShippingCost: fromMajor(2.9),
    estimatedMonthlyUnits: 2100,
    monthlySearchVolume: 14200,
    searchTrendPct: 18,
    trendDurationMonths: 26,
    seasonalityIndex: 0.18,
    competitorCount: 22,
    topCompetitorReviewCount: 8900,
    reviewCount: 12400,
    ratingAvg: 4.3,
    expectedReturnRatePct: 4.1,
    productComplexity: 0.1,
    supplierHint: {
      name: 'Meridian Housewares Ltd',
      country: 'GB',
      platform: 'direct',
      deliveryDaysMin: 2,
      deliveryDaysMax: 3,
    },
    reviewSample: [
      { rating: 4, body: 'Comfortable but the cover is a nightmare to get back on after washing.', verifiedPurchase: true },
      { rating: 2, body: 'Flattened within about six weeks of daily use.', verifiedPurchase: true },
      { rating: 5, body: 'Has genuinely helped my lower back.', verifiedPurchase: true },
      { rating: 3, body: 'Smaller than the photos suggest. Check the measurements.', verifiedPurchase: true },
      { rating: 5, body: 'Non-slip base actually works on carpet.', verifiedPurchase: true },
      { rating: 2, body: 'Strong chemical smell for the first week.', verifiedPurchase: true },
    ],
    raw: {
      note: 'Simulated.',
      imagesFromSupplier: false,
      identifiers: [
        {
          idType: 'ean',
          value: DEMO_RESTRICTED_EANS.footrest,
          source: 'manufacturer',
          validation: 'valid',
        },
      ],
    },
  },
  {
    externalRef: 'demo-cordless-vacuum-branded',
    title: 'Cordless Handheld Vacuum, Dyson Compatible Filter Set',
    category: 'Electronics',
    // A third-party brand in the title with no authorisation on file. This is
    // the IP risk case, and it must not clear the gate.
    brand: 'Dyson',
    description:
      'Replacement filter set compatible with Dyson V7 and V8 handheld models. Inspired by the original design.',
    estimatedSellingPrice: fromMajor(18.99),
    estimatedUnitCost: fromMajor(2.1),
    estimatedShippingCost: fromMajor(1.8),
    estimatedMonthlyUnits: 3400,
    monthlySearchVolume: 27000,
    searchTrendPct: 22,
    trendDurationMonths: 30,
    seasonalityIndex: 0.15,
    competitorCount: 41,
    topCompetitorReviewCount: 15200,
    reviewCount: 8800,
    ratingAvg: 3.9,
    expectedReturnRatePct: 8.4,
    productComplexity: 0.3,
    isElectrical: false,
    supplierHint: {
      name: '港湾 Trading (AliExpress)',
      country: 'CN',
      platform: 'aliexpress',
      deliveryDaysMin: 18,
      deliveryDaysMax: 26,
    },
    reviewSample: [
      { rating: 1, body: 'Did not fit my V8 despite the listing saying it would.', verifiedPurchase: true },
      { rating: 2, body: 'Suction dropped noticeably compared to the genuine filter.', verifiedPurchase: true },
      { rating: 4, body: 'Fine for the price, but do not expect original quality.', verifiedPurchase: true },
      { rating: 1, body: 'Arrived in a plain bag from another retailer with their invoice inside.', verifiedPurchase: true },
    ],
    raw: { note: 'Simulated. Included specifically to exercise the IP risk path.' },
  },
  {
    externalRef: 'demo-usb-desk-lamp',
    title: 'Rechargeable LED Desk Lamp with Lithium Battery',
    category: 'Home Office',
    brand: null,
    description:
      'Cordless LED desk lamp with a built-in rechargeable lithium cell, three colour temperatures and USB-C charging.',
    estimatedSellingPrice: fromMajor(29.99),
    estimatedUnitCost: fromMajor(9.8),
    estimatedShippingCost: fromMajor(3.4),
    estimatedMonthlyUnits: 1800,
    monthlySearchVolume: 11800,
    searchTrendPct: 18,
    trendDurationMonths: 14,
    seasonalityIndex: 0.34,
    competitorCount: 33,
    topCompetitorReviewCount: 6100,
    reviewCount: 4200,
    ratingAvg: 4.0,
    expectedReturnRatePct: 7.8,
    productComplexity: 0.55,
    // Regulatory path: a lithium cell brings documentation duties.
    hasBattery: true,
    isElectrical: true,
    supplierHint: {
      name: 'Northwind Supply Co',
      country: 'GB',
      platform: 'wholesaler',
      deliveryDaysMin: 3,
      deliveryDaysMax: 5,
    },
    reviewSample: [
      { rating: 2, body: 'Battery life is nothing like the eight hours claimed. Maybe three.', verifiedPurchase: true },
      { rating: 3, body: 'No charging cable in the box, which the listing did not make clear.', verifiedPurchase: true },
      { rating: 5, body: 'Lovely warm light and no cable across my desk.', verifiedPurchase: true },
      { rating: 1, body: 'Stopped holding charge entirely after a month.', verifiedPurchase: true },
      { rating: 4, body: 'Good lamp, but the instructions are barely legible.', verifiedPurchase: true },
    ],
    raw: { note: 'Simulated. Included to exercise the regulated-product path.' },
  },
  {
    externalRef: 'demo-bamboo-drawer-dividers',
    title: 'Bamboo Drawer Dividers, Expandable, Set of 4',
    category: 'Storage',
    brand: null,
    description: 'Spring-loaded bamboo dividers that expand to fit standard kitchen and bedroom drawers.',
    estimatedSellingPrice: fromMajor(19.5),
    estimatedUnitCost: fromMajor(5.9),
    estimatedShippingCost: fromMajor(2.6),
    estimatedMonthlyUnits: 900,
    monthlySearchVolume: 5400,
    searchTrendPct: 8,
    trendDurationMonths: 9,
    seasonalityIndex: 0.41,
    competitorCount: 19,
    topCompetitorReviewCount: 3100,
    reviewCount: 2600,
    ratingAvg: 4.2,
    expectedReturnRatePct: 5.1,
    productComplexity: 0.2,
    reviewSample: [
      { rating: 3, body: 'The springs are not strong enough for a heavy drawer, they shift when you open it.', verifiedPurchase: true },
      { rating: 5, body: 'Transformed my utensil drawer.', verifiedPurchase: true },
      { rating: 2, body: 'Bamboo splintered along one edge straight out of the packet.', verifiedPurchase: true },
      { rating: 4, body: 'Wish the set came with more than four.', verifiedPurchase: true },
    ],
    raw: { note: 'Simulated. No supplier hint, so the supplier gate stays open.' },
  },
  {
    externalRef: 'demo-christmas-light-projector',
    title: 'Outdoor Christmas Light Projector',
    category: 'Cleaning',
    brand: null,
    description: 'Weatherproof rotating light projector for exterior walls, with a remote and timer.',
    estimatedSellingPrice: fromMajor(24.99),
    // Deliberately unviable: cost and shipping leave nothing after fees and
    // advertising, so the profitability gate has something to refuse.
    estimatedUnitCost: fromMajor(13.4),
    estimatedShippingCost: fromMajor(4.9),
    estimatedMonthlyUnits: 4200,
    monthlySearchVolume: 33000,
    searchTrendPct: 54,
    trendDurationMonths: 2,
    // Almost all demand lands in six weeks of the year.
    seasonalityIndex: 0.92,
    competitorCount: 58,
    topCompetitorReviewCount: 11400,
    reviewCount: 9800,
    ratingAvg: 3.6,
    expectedReturnRatePct: 16.2,
    productComplexity: 0.6,
    isElectrical: true,
    supplierHint: {
      name: '港湾 Trading (AliExpress)',
      country: 'CN',
      platform: 'aliexpress',
      deliveryDaysMin: 18,
      deliveryDaysMax: 26,
    },
    reviewSample: [
      { rating: 1, body: 'Water got in after the first night of rain and it died.', verifiedPurchase: true },
      { rating: 2, body: 'The remote stopped working almost immediately. No spare battery included.', verifiedPurchase: true },
      { rating: 4, body: 'Looks great when it works.', verifiedPurchase: true },
      { rating: 1, body: 'Arrived three weeks after Christmas.', verifiedPurchase: true },
      { rating: 2, body: 'Stakes for the ground are flimsy plastic and snapped.', verifiedPurchase: true },
    ],
    raw: { note: 'Simulated. Included to exercise seasonality and the profitability gate.' },
  },
]

export class DemoResearchProvider implements ResearchProvider {
  readonly descriptor = DESCRIPTOR

  /** Always available: it needs nothing, because it reaches nothing. */
  isConfigured(): boolean {
    return true
  }

  async fetch(options: FetchOptions): Promise<Result<FetchOutcome, string>> {
    const known = options.knownRefs ?? new Set<string>()

    const filtered = CANDIDATES.filter((candidate) => {
      if (known.has(candidate.externalRef)) return false
      if (options.categories && options.categories.length > 0) {
        return options.categories.includes(candidate.category)
      }
      return true
    }).slice(0, options.limit)

    return ok({
      candidates: filtered,
      // No network requests are made, so nothing is consumed.
      requestsMade: 0,
      warnings:
        filtered.length === 0 && CANDIDATES.length > 0
          ? ['Every simulated candidate has already been imported.']
          : [],
    })
  }
}

export const demoResearchProvider = new DemoResearchProvider()

/**
 * The fixed catalogue, exposed synchronously.
 *
 * The provider interface is async because real providers perform I/O. This one
 * does not, so demo code that renders synchronously can read the same list
 * directly rather than pretending to await something that never suspends.
 */
export const demoCandidates = (): readonly ResearchCandidate[] => CANDIDATES
