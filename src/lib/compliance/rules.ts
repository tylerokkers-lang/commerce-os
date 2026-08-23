import { assessGtinEligibility, type IdentifierRecord } from '@/lib/products/identifiers'
import { assessIpRisk, type IpAssessment, type IpAssessmentInput } from '@/lib/compliance/ip'
import type { ApprovalStatus, ChannelKey, ComplianceVerdict } from '@/lib/core/domain'

/**
 * The compliance gate (§14).
 *
 * Rules are data, evaluated one at a time, each producing its own verdict and
 * its own evidence. The overall verdict is derived from the individual checks,
 * so a blocked product can always say exactly which requirement failed.
 *
 * Three principles hold throughout:
 *
 *   1. A critical failure blocks the channel. Automation cannot override it.
 *   2. Unknown is not pass. A requirement that has not been established
 *      resolves to review, never to approval.
 *   3. The system never claims legal certainty. It reports what it checked and
 *      what it found; the decision remains the owner's.
 */

export const RULESET_VERSION = 'compliance-rules@1'

export type CheckSeverity = 'critical' | 'major' | 'minor'
export type CheckOutcome = 'pass' | 'fail' | 'unknown' | 'not_applicable'

export interface ComplianceCheck {
  key: string
  label: string
  severity: CheckSeverity
  outcome: CheckOutcome
  /** What was actually observed, in words the owner can act on. */
  evidence: string
  /** What to do about a failure. */
  remedy?: string
  /**
   * Whether the failure can be cleared by obtaining something, as opposed to
   * being a decision that has already been made or a judgement a person has to
   * make. A missing certificate is remediable; a category the owner has
   * deliberately blocked, or a high IP risk, is not, and neither should be
   * routed around by an automated plan.
   */
  remediable: boolean
}

export interface ComplianceAssessment {
  channel: ChannelKey
  verdict: ComplianceVerdict
  checks: readonly ComplianceCheck[]
  blockingReasons: readonly string[]
  reviewReasons: readonly string[]
  /** Blockers that could be cleared by obtaining something. */
  remediableBlockers: readonly ComplianceCheck[]
  /** Blockers that need a person to decide, or that reflect a decision already made. */
  fundamentalBlockers: readonly ComplianceCheck[]
  ip: IpAssessment
  restrictedCategory: boolean
  requiresDocumentation: boolean
  rulesetVersion: string
  assessedAt: string
  /** Plain-English summary, shown at the top of the compliance panel. */
  summary: string
  /**
   * Always present. The system reports findings, not legal conclusions, and
   * this sentence travels with every assessment so that is never lost.
   */
  disclaimer: string
}

export interface ComplianceContext {
  title: string
  description?: string | null
  category: string | null
  brand?: string | null
  /** Whether the product runs on, or contains, a lithium battery. */
  hasBattery?: boolean
  /** Intended for, or likely to be used by, children under 14. */
  isChildrensProduct?: boolean
  /** Contacts food or drink. */
  isFoodContact?: boolean
  /** Applied to the body. */
  isCosmetic?: boolean
  /** Mains powered or otherwise electrical. */
  isElectrical?: boolean

  identifiers: readonly IdentifierRecord[]

  /** Capability verdicts from the supplier scoring engine. */
  supplierCapability: ApprovalStatus | null
  supplierCapabilityReasons: readonly string[]
  supplierName?: string | null

  /** Compliance paperwork on file for this product. */
  documents: readonly { docType: string; expiresOn?: string | null }[]

  /** Categories the owner has blocked outright (§60). */
  blockedCategories: readonly string[]

  ipInput: IpAssessmentInput
}

/** Categories that carry statutory duties beyond ordinary consumer goods. */
const REGULATED_CATEGORY_RULES: readonly {
  applies: (ctx: ComplianceContext) => boolean
  label: string
  requiredDocs: readonly string[]
  note: string
}[] = [
  {
    applies: (c) => c.hasBattery === true,
    label: 'Lithium battery',
    requiredDocs: ['test_report', 'safety_datasheet'],
    note: 'Lithium cells are dangerous goods for carriage and carry UK product safety duties. A UN 38.3 test report and a safety data sheet are the usual minimum.',
  },
  {
    applies: (c) => c.isElectrical === true,
    label: 'Electrical equipment',
    requiredDocs: ['certificate_of_conformity'],
    note: 'Mains or electrical goods need a UK Declaration of Conformity and correct UKCA or CE marking for the market being sold into.',
  },
  {
    applies: (c) => c.isChildrensProduct === true,
    label: "Children's product",
    requiredDocs: ['test_report', 'certificate_of_conformity'],
    note: 'Toys and children’s products carry strict safety testing duties and age marking requirements.',
  },
  {
    applies: (c) => c.isFoodContact === true,
    label: 'Food contact material',
    requiredDocs: ['certificate_of_conformity'],
    note: 'Food contact materials require a declaration of compliance from the manufacturer.',
  },
  {
    applies: (c) => c.isCosmetic === true,
    label: 'Cosmetic product',
    requiredDocs: ['certificate_of_conformity', 'safety_datasheet'],
    note: 'Cosmetics require a safety report and responsible person registration before sale in the UK.',
  },
]

function regulatedProfile(ctx: ComplianceContext) {
  const matched = REGULATED_CATEGORY_RULES.filter((rule) => rule.applies(ctx))
  const requiredDocs = [...new Set(matched.flatMap((rule) => rule.requiredDocs))]
  return { matched, requiredDocs }
}

function documentChecks(ctx: ComplianceContext, requiredDocs: readonly string[]): ComplianceCheck[] {
  if (requiredDocs.length === 0) return []

  const today = new Date().toISOString().slice(0, 10)

  return requiredDocs.map((docType) => {
    const doc = ctx.documents.find((d) => d.docType === docType)
    if (!doc) {
      return {
        key: `document:${docType}`,
        label: `Documentation: ${docType.replace(/_/g, ' ')}`,
        severity: 'critical' as const,
        outcome: 'fail' as const,
        evidence: `No ${docType.replace(/_/g, ' ')} is on file for this product.`,
        remedy: 'Request it from the manufacturer or supplier and upload it against this product.',
        remediable: true,
      }
    }
    if (doc.expiresOn && doc.expiresOn < today) {
      return {
        key: `document:${docType}`,
        label: `Documentation: ${docType.replace(/_/g, ' ')}`,
        severity: 'critical' as const,
        outcome: 'fail' as const,
        evidence: `The ${docType.replace(/_/g, ' ')} on file expired on ${doc.expiresOn}.`,
        remedy: 'Obtain a current version from the manufacturer.',
        remediable: true,
      }
    }
    return {
      key: `document:${docType}`,
      label: `Documentation: ${docType.replace(/_/g, ' ')}`,
      severity: 'critical' as const,
      outcome: 'pass' as const,
      evidence: `A current ${docType.replace(/_/g, ' ')} is on file.`,
      remediable: true,
    }
  })
}

/** Checks that apply on every channel. */
function sharedChecks(ctx: ComplianceContext, ip: IpAssessment): ComplianceCheck[] {
  const checks: ComplianceCheck[] = []
  const { matched, requiredDocs } = regulatedProfile(ctx)

  const blocked = ctx.blockedCategories.find(
    (c) => ctx.category && c.toLowerCase() === ctx.category.toLowerCase(),
  )
  checks.push({
    key: 'blocked_category',
    label: 'Category permitted',
    severity: 'critical',
    outcome: blocked ? 'fail' : 'pass',
    evidence: blocked
      ? `"${ctx.category}" is on the blocked category list in business settings.`
      : `"${ctx.category ?? 'Uncategorised'}" is not on the blocked category list.`,
    remedy: blocked ? 'Remove the category from the block list if this was not intended.' : undefined,
    // The owner chose this. Automation does not get to plan around it.
    remediable: false,
  })

  checks.push({
    key: 'ip_risk',
    label: 'Intellectual property risk',
    severity: 'critical',
    // High risk blocks. Medium goes to review. Neither is ever auto-cleared.
    outcome: ip.level === 'high' ? 'fail' : ip.level === 'low' ? 'pass' : 'unknown',
    evidence: ip.reasons.length > 0 ? ip.reasons.join(' ') : ip.summary,
    remedy:
      ip.level === 'low'
        ? undefined
        : 'Establish the chain of authorisation, or choose an unbranded equivalent, before listing.',
    // IP risk is a judgement, not a missing document. A person decides.
    remediable: false,
  })

  for (const rule of matched) {
    checks.push({
      key: `regulated:${rule.label}`,
      label: `Regulated product: ${rule.label}`,
      severity: 'major',
      outcome: 'unknown',
      evidence: rule.note,
      remedy: 'Confirm the requirements with a competent person before listing.',
      remediable: true,
    })
  }

  checks.push(...documentChecks(ctx, requiredDocs))

  return checks
}

function shopifyChecks(ctx: ComplianceContext): ComplianceCheck[] {
  const checks: ComplianceCheck[] = []

  if (ctx.supplierCapability === null) {
    checks.push({
      key: 'shopify_supplier',
      label: 'Supplier assessed',
      severity: 'critical',
      outcome: 'unknown',
      evidence: 'No supplier has been assessed for this product.',
      remedy: 'Assign and assess a supplier before listing.',
      remediable: true,
    })
  } else {
    checks.push({
      key: 'shopify_supplier',
      label: 'Supplier suitable for Shopify',
      severity: ctx.supplierCapability === 'blocked' ? 'critical' : 'major',
      outcome:
        ctx.supplierCapability === 'approved'
          ? 'pass'
          : ctx.supplierCapability === 'blocked'
            ? 'fail'
            : 'unknown',
      evidence: ctx.supplierCapabilityReasons.join(' ') || 'No detail recorded.',
      remedy:
        ctx.supplierCapability === 'approved'
          ? undefined
          : 'Resolve the supplier gaps, or source from a supplier that meets them.',
      remediable: true,
    })
  }

  // Shopify does not require a GTIN, so its absence is a minor matter here.
  const gtin = assessGtinEligibility(ctx.identifiers)
  checks.push({
    key: 'shopify_identifiers',
    label: 'Product identifiers',
    severity: 'minor',
    outcome: gtin.eligible ? 'pass' : 'not_applicable',
    evidence: gtin.eligible
      ? gtin.reason
      : 'Shopify does not require a GTIN. One is still worth obtaining for search and for any future marketplace listing.',
    remediable: true,
  })

  return checks
}

function amazonChecks(ctx: ComplianceContext): ComplianceCheck[] {
  const checks: ComplianceCheck[] = []

  // Seller of record and the dropshipping requirements (§15). This is the
  // check that blocks most marketplace-sourced suppliers.
  if (ctx.supplierCapability === null) {
    checks.push({
      key: 'amazon_supplier',
      label: 'Supplier assessed for Amazon',
      severity: 'critical',
      outcome: 'unknown',
      evidence: 'No supplier has been assessed against Amazon’s requirements for this product.',
      remedy: 'Assign a supplier and complete the Amazon capability assessment.',
      remediable: true,
    })
  } else {
    checks.push({
      key: 'amazon_supplier',
      label: 'Supplier meets Amazon dropshipping requirements',
      severity: 'critical',
      outcome:
        ctx.supplierCapability === 'approved'
          ? 'pass'
          : ctx.supplierCapability === 'blocked'
            ? 'fail'
            : 'unknown',
      evidence: ctx.supplierCapabilityReasons.join(' ') || 'No detail recorded.',
      remedy:
        ctx.supplierCapability === 'approved'
          ? undefined
          : 'Amazon requires that we remain the seller of record, that no other retailer appears on the parcel or paperwork, and that we handle returns. Use a supplier that can meet all three.',
      // Cleared by changing supplier, which is a sourcing task rather than a
      // judgement call.
      remediable: true,
    })
  }

  // GTIN. Never satisfied by generating a number (§17).
  const gtin = assessGtinEligibility(ctx.identifiers)
  checks.push({
    key: 'amazon_gtin',
    label: 'GTIN or exemption',
    severity: 'critical',
    outcome: gtin.eligible ? 'pass' : 'fail',
    evidence: gtin.reason,
    remedy: gtin.eligible
      ? undefined
      : 'Obtain a GTIN from the brand owner or GS1, or apply to Amazon for a category exemption. This system will never generate one.',
    remediable: true,
  })

  checks.push({
    key: 'amazon_condition',
    label: 'Condition and authenticity',
    severity: 'major',
    outcome: ctx.brand && !ctx.ipInput.hasBrandAuthorisation ? 'unknown' : 'pass',
    evidence:
      ctx.brand && !ctx.ipInput.hasBrandAuthorisation
        ? `Listing a branded product ("${ctx.brand}") without recorded authorisation. Amazon can request an invoice chain at any time.`
        : 'No third-party brand claim requiring an authorisation chain.',
    remedy:
      ctx.brand && !ctx.ipInput.hasBrandAuthorisation
        ? 'Keep supplier invoices that establish the chain of custody, or list an unbranded equivalent.'
        : undefined,
    remediable: true,
  })

  return checks
}

/**
 * Derives the overall verdict from the individual checks.
 *
 * Any critical failure blocks. Any major failure, or any unknown on a critical
 * or major check, means review. Only a clean sheet passes.
 */
function deriveVerdict(checks: readonly ComplianceCheck[]): ComplianceVerdict {
  const relevant = checks.filter((c) => c.outcome !== 'not_applicable')
  if (relevant.length === 0) return 'not_assessed'

  if (relevant.some((c) => c.severity === 'critical' && c.outcome === 'fail')) return 'fail'
  if (relevant.some((c) => c.outcome === 'fail')) return 'review_required'
  if (relevant.some((c) => c.outcome === 'unknown' && c.severity !== 'minor')) return 'review_required'
  return 'pass'
}

export function assessCompliance(
  channel: ChannelKey,
  ctx: ComplianceContext,
  now: Date = new Date(),
): ComplianceAssessment {
  const ip = assessIpRisk(ctx.ipInput, now)

  const checks = [
    ...sharedChecks(ctx, ip),
    ...(channel === 'amazon_uk' ? amazonChecks(ctx) : shopifyChecks(ctx)),
  ]

  const verdict = deriveVerdict(checks)
  const { matched, requiredDocs } = regulatedProfile(ctx)

  const blockingReasons = checks
    .filter((c) => c.severity === 'critical' && c.outcome === 'fail')
    .map((c) => `${c.label}: ${c.evidence}`)

  const reviewReasons = checks
    .filter((c) => c.outcome === 'unknown' || (c.outcome === 'fail' && c.severity !== 'critical'))
    .map((c) => `${c.label}: ${c.evidence}`)

  const criticalFailures = checks.filter((c) => c.severity === 'critical' && c.outcome === 'fail')
  const remediableBlockers = criticalFailures.filter((c) => c.remediable)
  const fundamentalBlockers = criticalFailures.filter((c) => !c.remediable)

  const channelLabel = channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'
  const summary =
    verdict === 'pass'
      ? `Every check this system performs passed for ${channelLabel}.`
      : verdict === 'fail'
        ? `Blocked for ${channelLabel} by ${blockingReasons.length} critical requirement${blockingReasons.length === 1 ? '' : 's'}.`
        : `${channelLabel} needs a human review: ${reviewReasons.length} item${reviewReasons.length === 1 ? '' : 's'} could not be established automatically.`

  return {
    channel,
    verdict,
    checks,
    blockingReasons,
    reviewReasons,
    remediableBlockers,
    fundamentalBlockers,
    ip,
    restrictedCategory: matched.length > 0,
    requiresDocumentation: requiredDocs.length > 0,
    rulesetVersion: RULESET_VERSION,
    assessedAt: now.toISOString(),
    summary,
    disclaimer:
      'This is the result of the checks this system performs against its current ruleset. It is not legal advice and it is not a guarantee of marketplace compliance. Policies change, and responsibility for the decision remains with the business owner.',
  }
}

/**
 * The hard gate before a product may enter a channel's launch queue (§9).
 *
 * Only an explicit pass admits a product. Neither a failure nor an unresolved
 * review can be overridden by automation at any automation level.
 */
export function canEnterLaunchQueue(assessment: ComplianceAssessment): {
  allowed: boolean
  reason: string
} {
  if (assessment.verdict === 'pass') {
    return { allowed: true, reason: 'All compliance checks passed for this channel.' }
  }
  if (assessment.verdict === 'fail') {
    return {
      allowed: false,
      reason: `Blocked: ${assessment.blockingReasons[0] ?? 'a critical requirement failed.'}`,
    }
  }
  if (assessment.verdict === 'review_required') {
    return {
      allowed: false,
      reason: `Held for review: ${assessment.reviewReasons[0] ?? 'a requirement could not be established automatically.'} A person must resolve this; automation cannot.`,
    }
  }
  return { allowed: false, reason: 'Compliance has not been assessed for this channel.' }
}
