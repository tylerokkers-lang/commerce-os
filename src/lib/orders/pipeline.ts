/**
 * The order and fulfilment orchestration pipeline (Milestone 5).
 *
 * Documents and threads together the full flow described in
 * `docs/MILESTONES.md`:
 *
 *   marketplace order -> ingestion -> validation -> fraud/risk (where
 *   available) -> supplier selection -> profitability re-check -> compliance
 *   re-check (where necessary) -> submit fulfilment -> supplier
 *   acknowledgement -> tracking received -> marketplace updated -> delivery
 *   monitoring -> returns/refunds -> financial reconciliation
 *
 * This module is deliberately thin. Every step already exists as its own
 * tested, independent function elsewhere in `src/lib/orders/` and
 * `src/lib/fulfilment/` — `planOrderIngestion`, `validateOrder`,
 * `chooseFulfilmentSupplier`, `recheckOrderLineProfitability`,
 * `decideComplianceRecheck`, `assessFulfilmentSubmission`, `reserveStock`,
 * `assessDeliveryHealth`, `planRefund`. This file's only job is to run them
 * in the right order and carry each step's output into the next one's input,
 * so the ordering itself — supplier before compliance, compliance before
 * submission — is documented in exactly one place rather than left implicit
 * in whichever caller happens to invoke these functions.
 *
 * Nothing here calls a marketplace or a supplier. It produces a plan; a
 * caller with real connectors and real database access executes it.
 */

import { planOrderIngestion, type IngestOrderInput, type IngestionDecision } from './ingestion'
import { recheckOrderLineProfitability, type OrderLineEconomics, type OrderProfitabilityResult } from './profitabilityRecheck'
import { decideComplianceRecheck, type ComplianceRecheckContext, type ComplianceRecheckDecision } from './complianceRecheck'
import { chooseFulfilmentSupplier, type FulfilmentSupplierCandidate, type FulfilmentSupplierChoice } from '@/lib/fulfilment/selection'
import { assessFulfilmentSubmission, type AutomationLevel, type SubmissionDecision } from '@/lib/fulfilment/submission'
import { reserveStock, type ReservationOutcome, type StockState } from '@/lib/inventory/reservation'
import { assessDeliveryHealth, type DeliveryHealthIssue, type ShipmentRecord } from '@/lib/fulfilment/tracking'
import type { Result } from '@/lib/core/result'

export interface OrderPipelineInput {
  orderId: string
  ingestion: IngestOrderInput
  lineEconomics: OrderLineEconomics
  marginThreshold: { minNetMarginPct: number }
  stock: StockState
  requestedQuantity: number
  supplierCandidates: readonly FulfilmentSupplierCandidate[]
  complianceContext: ComplianceRecheckContext
  /** Result of actually running `assessCompliance` again, only when a re-check was required. */
  complianceRecheckResult: boolean | null
  automationLevel: AutomationLevel
  shipment: ShipmentRecord | null
}

export interface OrderPipelineResult {
  ingestion: IngestionDecision
  profitability: OrderProfitabilityResult
  complianceRecheck: ComplianceRecheckDecision
  supplierChoice: FulfilmentSupplierChoice
  reservation: Result<ReservationOutcome, string>
  submission: SubmissionDecision
  deliveryIssues: readonly DeliveryHealthIssue[]
  /** True only when every step succeeded and submission may proceed without a human. */
  readyForAutomaticFulfilment: boolean
}

/**
 * Runs one order through the full evaluation pipeline and returns every
 * step's result. Stops threading data forward once ingestion itself is
 * rejected (an invalid order has no supplier, profitability or compliance
 * question worth asking), but otherwise always runs every step so the full
 * picture — including a stock shortfall alongside a profitability failure —
 * is visible in one result rather than discovered one gate at a time.
 */
export function runOrderPipeline(input: OrderPipelineInput): OrderPipelineResult {
  const ingestion = planOrderIngestion(input.ingestion)

  const profitability = recheckOrderLineProfitability(input.lineEconomics, input.marginThreshold)
  const complianceRecheck = decideComplianceRecheck(input.complianceContext)
  const supplierChoice = chooseFulfilmentSupplier(input.supplierCandidates)

  const reservation = reserveStock(input.stock, { orderId: input.orderId, quantity: input.requestedQuantity })

  const submission = assessFulfilmentSubmission({
    supplierChoice,
    reservation: reservation.ok ? { ok: true, value: reservation.value } : { ok: false, error: reservation.error },
    profitability,
    complianceRecheck,
    complianceRecheckPasses: input.complianceRecheckResult,
    automationLevel: input.automationLevel,
  })

  const deliveryIssues = input.shipment ? assessDeliveryHealth(input.shipment) : []

  return {
    ingestion,
    profitability,
    complianceRecheck,
    supplierChoice,
    reservation,
    submission,
    deliveryIssues,
    readyForAutomaticFulfilment:
      ingestion.outcome !== 'rejected' && submission.outcome === 'submit_automatically',
  }
}
