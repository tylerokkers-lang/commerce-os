import { Badge } from '@/components/ui'
import { CHANNEL_LABELS, LISTING_LABELS, LISTING_TONES } from '@/lib/constants'
import type { ChannelKey, ListingStatus } from '@/lib/core/domain'

/**
 * Shows a product's status on each channel side by side, never merged.
 * A product can be live on Shopify and blocked on Amazon, and the interface
 * has to make that obvious rather than picking one to display (§21).
 */
export function ChannelStatus({ status }: { status: Record<ChannelKey, ListingStatus> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(CHANNEL_LABELS) as ChannelKey[]).map((channel) => (
        <Badge key={channel} tone={LISTING_TONES[status[channel]]}>
          <span className="text-ink-subtle">{CHANNEL_LABELS[channel]}</span>
          <span aria-hidden>·</span>
          {LISTING_LABELS[status[channel]]}
        </Badge>
      ))}
    </div>
  )
}
