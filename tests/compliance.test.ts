import { describe, expect, it } from 'vitest'
import {
  assessCompliance,
  canEnterLaunchQueue,
  RULESET_VERSION,
  type ComplianceContext,
} from '@/lib/compliance/rules'
import { assessIpRisk } from '@/lib/compliance/ip'
import type { IdentifierRecord } from '@/lib/products/identifiers'

const CLOCK = new Date('2026-08-22T09:00:00Z')

const validEan: IdentifierRecord = {
  idType: 'ean',
  value: '4006381333931',
  source: 'manufacturer',
  validation: 'valid',
}

/** A clean, unbranded product from a fully capable supplier. */
const clean: ComplianceContext = {
  title: 'Solid Oak Chopping Board',
  description: 'Hardwood chopping board with a juice groove.',
  category: 'Kitchen',
  brand: null,
  identifiers: [validEan],
  supplierCapability: 'approved',
  supplierCapabilityReasons: ['Meets every requirement.'],
  supplierName: 'Meridian Housewares Ltd',
  documents: [],
  blockedCategories: [],
  ipInput: {
    title: 'Solid Oak Chopping Board',
    brand: null,
    ownBrands: [],
    category: 'Kitchen',
    imagesFromSupplier: false,
    hasBrandAuthorisation: false,
  },
}

describe('compliance verdicts', () => {
  it('passes a clean product on both channels', () => {
    expect(assessCompliance('shopify', clean, CLOCK).verdict).toBe('pass')
    expect(assessCompliance('amazon_uk', clean, CLOCK).verdict).toBe('pass')
  })

  it('stamps the ruleset version so a stale assessment can be found', () => {
    expect(assessCompliance('amazon_uk', clean, CLOCK).rulesetVersion).toBe(RULESET_VERSION)
  })

  it('never claims legal certainty', () => {
    const assessment = assessCompliance('amazon_uk', clean, CLOCK)
    expect(assessment.disclaimer).toMatch(/not legal advice/)
    expect(assessment.disclaimer).toMatch(/not a guarantee/)
    expect(assessment.summary).not.toMatch(/guaranteed/)
  })

  it('gives every check its own evidence', () => {
    for (const check of assessCompliance('amazon_uk', clean, CLOCK).checks) {
      expect(check.evidence.length).toBeGreaterThan(10)
    }
  })
})

describe('Amazon blocking', () => {
  it('blocks when no GTIN exists, and never suggests generating one', () => {
    const assessment = assessCompliance('amazon_uk', { ...clean, identifiers: [] }, CLOCK)
    expect(assessment.verdict).toBe('fail')

    const gtin = assessment.checks.find((c) => c.key === 'amazon_gtin')!
    expect(gtin.outcome).toBe('fail')
    expect(gtin.remedy).toMatch(/never generate one/)
  })

  it('blocks when the supplier cannot meet the dropshipping requirements', () => {
    const assessment = assessCompliance(
      'amazon_uk',
      {
        ...clean,
        supplierCapability: 'blocked',
        supplierCapabilityReasons: ['Cannot issue invoices in our name.'],
      },
      CLOCK,
    )
    expect(assessment.verdict).toBe('fail')
    expect(assessment.blockingReasons.join(' ')).toMatch(/invoices in our name/)
  })

  it('holds for review when no supplier has been assessed at all', () => {
    const assessment = assessCompliance(
      'amazon_uk',
      { ...clean, supplierCapability: null, supplierCapabilityReasons: [] },
      CLOCK,
    )
    expect(assessment.verdict).toBe('review_required')
  })

  it('keeps a product with a critical Amazon failure out of the launch queue', () => {
    const assessment = assessCompliance('amazon_uk', { ...clean, identifiers: [] }, CLOCK)
    const gate = canEnterLaunchQueue(assessment)
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toMatch(/Blocked/)
  })

  it('keeps a product needing review out of the launch queue too', () => {
    const assessment = assessCompliance(
      'amazon_uk',
      { ...clean, supplierCapability: null, supplierCapabilityReasons: [] },
      CLOCK,
    )
    const gate = canEnterLaunchQueue(assessment)
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toMatch(/automation cannot/)
  })

  it('admits only an explicit pass', () => {
    expect(canEnterLaunchQueue(assessCompliance('amazon_uk', clean, CLOCK)).allowed).toBe(true)
  })
})

describe('Shopify approval', () => {
  it('does not require a GTIN', () => {
    const assessment = assessCompliance('shopify', { ...clean, identifiers: [] }, CLOCK)
    expect(assessment.verdict).toBe('pass')

    const identifiers = assessment.checks.find((c) => c.key === 'shopify_identifiers')!
    expect(identifiers.severity).toBe('minor')
  })

  it('passes a product Amazon blocks for want of a GTIN', () => {
    // The channel-divergence case: same product, different answer.
    const context = { ...clean, identifiers: [] }
    expect(assessCompliance('shopify', context, CLOCK).verdict).toBe('pass')
    expect(assessCompliance('amazon_uk', context, CLOCK).verdict).toBe('fail')
  })
})

describe('blocked categories and regulated products', () => {
  it('blocks a category the owner has excluded', () => {
    const assessment = assessCompliance(
      'shopify',
      { ...clean, blockedCategories: ['Kitchen'] },
      CLOCK,
    )
    expect(assessment.verdict).toBe('fail')
    expect(assessment.blockingReasons.join(' ')).toMatch(/blocked category list/)
  })

  it('treats an owner-blocked category as not remediable', () => {
    const assessment = assessCompliance(
      'shopify',
      { ...clean, blockedCategories: ['Kitchen'] },
      CLOCK,
    )
    expect(assessment.fundamentalBlockers.length).toBeGreaterThan(0)
    expect(assessment.remediableBlockers).toHaveLength(0)
  })

  it('requires documentation for a lithium battery product', () => {
    const assessment = assessCompliance('shopify', { ...clean, hasBattery: true }, CLOCK)
    expect(assessment.requiresDocumentation).toBe(true)
    expect(assessment.restrictedCategory).toBe(true)
    expect(assessment.verdict).toBe('fail')
    expect(assessment.blockingReasons.join(' ')).toMatch(/test report|safety datasheet/i)
  })

  it('treats missing documentation as remediable, so it is fixed rather than rejected', () => {
    const assessment = assessCompliance('shopify', { ...clean, hasBattery: true }, CLOCK)
    expect(assessment.remediableBlockers.length).toBeGreaterThan(0)
    expect(assessment.fundamentalBlockers).toHaveLength(0)
    for (const blocker of assessment.remediableBlockers) {
      expect(blocker.remedy).toBeTruthy()
    }
  })

  it('passes once the documentation is on file', () => {
    const assessment = assessCompliance(
      'shopify',
      {
        ...clean,
        hasBattery: true,
        isElectrical: true,
        documents: [
          { docType: 'test_report' },
          { docType: 'safety_datasheet' },
          { docType: 'certificate_of_conformity' },
        ],
      },
      CLOCK,
    )
    expect(assessment.blockingReasons).toHaveLength(0)
    // Still a review, because a regulated product is never waved through.
    expect(assessment.verdict).toBe('review_required')
  })

  it('rejects expired documentation', () => {
    const assessment = assessCompliance(
      'shopify',
      {
        ...clean,
        hasBattery: true,
        documents: [
          { docType: 'test_report', expiresOn: '2020-01-01' },
          { docType: 'safety_datasheet' },
        ],
      },
      CLOCK,
    )
    expect(assessment.blockingReasons.join(' ')).toMatch(/expired on 2020-01-01/)
  })
})

describe('IP risk', () => {
  it('flags an unauthorised third-party brand as high risk', () => {
    const result = assessIpRisk(
      { title: 'Dyson Compatible Filter', brand: 'Dyson', hasBrandAuthorisation: false },
      CLOCK,
    )
    expect(result.level).toBe('high')
    expect(result.requiresHumanReview).toBe(true)
    expect(result.reasons.join(' ')).toMatch(/no authorisation to resell/)
  })

  it('accepts our own brand without flagging it', () => {
    const result = assessIpRisk(
      { title: 'Commerce OS Chopping Board', brand: 'Commerce OS', ownBrands: ['Commerce OS'] },
      CLOCK,
    )
    expect(result.level).toBe('low')
  })

  it('flags replica and copy vocabulary', () => {
    expect(assessIpRisk({ title: 'Replica designer lamp' }, CLOCK).level).not.toBe('low')
    expect(assessIpRisk({ title: 'Chair inspired by Eames' }, CLOCK).level).not.toBe('low')
  })

  it('flags a branded item priced implausibly below retail', () => {
    const result = assessIpRisk(
      {
        title: 'Branded headphones',
        brand: 'SomeBrand',
        unitCostMinor: 800,
        typicalRetailMinor: 20000,
      },
      CLOCK,
    )
    expect(result.level).toBe('high')
    expect(result.reasons.join(' ')).toMatch(/rarely wholesales this far below retail/)
  })

  it('flags an owner-configured restricted brand', () => {
    const result = assessIpRisk(
      { title: 'Universal case for Foobar Pro', restrictedBrands: ['Foobar'] },
      CLOCK,
    )
    expect(result.level).toBe('high')
    expect(result.reasons.join(' ')).toMatch(/off-limits brand/)
  })

  it('treats supplier photography as a minor issue, not a compliance block', () => {
    const result = assessIpRisk({ title: 'Plain wooden spoon', imagesFromSupplier: true }, CLOCK)
    expect(result.level).toBe('low')
    expect(result.signals.some((s) => s.key === 'supplier_images')).toBe(true)
  })

  it('never claims a product is legally clear', () => {
    const result = assessIpRisk({ title: 'Plain wooden spoon' }, CLOCK)
    expect(result.summary).toMatch(/not a legal clearance/)
  })

  it('blocks a high IP risk product on every channel, and it is not remediable', () => {
    const context: ComplianceContext = {
      ...clean,
      brand: 'Dyson',
      ipInput: { ...clean.ipInput, brand: 'Dyson', title: 'Dyson Compatible Filter' },
    }
    for (const channel of ['shopify', 'amazon_uk'] as const) {
      const assessment = assessCompliance(channel, context, CLOCK)
      expect(assessment.verdict).toBe('fail')
      expect(assessment.fundamentalBlockers.some((b) => b.key === 'ip_risk')).toBe(true)
    }
  })
})
