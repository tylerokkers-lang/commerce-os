'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Badge, Card, type Tone } from '@/components/ui'
import { cn } from '@/lib/utils'

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
 */

interface ChatReference {
  type: string
  id: string
  label: string
  href: string | null
}

interface ChatMessageView {
  role: 'user' | 'assistant'
  content: string
  groundedIn?: 'live_model' | 'fact_only'
  factStatus?: 'grounded' | 'partial' | 'insufficient_data'
  references?: readonly ChatReference[]
  warnings?: readonly string[]
  error?: string
}

const FACT_STATUS_TONE: Record<string, Tone> = { grounded: 'positive', partial: 'caution', insufficient_data: 'negative' }
const FACT_STATUS_LABEL: Record<string, string> = { grounded: 'Grounded in current data', partial: 'Partial data', insufficient_data: 'Insufficient data' }

const REFERENCE_TYPE_LABEL: Record<string, string> = {
  priority: 'Priority', compliance: 'Compliance', opportunity: 'Opportunity', supplier: 'Supplier', channel: 'Channel', approval: 'Approval',
}

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
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
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

function MessageBubble({ message }: { message: ChatMessageView }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
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
    </div>
  )
}
