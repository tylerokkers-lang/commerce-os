# Architecture

## The shape of the thing

Shopify and Amazon are sales channels. Neither is the system. The system is a
central application that owns the products, suppliers, stock, orders, money and
decisions, and pushes to or pulls from each channel independently.

```
                         COMMERCE OS
                              |
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   PRODUCT AI            FINANCE AI           COMPLIANCE AI
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                      CENTRAL DATABASE  ← source of truth
                              │
                ┌─────────────┴─────────────┐
                │                           │
             SHOPIFY                    AMAZON UK
                │                           │
                └─────────────┬─────────────┘
                              │
                       ORDER ENGINE
                              │
                   SUPPLIER / FULFILMENT
                              │
                          CUSTOMER
```

The consequence that matters most: **a product has an independent status on
every channel**. Live on Shopify and blocked on Amazon is a normal state, not an
error, and the interface never collapses the two into one status.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server Components keep credentials and business logic server-side by default |
| Language | TypeScript, strict | Money and compliance rules are not places for `any` |
| Database | Supabase Postgres | Relational integrity, row level security, and auth in one place |
| Auth | Supabase Auth | Sessions refreshed in `proxy.ts` |
| Storage | Supabase Storage | Invoices, compliance documents, brand assets |
| Styling | Tailwind CSS v4 | CSS-first tokens in `globals.css` |
| Tests | Vitest | Fast enough to run on every change |
| Schema checks | PGlite | Runs the real migrations against a real Postgres engine in memory |

Note this is Next.js **16**: `middleware.ts` is deprecated in favour of
`proxy.ts`, and `cookies()`, `headers()`, `params` and `searchParams` are all
async. Read `node_modules/next/dist/docs/` before writing framework code.

## Module layout

```
src/lib/
  core/          money, Result, env, domain view models
  supabase/      generated types and the three clients
  security/      session, roles, action guards
  audit/         append-only action log
  profitability/ the cost model everything else defers to
  demo/          the simulated business
  products/      catalogue reads and settings validation
  suppliers/     supplier reads
  compliance/    per-channel gate reads
  tax/           VAT and finance reads
  analytics/     reporting aggregates
  automation/    approvals, rules, scheduled runs
  notifications/ alerting
  integrations/  connection health
  amazon/ shopify/ orders/ inventory/ fulfilment/ pricing/
  invoices/ accounting/ research/ ai/
```

The empty directories are deliberate: they are the seams the later milestones
fill, and having them named now stops integration code from being written into
whatever file happens to be open.

## Rules the code follows

**Money is integer minor units.** Every monetary column ends in `_minor` and
holds pence. `src/lib/core/money.ts` is the only place arithmetic happens.
Floating point is never used for money: `0.1 + 0.2 !== 0.3` is a curiosity in
most software and a mis-stated VAT return here.

**Nothing is profitable because it sold.** `calculateProfitability` strips VAT
first, then subtracts product cost, inbound shipping, fulfilment, packaging,
channel fees, payment fees, a weighted returns allowance, a refunds allowance
and advertising. `assessProfitabilityGate` returns reasons, not a boolean, so a
blocked product can always explain itself.

**Demo mode is a first-class mode, and it is the default.** With no environment
variables the system runs a complete simulated business through the real
profitability engine. Live mode requires Supabase to be configured *and*
`COMMERCE_OS_MODE=live` to be set explicitly. Nothing can reach a real
marketplace by accident.

**Empty is not the same as unknown.** A live business with no orders shows
zeros, not demo figures. Aggregates that are not yet implemented return honest
empties rather than plausible numbers.

**Every consequential action is audited.** `audit_logs` is append-only at the
database level; UPDATE and DELETE raise an exception. `recordAudit` never
throws, so a logging failure cannot roll back a business action that succeeded,
but it does report to stderr.

**Server Actions guard themselves.** They are reachable by direct POST, not only
through the UI, so each one calls `requireWriteAccess()` rather than trusting
that a page rendered.

**Secrets never reach the browser.** Server-only modules import `server-only`.
The service role key bypasses RLS and is used solely by trusted server-side
automation.

## Data access

Every read goes through a repository that branches on `session.isDemo` and
returns the same view model either way, so no component knows which mode it is
in. The view models live in `src/lib/core/domain.ts`.

```
page.tsx  →  lib/<domain>/repository.ts  →  demo dataset  or  Supabase
```

## Generated types

`src/lib/supabase/database.types.ts` is generated from the migrations
themselves: they are applied to PGlite and the catalogue is introspected,
including foreign keys so nested selects type correctly. Run `npm run db:types`
after any migration change. Once a real Supabase project exists,
`supabase gen types typescript` against it is equivalent.
