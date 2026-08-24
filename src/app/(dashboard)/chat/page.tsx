import { PageHeader } from '@/components/ui'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { isConfigured } from '@/lib/core/env'

export const dynamic = 'force-dynamic'

const SUGGESTED_QUESTIONS = [
  'What needs my attention today?',
  'What compliance issues are currently affecting sales?',
  'Which marketplace is performing best?',
  'Which suppliers are highest risk?',
  'What opportunities should I investigate?',
  'What are the biggest risks in the business right now?',
]

/**
 * Commerce Intelligence chat (Milestone 12) — a read-only interface over
 * the existing intelligence layer. This page renders only the shell
 * (`isConfigured('anthropic')` is a plain sync boolean, the same check
 * `/integrations` already surfaces); every actual fact comes from
 * `/api/chat`, which composes `getCEOCommandCentre()` and the same
 * opportunity/supplier repositories `/` and `/opportunities`/`/suppliers`
 * already call — never a second intelligence engine.
 */
export default function ChatPage() {
  return (
    <>
      <PageHeader
        title="Commerce Intelligence"
        description="Ask a question about the business and get an answer grounded in your current Commerce OS data — read-only, nothing here can change a price, a listing, an order, or a compliance state."
      />
      <ChatPanel providerConfigured={isConfigured('anthropic')} suggestedQuestions={SUGGESTED_QUESTIONS} />
    </>
  )
}
