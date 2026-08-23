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

Before pushing any change:

```bash
npm run check
```

That runs the typechecker, ESLint, the tests and the schema verification. All
four must be clean. Do not relax this.

@AGENTS.md
