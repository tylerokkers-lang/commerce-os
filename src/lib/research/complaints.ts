import type { ReviewSample } from './providers/types'

/**
 * Customer complaint analysis (§10).
 *
 * Reads sampled customer feedback about a product category and groups it into
 * recurring themes. The output feeds two things: the opportunity score, where
 * widespread complaints are a risk to inherit, and the differentiation engine,
 * where they are the clearest available guide to what a better version would
 * need to do.
 *
 * The themes and their weightings are the analysis. Review text is retained
 * only as evidence for a person to read; it is never copied into listing
 * content, which must be original (§18).
 */

export type ComplaintTheme =
  | 'durability'
  | 'quality'
  | 'performance'
  | 'delivery'
  | 'packaging'
  | 'missing_components'
  | 'instructions'
  | 'sizing'
  | 'accuracy'
  | 'value'
  | 'support'

interface ThemeDefinition {
  theme: ComplaintTheme
  label: string
  patterns: readonly RegExp[]
  /** How damaging this theme is to a product's prospects, 0-1. */
  weight: number
}

/**
 * Deliberately conservative patterns. A false negative costs a little insight;
 * a false positive sends the differentiation engine chasing a problem that is
 * not there.
 */
const THEMES: readonly ThemeDefinition[] = [
  {
    theme: 'durability',
    label: 'Durability',
    weight: 1,
    patterns: [
      /\b(?:broke|broken|snapped|cracked|split|tore|torn)\b/i,
      /\bstopped working\b/i,
      /\bfell apart\b/i,
      /\bcame loose\b/i,
      /\bafter (?:a|two|three|\d+)\s*(?:week|month|day)s?\b/i,
      /\bflattened\b/i,
      /\bdied\b/i,
    ],
  },
  {
    theme: 'quality',
    label: 'Build quality',
    weight: 0.9,
    patterns: [
      /\b(?:cheap|flimsy|thin|shoddy|poorly made|badly made)\b/i,
      /\bfeels cheap\b/i,
      /\bsplinter/i,
      /\bchip(?:ped)?\b/i,
      /\bplastic\b.*\b(?:snapped|flimsy|cheap)\b/i,
    ],
  },
  {
    theme: 'performance',
    label: 'Does not perform as described',
    weight: 1,
    patterns: [
      /\bnot (?:as )?(?:strong|powerful|bright|effective)\b/i,
      /\btoo weak\b/i,
      /\bbarely\b/i,
      /\bnothing like\b/i,
      /\bdoes ?n[o']?t work\b/i,
      /\bsuction dropped\b/i,
      /\bslides? (?:straight )?off\b/i,
      /\bnot hold\b/i,
    ],
  },
  {
    theme: 'delivery',
    label: 'Delivery',
    weight: 0.8,
    patterns: [
      /\b(?:late|delayed|slow) (?:delivery|arrival|shipping)\b/i,
      /\barrived .{0,20}(?:late|weeks? after|month)\b/i,
      /\btook (?:weeks|forever|ages)\b/i,
      /\bstill waiting\b/i,
    ],
  },
  {
    theme: 'packaging',
    label: 'Packaging',
    weight: 0.6,
    patterns: [
      /\bpackag(?:ing|ed)\b.{0,40}\b(?:thin|poor|no padding|damaged|flimsy)\b/i,
      /\bno padding\b/i,
      /\barrived (?:damaged|dented|broken)\b/i,
      /\bplain bag\b/i,
    ],
  },
  {
    theme: 'missing_components',
    label: 'Missing parts or accessories',
    weight: 0.85,
    patterns: [
      /\bno (?:charging )?cable\b/i,
      /\bnot included\b/i,
      /\bno (?:spare )?batter(?:y|ies)\b/i,
      /\bmissing\b/i,
      /\bhad to buy\b/i,
      /\bscrews? (?:included )?(?:are|were)? ?useless\b/i,
    ],
  },
  {
    theme: 'instructions',
    label: 'Instructions',
    weight: 0.55,
    patterns: [
      /\binstructions?\b.{0,40}\b(?:poor|useless|unclear|no words|barely legible|confusing|none)\b/i,
      /\bno instructions\b/i,
      /\bsingle diagram\b/i,
      /\bworked it out\b/i,
    ],
  },
  {
    theme: 'sizing',
    label: 'Size or fit',
    weight: 0.8,
    patterns: [
      /\bsmaller than\b/i,
      /\bbigger than\b/i,
      /\b(?:did|does) ?n[o']?t fit\b/i,
      /\bcheck the measurements\b/i,
      /\btoo (?:small|large|short|narrow)\b/i,
    ],
  },
  {
    theme: 'accuracy',
    label: 'Listing accuracy',
    weight: 0.95,
    patterns: [
      /\bnot as (?:described|advertised|shown)\b/i,
      /\bdespite the listing\b/i,
      /\bphotos? suggest\b/i,
      /\blisting did ?n[o']?t (?:say|make clear)\b/i,
      /\bclaimed\b/i,
    ],
  },
  {
    theme: 'value',
    label: 'Value for money',
    weight: 0.5,
    patterns: [/\bnot worth\b/i, /\boverpriced\b/i, /\bfor the price\b/i],
  },
  {
    theme: 'support',
    label: 'Customer support',
    weight: 0.7,
    patterns: [/\bno (?:reply|response)\b/i, /\bcustomer (?:service|support)\b.{0,30}\b(?:poor|awful|useless)\b/i],
  },
]

export interface ComplaintFinding {
  theme: ComplaintTheme
  label: string
  /** How many sampled reviews mentioned this theme. */
  mentions: number
  /** Mentions as a share of the whole sample, 0-1. */
  frequency: number
  /** Mean star rating of the reviews that mentioned it. */
  averageRating: number
  /** frequency x theme weight x rating severity, 0-1. */
  severity: number
  /** Verbatim evidence, for a person to read. Never used in listing copy. */
  examples: readonly string[]
}

export interface ComplaintAnalysis {
  sampleSize: number
  /** Mean rating across the whole sample. */
  averageRating: number
  /** Share of the sample rated 1 or 2 stars. */
  negativeShare: number
  findings: readonly ComplaintFinding[]
  /** Weighted overall severity, 0-1. Feeds the opportunity score directly. */
  overallSeverity: number
  /** Sentiment across the sample, 0-1. Also feeds the score. */
  sentiment: number
  summary: string
}

const EMPTY: ComplaintAnalysis = {
  sampleSize: 0,
  averageRating: 0,
  negativeShare: 0,
  findings: [],
  overallSeverity: 0,
  sentiment: 0.5,
  summary: 'No review sample was available, so no complaint analysis was possible.',
}

export function analyseComplaints(reviews: readonly ReviewSample[]): ComplaintAnalysis {
  if (reviews.length === 0) return EMPTY

  const sampleSize = reviews.length
  const averageRating = reviews.reduce((sum, r) => sum + r.rating, 0) / sampleSize
  const negativeShare = reviews.filter((r) => r.rating <= 2).length / sampleSize

  const findings: ComplaintFinding[] = []

  for (const definition of THEMES) {
    const matched = reviews.filter((review) =>
      definition.patterns.some((pattern) => pattern.test(`${review.title ?? ''} ${review.body}`)),
    )
    if (matched.length === 0) continue

    const frequency = matched.length / sampleSize
    const themeAverage = matched.reduce((sum, r) => sum + r.rating, 0) / matched.length
    // A complaint raised in one-star reviews matters more than the same words
    // appearing in a four-star review that was broadly positive.
    const ratingSeverity = Math.max(0, (5 - themeAverage) / 4)

    findings.push({
      theme: definition.theme,
      label: definition.label,
      mentions: matched.length,
      frequency: Math.round(frequency * 100) / 100,
      averageRating: Math.round(themeAverage * 10) / 10,
      severity: Math.round(frequency * definition.weight * ratingSeverity * 100) / 100,
      examples: matched.slice(0, 3).map((r) => r.body),
    })
  }

  findings.sort((a, b) => b.severity - a.severity)

  // The overall figure is driven by the worst themes rather than the mean, so
  // one serious, frequent problem is not diluted by several trivial ones.
  const top = findings.slice(0, 3)
  const overallSeverity =
    top.length === 0
      ? 0
      : Math.min(1, Math.round((top.reduce((sum, f) => sum + f.severity, 0) / top.length) * 1.6 * 100) / 100)

  const sentiment = Math.round(((averageRating - 1) / 4) * 100) / 100

  const summary =
    findings.length === 0
      ? `No recurring complaint themes were found across ${sampleSize} sampled reviews, which average ${averageRating.toFixed(1)} stars.`
      : `Across ${sampleSize} sampled reviews averaging ${averageRating.toFixed(1)} stars, the recurring themes are ${findings
          .slice(0, 3)
          .map((f) => f.label.toLowerCase())
          .join(', ')}. ${Math.round(negativeShare * 100)}% of the sample rated the product one or two stars.`

  return {
    sampleSize,
    averageRating: Math.round(averageRating * 10) / 10,
    negativeShare: Math.round(negativeShare * 100) / 100,
    findings,
    overallSeverity,
    sentiment,
    summary,
  }
}
