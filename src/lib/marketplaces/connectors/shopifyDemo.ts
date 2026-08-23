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
  MarketplaceConnector,
  MarketplaceConnectorDescriptor,
  MarketplaceFeeSnapshot,
  MarketplaceInventorySnapshot,
  MarketplaceListingSnapshot,
  MarketplaceOrderSnapshot,
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
    writeListings: false,
    syncInventory: true,
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
}

export const shopifyDemoConnector = new ShopifyDemoConnector()
