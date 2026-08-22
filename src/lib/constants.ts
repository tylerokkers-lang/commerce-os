import type { ChannelKey, ListingStatus, ProductStage } from '@/lib/core/domain'
import type { Tone } from '@/components/ui'

export const APP_NAME = 'Commerce OS'

export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Dashboard' },
      { href: '/report', label: 'Daily report' },
      { href: '/approvals', label: 'Approvals' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { href: '/products', label: 'Products' },
      { href: '/opportunities', label: 'Opportunities' },
      { href: '/suppliers', label: 'Suppliers' },
      { href: '/compliance', label: 'Compliance' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/finance', label: 'Finance & VAT' },
      { href: '/audit', label: 'Audit log' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/settings', label: 'Business settings' },
      { href: '/integrations', label: 'Integrations' },
    ],
  },
] as const

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  shopify: 'Shopify',
  amazon_uk: 'Amazon UK',
}

export const STAGE_LABELS: Record<ProductStage, string> = {
  discovered: 'Discovered',
  researching: 'Researching',
  supplier_review: 'Supplier review',
  compliance_review: 'Compliance review',
  approved: 'Approved',
  testing: 'Testing',
  proven: 'Proven',
  scaling: 'Scaling',
  mature: 'Mature',
  declining: 'Declining',
  paused: 'Paused',
  removed: 'Removed',
}

export const STAGE_TONES: Record<ProductStage, Tone> = {
  discovered: 'neutral',
  researching: 'neutral',
  supplier_review: 'caution',
  compliance_review: 'caution',
  approved: 'accent',
  testing: 'accent',
  proven: 'positive',
  scaling: 'positive',
  mature: 'neutral',
  declining: 'caution',
  paused: 'caution',
  removed: 'negative',
}

export const LISTING_LABELS: Record<ListingStatus, string> = {
  not_listed: 'Not listed',
  draft: 'Draft',
  review_required: 'Review required',
  blocked: 'Blocked',
  testing: 'Testing',
  live: 'Live',
  paused: 'Paused',
  removed: 'Removed',
}

export const LISTING_TONES: Record<ListingStatus, Tone> = {
  not_listed: 'neutral',
  draft: 'neutral',
  review_required: 'caution',
  blocked: 'negative',
  testing: 'accent',
  live: 'positive',
  paused: 'caution',
  removed: 'negative',
}

/**
 * UK VAT registration threshold, held here only as the seed value for a new
 * business. It is written into `config_values` on setup and read from there
 * afterwards, so it can be changed without a deployment when HMRC changes it
 * (§41 - thresholds must never be permanently hard-coded).
 */
export const DEFAULT_VAT_THRESHOLD_MINOR = 9_000_000 // £90,000
export const DEFAULT_VAT_STANDARD_RATE_PCT = 20
