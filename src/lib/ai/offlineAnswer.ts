import type { FactBundle } from './types'

/**
 * The deterministic fallback used whenever `ANTHROPIC_API_KEY` is not
 * configured (`isConfigured('anthropic')` is false) — the same "demo mode
 * is a first-class mode, never a broken one" posture `core/env.ts` takes
 * everywhere else, applied to the chat. This is not a miniature language
 * model: it does not interpret the question, only orders and labels the
 * same real facts a live model would have received, so the chat stays
 * genuinely useful — and fully testable — with zero credentials. It is
 * always clearly marked `groundedIn: 'fact_only'` by the caller, never
 * presented as if it were the language model's own reasoning.
 */

const TOPIC_KEYWORDS: Record<string, RegExp> = {
  compliance: /complian|block/i,
  suppliers: /supplier/i,
  opportunities: /opportunit|invest|new product/i,
  channels: /channel|marketplace|amazon|shopify/i,
  approvals: /approv/i,
  financials: /revenue|profit|margin|financ|sales/i,
  priorities: /priorit|attention|risk/i,
}

/** Which section the question seems to be about, if any — a plain keyword match, never a claim of understanding the question. Used only to decide section order. */
function leadingTopic(question: string): string | null {
  for (const [topic, pattern] of Object.entries(TOPIC_KEYWORDS)) {
    if (pattern.test(question)) return topic
  }
  return null
}

function section(title: string, lines: readonly string[]): string {
  return lines.length > 0 ? `${title}\n${lines.map((l) => `- ${l}`).join('\n')}` : ''
}

export function buildOfflineAnswer(bundle: FactBundle, question: string): string {
  const parts: string[] = []
  parts.push(
    'AI language reasoning is not connected in this environment (ANTHROPIC_API_KEY is not configured), so this is a direct, fact-only summary of your current Commerce OS data rather than a language-model answer.',
  )

  if (bundle.dataSourceFailures.length > 0) {
    parts.push(`Note: ${bundle.dataSourceFailures.join(', ')} failed to load this turn — the figures below fell back to a safe empty value and may be incomplete.`)
  }
  if (bundle.currencyCautions.length > 0) {
    parts.push(section('Currency limitations (figures deliberately withheld rather than mixed)', bundle.currencyCautions))
  }

  const sections: Record<string, string> = {
    financials: section('Executive summary (last 30 days)', bundle.executiveSummary.map((m) => `${m.label}: ${m.value}`)),
    priorities: section(
      bundle.priorities.length > 0 ? `Priority queue — ${bundle.priorities.length} open item(s), most critical first` : 'Priority queue',
      bundle.priorities.length > 0
        ? bundle.priorities.slice(0, 8).map((p) => `[${p.severity.toUpperCase()}] ${p.title} — ${p.recommendedNextStep}`)
        : ['Nothing currently needs attention.'],
    ),
    compliance: section(
      bundle.complianceIssues.length > 0 ? `Compliance issues — ${bundle.complianceIssues.length}` : 'Compliance',
      bundle.complianceIssues.length > 0
        ? bundle.complianceIssues.map((c) => `${c.title} on ${c.channel}: ${c.verdict === 'fail' ? 'BLOCKED' : 'REVIEW REQUIRED'} — ${c.blockingReasons[0] ?? 'see /compliance'}`)
        : ['No product is currently blocked or under review.'],
    ),
    channels: section(
      'Channel performance',
      bundle.channels.map((c) => `${c.label}: revenue ${c.revenue}, known net margin ${c.knownNetMarginPct === null ? 'unknown' : `${c.knownNetMarginPct.toFixed(1)}%`}, ${c.lossMakingProductCount} loss-making product(s)`),
    ),
    opportunities: section(
      'Top opportunities',
      bundle.topOpportunities.length > 0
        ? bundle.topOpportunities.slice(0, 5).map((o) => `${o.title} (score ${o.score}, ${o.band}) — ${o.headline}`)
        : ['No evaluated opportunities yet.'],
    ),
    suppliers: section(
      'Suppliers, highest risk first',
      bundle.supplierRisk.length > 0
        ? bundle.supplierRisk.slice(0, 5).map((s) => `${s.name} — score ${s.score}, Shopify ${s.shopifyStatus}, Amazon UK ${s.amazonStatus}${s.statusReason ? ` (${s.statusReason})` : ''}`)
        : ['No supplier data available.'],
    ),
    approvals: section(
      bundle.pendingApprovals.length > 0 ? `Pending approvals — ${bundle.pendingApprovals.length}` : 'Pending approvals',
      bundle.pendingApprovals.length > 0
        ? bundle.pendingApprovals.map((a) => `${a.title}${a.impact ? ` (${a.impact})` : ''}`)
        : ['Nothing awaiting approval.'],
    ),
  }

  parts.push(`Overall business health: ${bundle.overallHealth.toUpperCase()}`)

  const topic = leadingTopic(question)
  const order = topic && sections[topic] ? [topic, ...Object.keys(sections).filter((k) => k !== topic)] : Object.keys(sections)
  for (const key of order) {
    if (sections[key]) parts.push(sections[key])
  }

  parts.push(
    'Uncertainty: any figure above marked "unavailable" or "unknown" is a genuine gap in the underlying data, not a zero — treat it as not yet knowable rather than favourable or unfavourable.',
  )

  return parts.filter(Boolean).join('\n\n')
}
