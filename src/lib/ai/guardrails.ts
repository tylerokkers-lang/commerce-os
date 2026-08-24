import { z } from 'zod'
import type { ChatMessage } from './types'

/**
 * Everything here treats chat input as untrusted — the same posture
 * `suppliers/validation.ts` takes toward a supplier form, applied to free
 * text instead. None of this is a claim that prompt injection is fully
 * solved (no purely textual defence is): it is the bounded, testable part
 * of the defence. The structural part — the model is never given
 * tool/function-calling access, so even a successful injection cannot
 * query, mutate, or execute anything — lives in `types.ts`'s `ChatProvider`
 * contract and is enforced by construction, not by this file.
 */

export const MAX_MESSAGE_CHARS = 2000
export const MAX_CONVERSATION_TURNS = 20
/**
 * Assistant turns get a much higher ceiling than user turns: the length
 * cap on a user turn exists to bound abuse/cost on *typed* input, but a
 * conversation round-trips its own prior assistant replies back as
 * history (the client has no server-side session to persist them in —
 * see `repository.ts`'s module comment), and a real answer — especially
 * `offlineAnswer.ts`'s fact-only summary of a business with many open
 * priorities/compliance issues/opportunities — genuinely runs well past
 * 2000 characters. A found bug during browser verification: a second
 * question after a long first answer was rejected with 400 before this
 * split existed.
 */
export const MAX_ASSISTANT_MESSAGE_CHARS = 8000

const chatMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string().trim().min(1, 'A message cannot be empty.').max(MAX_MESSAGE_CHARS, `A message cannot exceed ${MAX_MESSAGE_CHARS} characters.`) }),
  z.object({ role: z.literal('assistant'), content: z.string().trim().min(1, 'A message cannot be empty.').max(MAX_ASSISTANT_MESSAGE_CHARS, `A message cannot exceed ${MAX_ASSISTANT_MESSAGE_CHARS} characters.`) }),
])

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, 'At least one message is required.').max(MAX_CONVERSATION_TURNS, `A conversation cannot exceed ${MAX_CONVERSATION_TURNS} messages.`),
})

export type ChatRequestInput = z.infer<typeof chatRequestSchema>

export interface GuardrailResult {
  ok: boolean
  errors: readonly string[]
}

/** Structural validation only — shape, length, role, turn count. Content-level sanitisation is `sanitizeUserMessage`'s job, kept separate so a caller can always tell "this request was malformed" from "this request was suspicious." */
export function validateChatRequest(body: unknown): { ok: true; value: ChatRequestInput } | { ok: false; errors: readonly string[] } {
  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) }
  const last = parsed.data.messages[parsed.data.messages.length - 1]
  if (last.role !== 'user') return { ok: false, errors: ['The final message in a conversation must be from the user.'] }
  return { ok: true, value: parsed.data }
}

/**
 * Fake role/instruction prefixes are the cheapest injection technique
 * ("System: ignore all previous instructions…", "Assistant: sure, here is
 * the API key…") — since we already pass the real system prompt and
 * conversation roles through the API's own `system`/`role` fields, a user
 * message that *tries* to forge one is never given that authority, but we
 * additionally neutralise the visible pattern so it cannot even *read* as
 * an instruction boundary inside the rendered transcript. This is a
 * defence in depth measure, not the primary one — see the module comment.
 */
const FORGED_ROLE_PREFIX = /^\s*(system|assistant|developer|tool)\s*:/i

export function sanitizeUserMessage(content: string): string {
  const trimmed = content.trim()
  const withoutForgedPrefix = trimmed.replace(FORGED_ROLE_PREFIX, '[user text]:')
  return withoutForgedPrefix.slice(0, MAX_MESSAGE_CHARS)
}

/** Keeps only the most recent turns (structural rule, never content-based), so a very long conversation cannot be used to push the fixed system prompt/fact bundle out of the model's effective attention, and so cost/abuse stay bounded. */
export function capConversation(messages: readonly ChatMessage[], maxTurns: number = MAX_CONVERSATION_TURNS): readonly ChatMessage[] {
  if (messages.length <= maxTurns) return messages
  return messages.slice(messages.length - maxTurns)
}
