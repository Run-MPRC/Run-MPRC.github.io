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
- `public/404.html`, `public/index.html`, and `public/spa-navigation.js`: current tested GitHub Pages callback handoff. It preserves safe same-origin path, query, and fragment state.

**Deployment reality checked 2026-07-13:** merges run CI but do not start the manual release workflow. The protected gate accepts one exact current merged commit, rechecks its newest CI run after approval, uses one fixed Firebase target set, fails when protected authority/configuration is missing, verifies Firebase before publishing GitHub Pages, and gives no server credential to website preparation or publication. Git-triggered Netlify production builds are paused. The source stops adding a Pages `CNAME`, but GitHub Pages currently still claims `runmprc.com` and its default URL redirects there; only a controlled #136/WEB-001 publication and provider readback can clear that conflict. Protected publication to the live Netlify-served `runmprc.com` is not configured yet. Treat GitHub Pages, Netlify, `runmprc.com`, Firebase, and outside providers as separate states.

## Local setup status

The #99 local Firebase boundary is available for synthetic source development. It uses a non-addressable `demo-mprc-local` configuration and loopback Auth, Firestore, and Functions emulators. It stops startup when an emulator connection cannot be configured. App Check, Analytics, and Sentry stay off locally.

Node.js 20 lockfile installation remains the baseline for maintainers preparing isolated, non-Firebase checks:

```bash
npm ci --legacy-peer-deps
npm --prefix functions ci
```

Start it in two terminals:

```bash
# Terminal 1
npm run emulators

# Terminal 2 — only after all three emulators report ready
npm start
```

Open only `http://localhost:3000`. Stop if Firebase traffic uses a non-loopback host. Use synthetic records only. This does **not** make checkout, refunds, email, Strava, or other outside-provider calls safe; follow [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md) before any provider test.

Do not use a Netlify preview or locally served optimized `build/` for sign-in, private pages, admin work, or Firebase testing. Those production-mode builds still target production Firebase until #105/CONFIG establishes staging.

## Verification

```bash
npm --prefix functions run lint
npm --prefix functions run test:run -- --runInBand
CI=true npm test -- --watchAll=false --runInBand
npm run test:spa-navigation
npm run test:rules
CI=true DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build
```

Rules tests require Java 17. The direct `react-scripts build` command is useful for a diagnostic compile because the normal `npm run build` runs the sitemap generator and may intentionally update `public/sitemap.xml`. Hosted CI runs the frontend Jest suite under [#124](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/124), the SPA callback suite under [#126](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/126), and the release-gate source tests under [#135](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/135). [#133](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/133) still owns protected environment/OIDC configuration; [#136](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/136) owns the actual staged profile-recovery release. Non-mutating lint, required branch checks, scanning, staging, and hosting consolidation remain open under [#105](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/105) and their atomic children.

These safety changes do not repair a missing member profile or prove deployed Firebase Rules/Functions. The reported profile-save failure remains [#118](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/118).

## Working on the platform

1. Select one ready `S`/`M` issue from [GITHUB_ISSUES.md](./GITHUB_ISSUES.md), or one atomic child from [GITHUB_ISSUE_SLICES.md](./GITHUB_ISSUE_SLICES.md), and confirm its dependencies.
2. Follow [AGENTS.md](./AGENTS.md), including no production credentials/data and preserving unrelated worktree changes.
3. Add positive, negative, retry, and authorization/concurrency tests appropriate to the risk.
4. Use additive/idempotent migrations and backend-first expand-and-contract deployment.
5. Update the affected design/runbook and record residual risk.

Business owners—not coding agents—must approve legal text, waiver/insurance policy, tax, shipping/returns, retention, live credentials, account ownership, DNS, and the live-mode pilot.

## Deployment warning

Pushing to `main` runs CI only. It does not start `.github/workflows/deploy.yml`. The manual workflow is fixed to an exact merged commit and reviewed target set, but it is **NOT AVAILABLE YET** until #133 configures protected environments and short-lived cloud authority. Git-triggered Netlify production builds are paused; a protected live-Netlify publication path is also **NOT AVAILABLE YET**. Production changes still require protected approval, a compatible backend-first rollout, separate live-host proof, a named observer, and the runbook's post-deploy/reconciliation steps.
