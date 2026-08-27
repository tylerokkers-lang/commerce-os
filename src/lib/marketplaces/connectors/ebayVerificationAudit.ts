import type { AuditEntry } from '@/lib/audit'
import type { EbayVerificationResult } from './ebay'

/**
 * Builds the audit entry for a `verifyEbayConnection()` result — kept
 * separate from `ebay.ts` itself (which deliberately has zero `recordAudit`
 * dependency, matching every other connector file) so a caller (a future
 * "verify connection" route, or a maintenance-cycle check) just calls
 * `recordAudit(buildEbayVerificationAuditEntry(orgId, result))`.
 *
 * Structurally cannot contain a credential: every field is read from
 * `EbayVerificationResult`, whose own fields (`status`, `environment`,
 * `operationTested`, `latencyMs`, `detail`, `oauthScopesGranted`) are
 * themselves incapable of holding an access token, refresh token, client
 * secret, or Authorization header value (`ebay.ts`'s `verifyEbayConnection`
 * never puts one there — see its own doc comment and the "credential
 * never appears in a result" test).
 */
export function buildEbayVerificationAuditEntry(orgId: string, result: EbayVerificationResult): AuditEntry {
  return {
    orgId,
    action: 'MARKETPLACE_CONNECTOR_VERIFIED',
    entityType: 'marketplace_connector',
    entityId: 'ebay',
    actorType: 'system',
    newValue: {
      integration: 'ebay',
      environment: result.environment,
      environmentSource: result.environmentSource,
      status: result.status,
      operationTested: result.operationTested,
      latencyMs: result.latencyMs,
      oauthScopesGranted: result.oauthScopesGranted,
    },
    reason: result.detail,
    result: result.status === 'CONNECTED' ? 'success' : result.status === 'DEGRADED' ? 'blocked' : 'failure',
  }
}
