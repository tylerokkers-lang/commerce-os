Read `HANDOVER.md` before doing anything else in this repo. It holds current
status, what is verified, and what is deliberately not built yet. Keep it up to
date as things change.

`docs/ARCHITECTURE.md` explains the rules the code follows and why. Read it
before adding a module.

Before pushing any change:

```bash
npm run check
```

That runs the typechecker, ESLint, the tests and the schema verification. All
four must be clean. Do not relax this.

@AGENTS.md
