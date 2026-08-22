# Database

49 tables across nine migrations, applied in filename order. Every migration is
executed against a real Postgres engine by `npm run db:verify`, so nothing in
here is untested SQL.

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

## Access model

- Any member of an org can read that org's data.
- `owner` and `admin` can write.
- `owner` alone can delete, manage membership, and approve level 3 decisions.
- History tables (audit log, inventory movements, AI decisions, automation runs,
  scores, tax transactions) are **read-only through RLS**. Writes to them go
  through the service role in server-side code, so a viewer can still cause an
  audit entry without being able to forge one.
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
