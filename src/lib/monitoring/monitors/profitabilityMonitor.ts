import { buildChannelProfiles, projectChannel } from '@/lib/profitability/channels'
import type { ChannelKey } from '@/lib/core/domain'
import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Profitability monitoring (brief §2): the periodic safety net alongside
 * the price/stock monitors' explicit chaining.
 *
 * Two genuinely different checks share this monitor, because both start
 * from the same live supplier-cost fact:
 *
 * 1. A pure boundary check ("has the supplier's cost moved at all since we
 *    last looked?") — unchanged since Milestone 7, and still the trigger
 *    for `PRODUCT_PRICE_REVIEW_REQUIRED` -> `product_profitability_recheck`,
 *    which does the real, full-context recheck later.
 * 2. (Milestone 10) A real margin computation, using the *same* channel
 *    cost-profile assembly `channels.ts`'s `compareChannels` uses for the
 *    opportunity page — `calculateProfitability` is still the only place
 *    margin arithmetic happens; this monitor only decides whether the
 *    result crossed a boundary worth an event. `PRODUCT_MARGIN_DROPPED`,
 *    `PRODUCT_MARGIN_RECOVERED`, `PRODUCT_NO_LONGER_PROFITABLE` and
 *    `PRODUCT_BECAME_PROFITABLE` were reserved in `EVENT_TO_JOB_MAPPING`
 *    since Milestone 8 but never actually emitted anywhere — this closes
 *    that gap rather than leaving it as dead configuration.
 *
 * Both checks silently establish a baseline on a subject's first-ever
 * observation, exactly like every other monitor in this codebase — the
 * first look at a fact is never itself "a change."
 */

export interface ProfitabilityMonitorSubject {
  productId: string
  supplierId: string
  channelProductId: string
  /**
   * Added Milestone 10, optional so the existing unit-cost boundary check
   * (and every pre-existing test/demo scenario) keeps working unchanged —
   * the real margin check below only runs when both are present.
   */
  channel?: ChannelKey
  connectorKey?: string
}

const MONITOR_KEY = 'profitability_safety_net'

export const profitabilityMonitor: Monitor<ProfitabilityMonitorSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Profitability safety net', category: 'profitability', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly ProfitabilityMonitorSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let observationsCreated = 0
    let eventsCreated = 0
    let eventsDeduplicated = 0

    const marginDropThresholdPct = await ctx.events.getMonitorConfigNumber(ctx.orgId, `${MONITOR_KEY}:margin_drop_threshold_pct`, 5)

    for (const subject of subjects) {
      try {
        const supplier = await ctx.facts.loadSupplierFactsForProduct(ctx.orgId, subject.supplierId, subject.productId)
        if (supplier.unitCost.freshness === 'unavailable' || supplier.unitCost.freshness === 'unknown' || supplier.unitCost.value === null) {
          continue // Stale/missing facts block silently here; the recheck job itself records the fact-first "blocked" reason if actually invoked.
        }

        const previous = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'product', subject.productId)
        const previousCostMinor = previous?.value.unitCostMinor as number | undefined
        const currentCostMinor = supplier.unitCost.value.minor
        const hasCostBaseline = typeof previousCostMinor === 'number'
        const costUnchanged = previousCostMinor === currentCostMinor

        // -------------------------------------------------------------
        // 1. Unit-cost boundary tripwire (unchanged since Milestone 7).
        // -------------------------------------------------------------
        if (hasCostBaseline && !costUnchanged) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'PRODUCT_PRICE_REVIEW_REQUIRED', subjectType: 'product', subjectId: subject.productId,
            source: 'internal', severity: 'info', previousValue: { unitCostMinor: previousCostMinor }, currentValue: { unitCostMinor: currentCostMinor },
            // Keyed on the resulting cost, not just "changed": a cost that
            // keeps moving (£9 -> £10 -> £12) is a new fact each time, not
            // one standing alert. See supplierMonitor.ts's price dedupeKey
            // for the same fix and why it matters (Milestone 8.5).
            dedupeKey: `profitability:${subject.productId}:cost_changed:${currentCostMinor}`,
          })
          if (!result.deduplicated) {
            eventsCreated++
            await ctx.store.enqueueJob({
              orgId: ctx.orgId, jobType: 'product_profitability_recheck',
              payload: { productId: subject.productId, supplierId: subject.supplierId, channelProductId: subject.channelProductId },
              idempotencyKey: `event:${result.id}`, correlationId: result.id,
            })
          } else {
            eventsDeduplicated++
          }
        }

        // -------------------------------------------------------------
        // 2. Real margin crossing (Milestone 10) — only when the subject
        //    carries enough to price a real channel projection.
        // -------------------------------------------------------------
        let netMarginPct: number | null | undefined
        let isProfitable: boolean | undefined

        if (subject.channel && subject.connectorKey) {
          const [product, channelProductFacts] = await Promise.all([
            ctx.facts.loadProductFacts(ctx.orgId, subject.productId),
            ctx.facts.loadChannelProductFacts(ctx.orgId, subject.channelProductId),
          ])
          const priceFact = channelProductFacts.priceMinor
          if (priceFact.freshness !== 'unavailable' && priceFact.freshness !== 'unknown' && priceFact.value !== null) {
            const currency = supplier.unitCost.value.currency
            const sellingPrice = { minor: priceFact.value, currency }
            const profile = buildChannelProfiles({ category: product.category.value, sellingPrice }).find((p) => p.channel === subject.channel)

            if (profile) {
              const projection = projectChannel(
                {
                  sellingPrice,
                  productCost: supplier.unitCost.value,
                  supplierShipping: supplier.shippingCost.value ?? { minor: 0, currency },
                  returnRatePct: 0,
                  vatRatePct: 20,
                },
                profile,
                { minGrossMarginPct: 0, minNetMarginPct: ctx.settings.minNetMarginPct },
              )
              netMarginPct = projection.profitability.netMarginPct
              isProfitable = projection.profitability.netProfit.minor > 0

              const previousIsProfitable = previous?.value.isProfitable as boolean | undefined
              // A stable "last known healthy" reference, not the previous
              // tick's raw margin — comparing tick-to-tick would flip-flop
              // (a margin that stops falling but never recovers would
              // wrongly read as "recovered" the moment it stops moving).
              // The reference stays frozen for as long as the product is in
              // a dropped state, and only resets once it genuinely climbs
              // back above the threshold — the same "track a stable
              // boolean state, fire once on each transition" shape
              // `performanceMonitor.ts`'s underperforming/recovered pair
              // already established.
              const previousReferenceMarginPct = previous?.value.referenceMarginPct as number | undefined
              const previousMarginDropped = previous?.value.marginDropped === true
              const hasMarginBaseline = typeof previousReferenceMarginPct === 'number'

              let referenceMarginPct = previousReferenceMarginPct ?? netMarginPct!
              let marginDropped = previousMarginDropped

              if (hasMarginBaseline) {
                const deltaFromReferencePoints = netMarginPct! - previousReferenceMarginPct!
                const currentlyDropped = deltaFromReferencePoints <= -marginDropThresholdPct

                if (currentlyDropped) {
                  const result = await ctx.events.createEvent({
                    orgId: ctx.orgId, eventType: 'PRODUCT_MARGIN_DROPPED', subjectType: 'product', subjectId: subject.productId,
                    source: 'internal', severity: 'warning',
                    facts: { channel: subject.channel, referenceMarginPct: previousReferenceMarginPct, currentNetMarginPct: netMarginPct, deltaPoints: deltaFromReferencePoints },
                    // Keyed on the resulting margin, not just "dropped": a
                    // margin that keeps falling while still below the
                    // reference opens a fresh event each time, same
                    // reasoning as every other value-qualified dedupe key
                    // in this codebase since the Milestone 8.5 fix.
                    dedupeKey: `profitability:${subject.productId}:${subject.channel}:margin_dropped:${netMarginPct}`,
                  })
                  if (!result.deduplicated) {
                    eventsCreated++
                    await ctx.store.enqueueJob({
                      orgId: ctx.orgId, jobType: 'product_profitability_recheck',
                      payload: { productId: subject.productId, supplierId: subject.supplierId, channelProductId: subject.channelProductId },
                      idempotencyKey: `event:${result.id}`, correlationId: result.id,
                    })
                  } else eventsDeduplicated++
                  marginDropped = true
                  // referenceMarginPct stays at its previous (pre-drop) value.
                } else if (previousMarginDropped) {
                  const result = await ctx.events.createEvent({
                    orgId: ctx.orgId, eventType: 'PRODUCT_MARGIN_RECOVERED', subjectType: 'product', subjectId: subject.productId,
                    source: 'internal', severity: 'info', facts: { channel: subject.channel, currentNetMarginPct: netMarginPct }, dedupeKey: null,
                  })
                  if (!result.deduplicated) eventsCreated++
                  marginDropped = false
                  referenceMarginPct = netMarginPct! // A fresh healthy baseline to measure the next drop against.
                } else {
                  referenceMarginPct = netMarginPct! // Normal drift: keep the reference current while nothing is wrong.
                }
              }

              if (previousIsProfitable === true && isProfitable === false) {
                // Shape matches `ProductPriceReviewPayload` in
                // `automation/handlers/productHandlers.ts` exactly — not
                // imported here, since monitors never import from
                // `automation/handlers/*` (monitors observe, handlers act;
                // the same one-directional dependency every other monitor
                // in this codebase keeps).
                const payload = {
                  channelProductId: subject.channelProductId,
                  externalId: channelProductFacts.externalId.value ?? '',
                  productTitle: product.title.value ?? subject.productId,
                  currentSellingPriceMinor: priceFact.value,
                  productCostMinor: supplier.unitCost.value.minor,
                  supplierShippingMinor: supplier.shippingCost.value?.minor ?? 0,
                  channelFeePct: profile.channelFeePct,
                  connectorKey: subject.connectorKey,
                }
                const result = await ctx.events.createEvent({
                  orgId: ctx.orgId, eventType: 'PRODUCT_NO_LONGER_PROFITABLE', subjectType: 'product', subjectId: subject.productId,
                  source: 'internal', severity: 'critical',
                  facts: { channel: subject.channel, netMarginPct, netProfitMinor: projection.profitability.netProfit.minor },
                  // The resulting loss, not just "crossed" — a loss that
                  // keeps deepening (-£1 -> -£3) is a fresh fact each time,
                  // same reasoning as every other value-qualified dedupe
                  // key in this codebase since the Milestone 8.5 fix.
                  dedupeKey: `profitability:${subject.productId}:${subject.channel}:unprofitable:${projection.profitability.netProfit.minor}`,
                })
                if (!result.deduplicated) {
                  eventsCreated++
                  await ctx.store.enqueueJob({
                    orgId: ctx.orgId, jobType: 'product_price_review', payload: payload as unknown as Record<string, unknown>,
                    idempotencyKey: `event:${result.id}`, correlationId: result.id,
                  })
                } else eventsDeduplicated++
              } else if (previousIsProfitable === false && isProfitable === true) {
                const result = await ctx.events.createEvent({
                  orgId: ctx.orgId, eventType: 'PRODUCT_BECAME_PROFITABLE', subjectType: 'product', subjectId: subject.productId,
                  source: 'internal', severity: 'info', facts: { channel: subject.channel, netMarginPct }, dedupeKey: null,
                })
                if (!result.deduplicated) eventsCreated++
              }

              await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'product', subject.productId, {
                status: 'ok',
                value: { unitCostMinor: currentCostMinor, netMarginPct, isProfitable, referenceMarginPct, marginDropped },
                lastCheckedAt: ctx.now.toISOString(),
              })
              observationsCreated++
              continue
            }
          }
        }

        // No channel/price context available (or price fact missing) —
        // the unit-cost-only observation still needs writing so the next
        // tick has a baseline, but nothing about margin can be claimed.
        await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'product', subject.productId, {
          status: 'ok', value: { unitCostMinor: currentCostMinor }, lastCheckedAt: ctx.now.toISOString(),
        })
        observationsCreated++
      } catch (error) {
        errors.push(`${subject.productId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
