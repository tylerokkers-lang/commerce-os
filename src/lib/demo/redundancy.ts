import { assessAmazonCapability, assessShopifyCapability } from '@/lib/suppliers/scoring'
import { evaluateSupplierRedundancy, type RedundancyDecision } from '@/lib/suppliers/redundancy'
import { DEMO_CONTEXT, demoEvaluationByRef } from './research'
import { suppliersFor } from './suppliers'
import type { ChannelKey } from '@/lib/core/domain'

/**
 * A worked example of supplier redundancy using the demo catalogue.
 *
 * Meridian Housewares is the chosen supplier for the magnetic knife rail,
 * approved on both channels. 港湾 Trading also quotes for the same product,
 * cheaper but blocked for Amazon and scoring far lower. This is the scenario
 * Milestone 3 exists to handle correctly: losing the good supplier should not
 * quietly fail over to the bad one just because it is the only one left.
 *
 * The demo business's automation level ("assisted") means the outcome is
 * always a request for approval, never a silent switch — that default is the
 * point, not an accident (`docs/PRINCIPLES.md` §5: switching suppliers is
 * approval-required by default).
 */

const SCENARIO_PRODUCT_REF = 'demo-magnetic-knife-rail'
const SCENARIO_SUPPLIER_ID = 'sup-1'
const SCENARIO_CHANNELS: readonly ChannelKey[] = ['shopify', 'amazon_uk']

export function demoRedundancyPreview(supplierId: string): RedundancyDecision | null {
  if (supplierId !== SCENARIO_SUPPLIER_ID) return null

  const evaluation = demoEvaluationByRef(SCENARIO_PRODUCT_REF)
  if (!evaluation) return null

  const quoting = suppliersFor(SCENARIO_PRODUCT_REF)
  const preferred = quoting.find((q) => q.id === SCENARIO_SUPPLIER_ID)
  if (!preferred) return null

  const alternatives = quoting
    .filter((q) => q.id !== SCENARIO_SUPPLIER_ID)
    .map((q) => ({ id: q.id, name: q.name, signals: q.signals }))

  return evaluateSupplierRedundancy({
    productTitle: evaluation.candidate.title,
    channels: SCENARIO_CHANNELS,
    reason: {
      key: 'out_of_stock',
      detail: 'the supplier reported zero stock on the last sync',
    },
    automationLevel: 'assisted',
    thresholds: {
      minGrossMarginPct: DEMO_CONTEXT.minGrossMarginPct,
      minNetMarginPct: DEMO_CONTEXT.minNetMarginPct,
    },
    previousChannelStatus: {
      shopify: assessShopifyCapability(preferred.signals).status,
      amazon_uk: assessAmazonCapability(preferred.signals).status,
    },
    alternatives,
    economics: {
      sellingPrice: evaluation.candidate.estimatedSellingPrice,
      returnRatePct: evaluation.candidate.expectedReturnRatePct ?? 5,
      vatRatePct: DEMO_CONTEXT.vatRatePct,
      vatInclusive: true,
    },
    profileInput: {
      category: evaluation.candidate.category,
    },
  })
}
