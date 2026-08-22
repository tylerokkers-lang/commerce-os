# Commerce OS

An ecommerce operating system for a Shopify store and an Amazon UK seller
account, run as one business with two independent sales channels.

It is not a storefront. It is the layer above the storefronts: research,
sourcing, compliance, pricing, fulfilment, invoicing, VAT and cashflow, with
automation that has to ask before it spends your money.

## Running it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No credentials, no database and no setup are
needed. The system starts in **demo mode** with a complete simulated business,
and every screen is labelled as simulated.

## Checks

```bash
npm run check
```

Runs the TypeScript compiler, ESLint, the unit tests, and the schema
verification, which applies every migration to a real Postgres engine in memory
and asserts the guarantees the application relies on.

## Going live

1. Create a Supabase project and apply `supabase/migrations/*.sql` in order.
2. Copy `.env.example` to `.env.local` and fill in the Supabase values.
3. Set `COMMERCE_OS_MODE=live`.
4. Add other integrations as you obtain them. Each one activates on its own;
   the Integrations page shows exactly what is and is not connected.

An integration is never reported as connected unless its credentials are
genuinely present.

## Documentation

| File | What it covers |
|---|---|
| `docs/ARCHITECTURE.md` | How the system is put together and why |
| `docs/DATABASE.md` | Schema, conventions and integrity rules |
| `docs/COMPLIANCE.md` | Marketplace, tax and legal boundaries |
| `docs/MILESTONES.md` | Build plan and current progress |
| `HANDOVER.md` | Current state, for whoever picks this up next |
