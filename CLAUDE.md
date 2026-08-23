Read `HANDOVER.md` before doing anything else in this repo. It holds current
status, what is verified, and what is deliberately not built yet. Keep it up to
date as things change.

`docs/ARCHITECTURE.md` explains the rules the code follows and why. Read it
before adding a module.

`docs/PRINCIPLES.md` governs every milestone from 3 onward (fact-first
labelling, single source of truth, channel-aware status, compliance before
automation, autonomy with guardrails, full auditability). Read it before
starting any new milestone.

Scheduled automation (Milestone 6) runs through `/api/automation/run`, a
plain HTTP route with no session — an external scheduler (cron, a hosted
worker, a serverless scheduled function) calls it on a timer, authenticated
by `AUTOMATION_CRON_SECRET`. It does not run itself; nothing about the
application depends on Claude Code, or any other coding assistant, staying
open. Automation decisions never bypass compliance, profitability, or the
financial limits in `business_settings` — see `docs/PRINCIPLES.md` §5 and
`src/lib/automation/policyEngine.ts`, the one place those limits are checked.
The orchestration loop (event → job → worker → facts → policy → action →
audit → notification) is proven end to end in
`tests/automation-engine-e2e.test.ts` against `automation/inMemoryStore.ts`,
a real (not mocked) implementation of the same `AutomationStore` interface
`supabaseStore.ts` implements for production — read `HANDOVER.md` §18 before
claiming anything about "the automation engine works" is proven beyond that.

Live facts (`automation/facts.ts`, `factsTypes.ts`) and every marketplace
write (`updateListingPrice`, `updateInventory`, `setListingStatus`,
`verifyListingState` in `marketplaces/connectors/types.ts`) follow the same
define-the-interface-satisfy-it-twice pattern (Milestone 7) — a real
implementation and a real in-memory test double, never a mock. External
writes always go SUBMIT → VERIFY → RECONCILE
(`automation/priceExecution.ts`, `automation/supplierSwitchExecution.ts`):
a write's own "accepted" response is never treated as proof the external
state changed. Read `HANDOVER.md` §19 before claiming any live marketplace
write works — most are `IMPLEMENTED BUT NOT LIVE-VERIFIED` or honestly
`not_supported`, not proven against a real account.

Before pushing any change:

```bash
npm run check
```

That runs the typechecker, ESLint, the tests and the schema verification. All
four must be clean. Do not relax this.

@AGENTS.md
