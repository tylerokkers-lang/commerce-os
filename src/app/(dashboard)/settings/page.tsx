import { Card, PageHeader } from '@/components/ui'
import { canWrite, requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'
import { SettingsForm } from './SettingsForm'
import type { Tables } from '@/lib/supabase/database.types'

export const dynamic = 'force-dynamic'

/** Sensible starting limits for a new business, deliberately cautious. */
const DEMO_DEFAULTS: Partial<Tables<'business_settings'>> = {
  legal_name: 'Demo Commerce Co Ltd',
  trading_name: 'Demo Commerce',
  address_line1: '1 Example Street',
  city: 'Manchester',
  postcode: 'M1 1AA',
  email: 'owner@demo.local',
  company_number: '00000000',
  vat_registered: true,
  vat_number: 'GB000000000',
  automation_level: 'assisted',
  min_gross_margin_pct: 25,
  min_net_margin_pct: 10,
  min_opportunity_score: 70,
  max_auto_purchase_minor: 20000,
  max_auto_price_change_pct: 5,
  max_daily_ad_spend_minor: 5000,
  min_roas: 3,
  max_auto_ad_increase_pct: 20,
  max_delivery_days: 7,
  max_return_rate_pct: 5,
}

export default async function SettingsPage() {
  const session = await requireSession()

  let settings: Partial<Tables<'business_settings'>> = DEMO_DEFAULTS
  if (!session.isDemo) {
    const supabase = await createServerSupabase()
    const { data } = await supabase
      .from('business_settings')
      .select('*')
      .eq('org_id', session.orgId)
      .maybeSingle()
    settings = data ?? {}
  }

  return (
    <>
      <PageHeader
        title="Business settings"
        description="Your legal identity, VAT status, and the limits that decide what the system may do without asking you first."
      />

      {session.isDemo ? (
        <Card className="border-demo/30 bg-demo-soft">
          <div className="px-5 py-4">
            <p className="text-sm text-demo">
              These are illustrative values. Demo mode has no database, so saving is disabled until
              Supabase is connected.
            </p>
          </div>
        </Card>
      ) : null}

      <SettingsForm settings={settings} canEdit={canWrite(session) && !session.isDemo} />
    </>
  )
}
