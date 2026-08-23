# Milestones

Built in order. A milestone is not finished until it typechecks, lints, passes
its tests and has been exercised in a running application.

## Milestone 1 — Foundation ✅ complete

- [x] Architecture, module layout, documentation
- [x] Database schema: 49 tables, 24 enums, 123 foreign keys, 9 migrations
- [x] Row level security across every org-scoped table
- [x] Append-only audit log with database-level enforcement
- [x] Money, Result and profitability primitives with tests
- [x] Supabase clients (browser, request-scoped server, service role)
- [x] Authentication, session resolution, role guards, `proxy.ts`
- [x] Dashboard shell and thirteen working routes
- [x] Business settings with validation and a real Server Action
- [x] Demo mode: a complete simulated business through the real cost engine
- [x] Integration health reporting
- [x] Schema verification and type generation against a real Postgres engine

**Verified:** 23 unit tests pass; 9 migrations apply cleanly; all 13 routes
return 200 in demo mode with no console errors; `npm run check` is clean.

## Milestone 2 — Product intelligence ✅ complete

- [x] Provider-based research architecture (`src/lib/research/providers/`) with
      a typed interface, a declared descriptor (source type, credentials,
      rate limits, usage policy) and a registry that reports every planned
      provider — Amazon SP-API, Shopify Admin, a licensed trends dataset,
      TikTok Shop Partner API, a supplier feed — as `not_configured` until it
      genuinely has credentials and a written integration
- [x] Simulated research provider with six deliberately awkward candidates:
      a clean winner, a branded IP-risk case, a regulated lithium-battery
      product, a channel-divergent case, and a seasonal loss-maker
- [x] Opportunity lifecycle extended with `rejected` as a distinct terminal
      stage from `removed`, plus a state machine (`lifecycle.ts`) that
      refuses to skip the supplier and compliance gates, and an append-only
      `product_stage_transitions` history table
- [x] Opportunity scoring: 19 components, weights sum to 100, missing
      signals excluded and reweighted rather than defaulted, IP/regulatory
      risk hard-caps the total, confidence tracks both data coverage and
      source quality (simulated data cannot report high confidence)
- [x] Customer complaint analysis (11 themes, pattern-matched against
      sampled reviews) feeding a differentiation engine that proposes
      original, evidenced changes — never competitor text or images
- [x] Channel-aware profitability (`profitability/channels.ts`) that
      assembles Shopify vs Amazon cost assumptions and hands them to the
      *same* `calculateProfitability` engine from Milestone 1 — verified by
      a test that the channel module produces byte-identical output to
      calling the base engine directly
- [x] Compliance rule engine: per-check severity and remediability, so a
      missing certificate (fixable) is distinguished from a blocked category
      or high IP risk (a decision, not a task) — `canEnterLaunchQueue` is a
      hard gate no automation level can override
- [x] IP risk screening: brand authorisation, suspicious vocabulary,
      implausible pricing, restricted-brand list — always advisory, never a
      legal clearance
- [x] Identifier validation (`identifiers.ts`): real GS1 check-digit
      arithmetic verified against published reference barcodes, ISBN-10/13,
      ASIN shape checking — no function anywhere generates an identifier
- [x] Supplier scoring (cost, delivery, reliability, quality, returns,
      tracking, compliance capability) with independent Shopify/Amazon
      capability assessment, full CRUD with a real Server Action, and a
      cost-premium-vs-recommended distinction always shown in the UI
- [x] Dashboard Product Intelligence section, opportunity detail page (full
      profitability breakdown, per-channel compliance, supplier comparison,
      complaints, differentiation, score breakdown), research providers page,
      supplier detail/edit pages

**Verified:** 203 unit/integration tests pass (up from 23); 12 migrations
apply cleanly (54 tables, 29 enums, 139 foreign keys); all 19 routes return
200 in demo mode with no console errors; a supplier form submission was
driven through the browser and the Server Action's real capability
assessment ("Shopify would be review required, Amazon would be blocked")
was confirmed in the response; `npm run check` is clean.

**Known limitations**, stated plainly rather than glossed over:
- No live research provider exists yet. Every non-demo provider in the
  registry reports `not_configured` and refuses to run — this is the
  intended behaviour, not a gap to paper over.
- Opportunities and supplier scores are not yet persisted for a live
  (non-demo) org. `getOpportunities()` and `getSupplierDetail()` correctly
  return empty/null in live mode rather than fabricating data; the
  persistence path (writing `product_research`, `product_scores`,
  `opportunity_projections`, `differentiation_suggestions` rows from a real
  provider run) is Milestone 2's natural extension once a provider exists,
  and is deliberately not built ahead of having real data to write.
- The demo supplier model gives each supplier one flat unit cost across every
  product it supplies, which is a simplification — real supplier catalogues
  price per SKU.
- `changeProductStage` (the Server Action wrapping `planStageChange`) has not
  been exercised against a live Supabase project, only unit-tested and
  demo-mode-tested. The RLS split (history tables written via the service
  role) follows the same pattern as `saveSupplier`, which has been.

## Milestone 3 — Shopify

Products, inventory, orders, fulfilment, webhooks, reconciliation.

## Milestone 4 — Amazon UK

SP-API auth and rate limiting, listings, inventory, pricing, orders, reports,
and the compliance layer as a hard gate ahead of any listing call.

## Milestone 5 — Catalogue automation

Testing protocol, winner and loser engines, automatic replacement, the approval
queue made actionable.

## Milestone 6 — Supplier and fulfilment automation

Order routing, supplier submission with idempotency, tracking, exceptions.

## Milestone 7 — Invoicing

PDF generation, branding, numbering, Resend delivery with retry, credit notes.

## Milestone 8 — Finance

Finance engine, VAT engine, threshold monitoring, Xero sync, accountant export.

## Milestone 9 — AI CEO

Daily report generation, recommendations grounded in system data only, the
question-answering interface.

## Milestone 10 — Production hardening

Security review, integration and automation test suites, monitoring, rate
limiting, performance, deployment.
