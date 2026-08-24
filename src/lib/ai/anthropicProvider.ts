import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import { anthropicApiKey } from '@/lib/core/env'
import { buildAnthropicRequest, mapAnthropicError, parseAnthropicResponse } from './anthropicRequest'
import type { ChatMessage, ChatProvider } from './types'

/**
 * The real `ChatProvider`, used only when `isConfigured('anthropic')` is
 * true. `server-only` because it reads `ANTHROPIC_API_KEY` — never shipped
 * to the browser, matching every other credential in this codebase
 * (`docs/SECURITY.md`'s "never exposed to the browser" section). No tool
 * is ever registered on the request it builds (see `anthropicRequest.ts`'s
 * module comment) — this call can only turn text into more text.
 *
 * Not directly unit-tested, the same boundary `ceo/repository.ts` already
 * has: a `server-only` module cannot be imported into Vitest at all in
 * this project. Its request/response logic is tested through
 * `anthropicRequest.ts`'s pure functions instead; this file is exercised
 * by live browser verification only, and only when a real
 * `ANTHROPIC_API_KEY` is present.
 */
export function createAnthropicProvider(): ChatProvider {
  return {
    async complete(system: string, messages: readonly ChatMessage[]) {
      const apiKey = anthropicApiKey()
      if (!apiKey) return { ok: false, error: { kind: 'not_configured', message: 'ANTHROPIC_API_KEY is not configured.' } }

      const request = buildAnthropicRequest(system, messages)
      try {
        const client = new Anthropic({ apiKey })
        const response = await client.messages.create({ ...request, messages: [...request.messages], stream: false })
        return parseAnthropicResponse(response)
      } catch (error) {
        return { ok: false, error: mapAnthropicError(error) }
      }
    },
  }
}
