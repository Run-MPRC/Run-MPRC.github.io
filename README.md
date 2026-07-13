# Mid-Peninsula Running Club Platform

The MPRC platform is a React single-page application backed by Firebase Authentication, Cloud Firestore, and Firebase Cloud Functions. It publishes club content and events and contains an in-progress platform for member accounts, race registration, Stripe-hosted payments, merchandise orders, administration, and Strava connections.

- Production informational site: [runmprc.com](https://runmprc.com)
- Repository: [Run-MPRC/Run-MPRC.github.io](https://github.com/Run-MPRC/Run-MPRC.github.io)

> **Commerce status:** the repository contains a substantial Stripe/race/shop prototype, but live payments are not production-ready. Do not configure or enable live Stripe keys until the P0 gates in [STRIPE_COMMERCE_DESIGN.md](./STRIPE_COMMERCE_DESIGN.md) and [SECURITY.md](./SECURITY.md) are closed and a controlled pilot is approved.

## Choose your starting point

| You are… | Start here |
| --- | --- |
| A club officer or backup maintainer | [OFFICER_START_HERE.md](./OFFICER_START_HERE.md) — no coding required |
| An AI agent working a claimed issue | [AGENTS.md](./AGENTS.md) — safety, ownership, documentation, and proof rules |
| A developer | Continue with the technical documents below |

## Technical documents

| Document | Purpose |
| --- | --- |
| [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md) | Current and target architecture, boundaries, data model, invariants, workflows, and decisions |
| [STRIPE_COMMERCE_DESIGN.md](./STRIPE_COMMERCE_DESIGN.md) | Stripe configuration, checkout saga, webhooks, capacity, inventory, refunds, and launch checklist |
| [SECURITY.md](./SECURITY.md) | Dated risk register, threat model, required controls, privacy, secure delivery, and incident response |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | Dependency graph, phases, gates, first implementation tranche, and definition of done |
| [GITHUB_ISSUES.md](./GITHUB_ISSUES.md) | Ordered system-level trackers and directly assignable small/medium issues |
| [GITHUB_ISSUE_SLICES.md](./GITHUB_ISSUE_SLICES.md) | Atomic one-agent child tickets for every large tracker, with dependencies and required proof |
| [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md) | Environments, secrets, testing, deployment, launch, reconciliation, refunds, incidents, and restore |
| [AGENTS.md](./AGENTS.md) | Repository-specific safety and execution instructions for coding agents |
| [OFFICER_START_HERE.md](./OFFICER_START_HERE.md) | Plain-language change, approval, live-verification, access, and emergency guides |
| [OFFICER_HANDBOOK.md](./OFFICER_HANDBOOK.md) | Concise officer decision guide and index to the short step-by-step procedures |

Historical developer/content/LLM guides remain under [`docs/`](./docs/README.md). They predate portions of the commerce implementation; use the root documents above for target architecture and launch decisions.

## System at a glance

- `src/`: React 18 UI, routes, services, Firebase client, account/admin/event/shop experiences.
- `functions/`: Node.js 20 Firebase Functions for identity, checkout, Stripe webhooks, admin commands, exports, email, rate limiting, and Strava.
- `firestore.rules` and `firestore.indexes.json`: browser data boundary and query indexes.
- `tests/firestore-rules/`: emulator-based allow/deny coverage.
- `.github/workflows/`: frontend, Functions, Rules CI and deployment automation.
- `public/404.html`: current GitHub Pages SPA fallback. The safer shared callback helper and its tests are **NOT AVAILABLE YET** and belong to #99.

**Deployment reality checked 2026-07-12:** the repository publishes a GitHub Pages copy, while `runmprc.com` is currently served by a separate Netlify deployment. The Firebase workflow can remain green while skipping backend deployment when its service-account secret is absent. Treat website, Firebase, and provider deployment as separate states until CI-001 and hosting consolidation are complete.

## Local setup status

**Firebase-backed local development is NOT AVAILABLE YET on `main`.** Issue [#99](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/99) owns the missing demo-project emulator script, Auth/Firestore/Functions wiring, and fail-closed startup. Until #99 merges, `npm start` can use production Firebase configuration; do not use it for account, admin, member, event, shop, payment, or private-data testing.

Node.js 20 lockfile installation remains the baseline for maintainers preparing isolated, non-Firebase checks:

```bash
npm ci --legacy-peer-deps
npm --prefix functions ci
```

After #99 merges, the runbook and this section must be updated from its merged tests rather than from the pre-merge working tree.

## Verification

```bash
npm --prefix functions run lint
npm --prefix functions run test:run -- --runInBand
CI=true npm test -- --watchAll=false --runInBand
npm run test:rules
CI=true DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build
```

Rules tests require Java 17. The direct `react-scripts build` command is useful for a diagnostic compile because the normal `npm run build` runs the sitemap generator and may intentionally update `public/sitemap.xml`. The SPA navigation command remains queued under #99. The frontend Jest command now provides a deterministic local baseline, but current CI does not run it as a required gate; [#105](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/105) owns that remaining workflow work.

## Working on the platform

1. Select one ready `S`/`M` issue from [GITHUB_ISSUES.md](./GITHUB_ISSUES.md), or one atomic child from [GITHUB_ISSUE_SLICES.md](./GITHUB_ISSUE_SLICES.md), and confirm its dependencies.
2. Follow [AGENTS.md](./AGENTS.md), including no production credentials/data and preserving unrelated worktree changes.
3. Add positive, negative, retry, and authorization/concurrency tests appropriate to the risk.
4. Use additive/idempotent migrations and backend-first expand-and-contract deployment.
5. Update the affected design/runbook and record residual risk.

Business owners—not coding agents—must approve legal text, waiver/insurance policy, tax, shipping/returns, retention, live credentials, account ownership, DNS, and the live-mode pilot.

## Deployment warning

Pushing to `main` currently triggers GitHub Pages deployment and may deploy Firebase resources when configured. The existing workflow is itself scheduled for hardening in CI-001; do not assume a merge is a safe commerce release. Production changes require protected approval, passing checks, compatible backend-first rollout, a named observer, and the runbook's post-deploy/reconciliation steps.
