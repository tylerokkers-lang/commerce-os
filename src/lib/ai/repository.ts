import 'server-only'

import { requireSession } from '@/lib/security/session'
import { isConfigured } from '@/lib/core/env'
import { getCEOCommandCentre } from '@/lib/ceo/repository'
import { getOpportunities, getIntelligenceSummary } from '@/lib/products/opportunities'
import { getProducts } from '@/lib/products/repository'
import { getSuppliers } from '@/lib/suppliers/repository'
import { buildFactBundle, deriveReferences, serializeFactBundle } from './factBundle'
import { buildOfflineAnswer } from './offlineAnswer'
import { createOfflineProvider } from './offlineProvider'
import { createAnthropicProvider } from './anthropicProvider'
import { buildProviderMessages, buildSystemPrompt } from './promptBuilder'
import { extractActionIntent } from './actions/intentExtraction'
import { buildRecommendations } from './actions/recommend'
import { validateActionIntent } from './actions/validate'
import type { ChatAnswer, ChatMessage } from './types'

/**
 * The one orchestration function `/api/chat` calls (Milestone 12).
 * Composes exactly the same intelligence Milestone 11's CEO Command Centre
 * already composes — `getCEOCommandCentre()` — plus the two adjacent
 * repositories the CEO dashboard page itself calls directly but
 * `CEOCommandCentre` does not carry (`getOpportunities`/
 * `getIntelligenceSummary` for "what opportunities should I investigate",
 * `getSuppliers` for the full per-channel supplier scoring "which
 * suppliers are highest risk" needs). No new intelligence is computed
 * anywhere in this function: it authenticates, gathers, bundles, and
 * hands the bundle to a `ChatProvider` for language only.
 *
 * `server-only`, so — like `ceo/repository.ts`'s `getCEOCommandCentre()` —
 * this function cannot be imported into a Vitest file at all in this
 * project; every function it calls (`buildFactBundle`, `serializeFactBundle`,
 * `deriveReferences`, `buildOfflineAnswer`, `buildSystemPrompt`,
 * `buildProviderMessages`, the provider constructors' pure request/response
 * helpers) is tested directly instead, and this function itself is
 * exercised only by live browser verification.
 */
export async function askCommerceIntelligence(conversation: readonly ChatMessage[]): Promise<ChatAnswer> {
  const session = await requireSession()

  const [ceoResult, opportunitiesResult, summaryResult, suppliersResult, productsResult] = await Promise.allSettled([
    getCEOCommandCentre(),
    getOpportunities(),
    getIntelligenceSummary(),
    getSuppliers(),
    getProducts(),
  ])

  const warnings: string[] = []
  if (ceoResult.status === 'rejected') warnings.push('The CEO Command Centre data could not be loaded this turn.')
  if (opportunitiesResult.status === 'rejected') warnings.push('Opportunity intelligence could not be loaded this turn.')
  if (suppliersResult.status === 'rejected') warnings.push('Supplier intelligence could not be loaded this turn.')
  if (productsResult.status === 'rejected') warnings.push('The product catalogue could not be loaded this turn — no price-change proposal can be generated.')

  // `getCEOCommandCentre()` is the one fact source this chat cannot function
  // without (it carries priorities, health, compliance, financials); if
  // even it failed to load, the honest answer is "insufficient data", never
  // a guess built from whatever else happened to succeed.
  if (ceoResult.status === 'rejected') {
    return {
      content: 'Commerce OS data could not be loaded for this organisation right now, so this question cannot be answered from real facts. Please try again shortly.',
      groundedIn: 'fact_only', factStatus: 'insufficient_data', references: [], warnings, recommendations: [], proposedAction: null,
    }
  }

  const bundle = buildFactBundle({
    ceo: ceoResult.value,
    orgName: session.orgName,
    opportunities: opportunitiesResult.status === 'fulfilled' ? opportunitiesResult.value : [],
    opportunitySummary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
    suppliers: suppliersResult.status === 'fulfilled' ? suppliersResult.value : [],
    products: productsResult.status === 'fulfilled' ? productsResult.value : [],
    now: new Date().toISOString(),
  })

  warnings.push(...bundle.dataSourceFailures.map((s) => `${s} did not load — the figures it feeds show as unavailable, never a guessed value.`))

  const references = deriveReferences(bundle)
  const question = conversation[conversation.length - 1]?.content ?? ''
  const offlineAnswer = buildOfflineAnswer(bundle, question)
  const bundleHasSubstance = bundle.priorities.length > 0 || bundle.complianceIssues.length > 0 || bundle.topOpportunities.length > 0 || bundle.supplierRisk.length > 0

  // Milestone 13, Phases 2/3 — entirely deterministic, entirely independent
  // of which provider answers `content` below (or whether it answers at
  // all): recommendations are rule-based over the bundle; a proposed
  // action, if any, comes only from parsing the *user's own* last message
  // (never the model's reply) against real, already-known products. This
  // is a read-only preview — no `ai_decisions` row is created here; that
  // only happens if the user explicitly requests it via the chat page's
  // `proposeAction` Server Action (`ai/actions/propose.ts`), which
  // re-validates from scratch rather than trusting this preview.
  const recommendations = buildRecommendations(bundle)
  const intent = extractActionIntent(question, bundle.products)
  const proposedAction = intent ? await validateActionIntent(session, intent, bundle) : null

  if (!isConfigured('anthropic')) {
    const result = await createOfflineProvider(offlineAnswer).complete('', [])
    return {
      content: result.ok ? result.value : offlineAnswer,
      groundedIn: 'fact_only',
      factStatus: bundleHasSubstance ? 'grounded' : 'partial',
      references, warnings, recommendations, proposedAction,
    }
  }

  const system = buildSystemPrompt(serializeFactBundle(bundle))
  const result = await createAnthropicProvider().complete(system, buildProviderMessages(conversation))

  if (!result.ok) {
    return {
      content: offlineAnswer,
      groundedIn: 'fact_only',
      factStatus: 'partial',
      references,
      warnings: [...warnings, `The language model could not be reached (${result.error.kind}) — showing the underlying facts directly instead.`],
      recommendations, proposedAction,
    }
  }

  return { content: result.value, groundedIn: 'live_model', factStatus: 'grounded', references, warnings, recommendations, proposedAction }
}
