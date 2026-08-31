import { err, ok, type Result } from '@/lib/core/result'
import { demoAmazonFees, demoAmazonListings, demoAmazonOrders } from '@/lib/demo/marketplaceData'
import type {
  ConnectionHealth,
  CreateListingOutcome,
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
 * The demo Amazon UK connector. Same role as the Shopify demo connector:
 * always available, always reports `demo`, never `connected`, and returns
 * real computed data rather than a static fixture.
 */

const DESCRIPTOR: MarketplaceConnectorDescriptor = {
  key: 'amazon_uk_demo',
  label: 'Amazon UK (demo)',
  description: 'Simulated Amazon seller data, used to exercise listing sync, order ingestion and reconciliation without a real seller account.',
  channel: 'amazon_uk',
  capabilities: {
    readListings: true,
    writeListings: true,
    syncInventory: false,
    ingestOrders: true,
    updateFulfilment: true,
    processRefunds: false,
    readFees: true,
    webhooks: false,
    verifyWrites: true,
    createListings: false, // Matches the real connector — out of scope for the Shopify-specific Phase 6 milestone.
  },
  requiredCredentials: [],
  rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
  usagePolicy: {
    termsUrl: null,
    permittedUseNote: 'Generated locally. No network request is ever made, and no real seller account is represented.',
    authenticatedFirstParty: false,
  },
}

export class AmazonDemoConnector implements MarketplaceConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return true
  }

  async getConnectionHealth(): Promise<Result<ConnectionHealth, string>> {
    return ok({ status: 'demo', apiVersion: 'demo', checkedAt: new Date().toISOString(), detail: null, grantedScope: null })
  }

  async fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>> {
    return ok({ records: demoAmazonListings().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>> {
    // Mirrors the real connector's honest limitation: Amazon stock comes
    // through a separate inventory API this connector does not model.
    return ok({
      records: [],
      requestsMade: 0,
      warnings: [`Demo connector does not model the FBA Inventory API (requested up to ${options.limit} records).`],
    })
  }

  async fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>> {
    return ok({ records: demoAmazonOrders().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>> {
    return ok({ records: demoAmazonFees().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async submitFulfilmentUpdate(update: FulfilmentUpdateInput): Promise<Result<FulfilmentUpdateOutcome, string>> {
    if (!update.trackingNumber || !update.carrier) {
      return err('A tracking number and carrier are both required.')
    }
    return ok({ accepted: true, marketplaceReference: `demo-shipment-${update.idempotencyKey}` })
  }

  private static writtenPrices = new Map<string, number>()
  private static writtenStock = new Map<string, number>()
  private static writtenStatus = new Map<string, 'active' | 'paused'>()

  async updateListingPrice(input: ListingWriteInput & { priceMinor: number }): Promise<Result<WriteOutcome, WriteFailure>> {
    if (input.priceMinor <= 0) return err({ reason: 'rejected', detail: 'Price must be greater than zero.' })
    AmazonDemoConnector.writtenPrices.set(input.externalId, input.priceMinor)
    return ok({ accepted: true, externalRef: `demo-price-${input.idempotencyKey}` })
  }

  async updateInventory(input: ListingWriteInput & { stockQty: number }): Promise<Result<WriteOutcome, WriteFailure>> {
    if (input.stockQty < 0) return err({ reason: 'rejected', detail: 'Stock cannot be negative.' })
    AmazonDemoConnector.writtenStock.set(input.externalId, input.stockQty)
    return ok({ accepted: true, externalRef: `demo-inventory-${input.idempotencyKey}` })
  }

  async setListingStatus(input: ListingWriteInput & { status: 'active' | 'paused' }): Promise<Result<WriteOutcome, WriteFailure>> {
    AmazonDemoConnector.writtenStatus.set(input.externalId, input.status)
    return ok({ accepted: true, externalRef: `demo-status-${input.idempotencyKey}` })
  }

  async verifyListingState(externalId: string): Promise<Result<MarketplaceListingSnapshot, string>> {
    const listing = demoAmazonListings().find((l) => l.externalId === externalId)
    if (!listing) return err(`No demo Amazon listing found for external id "${externalId}".`)

    const writtenStatus = AmazonDemoConnector.writtenStatus.get(externalId)
    return ok({
      ...listing,
      priceMinor: AmazonDemoConnector.writtenPrices.get(externalId) ?? listing.priceMinor,
      stockQty: AmazonDemoConnector.writtenStock.has(externalId) ? AmazonDemoConnector.writtenStock.get(externalId)! : listing.stockQty,
      status: writtenStatus === 'paused' ? 'archived' : writtenStatus === 'active' ? 'active' : listing.status,
      reportedAt: new Date().toISOString(),
    })
  }

  /** `capabilities.createListings` is false, matching the real connector — out of scope for the Shopify-specific Phase 6 milestone. */
  async createListing(): Promise<Result<CreateListingOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'Amazon product creation is not simulated by this demo connector — out of scope for the Shopify-specific controlled publication milestone.' })
  }
}

export const amazonDemoConnector = new AmazonDemoConnector()
