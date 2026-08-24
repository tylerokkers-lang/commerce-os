import { validateChatRequest } from '@/lib/ai/guardrails'
import { askCommerceIntelligence } from '@/lib/ai/repository'

/**
 * Commerce Intelligence chat. Session-gated the same way every Server
 * Action in this codebase gates itself (`requireSession()`, re-checked
 * here rather than trusted from the page, since a Route Handler is
 * reachable by direct POST) — any authenticated org member may ask,
 * matching the existing read-access model (`docs/SECURITY.md`: "readable
 * by any org member"). This route itself remains strictly read-only
 * (Milestone 12); `askCommerceIntelligence()`'s response now also carries
 * Milestone 13's `recommendations`/`proposedAction` — both deterministic
 * *previews*, not writes. The one thing that can create real state
 * (`ai/actions/propose.ts`'s `proposeAction`, which only ever raises a
 * pending `ai_decisions` row for the owner to separately approve) is a
 * distinct Server Action (`chat/actions.ts`'s `requestActionApproval`),
 * never reachable through this route.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed request body — expected JSON.' }, { status: 400 })
  }

  const validated = validateChatRequest(body)
  if (!validated.ok) {
    return Response.json({ error: validated.errors.join(' ') }, { status: 400 })
  }

  try {
    const answer = await askCommerceIntelligence(validated.value.messages)
    return Response.json({ answer })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authenticated') {
      return Response.json({ error: 'Not authenticated.' }, { status: 401 })
    }
    return Response.json({ error: 'Something went wrong answering this question.' }, { status: 500 })
  }
}
