import { err, ok, type Result } from '@/lib/core/result'
import {
  demoShopifyFees,
  demoShopifyInventory,
  demoShopifyListings,
  demoShopifyOrders,
} from '@/lib/demo/marketplaceData'
import type {
  ConnectionHealth,
  FetchOptions,
  FetchOutcome,
  FulfilmentUpdateInput,
  FulfilmentUpdateOutcome,
  ListingWriteInput,
  MarketplaceConnector,
  MarketplaceConnectorDescriptor,
  MarketplaceFeeSnapshot,
  MarketplaceInventorySnapshot,
  MarketplaceListingSnapshot,
  MarketplaceOrderSnapshot,
  WriteFailure,
  WriteOutcome,
} from './types'

/**
 * The demo Shopify connector.
 *
 * Always available and always reports its status as `demo`, never
 * `connected` — this is the one distinction the whole demo/live separation
 * exists to protect. It returns real, computed data derived from the same
 * product seeds the rest of the demo business uses (`src/lib/demo/marketplaceData.ts`),
 * including one genuine, deliberate stock discrepancy for the reconciliation
 * engine to find.
 */

const DESCRIPTOR: MarketplaceConnectorDescriptor = {
  key: 'shopify_demo',
  label: 'Shopify (demo)',
  description: 'Simulated Shopify store data, used to exercise listing sync, order ingestion and reconciliation without a real store.',
  channel: 'shopify',
  capabilities: {
    readListings: true,
    writeListings: true,
    syncInventory: true,
    ingestOrders: true,
    updateFulfilment: true,
    processRefunds: false,
    readFees: true,
    webhooks: false,
    verifyWrites: true,
  },
  requiredCredentials: [],
  rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
  usagePolicy: {
    termsUrl: null,
    permittedUseNote: 'Generated locally. No network request is ever made, and no real store is represented.',
    authenticatedFirstParty: false,
  },
}

export class ShopifyDemoConnector implements MarketplaceConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return true
  }

  async getConnectionHealth(): Promise<Result<ConnectionHealth, string>> {
    return ok({ status: 'demo', apiVersion: 'demo', checkedAt: new Date().toISOString(), detail: null })
  }

  async fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>> {
    return ok({ records: demoShopifyListings().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>> {
    return ok({ records: demoShopifyInventory().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>> {
    return ok({ records: demoShopifyOrders().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>> {
    return ok({ records: demoShopifyFees().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async submitFulfilmentUpdate(update: FulfilmentUpdateInput): Promise<Result<FulfilmentUpdateOutcome, string>> {
    // Genuinely validates rather than accepting anything unconditionally, so
    // the "marketplace update failure" path has real behaviour to exercise
    // in tests, not a hardcoded success.
    if (!update.trackingNumber || !update.carrier) {
      return err('A tracking number and carrier are both required.')
    }
    return ok({ accepted: true, marketplaceReference: `demo-fulfilment-${update.idempotencyKey}` })
  }

  // Module-level so a write made earlier in the same process is visible to
  // a later verify call — the whole point of exercising SUBMIT -> VERIFY
  // for real in demo mode. Resets on process restart, same as every other
  // in-memory demo dataset.
  private static writtenPrices = new Map<string, number>()
  private static writtenStock = new Map<string, number>()
  private static writtenStatus = new Map<string, 'active' | 'paused'>()

  async updateListingPrice(input: ListingWriteInput & { priceMinor: number }): Promise<Result<WriteOutcome, WriteFailure>> {
    if (input.priceMinor <= 0) return err({ reason: 'rejected', detail: 'Price must be greater than zero.' })
    ShopifyDemoConnector.writtenPrices.set(input.externalId, input.priceMinor)
    return ok({ accepted: true, externalRef: `demo-price-${input.idempotencyKey}` })
  }

  async updateInventory(input: ListingWriteInput & { stockQty: number }): Promise<Result<WriteOutcome, WriteFailure>> {
    if (input.stockQty < 0) return err({ reason: 'rejected', detail: 'Stock cannot be negative.' })
    ShopifyDemoConnector.writtenStock.set(input.externalId, input.stockQty)
    return ok({ accepted: true, externalRef: `demo-inventory-${input.idempotencyKey}` })
  }

  async setListingStatus(input: ListingWriteInput & { status: 'active' | 'paused' }): Promise<Result<WriteOutcome, WriteFailure>> {
    ShopifyDemoConnector.writtenStatus.set(input.externalId, input.status)
    return ok({ accepted: true, externalRef: `demo-status-${input.idempotencyKey}` })
  }

  async verifyListingState(externalId: string): Promise<Result<MarketplaceListingSnapshot, string>> {
    const listing = demoShopifyListings().find((l) => l.externalId === externalId)
    if (!listing) return err(`No demo Shopify listing found for external id "${externalId}".`)

    const writtenStatus = ShopifyDemoConnector.writtenStatus.get(externalId)
    return ok({
      ...listing,
      priceMinor: ShopifyDemoConnector.writtenPrices.get(externalId) ?? listing.priceMinor,
      stockQty: ShopifyDemoConnector.writtenStock.has(externalId) ? ShopifyDemoConnector.writtenStock.get(externalId)! : listing.stockQty,
      status: writtenStatus === 'paused' ? 'draft' : writtenStatus === 'active' ? 'active' : listing.status,
      reportedAt: new Date().toISOString(),
    })
  }
}

export const shopifyDemoConnector = new ShopifyDemoConnector()
