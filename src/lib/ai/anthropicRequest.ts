import type { ChatMessage, ChatProviderError } from './types'

/**
 * Pure request/response mapping for the Anthropic Messages API, kept apart
 * from `anthropicProvider.ts` (which is `server-only` and holds the real
 * SDK client) specifically so it can be unit tested directly — the same
 * split `ceo/repository.ts` could not make for its own Supabase calls
 * (`server-only` modules cannot be imported into Vitest at all in this
 * project; see `HANDOVER.md` §26), but is possible and worthwhile here
 * since request/response shaping has nothing to do with the credential.
 *
 * `AnthropicCreateParams` intentionally has no `tools` field anywhere in
 * this module — that is not an oversight, it is the primary technical
 * guarantee behind "the model cannot query or act": nothing in this
 * codebase ever constructs a request that grants the model tool/function-
 * calling capability.
 */

export const COMMERCE_INTELLIGENCE_MODEL = 'claude-sonnet-5'
export const COMMERCE_INTELLIGENCE_MAX_TOKENS = 1024

export interface AnthropicCreateParams {
  model: string
  max_tokens: number
  system: string
  messages: readonly { role: 'user' | 'assistant'; content: string }[]
}

/** Consecutive same-role turns are merged (never sent separately) because the Messages API requires strictly alternating user/assistant turns and rejects a request that isn't. */
export function buildAnthropicRequest(system: string, messages: readonly ChatMessage[]): AnthropicCreateParams {
  const merged: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`
    else merged.push({ role: m.role, content: m.content })
  }
  return { model: COMMERCE_INTELLIGENCE_MODEL, max_tokens: COMMERCE_INTELLIGENCE_MAX_TOKENS, system, messages: merged }
}

export type AnthropicRawResponse = { content: readonly { type: string; text?: string }[] } | null | undefined

/** Never includes anything from the request (system prompt, facts, API key) in an error message — only the SDK's own status/message, matching `docs/SECURITY.md`'s "no connector ever logs a credential value" rule extended to this provider. */
export function parseAnthropicResponse(response: AnthropicRawResponse): { ok: true; value: string } | { ok: false; error: ChatProviderError } {
  const textBlocks = (response?.content ?? []).filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
  const text = textBlocks.map((b) => b.text).join('\n').trim()
  if (!text) return { ok: false, error: { kind: 'invalid_response', message: 'The model returned no text content.' } }
  return { ok: true, value: text }
}

export function mapAnthropicError(error: unknown): ChatProviderError {
  const message = error instanceof Error ? error.message : 'Unknown error calling the language model.'
  return { kind: 'request_failed', message: message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]') }
}
