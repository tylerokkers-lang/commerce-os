import { err, ok, type Result } from '@/lib/core/result'
import { demoEbayListings, demoEbayOrders } from '@/lib/demo/marketplaceData'
import type {
  ConnectionHealth,
  CreateListingOutcome,
  FetchOptions,
  FetchOutcome,
  FulfilmentUpdateInput,
  FulfilmentUpdateOutcome,
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
 * The demo eBay connector. Same role as the Shopify/Amazon demo connectors:
 * always available, always reports `demo`, never `connected`, and returns
 * real computed data rather than a static fixture.
 */

const DESCRIPTOR: MarketplaceConnectorDescriptor = {
  key: 'ebay_demo',
  label: 'eBay (demo)',
  description: 'Simulated eBay seller data, used to exercise order ingestion and the manual-purchase workflow without a real eBay account.',
  channel: 'ebay',
  capabilities: {
    readListings: true,
    writeListings: false,
    syncInventory: false,
    ingestOrders: true,
    updateFulfilment: true,
    processRefunds: false,
    readFees: false,
    webhooks: false,
    verifyWrites: false,
    createListings: false, // Out of scope for the Shopify-specific Phase 6 milestone.
  },
  requiredCredentials: [],
  rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
  usagePolicy: {
    termsUrl: null,
    permittedUseNote: 'Generated locally. No network request is ever made, and no real eBay account is represented.',
    authenticatedFirstParty: false,
  },
}

export class EbayDemoConnector implements MarketplaceConnector {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return true
  }

  async getConnectionHealth(): Promise<Result<ConnectionHealth, string>> {
    return ok({ status: 'demo', apiVersion: 'demo', checkedAt: new Date().toISOString(), detail: null, grantedScope: null })
  }

  async fetchListings(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceListingSnapshot>, string>> {
    return ok({ records: demoEbayListings().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async fetchInventory(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceInventorySnapshot>, string>> {
    return ok({
      records: [],
      requestsMade: 0,
      warnings: [`Demo connector does not model eBay's separate Offer-resource pricing/stock (requested up to ${options.limit} records).`],
    })
  }

  async fetchOrders(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceOrderSnapshot>, string>> {
    return ok({ records: demoEbayOrders().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  async fetchFees(options: FetchOptions): Promise<Result<FetchOutcome<MarketplaceFeeSnapshot>, string>> {
    return err(`Demo connector does not model eBay's Finances API (requested up to ${options.limit} records) — matches the real connector's honest limitation.`)
  }

  async submitFulfilmentUpdate(update: FulfilmentUpdateInput): Promise<Result<FulfilmentUpdateOutcome, string>> {
    if (!update.trackingNumber || !update.carrier) {
      return err('A tracking number and carrier are both required.')
    }
    return ok({ accepted: true, marketplaceReference: `demo-ebay-shipment-${update.idempotencyKey}` })
  }

  async updateListingPrice(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay price writes are not modelled by this demo connector (writeListings is false).' })
  }

  async updateInventory(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay inventory writes are not modelled by this demo connector.' })
  }

  async setListingStatus(): Promise<Result<WriteOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay listing status writes are not modelled by this demo connector.' })
  }

  async verifyListingState(externalId: string): Promise<Result<MarketplaceListingSnapshot, string>> {
    return err(`eBay write verification is not modelled by this demo connector (capabilities.verifyWrites is false) — requested for "${externalId}".`)
  }

  /** `capabilities.createListings` is false — out of scope for the Shopify-specific Phase 6 milestone. */
  async createListing(): Promise<Result<CreateListingOutcome, WriteFailure>> {
    return err({ reason: 'not_supported', detail: 'eBay product creation is not modelled by this demo connector.' })
  }
}

export const ebayDemoConnector = new EbayDemoConnector()
