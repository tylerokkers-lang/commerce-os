/**
 * Environment access.
 *
 * Nothing here is validated at module load: a missing Amazon credential must
 * not stop the whole application from booting, because running without live
 * credentials is a supported, first-class mode (§55). Instead each integration
 * reports its own readiness, and the Integrations page shows the owner exactly
 * what is and is not connected.
 */

function read(key: string): string | undefined {
  const value = process.env[key]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

function require_(key: string): string {
  const value = read(key)
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. See .env.example for what it should contain.`,
    )
  }
  return value
}

export const supabaseUrl = () => require_('NEXT_PUBLIC_SUPABASE_URL')
export const supabaseAnonKey = () => require_('NEXT_PUBLIC_SUPABASE_ANON_KEY')

/**
 * Bypasses RLS. Server-side only — importing this into a Client Component
 * would ship the key to the browser, so every caller lives behind a
 * `server-only` import.
 */
export const supabaseServiceKey = () => require_('SUPABASE_SERVICE_ROLE_KEY')

export const isSupabaseConfigured = (): boolean =>
  Boolean(read('NEXT_PUBLIC_SUPABASE_URL') && read('NEXT_PUBLIC_SUPABASE_ANON_KEY'))

/**
 * The shared secret an external scheduler (cron, a hosted worker, a
 * serverless scheduled function) presents to `/api/automation/run`. This is
 * what lets scheduled automation execute without Claude Code, ChatGPT, or
 * any coding assistant left open — the route is a plain, stateless HTTP
 * endpoint, and this secret is the only thing standing between it and the
 * public internet.
 */
export const automationCronSecret = () => read('AUTOMATION_CRON_SECRET')

/** Server-only callers (`ai/anthropicProvider.ts`) read the key through this accessor rather than `process.env` directly, matching every other credential in this file — `undefined` (never a thrown error) when absent, since demo mode must still boot with zero credentials. */
export const anthropicApiKey = () => read('ANTHROPIC_API_KEY')

/**
 * Milestone 19, Phase 8 — the explicit, deliberate opt-in a write
 * verification run (`advertising/writeVerification.ts`) refuses to proceed
 * without, on top of every other gate that function already enforces
 * (explicit target campaign, explicit action, a genuinely configured real
 * connector). Absent or anything other than the literal string `'true'`
 * means write verification is disabled — never inferred from credentials
 * merely being present, and never set by anything in this codebase itself.
 */
export const advertisingWriteVerificationEnabled = (): boolean => read('ADVERTISING_WRITE_VERIFICATION_ENABLED') === 'true'

export interface IntegrationCredentials {
  readonly key: string
  readonly label: string
  readonly configured: boolean
  readonly missing: readonly string[]
}

function describe(key: string, label: string, vars: readonly string[]): IntegrationCredentials {
  const missing = vars.filter((v) => !read(v))
  return { key, label, configured: missing.length === 0, missing }
}

/**
 * The single source of truth for which integrations can run for real.
 * Anything not fully configured stays in demo mode; the system never claims a
 * live connection it does not have (§20, §56).
 */
export function integrationStatus(): readonly IntegrationCredentials[] {
  return [
    describe('supabase', 'Supabase', [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]),
    describe('shopify', 'Shopify (Admin API — order/product read)', [
      'SHOPIFY_STORE_DOMAIN',
      'SHOPIFY_CLIENT_ID',
      'SHOPIFY_CLIENT_SECRET',
      'SHOPIFY_API_VERSION',
    ]),
    describe('shopify_storefront', 'Shopify Storefront API (customer-facing store)', [
      'SHOPIFY_STORE_DOMAIN',
      'SHOPIFY_STOREFRONT_ACCESS_TOKEN',
      'SHOPIFY_API_VERSION',
    ]),
    describe('amazon', 'Amazon Selling Partner API', [
      'AMAZON_SP_CLIENT_ID',
      'AMAZON_SP_CLIENT_SECRET',
      'AMAZON_SP_REFRESH_TOKEN',
      'AMAZON_SP_MARKETPLACE_ID',
    ]),
    describe('resend', 'Resend', ['RESEND_API_KEY', 'INVOICE_FROM_EMAIL']),
    describe('xero', 'Xero', ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'XERO_TENANT_ID']),
    describe('anthropic', 'Claude API', ['ANTHROPIC_API_KEY']),
  ]
}

export const isConfigured = (key: string): boolean =>
  integrationStatus().find((i) => i.key === key)?.configured ?? false

/**
 * Demo mode is on unless Supabase is configured AND the owner has explicitly
 * turned it off. Defaulting to demo means a fresh checkout is safe to explore
 * and can never accidentally touch a real marketplace.
 *
 * CRITICAL BUG FOUND AND FIXED (Milestone: live infrastructure activation,
 * Phase 11): this previously read `return isSupabaseConfigured()` — the
 * *un-negated* value — which means demo mode was reported as *on* whenever
 * Supabase *was* correctly configured, and (worse) reported as genuinely
 * live whenever `COMMERCE_OS_MODE=live` was set with Supabase *missing*.
 * The exact inverse of the intended, documented behaviour above. This had
 * never been caught because `COMMERCE_OS_MODE=live` had never once been
 * set in any environment this codebase had run in before this milestone —
 * the buggy branch was unreachable in practice until the first real
 * attempt to activate live mode, which is exactly what surfaced it. Found
 * via a deliberate, temporary failure-injection test (real `next dev`
 * process, `COMMERCE_OS_MODE=live` plus a syntactically-valid but
 * non-functional Supabase URL/key, `/api/health` instrumented temporarily
 * to compare `isDemoMode()`'s output against the raw env values directly)
 * — not found by inspection alone. With the fix, live mode now genuinely
 * requires both `COMMERCE_OS_MODE=live` and real Supabase configuration,
 * and reports itself honestly either way.
 */
export function isDemoMode(): boolean {
  if (read('COMMERCE_OS_MODE') === 'live') return !isSupabaseConfigured()
  return true
}

export const appUrl = () => read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000'
