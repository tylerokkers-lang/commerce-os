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

## Milestone 2 — Product intelligence

- Research engine against permitted sources
- Opportunity scoring, configurable weights, versioned
- Complaint analysis and differentiation suggestions
- Supplier database CRUD and scoring
- Profitability gate wired into the product lifecycle

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
