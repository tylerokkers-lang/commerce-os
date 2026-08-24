import type { ChannelKey } from '@/lib/core/domain'
import type { FactBundle } from '../types'
import type { ProposedActionType, RawActionIntent } from './types'

/**
 * Pure, deterministic parsing of the user's own most recent chat message —
 * never the model's reply. See `types.ts`'s module comment for why this,
 * rather than parsing structured output the model wrote, is this
 * milestone's answer to "the AI proposal is untrusted input": there is no
 * AI-authored structure here to distrust in the first place. Every field
 * this produces is either a fixed vocabulary member or a real, exact match
 * against `bundle.products`/`bundle.channels` — never a fuzzy guess, never
 * an id invented from thin air. Ambiguous or unmatched input produces
 * `null`, not a best-effort proposal.
 */

const ACTION_KEYWORDS: readonly { type: ProposedActionType; pattern: RegExp }[] = [
  { type: 'UPDATE_PRICE', pattern: /\b(increase|raise|put up|lower|decrease|cut|drop|reduce|change)\b.{0,20}\bprice\b|\bprice\b.{0,20}\b(increase|raise|lower|decrease|cut|drop|reduce|change)\b/i },
  { type: 'PAUSE_LISTING', pattern: /\bpause\b/i },
  { type: 'CREATE_LISTING', pattern: /\b(create|launch|publish|list)\b.{0,20}\blisting\b|\blist\b.{0,10}\bit\b/i },
  { type: 'REVIEW_ADVERTISING', pattern: /\badvertis|\bads?\b/i },
  { type: 'ADJUST_INVENTORY_THRESHOLD', pattern: /\b(inventory|stock|reorder)\b.{0,20}\bthreshold\b/i },
  { type: 'REVIEW_SUPPLIER', pattern: /\breview\b.{0,20}\bsupplier\b|\bsupplier\b.{0,20}\breview\b/i },
  { type: 'REQUEST_APPROVAL', pattern: /\b(request|flag|escalate)\b.{0,20}\bapproval\b/i },
  { type: 'REVIEW_PRODUCT', pattern: /\breview\b.{0,20}\bproduct\b|\binvestigate\b/i },
]

const CHANNEL_KEYWORDS: readonly { channel: ChannelKey; pattern: RegExp }[] = [
  { channel: 'amazon_uk', pattern: /\bamazon\b/i },
  { channel: 'shopify', pattern: /\bshopify\b/i },
]

const PERCENT_PATTERN = /(\d+(?:\.\d+)?)\s*%/
const PRICE_PATTERN = /£\s*(\d+(?:\.\d+)?)/

function detectActionType(message: string): ProposedActionType | null {
  for (const { type, pattern } of ACTION_KEYWORDS) {
    if (pattern.test(message)) return type
  }
  return null
}

function detectChannel(message: string): ChannelKey | null {
  const matches = CHANNEL_KEYWORDS.filter(({ pattern }) => pattern.test(message))
  return matches.length === 1 ? matches[0].channel : null
}

/**
 * Matches the message against real product titles/SKUs only. Returns null
 * on zero or on more than one match — an ambiguous reference must never be
 * resolved by guessing which product the user meant.
 */
function matchProduct(message: string, products: FactBundle['products']): FactBundle['products'][number] | null {
  const lower = message.toLowerCase()
  const matches = products.filter((p) => lower.includes(p.title.toLowerCase()) || lower.includes(p.sku.toLowerCase()))
  return matches.length === 1 ? matches[0] : null
}

function detectSign(message: string, actionType: ProposedActionType): 1 | -1 {
  if (actionType !== 'UPDATE_PRICE') return 1
  return /\b(lower|decrease|cut|drop|reduce)\b/i.test(message) ? -1 : 1
}

export function extractActionIntent(userMessage: string, products: FactBundle['products']): RawActionIntent | null {
  const actionType = detectActionType(userMessage)
  if (!actionType) return null

  const product = matchProduct(userMessage, products)
  if (!product) return null

  let channel = detectChannel(userMessage)
  if (!channel) {
    // If the product is known on exactly one channel, that is an unambiguous default — never a guess across two.
    if (product.channels.length === 1) channel = product.channels[0].channel as ChannelKey
  }

  const sign = detectSign(userMessage, actionType)
  const pctMatch = userMessage.match(PERCENT_PATTERN)
  const priceMatch = userMessage.match(PRICE_PATTERN)

  return {
    actionType,
    matchedProductId: product.id,
    matchedProductTitle: product.title,
    channel,
    requestedPricePct: pctMatch ? sign * parseFloat(pctMatch[1]) : null,
    requestedPriceMinor: priceMatch ? Math.round(parseFloat(priceMatch[1]) * 100) : null,
  }
}
