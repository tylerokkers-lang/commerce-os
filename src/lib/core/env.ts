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
    describe('shopify', 'Shopify', [
      'SHOPIFY_STORE_DOMAIN',
      'SHOPIFY_ADMIN_ACCESS_TOKEN',
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
 */
export function isDemoMode(): boolean {
  if (read('COMMERCE_OS_MODE') === 'live') return isSupabaseConfigured()
  return true
}

export const appUrl = () => read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000'
