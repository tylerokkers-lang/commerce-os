# Database

72 tables across 25 migrations (as of Milestone 11 — unchanged since
Milestone 9), applied in filename order. Every migration is executed
against a real Postgres engine by `npm run db:verify`, so nothing in here
is untested SQL. This file describes the conventions that have held since
Milestone 1; see `docs/MILESTONES.md` for what each later migration
specifically added.

Milestone 10 added **zero migrations**. Every analytics figure
(`src/lib/analytics/`) is computed at read time from tables that already
existed — `orders`/`order_items`/`refunds` (revenue, units, refund/return
rates), `channel_products`/`supplier_products` (per-channel profitability
projections), `suppliers`/`supplier_connectors` (supplier health),
`fulfilments`/`shipments` (fulfilment health), and `domain_events`
(business alerts, via the existing Milestone 8 monitoring status). No
alert, classification, or data-quality finding is persisted anywhere —
each is derived fresh on every read, the same "a real open-event list, not
a stored count" discipline `monitoring/repository.ts` already established
in Milestone 8.5.

Milestone 11 also added **zero migrations** — the CEO Command Centre
(`src/lib/ceo/`) reads nothing from the database directly at all. It
composes Milestone 6/8/10's own repository reads (which already query the
tables above, plus `automation_actions`/`automation_jobs`/`ai_decisions`
for automation health and approvals); the priority queue and business
health scorecard are computed in memory from those results, never
persisted anywhere.

Milestone 8.5's monitoring reads `supplier_products.dispatch_days_min/max`,
`.cancellation_rate_pct`, `.fulfilment_success_rate_pct` and
`supplier_connectors.status`/`.last_success_at` — all added by Milestone 3
(`0013_supplier_connectors.sql`) but unread by any application code until
then.

Milestone 9 added 4 new tables (`exchange_rates`,
`supplier_market_capabilities`, `market_compliance_assessments`,
`market_expansion_assessments`) — see `0024`/`0025` below. It deliberately
did **not** add a table for `MARKET_CATALOG` (the country/marketplace
registry): that is a closed, pure-TypeScript set, not a changing fact, so
it lives in code (`src/lib/markets/catalog.ts`) rather than the database —
only genuinely changing facts got migrations.

## Conventions

**Money.** `BIGINT`, minor units, column name ends in `_minor`. There is a
verification check that fails the build if any money-ish column is ever declared
as a floating point type.

**Tenancy.** Every business table carries `org_id`. The system is built for one
owner-operated business, but RLS needs a tenancy anchor and a second brand or
legal entity should not require a rewrite.

**Idempotency.** Anything that can be retried carries an `idempotency_key` with
a unique constraint: `orders`, `fulfilments`, `invoices`, `credit_notes`,
`refunds`, `supplier_orders`, `inventory_movements`, `automation_runs`. A
retried job cannot place a second supplier order or issue a second invoice.

**Snapshots over joins.** `order_items` stores its own `sku` and `description`;
`invoices` store `seller_snapshot`, `buyer_snapshot` and `lines` as JSON. An
invoice reprinted in three years must read as it did on the day it was issued,
even if the product has since been renamed or removed.

**Versioned scores.** `product_scores`, `supplier_scores` and `product_health`
insert a new row with a `weights_version` rather than updating in place, so any
past decision can be replayed against the inputs that produced it.

## Integrity that is enforced, not just intended

| Rule | How |
|---|---|
| Audit log cannot be rewritten | `before update`/`before delete` triggers raise |
| Inventory movements cannot be rewritten | same triggers |
| Invoices and credit notes cannot be deleted | `before delete` trigger raises; void instead |
| A VAT number requires VAT registration | `check` constraint on `business_settings` |
| A VAT invoice must carry a VAT rate | `check` constraint on `invoices` |
| One order, one invoice | `unique (org_id, order_id)` on `invoices` |
| Available stock cannot drift | derived by function, never stored |
| Every org-scoped table has RLS | asserted by `npm run db:verify` |
| At most one OPEN domain event per dedupe key | partial unique index `domain_events_open_dedupe_idx on (org_id, dedupe_key) where status = 'open' and dedupe_key is not null` — the actual mechanism that stops a supplier outage checked every 15 minutes from becoming dozens of events, not an application-level convention |

## Migrations

| File | Contents |
|---|---|
| `0001_core.sql` | Extensions, organisations, memberships, business settings, config values, audit log |
| `0002_catalogue.sql` | Products, variants, identifiers, research, scores, listing content |
| `0003_suppliers.sql` | Suppliers, per-channel approval, offers, documents, purchase orders |
| `0004_inventory.sql` | Stock and the append-only movement ledger |
| `0005_channels.sql` | Channels, per-channel listings, Amazon and Shopify specifics |
| `0006_orders.sql` | Customers, orders, fulfilments, shipments, payments, refunds |
| `0007_finance.sql` | Invoices, credit notes, expenses, VAT transactions and periods, accounting sync |
| `0008_intelligence.sql` | Compliance, performance, health, advertising, AI decisions, automation, notifications, documents |
| `0009_rls.sql` | Row level security policies |
| `0010`–`0012` | Research providers, RLS, supplier attributes (Milestone 2) |
| `0013`–`0014` | Supplier connectors, price history, RLS (Milestone 3) |
| `0015`–`0016` | Marketplace connectors, discrepancies, RLS (Milestone 4) |
| `0017`–`0018` | Order/fulfilment transition history, RLS (Milestone 5) |
| `0019`–`0020` | `automation_actions`, `automation_jobs`, kill-switch/limit columns, RLS (Milestone 6) |
| `0021_external_action_verification.sql` | `external_ref`/`verification_status`/`reconciliation_status` on `automation_actions` (Milestone 7) |
| `0022_monitoring_events.sql` | `domain_events`, `monitor_observations`, `monitor_runs` (Milestone 8) |
| `0023_rls_monitoring_events.sql` | RLS for the three Milestone 8 tables |
| `0024_global_markets.sql` | `exchange_rates` (append-only), `supplier_market_capabilities`, `market_compliance_assessments`, `market_expansion_assessments` (append-only, `source_payload jsonb`) (Milestone 9) |
| `0025_rls_global_markets.sql` | RLS for the four Milestone 9 tables |

## Access model

- Any member of an org can read that org's data.
- `owner` and `admin` can write.
- `owner` alone can delete, manage membership, and approve level 3 decisions.
- History tables (audit log, inventory movements, AI decisions, automation runs,
  scores, tax transactions, and — since Milestone 8 — `domain_events`,
  `monitor_observations`, `monitor_runs`) are **read-only through RLS**.
  Writes to them go through the service role in server-side code, so a
  viewer can still cause an audit entry without being able to forge one.
- All four Milestone 9 tables are read-only through RLS too: `exchange_rates`
  and `market_expansion_assessments` are append-only history (same
  `forbid_mutation` trigger pattern as the tables above);
  `supplier_market_capabilities` and `market_compliance_assessments` are
  mutable-in-place current-state tables (a `touch_updated_at` trigger,
  matching `supplier_products`/`compliance_records`), but still writable
  only by the service role.
- The service role bypasses RLS entirely, which is exactly why that key must
  never reach the browser.

## Identifiers

`product_identifiers` records a `source` for every GTIN, EAN, UPC and ASIN,
along with free-text `evidence` and a `verified_at` timestamp. The system never
generates an identifier. If a listing needs a GTIN and none exists, the options
are a legitimate exemption (recorded as `gtin_exemption`) or a blocked listing.

## Changing the schema

1. Add a new numbered file in `supabase/migrations/`. Never edit an applied one.
2. `npm run db:verify`
3. `npm run db:types`
4. `npm run check`
