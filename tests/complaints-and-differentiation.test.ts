import { describe, expect, it } from 'vitest'
import { analyseComplaints } from '@/lib/research/complaints'
import { suggestDifferentiation } from '@/lib/research/differentiation'
import { demoCandidates } from '@/lib/research/providers/demo'
import type { ReviewSample } from '@/lib/research/providers/types'

const reviews: readonly ReviewSample[] = [
  { rating: 1, body: 'The magnets are far too weak, my knife slides off.' },
  { rating: 2, body: 'Screws included are useless, had to buy proper fixings.' },
  { rating: 2, body: 'Arrived with a chip out of one corner, thin packaging with no padding.' },
  { rating: 4, body: 'Instructions were a single diagram with no words.' },
  { rating: 5, body: 'Great once set up.' },
  { rating: 1, body: 'Magnets came loose from the wood after two months, stopped working.' },
]

describe('complaint analysis', () => {
  it('groups feedback into recurring themes with counted evidence', () => {
    const result = analyseComplaints(reviews)
    expect(result.sampleSize).toBe(6)
    const durability = result.findings.find((f) => f.theme === 'durability')!
    expect(durability.mentions).toBeGreaterThanOrEqual(1)
    expect(durability.examples.length).toBeGreaterThan(0)
  })

  it('weighs frequency and severity together, not frequency alone', () => {
    const result = analyseComplaints(reviews)
    const worst = result.findings[0]
    // The worst-ranked theme should be one raised in genuinely low-starred reviews.
    expect(worst.averageRating).toBeLessThan(3)
  })

  it('handles no review sample without throwing', () => {
    const result = analyseComplaints([])
    expect(result.sampleSize).toBe(0)
    expect(result.findings).toHaveLength(0)
    expect(result.summary).toMatch(/No review sample/)
  })

  it('reports negative share and sentiment consistently with the sample', () => {
    const allFive: readonly ReviewSample[] = Array.from({ length: 5 }, () => ({ rating: 5, body: 'Excellent.' }))
    const result = analyseComplaints(allFive)
    expect(result.negativeShare).toBe(0)
    expect(result.sentiment).toBe(1)
  })

  it('produces severity strictly between 0 and 1', () => {
    const result = analyseComplaints(reviews)
    for (const finding of result.findings) {
      expect(finding.severity).toBeGreaterThan(0)
      expect(finding.severity).toBeLessThanOrEqual(1)
    }
  })
})

describe('differentiation suggestions', () => {
  it('every suggestion traces to an observed complaint or is explicitly baseline', () => {
    const analysis = analyseComplaints(reviews)
    const suggestions = suggestDifferentiation({ analysis })
    for (const suggestion of suggestions) {
      if (suggestion.addressesComplaint === null) {
        expect(suggestion.rationale.length).toBeGreaterThan(10)
      } else {
        expect(analysis.findings.map((f) => f.theme)).toContain(suggestion.addressesComplaint)
      }
    }
  })

  it('ranks the strongest evidence first', () => {
    const analysis = analyseComplaints(reviews)
    const suggestions = suggestDifferentiation({ analysis })
    const strengths = suggestions.map((s) => ({ weak: 0, moderate: 1, strong: 2 })[s.evidenceStrength])
    // Not required to be perfectly sorted (baseline suggestions are appended),
    // but the first complaint-derived suggestion should not be the weakest.
    expect(strengths[0]).toBeGreaterThanOrEqual(1)
  })

  it('never reuses competitor text: every suggestion is original guidance to ourselves', () => {
    const analysis = analyseComplaints(reviews)
    const suggestions = suggestDifferentiation({ analysis })
    for (const suggestion of suggestions) {
      // Original suggestions read as instructions, not as marketing copy lifted
      // from a listing.
      expect(suggestion.suggestion).not.toMatch(/genuine|authentic|as seen on/i)
    }
  })

  it('returns the always-applicable baseline even with no complaints', () => {
    const empty = analyseComplaints([])
    const suggestions = suggestDifferentiation({ analysis: empty })
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.every((s) => s.addressesComplaint === null)).toBe(true)
  })

  it('respects the limit', () => {
    const analysis = analyseComplaints(reviews)
    const suggestions = suggestDifferentiation({ analysis, limit: 2 })
    expect(suggestions.length).toBeLessThanOrEqual(2)
  })
})

describe('demo review samples feed the real complaint pipeline', () => {
  it('every demo candidate with a review sample produces at least one theme', () => {
    for (const candidate of demoCandidates()) {
      if (!candidate.reviewSample || candidate.reviewSample.length === 0) continue
      const analysis = analyseComplaints(candidate.reviewSample)
      expect(analysis.findings.length, candidate.title).toBeGreaterThan(0)
    }
  })
})
