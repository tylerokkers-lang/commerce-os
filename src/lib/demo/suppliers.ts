import { fromMajor } from '@/lib/core/money'
import type { SupplierCandidate } from '@/lib/research/pipeline'
import type { SupplierSignals } from '@/lib/suppliers/scoring'

/**
 * The simulated supplier base.
 *
 * These feed the real supplier scoring engine rather than carrying hand-written
 * scores, so the numbers on screen are produced by the same code that would
 * score a real supplier.
 *
 * The three are chosen to make the per-channel distinction unavoidable: one
 * that clears both channels, one that clears Shopify but not Amazon, and one
 * that Amazon's dropshipping requirements rule out entirely.
 */

export interface DemoSupplier {
  id: string
  name: string
  companyName: string
  website: string
  contactEmail: string
  country: string
  platform: string
  returnsPolicy: string
  notes: string
  signals: SupplierSignals
  documentCount: number
  /** Products this supplier can quote for, by research candidate ref. */
  supplies: readonly string[]
}

export const DEMO_SUPPLIERS: readonly DemoSupplier[] = [
  {
    id: 'sup-1',
    name: 'Meridian Housewares Ltd',
    companyName: 'Meridian Housewares Limited',
    website: 'https://example-meridian.invalid',
    contactEmail: 'trade@example-meridian.invalid',
    country: 'GB',
    platform: 'direct',
    returnsPolicy: 'Accepts returns within 60 days, including faulty goods, at their cost.',
    notes:
      'UK warehouse. Ships blind, issues paperwork in our name, and has handled every return without argument so far.',
    documentCount: 3,
    supplies: ['demo-magnetic-knife-rail', 'demo-bamboo-drawer-dividers'],
    signals: {
      unitCost: fromMajor(8.6),
      shippingCost: fromMajor(2.2),
      deliveryDaysMin: 2,
      deliveryDaysMax: 3,
      ordersPlaced: 148,
      ordersLate: 6,
      ordersDefective: 3,
      qualityRating: 4.6,
      communicationRating: 4.7,
      handlesReturns: true,
      returnsWindowDays: 60,
      acceptsFaultyReturns: true,
      providesTracking: true,
      supportsBlindShipping: true,
      supportsCustomInvoice: true,
      supportsCustomPackaging: true,
      supportsOwnBranding: true,
      documentCount: 3,
    },
  },
  {
    id: 'sup-2',
    name: 'Northwind Supply Co',
    companyName: 'Northwind Supply Company Ltd',
    website: 'https://example-northwind.invalid',
    contactEmail: 'accounts@example-northwind.invalid',
    country: 'GB',
    platform: 'wholesaler',
    returnsPolicy: 'Accepts returns within 30 days, including faulty goods, and handles the customer directly.',
    notes:
      'Good for direct-to-customer sales: ships blind, tracks, and handles returns properly. Insists on including their own invoice in every parcel, which rules out Amazon specifically, since it means we could not remain the seller of record. Perfectly usable for Shopify.',
    documentCount: 1,
    supplies: ['demo-usb-desk-lamp', 'demo-bamboo-drawer-dividers', 'demo-underdesk-footrest'],
    signals: {
      unitCost: fromMajor(9.8),
      shippingCost: fromMajor(3.4),
      deliveryDaysMin: 3,
      deliveryDaysMax: 5,
      ordersPlaced: 34,
      ordersLate: 4,
      ordersDefective: 2,
      qualityRating: 4.1,
      communicationRating: 3.9,
      handlesReturns: true,
      returnsWindowDays: 30,
      acceptsFaultyReturns: true,
      providesTracking: true,
      supportsBlindShipping: true,
      // The single gap that matters: Amazon requires paperwork identifying us
      // as the seller of record, and this supplier will only ship with its
      // own invoice in the box.
      supportsCustomInvoice: false,
      supportsCustomPackaging: false,
      supportsOwnBranding: false,
      documentCount: 1,
    },
  },
  {
    id: 'sup-3',
    name: '港湾 Trading (AliExpress)',
    companyName: 'Unverified marketplace seller',
    website: 'https://example-marketplace.invalid',
    contactEmail: 'seller@example-marketplace.invalid',
    country: 'CN',
    platform: 'aliexpress',
    returnsPolicy: 'No returns accepted after dispatch.',
    notes:
      'An open marketplace listing rather than a trading relationship. Cheapest on paper, and blocked for Amazon on seller of record, branding, returns and delivery time. Kept in the demo because this is the most common trap in dropshipping.',
    documentCount: 0,
    supplies: ['demo-cordless-vacuum-branded', 'demo-christmas-light-projector', 'demo-magnetic-knife-rail'],
    signals: {
      // Deliberately the cheapest unit cost of the three. The scoring engine
      // still must not choose it.
      unitCost: fromMajor(5.9),
      shippingCost: fromMajor(1.4),
      deliveryDaysMin: 18,
      deliveryDaysMax: 26,
      ordersPlaced: 11,
      ordersLate: 5,
      ordersDefective: 2,
      qualityRating: 2.9,
      communicationRating: 2.4,
      handlesReturns: false,
      returnsWindowDays: 0,
      acceptsFaultyReturns: false,
      providesTracking: false,
      supportsBlindShipping: false,
      supportsCustomInvoice: false,
      supportsCustomPackaging: false,
      supportsOwnBranding: false,
      documentCount: 0,
    },
  },
]

/**
 * Suppliers able to quote for a given research candidate, with the best
 * available cost filled in so the cost component can be scored relatively.
 */
export function suppliersFor(candidateRef: string): readonly SupplierCandidate[] {
  const eligible = DEMO_SUPPLIERS.filter((s) => s.supplies.includes(candidateRef))
  if (eligible.length === 0) return []

  const bestUnitCost = eligible.reduce(
    (best, s) => (s.signals.unitCost.minor < best.minor ? s.signals.unitCost : best),
    eligible[0].signals.unitCost,
  )

  return eligible.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    country: supplier.country,
    platform: supplier.platform,
    signals: { ...supplier.signals, bestAvailableUnitCost: bestUnitCost },
  }))
}

export const findDemoSupplier = (id: string): DemoSupplier | undefined =>
  DEMO_SUPPLIERS.find((s) => s.id === id)
