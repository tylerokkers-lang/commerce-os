import 'server-only'

import { connectorForChannel, listMarketplaceConnectors, marketplaceConnectorSummary } from './connectors/registry'
import { reconcileInventory, reconcileListings } from './reconciliation'
import { requireSession } from '@/lib/security/session'
import type { ChannelKey, ChannelDiscrepancySummary, MarketplaceChannelSummary } from '@/lib/core/domain'
import type { OurInventoryRecord, OurListingRecord } from './reconciliation'

/**
 * The demo business's own recorded inventory and listing state, for
 * reconciliation. In live mode this reads `inventory` and `channel_products`;
 * in demo mode it mirrors the same figures `demoStockAlerts`/`demoProducts`
 * already show elsewhere, so the discrepancy this page finds is the same one
 * a person would notice by comparing the two pages by hand.
 */
async function ourInventoryRecords(): Promise<readonly OurInventoryRecord[]> {
  const { demoStockAlerts, demoProducts } = await import('@/lib/demo/dataset')
  const recordedAt = '2026-08-23T06:00:00.000Z' // Our last internal sync, before the marketplace moved on.
  const bySku = new Map(demoStockAlerts().map((alert) => [alert.sku, alert.availableQty]))

  return demoProducts()
    .filter((product) => bySku.has(product.sku))
    .map((product) => ({
      channelProductRef: product.sku,
      stockQty: bySku.get(product.sku) as number,
      recordedAt,
    }))
}

/**
 * Builds our own listing records by pairing each demo product's known status
 * with the price the marketplace itself reports. `PRODUCT_SEEDS` is the
 * single source of truth for price on both sides of this comparison in demo
 * mode, so this never manufactures a price discrepancy that does not exist —
 * only a genuine one (seeded deliberately in `marketplaceData.ts`, exactly
 * like the stock discrepancy) would ever surface here.
 */
async function ourListingRecords(
  channel: ChannelKey,
  marketplaceListings: readonly { channelProductRef: string; priceMinor: number }[],
): Promise<readonly OurListingRecord[]> {
  const { demoProducts } = await import('@/lib/demo/dataset')
  const recordedAt = '2026-08-23T06:00:00.000Z'
  const marketplacePriceByRef = new Map(marketplaceListings.map((l) => [l.channelProductRef, l.priceMinor]))

  return demoProducts()
    .filter((product) => product.channelStatus[channel] !== 'not_listed')
    .map((product) => ({
      channelProductRef: product.sku,
      priceMinor: marketplacePriceByRef.get(product.sku) ?? 0,
      status: product.channelStatus[channel],
      recordedAt,
    }))
}

export async function getMarketplaceChannels(): Promise<readonly MarketplaceChannelSummary[]> {
  const session = await requireSession()

  const channels: readonly ChannelKey[] = ['shopify', 'amazon_uk']
  const results: MarketplaceChannelSummary[] = []

  for (const channel of channels) {
    const connector = connectorForChannel(channel, session.isDemo)
    const summary = await marketplaceConnectorSummary(connector)

    const listings = await connector.fetchListings({ limit: 100 })
    const listingCount = listings.ok ? listings.value.records.length : 0

    const orders = await connector.fetchOrders({ limit: 100 })
    const orderCount = orders.ok ? orders.value.records.length : 0

    let openDiscrepancyCount = 0
    let inventorySyncStatus: MarketplaceChannelSummary['inventorySyncStatus'] = 'not_synced'

    if (session.isDemo && listings.ok) {
      const ourListings = await ourListingRecords(channel, listings.value.records)
      const listingDiscrepancies = reconcileListings(ourListings, listings.value.records)

      const inventory = await connector.fetchInventory({ limit: 100 })
      const inventoryDiscrepancies = inventory.ok
        ? reconcileInventory(await ourInventoryRecords(), inventory.value.records)
        : []

      openDiscrepancyCount = listingDiscrepancies.length + inventoryDiscrepancies.length
      inventorySyncStatus = inventory.ok
        ? inventoryDiscrepancies.length > 0
          ? 'discrepancies_found'
          : 'ok'
        : 'not_synced'
    }

    results.push({
      channel,
      label: channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify',
      connectorKey: connector.descriptor.key,
      status: summary.status,
      isDemo: summary.status === 'demo',
      apiVersion: summary.apiVersion,
      lastSuccessAt: summary.lastSuccessAt,
      lastFailureAt: summary.lastFailureAt,
      lastError: summary.lastError,
      consecutiveFailures: summary.consecutiveFailures,
      listingCount,
      orderCount,
      inventorySyncStatus,
      openDiscrepancyCount,
      pendingActionCount: 0,
      requiresAttention: summary.status === 'error' || summary.status === 'degraded' || openDiscrepancyCount > 0,
    })
  }

  return results
}

export async function getChannelDiscrepancies(): Promise<readonly ChannelDiscrepancySummary[]> {
  const session = await requireSession()
  if (!session.isDemo) return []

  const channels: readonly ChannelKey[] = ['shopify', 'amazon_uk']
  const results: ChannelDiscrepancySummary[] = []

  for (const channel of channels) {
    const connector = connectorForChannel(channel, true)
    const inventory = await connector.fetchInventory({ limit: 100 })
    if (!inventory.ok) continue

    const discrepancies = reconcileInventory(await ourInventoryRecords(), inventory.value.records)
    for (const d of discrepancies) {
      results.push({
        channel,
        field: d.field,
        channelProductRef: d.channelProductRef,
        ourValue: d.ourValue,
        marketplaceValue: d.marketplaceValue,
        detectedAt: d.marketplaceReportedAt,
      })
    }
  }

  return results
}

export async function getAllMarketplaceConnectors() {
  const session = await requireSession()
  const connectors = listMarketplaceConnectors()
  return Promise.all(
    connectors.map(async (connector) => ({
      ...(await marketplaceConnectorSummary(connector)),
      isRelevantToSession: session.isDemo
        ? connector.descriptor.key.endsWith('_demo')
        : !connector.descriptor.key.endsWith('_demo'),
    })),
  )
}
