import type { ChatProvider } from './types'

/**
 * The deterministic `ChatProvider` — no network call, no credential, never
 * fails. Used whenever `ANTHROPIC_API_KEY` is not configured, and in every
 * test in this codebase (which run with no credentials at all, the same
 * boundary every other live-service integration in this project has).
 *
 * This does not itself decide *what* to say — `repository.ts` builds the
 * actual reply text via `offlineAnswer.ts` before ever constructing a
 * `ChatMessage[]` history; this provider exists only so the orchestration
 * code has one uniform `ChatProvider` shape to call regardless of which
 * implementation was selected, matching the "define the interface, satisfy
 * it twice" pattern the rest of this codebase already uses for
 * `AutomationStore`/`FxRateStore`/`EventStore`.
 */
export function createOfflineProvider(fixedReply: string): ChatProvider {
  return {
    async complete() {
      return { ok: true as const, value: fixedReply }
    },
  }
}
