import { err, ok, type Result } from '@/lib/core/result'
import { demoAmazonFees, demoAmazonListings, demoAmazonOrders } from '@/lib/demo/marketplaceData'
import type {
  ConnectionHealth,
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
    writeListings: false,
    syncInventory: false,
    ingestOrders: true,
    updateFulfilment: true,
    processRefunds: false,
    readFees: true,
    webhooks: false,
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
    return ok({ status: 'demo', apiVersion: 'demo', checkedAt: new Date().toISOString(), detail: null })
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
}

export const amazonDemoConnector = new AmazonDemoConnector()
