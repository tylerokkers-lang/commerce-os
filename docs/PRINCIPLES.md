# Principles

These govern every milestone from here on. They are not aspirational — code
that violates one of these is a defect, regardless of what else it does
correctly. Read this before starting any milestone from 3 onward.

## 1. Fact-first: label every claim

Every figure or statement the system produces belongs to exactly one of five
categories, and the UI and any AI-generated text must make the category
obvious rather than blur it:

| Category | Meaning | Example |
|---|---|---|
| **FACT** | Directly observed or retrieved data | "Order #4021 was placed at 14:32" |
| **CALCULATION** | Deterministic result from recorded inputs | "Net margin: 16.9%" (from `calculateProfitability`) |
| **RULE** | A configured business rule or threshold | "Minimum net margin: 10%" |
| **AI ANALYSIS** | Reasoning over available evidence | "Durability is the leading complaint" |
| **PREDICTION** | An estimate with uncertainty | "Estimated 2,100 units/month" — always with a confidence figure |

Never invent a business figure when the real data can be queried. If data is
missing, stale, or unavailable, say so explicitly rather than filling the gap
with a plausible-looking number — this is the same discipline Milestone 1
established for empty aggregates ("empty is not the same as unknown") and it
now extends to every AI-generated answer.

## 2. Single source of truth

There is exactly one profitability engine (`src/lib/profitability/index.ts`).
Every channel-specific or marketplace-specific module assembles *inputs* for
it — cost assumptions, fee structures, advertising estimates — and never
reimplements margin arithmetic. `src/lib/profitability/channels.ts` is the
reference example: a test proves its output is byte-identical to calling the
base engine directly with the same inputs. Any new connector or marketplace
module follows this pattern or is wrong.

Money is integer minor units, always. No floating-point money storage,
anywhere, ever.

## 3. Channel-aware, never globally approved

A product's status is per marketplace. "Approved for Shopify, blocked for
Amazon, approved for eBay" is a normal and expected result, not an edge case.
Nothing in the system may collapse per-channel status into one global flag.
This is why `compliance_records` and future marketplace eligibility tables are
keyed by `(product_id, channel)`, not by `product_id` alone.

## 4. Compliance before automation, and unknown is not approved

Before any listing or fulfilment action, evaluate marketplace rules, supplier
suitability, category restrictions, documentation, IP risk, and applicable
safety requirements. A verdict is always one of `pass`, `fail`, or
`review_required` — there is no code path that defaults an unassessed product
to approved. Compliance checks are further split by **remediability**:

- **Fatal** (`remediable: false`): a decision already made (a blocked
  category) or a judgement only a person can make (high IP risk). Rejects
  outright.
- **Remediable**: something that can be obtained (a certificate, a GTIN, a
  better supplier). Routes to `review_required` with a named remedy.
- **Unknown/review required**: not yet assessed. Never treated as a pass.

The system never claims to guarantee legal or regulatory compliance. Where
professional advice is required, say so.

## 5. Autonomy with guardrails

Four automation levels apply to every automated capability the system gains:

| Level | Behaviour |
|---|---|
| **Manual** | Recommends only; a human acts |
| **Approval required** | Prepares the action; a human approves before it executes |
| **Guarded automation** | Acts automatically within configured limits |
| **Autonomous** | Acts automatically within explicit rules and safety boundaries |

Financially consequential actions (publishing a product, switching suppliers,
material price changes, advertising increases, entering a new country or
marketplace) default to **approval required** until the owner explicitly
raises the automation level for that action type, and every automated
financial action carries an explicit, configurable limit. There is no code
path for unlimited automated spending.

## 6. Everything important is auditable

Every automated or manual action of consequence is recorded: what happened,
when, the actor (user, system, AI, integration), the triggering event, the
source data, the rules evaluated, calculations where relevant, previous state,
new state, result, and failures. The append-only audit log and inventory
ledger from Milestone 1 (enforced by database triggers, not just application
code) are not to be weakened by any future migration. `product_stage_transitions`
follows the identical pattern and any new history table added for orders,
fulfilment, or automation decisions must too.

## How these interact with existing engines

- `src/lib/profitability/` — implements #2.
- `src/lib/compliance/` — implements #4.
- `src/lib/products/lifecycle.ts` + `product_stage_transitions` — implements #6
  for the product lifecycle specifically.
- `src/lib/core/domain.ts` `ComplianceVerdict`, `ApprovalStatus` types —
  implement #3 and #4's three-state (never two-state) verdict model.
- Business settings' automation limits (`max_auto_purchase_minor`,
  `max_auto_price_change_pct`, `max_daily_ad_spend_minor`, `min_roas`) —
  implement #5's guardrail requirement; every future automated capability
  gets its own such limit in this table rather than a hard-coded constant.
- `src/lib/automation/policyEngine.ts` (Milestone 6) — the single place the
  kill switch, category pauses and financial/percentage limits are checked,
  layered on top of (never duplicating) each domain engine's own decision.
  `automation_actions` is the fact-first record #1 and #6 require for every
  automation decision: the facts used, the policy evaluated, and the result.
- `src/lib/automation/store.ts`'s `AutomationStore` interface (Milestone 6
  verification pass) — the pattern for testing any code that would
  otherwise require a live external service: define the interface the real
  implementation (`supabaseStore.ts`) satisfies, then satisfy it a second
  time with a real (not mocked) in-memory implementation
  (`inMemoryStore.ts`) that a test can drive through the actual
  orchestration entry points. This is what let
  `tests/automation-engine-e2e.test.ts` prove the job queue and business
  decision modules work correctly *together* without a live Supabase
  project, catching two real bugs that unit-testing the pieces in isolation
  had missed. Any future milestone that needs to prove an end-to-end flow
  against something this environment cannot stand up for real (a live
  payment provider, a real marketplace API) should follow the same pattern
  rather than mocking function calls directly.
- The runaway-automation safeguard (`RUNAWAY_MAX_ACTIONS_PER_WINDOW` in
  `store.ts`) — a hard backstop inside `createAutomationAction` itself,
  independent of any domain engine's verdict, implementing #5's "autonomy
  with guardrails" against the specific failure mode of a rule that keeps
  re-triggering itself. It cannot be bypassed by any automation level,
  including autonomous.
