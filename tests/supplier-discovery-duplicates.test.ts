import { describe, expect, it } from 'vitest'
import { detectDuplicateCandidate, type CandidateIdentity, type ExistingCandidate, type ExistingProductIdentifier } from '@/lib/suppliers/discovery/duplicateDetection'

const NO_IDENTIFIERS: readonly { idType: string; value: string }[] = []

describe('Supplier discovery — duplicate detection', () => {
  it('two legitimately distinct products from the same supplier are not flagged', () => {
    const candidate: CandidateIdentity = { supplierId: 'sup-1', supplierSku: 'ABC-1', sourceReference: null, identifiers: NO_IDENTIFIERS }
    const existing: readonly ExistingCandidate[] = [{ id: 'cand-1', candidateTitle: 'Desk Lamp', supplierId: 'sup-1', supplierSku: 'ABC-2', sourceReference: null }]
    const result = detectDuplicateCandidate(candidate, existing, [])
    expect(result.isDuplicate).toBe(false)
    expect(result.matches).toHaveLength(0)
  })

  it('an identical supplier SKU from the same supplier is flagged, with a plain-English reason', () => {
    const candidate: CandidateIdentity = { supplierId: 'sup-1', supplierSku: 'XYZ-123', sourceReference: null, identifiers: NO_IDENTIFIERS }
    const existing: readonly ExistingCandidate[] = [{ id: 'cand-1', candidateTitle: 'Wireless Mouse', supplierId: 'sup-1', supplierSku: 'XYZ-123', sourceReference: null }]
    const result = detectDuplicateCandidate(candidate, existing, [])
    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toMatch(/XYZ-123/)
    expect(result.reason).toMatch(/Wireless Mouse/)
  })

  it('an identical source URL from the same supplier is flagged', () => {
    const candidate: CandidateIdentity = { supplierId: 'sup-1', supplierSku: null, sourceReference: 'https://supplier.example/item/42', identifiers: NO_IDENTIFIERS }
    const existing: readonly ExistingCandidate[] = [{ id: 'cand-1', candidateTitle: 'Phone Stand', supplierId: 'sup-1', supplierSku: null, sourceReference: 'https://supplier.example/item/42' }]
    const result = detectDuplicateCandidate(candidate, existing, [])
    expect(result.isDuplicate).toBe(true)
    expect(result.matches[0].kind).toBe('candidate_source_reference')
  })

  it('the same supplier SKU from a DIFFERENT supplier is not flagged as a candidate duplicate', () => {
    const candidate: CandidateIdentity = { supplierId: 'sup-2', supplierSku: 'XYZ-123', sourceReference: null, identifiers: NO_IDENTIFIERS }
    const existing: readonly ExistingCandidate[] = [{ id: 'cand-1', candidateTitle: 'Wireless Mouse', supplierId: 'sup-1', supplierSku: 'XYZ-123', sourceReference: null }]
    const result = detectDuplicateCandidate(candidate, existing, [])
    expect(result.isDuplicate).toBe(false)
  })

  it('a matching barcode/GTIN against an already-imported product is flagged, even across suppliers', () => {
    const candidate: CandidateIdentity = { supplierId: 'sup-2', supplierSku: null, sourceReference: null, identifiers: [{ idType: 'gtin', value: '5012345678900' }] }
    const identifiers: readonly ExistingProductIdentifier[] = [{ productId: 'prod-1', productTitle: 'Ceramic Mug', idType: 'gtin', value: '5012345678900' }]
    const result = detectDuplicateCandidate(candidate, [], identifiers)
    expect(result.isDuplicate).toBe(true)
    expect(result.matches[0].kind).toBe('product_identifier')
    expect(result.reason).toMatch(/Ceramic Mug/)
  })

  it('is case- and whitespace-insensitive when comparing SKUs', () => {
    const candidate: CandidateIdentity = { supplierId: 'sup-1', supplierSku: ' xyz-123 ', sourceReference: null, identifiers: NO_IDENTIFIERS }
    const existing: readonly ExistingCandidate[] = [{ id: 'cand-1', candidateTitle: 'Wireless Mouse', supplierId: 'sup-1', supplierSku: 'XYZ-123', sourceReference: null }]
    const result = detectDuplicateCandidate(candidate, existing, [])
    expect(result.isDuplicate).toBe(true)
  })

  it('a candidate with no supplier assigned yet is never flagged against other candidates (nothing to compare against)', () => {
    const candidate: CandidateIdentity = { supplierId: null, supplierSku: 'XYZ-123', sourceReference: null, identifiers: NO_IDENTIFIERS }
    const existing: readonly ExistingCandidate[] = [{ id: 'cand-1', candidateTitle: 'Wireless Mouse', supplierId: 'sup-1', supplierSku: 'XYZ-123', sourceReference: null }]
    const result = detectDuplicateCandidate(candidate, existing, [])
    expect(result.isDuplicate).toBe(false)
  })
})
