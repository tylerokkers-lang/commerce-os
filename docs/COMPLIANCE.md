# Compliance boundaries

This system automates operations. It does not automate its way around rules,
and several of its behaviours exist specifically to make that impossible.

## Marketplace policy

**Compliance is a hard gate.** A product cannot be listed on a channel until it
has a `compliance_records` row for that channel with a `pass` verdict.
Automation cannot override a block. Only a person with the owner role can
review a `review_required` verdict, and that review is audited.

**Verdicts, not guarantees.** The system reports `pass`, `fail`,
`review_required` or `not_assessed` with the evidence behind each individual
check. It never states that a product is guaranteed compliant. Marketplace
policies change; `ruleset_version` records which version of the rules produced a
verdict so stale assessments can be found and redone.

**Amazon dropshipping.** A supplier is assessed per channel and starts as
`not_assessed`, which blocks. To reach `approved` for Amazon it must be able to:
ship without third-party retailer branding, issue documentation identifying us
as the seller of record, provide tracking, accept responsibility for returns,
and meet the delivery expectation. A supplier that fails any of these can still
be approved for Shopify. This is why `suppliers` has separate `shopify_status`
and `amazon_status` columns rather than one status.

**AliExpress specifically.** Treated as a supplier source like any other, with
no assumption of Amazon compatibility. Most listings will fail the seller of
record and delivery time checks. The demo dataset includes exactly this case so
the behaviour is visible before it matters.

**Identifiers are never invented.** See `docs/DATABASE.md`.

## Data sourcing

Research uses official APIs, licensed datasets and permitted public data. The
`research_source` enum names the source of every candidate and
`source_reference` records the specific row or record, so any figure can be
traced. There is no scraping of sites that prohibit it, no bypassing of
authentication, rate limits, robots directives or access controls.

## Intellectual property

Generated listing content is original. Competitor copy, photography, logos and
branding are not reproduced. Products with meaningful trademark, copyright,
patent or counterfeit uncertainty resolve to `review_required`, never to an
automatic pass.

## Tax

**VAT is contextual.** `tax_transactions` records the treatment alongside the
customer country, supplier country, ship-from, ship-to, channel and
jurisdiction that determined it. There is no assumption that a sale is standard
rate UK VAT. Transactions the rules cannot resolve confidently are flagged
`needs_review` rather than guessed.

**Thresholds are configuration.** The VAT registration threshold lives in
`config_values` with an `effective_from` date. The constant in
`src/lib/constants.ts` is only the seed value for a new business.

**A VAT invoice requires VAT registration.** Enforced by a check constraint, not
only by application code.

**This is not an accounting system.** Xero remains the formal record. This layer
feeds it and shows what needs attention.

## What stays with the owner

Business decisions, tax filings, VAT registration, legal compliance,
marketplace account ownership, supplier contracts and every financial approval.
The software makes these easier to see and harder to get wrong. It does not
assume them, and it never claims that automation guarantees profit.
