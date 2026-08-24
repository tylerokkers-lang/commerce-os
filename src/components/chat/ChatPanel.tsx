'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Badge, Card, type Tone } from '@/components/ui'
import { cn } from '@/lib/utils'
import { requestActionApproval } from '@/app/(dashboard)/chat/actions'

/**
 * The first client component in this codebase — a genuine, minimal
 * exception to the "Server Components by default" rule the rest of the
 * application follows (`docs/ARCHITECTURE.md`), because a chat transcript
 * that updates as you type is the one interaction this codebase has that
 * cannot be a plain form submit. Everything it knows about the business
 * comes from `/api/chat`'s response for the current turn only — no
 * session detail, credential, or fact is ever embedded in this component
 * or its initial props beyond `providerConfigured` (a plain boolean the
 * Integrations page already shows) and the org name already visible
 * elsewhere on the page.
 *
 * Milestone 13 adds recommendation/proposed-action cards, both entirely
 * server-computed (`ChatAnswer.recommendations`/`.proposedAction`) — this
 * component only renders them and, for a proposal that already cleared
 * deterministic validation, offers a button that calls the
 * `requestActionApproval` Server Action. That action re-validates
 * everything from scratch server-side (see `ai/actions/propose.ts`) rather
 * than trusting anything this component sends back; the only thing this
 * component ever transmits is the user's own original message text.
 */

interface ChatReference {
  type: string
  id: string
  label: string
  href: string | null
}

interface LabelledFact {
  category: string
  label: string
  value: string
}

interface Recommendation {
  id: string
  type: string
  title: string
  explanation: string
  supportingFacts: readonly LabelledFact[]
  targetLabel: string | null
  channel: string | null
  expectedBenefit: string
  risk: string
  confidence: 'low' | 'medium' | 'high'
  complianceStatus: 'pass' | 'blocked' | 'review_required' | 'unknown'
  requiresApproval: boolean
  executable: boolean
  suggestedNextStep: string
  href: string | null
}

interface ProposedAction {
  id: string
  actionType: string
  targetLabel: string
  channel: string | null
  currentState: readonly LabelledFact[]
  proposedState: readonly LabelledFact[]
  reason: string
  supportingFacts: readonly LabelledFact[]
  risk: string
  complianceStatus: 'pass' | 'blocked' | 'review_required' | 'unknown'
  confidence: 'low' | 'medium' | 'high'
  outcome: 'blocked' | 'requires_approval' | 'not_executable' | 'invalid'
  policyReasons: readonly string[]
  requiresApproval: boolean
  executable: boolean
  approvalId: string | null
}

interface ChatMessageView {
  role: 'user' | 'assistant'
  content: string
  groundedIn?: 'live_model' | 'fact_only'
  factStatus?: 'grounded' | 'partial' | 'insufficient_data'
  references?: readonly ChatReference[]
  warnings?: readonly string[]
  recommendations?: readonly Recommendation[]
  proposedAction?: ProposedAction | null
  error?: string
}

const FACT_STATUS_TONE: Record<string, Tone> = { grounded: 'positive', partial: 'caution', insufficient_data: 'negative' }
const FACT_STATUS_LABEL: Record<string, string> = { grounded: 'Grounded in current data', partial: 'Partial data', insufficient_data: 'Insufficient data' }

const REFERENCE_TYPE_LABEL: Record<string, string> = {
  priority: 'Priority', compliance: 'Compliance', opportunity: 'Opportunity', supplier: 'Supplier', channel: 'Channel', approval: 'Approval', product: 'Product',
}

const COMPLIANCE_TONE: Record<string, Tone> = { pass: 'positive', blocked: 'negative', review_required: 'caution', unknown: 'neutral' }
const COMPLIANCE_LABEL: Record<string, string> = { pass: 'Compliance: pass', blocked: 'Compliance: BLOCKED', review_required: 'Compliance: review required', unknown: 'Compliance: unknown' }
const OUTCOME_TONE: Record<string, Tone> = { blocked: 'negative', requires_approval: 'caution', not_executable: 'neutral', invalid: 'neutral' }
const OUTCOME_LABEL: Record<string, string> = { blocked: 'BLOCKED', requires_approval: 'Approval required', not_executable: 'Not currently executable', invalid: 'Could not be resolved' }

export function ChatPanel({ providerConfigured, suggestedQuestions }: { providerConfigured: boolean; suggestedQuestions: readonly string[] }) {
  const [messages, setMessages] = useState<ChatMessageView[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  async function send(question: string) {
    const trimmed = question.trim()
    if (!trimmed || isLoading) return

    const history = [...messages, { role: 'user' as const, content: trimmed }]
    setMessages(history)
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })) }),
      })
      const body = await response.json()
      if (!response.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: body.error ?? 'Something went wrong.', error: body.error }])
        return
      }
      setMessages((prev) => [...prev, { role: 'assistant', ...body.answer }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Could not reach Commerce Intelligence — check your connection and try again.', error: 'network_error' }])
    } finally {
      setIsLoading(false)
    }
  }

  function updateProposedAction(index: number, next: ProposedAction | null) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, proposedAction: next } : m)))
  }

  return (
    <div className="flex flex-col gap-4">
      {!providerConfigured ? (
        <Card className="border-caution/30 bg-caution-soft px-4 py-3">
          <p className="text-sm text-caution">
            AI language reasoning is not connected (<code className="rounded bg-surface px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code> is not configured on <Link href="/integrations" className="underline">Integrations</Link>). Questions below are still answered directly from your Commerce OS data — just without natural-language reasoning.
          </p>
        </Card>
      ) : null}

      <Card className="flex min-h-[28rem] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
              <p className="text-sm text-ink-muted">Ask a question about your business. Every answer is grounded in your current Commerce OS data — nothing is invented.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                sourceUserMessage={messages[i - 1]?.role === 'user' ? messages[i - 1].content : ''}
                onProposedActionChange={(next) => updateProposedAction(i, next)}
              />
            ))
          )}
          {isLoading ? <p className="text-sm text-ink-subtle">Reading your Commerce OS data…</p> : null}
        </div>

        <form
          className="flex items-end gap-2 border-t border-border px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder="What needs my attention today?"
            rows={2}
            maxLength={2000}
            className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent/50"
          />
          <button
            type="submit"
            disabled={isLoading || input.trim().length === 0}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask
          </button>
        </form>
      </Card>
    </div>
  )
}

function MessageBubble({
  message, sourceUserMessage, onProposedActionChange,
}: {
  message: ChatMessageView
  /** The exact user message that produced this turn's proposal — re-sent verbatim to `requestActionApproval` so the server re-parses the identical intent, rather than a synthesized string that might not match. */
  sourceUserMessage: string
  onProposedActionChange: (next: ProposedAction | null) => void
}) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
      <div className={cn('max-w-[85%] rounded-xl px-4 py-3', isUser ? 'bg-accent text-white' : 'border border-border bg-surface-muted')}>
        <p className={cn('text-sm whitespace-pre-wrap', isUser ? 'text-white' : 'text-ink')}>{message.content}</p>

        {!isUser && (message.groundedIn || message.factStatus) ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
            {message.groundedIn === 'fact_only' ? <Badge tone="neutral">Fact-only mode</Badge> : null}
            {message.factStatus ? <Badge tone={FACT_STATUS_TONE[message.factStatus]}>{FACT_STATUS_LABEL[message.factStatus]}</Badge> : null}
          </div>
        ) : null}

        {!isUser && message.warnings && message.warnings.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {message.warnings.map((w, i) => (
              <li key={i} className="text-xs text-caution">⚠ {w}</li>
            ))}
          </ul>
        ) : null}

        {!isUser && message.references && message.references.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {message.references.slice(0, 8).map((r, i) =>
              r.href ? (
                <Link key={i} href={r.href} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-ink-muted hover:border-accent/40 hover:text-accent">
                  {REFERENCE_TYPE_LABEL[r.type] ?? r.type}: {r.label}
                </Link>
              ) : (
                <span key={i} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-ink-subtle">
                  {REFERENCE_TYPE_LABEL[r.type] ?? r.type}: {r.label}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>

      {!isUser && message.proposedAction ? (
        <ProposedActionCard action={message.proposedAction} sourceUserMessage={sourceUserMessage} onChange={onProposedActionChange} />
      ) : null}

      {!isUser && message.recommendations && message.recommendations.length > 0 ? (
        <div className="flex w-full max-w-[85%] flex-col gap-2">
          {message.recommendations.slice(0, 4).map((r) => <RecommendationCard key={r.id} rec={r} />)}
        </div>
      ) : null}
    </div>
  )
}

function FactList({ facts }: { facts: readonly LabelledFact[] }) {
  if (facts.length === 0) return null
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
      {facts.map((f, i) => (
        <div key={i} className="contents">
          <dt className="text-xs text-ink-subtle">{f.label}</dt>
          <dd className="text-xs font-medium text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <Card className="w-full px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Recommendation</p>
          <p className="mt-0.5 text-sm font-medium text-ink">{rec.title}</p>
        </div>
        <Badge tone={COMPLIANCE_TONE[rec.complianceStatus]}>{COMPLIANCE_LABEL[rec.complianceStatus]}</Badge>
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">{rec.explanation}</p>
      <div className="mt-2">
        <FactList facts={rec.supportingFacts} />
      </div>
      <p className="mt-2 text-xs text-ink-subtle">Expected benefit: {rec.expectedBenefit}</p>
      <p className="text-xs text-ink-subtle">Risk: {rec.risk}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">Confidence: {rec.confidence}</Badge>
        {!rec.executable ? <Badge tone="neutral">Not yet an automatic proposal</Badge> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <p className="text-xs text-ink-subtle">{rec.suggestedNextStep}</p>
        {rec.href ? <Link href={rec.href} className="shrink-0 text-xs text-accent hover:underline">Open →</Link> : null}
      </div>
    </Card>
  )
}

function ProposedActionCard({
  action, sourceUserMessage, onChange,
}: {
  action: ProposedAction
  sourceUserMessage: string
  onChange: (next: ProposedAction | null) => void
}) {
  const [isRequesting, setIsRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canRequest = action.executable && action.outcome === 'requires_approval' && !action.approvalId

  async function handleRequestApproval() {
    setIsRequesting(true)
    setError(null)
    try {
      const result = await requestActionApproval(sourceUserMessage)
      if ('error' in result) {
        setError(result.error)
      } else {
        onChange(result)
      }
    } catch {
      setError('Could not request approval — please try again.')
    } finally {
      setIsRequesting(false)
    }
  }

  return (
    <Card className="w-full max-w-[85%] border-accent/25 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Proposed action</p>
          <p className="mt-0.5 text-sm font-medium text-ink">{action.actionType.replace(/_/g, ' ')}: {action.targetLabel}{action.channel ? ` on ${action.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'}` : ''}</p>
        </div>
        <Badge tone={OUTCOME_TONE[action.outcome]}>{OUTCOME_LABEL[action.outcome]}</Badge>
      </div>

      {action.currentState.length > 0 || action.proposedState.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-medium text-ink-subtle">Current</p>
            <FactList facts={action.currentState} />
          </div>
          <div>
            <p className="text-xs font-medium text-ink-subtle">Proposed</p>
            <FactList facts={action.proposedState} />
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-sm text-ink-muted">{action.reason}</p>
      {action.policyReasons.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {action.policyReasons.map((r, i) => <li key={i} className="text-xs text-negative">⚠ {r}</li>)}
        </ul>
      ) : null}
      <p className="mt-1 text-xs text-ink-subtle">Risk: {action.risk}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={COMPLIANCE_TONE[action.complianceStatus]}>{COMPLIANCE_LABEL[action.complianceStatus]}</Badge>
        <Badge tone="neutral">Confidence: {action.confidence}</Badge>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        {action.approvalId ? (
          <>
            <p className="text-xs text-positive">Approval requested — awaiting owner decision.</p>
            <Link href="/approvals" className="text-xs text-accent hover:underline">Review on /approvals →</Link>
          </>
        ) : canRequest ? (
          <>
            <p className="text-xs text-ink-subtle">This only raises a request — the AI cannot approve or execute it itself.</p>
            <button
              type="button"
              onClick={handleRequestApproval}
              disabled={isRequesting}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isRequesting ? 'Requesting…' : 'Request approval'}
            </button>
          </>
        ) : (
          <p className="text-xs text-ink-subtle">{action.outcome === 'blocked' ? 'Blocked — cannot be proposed for approval.' : 'No action available.'}</p>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-negative">{error}</p> : null}
    </Card>
  )
}
