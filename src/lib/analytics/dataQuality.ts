/**
 * Data quality summary (Milestone 10 §13) — the single place every other
 * analytics module's "unknown"/"unavailable"/"stale" counts are rolled up
 * into a CEO-legible list, so a profit figure that is genuinely incomplete
 * can never be read as if it were whole. This is deliberately just a
 * rollup: every count here is computed elsewhere (profit/product/channel/
 * supplier/international/fulfilment analytics, and the existing Milestone
 * 8 monitoring status) and passed in, never recomputed.
 */

export type DataQualityIssueKey =
  | 'missing_supplier_cost' | 'missing_advertising_data' | 'stale_fx' | 'missing_fulfilment_tracking'
  | 'missing_marketplace_price' | 'missing_sales_data' | 'stale_connector' | 'disconnected_marketplace'

export interface DataQualityIssue {
  key: DataQualityIssueKey
  severity: 'info' | 'warning' | 'critical'
  message: string
  affectedCount: number
}

export interface DataQualitySummary {
  issues: readonly DataQualityIssue[]
  /** `complete` only when every check below found nothing missing; `unknown` only in demo mode, where there is no live database to check against at all. */
  overallStatus: 'complete' | 'incomplete' | 'unknown'
}

export interface DataQualityInputs {
  productsWithUnknownCost: number
  productsMissingListingPrice: number
  fxRatesStale: number
  fulfilmentsMissingTracking: number
  productsWithNoSalesData: number
  connectorsNotConnected: readonly string[]
  connectorsDegraded: readonly string[]
  advertisingConfigured: boolean
}

export function buildDataQualitySummary(inputs: DataQualityInputs): DataQualitySummary {
  const issues: DataQualityIssue[] = []

  if (inputs.productsWithUnknownCost > 0) {
    issues.push({ key: 'missing_supplier_cost', severity: 'warning', affectedCount: inputs.productsWithUnknownCost, message: `${inputs.productsWithUnknownCost} product(s) have no known live supplier cost — their profit figures are incomplete, not zero-cost.` })
  }
  if (inputs.productsMissingListingPrice > 0) {
    issues.push({ key: 'missing_marketplace_price', severity: 'warning', affectedCount: inputs.productsMissingListingPrice, message: `${inputs.productsMissingListingPrice} product(s) have no live channel listing price on file.` })
  }
  if (inputs.fxRatesStale > 0) {
    issues.push({ key: 'stale_fx', severity: 'warning', affectedCount: inputs.fxRatesStale, message: `${inputs.fxRatesStale} exchange rate(s) are stale or unavailable — market profitability using them is degraded, never presented as fresh.` })
  }
  if (inputs.fulfilmentsMissingTracking > 0) {
    issues.push({ key: 'missing_fulfilment_tracking', severity: 'info', affectedCount: inputs.fulfilmentsMissingTracking, message: `${inputs.fulfilmentsMissingTracking} shipped fulfilment(s) have no tracking number — delivery outcome is unknown, not assumed successful.` })
  }
  if (inputs.productsWithNoSalesData > 0) {
    issues.push({ key: 'missing_sales_data', severity: 'info', affectedCount: inputs.productsWithNoSalesData, message: `${inputs.productsWithNoSalesData} product(s) have no order history yet in this period.` })
  }
  if (inputs.connectorsDegraded.length > 0) {
    issues.push({ key: 'stale_connector', severity: 'warning', affectedCount: inputs.connectorsDegraded.length, message: `Degraded connector(s): ${inputs.connectorsDegraded.join(', ')} — recent data from these may be incomplete.` })
  }
  if (inputs.connectorsNotConnected.length > 0) {
    issues.push({ key: 'disconnected_marketplace', severity: 'info', affectedCount: inputs.connectorsNotConnected.length, message: `Not connected: ${inputs.connectorsNotConnected.join(', ')} — no live data flows from these yet.` })
  }
  if (!inputs.advertisingConfigured) {
    issues.push({ key: 'missing_advertising_data', severity: 'info', affectedCount: 1, message: 'No advertising connector is configured — advertising spend, ROAS and profit impact are unavailable, not zero.' })
  }

  return { issues, overallStatus: issues.length === 0 ? 'complete' : 'incomplete' }
}

export function unknownDataQualitySummary(): DataQualitySummary {
  return { issues: [], overallStatus: 'unknown' }
}
