# GitHub Issue Backlog: Secure Commerce Program

**Prepared:** 2026-07-12
**Status:** Dated design/assessment catalog; GitHub is canonical for execution
**Execution model:** One focused issue per branch/pull request
**Intended implementers:** Claude Sonnet, Terra/Luna, Codex, or a human engineer working under `AGENTS.md`

GitHub publication began on 2026-07-12. Use the [Secure Commerce & Platform Hardening milestone](https://github.com/Run-MPRC/Run-MPRC.github.io/milestone/2) and each issue's current labels, dependencies, assignment, and comments as the live status source. This file preserves the broader system design and proposed issue bodies; its tables are an assessment snapshot, not an instruction to create duplicates.

Published foundation mapping:

- SAFETY-001 → [#99](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/99)
- SEC-001 → [#100](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/100)
- PAY-003A → [#101](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/101)
- PROMO-001 → [#102](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/102)
- CI-001A → [#103](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/103)
- CI-001B1 → [#124](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/124)
- SUPPLY-001A → [#127](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/127)
- SUPPLY-001B → [#192](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/192)
- SUPPLY-001C → [#202](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/202)
- ARCH-001 documentation → [#104](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/104)
- CI-001 tracker → [#105](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/105)
- PAY-003 tracker → [#106](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/106)

Before creating or claiming anything from this catalog, search GitHub, confirm the predecessor is merged, then follow the timestamped claim protocol in the live issue.

## Backlog conventions

### Labels

- Priority: `priority:P0`, `priority:P1`, `priority:P2`
- Type: `type:security`, `type:feature`, `type:reliability`, `type:compliance`, `type:operations`, `type:testing`, `type:maintenance`
- Area: `area:firebase`, `area:stripe`, `area:auth`, `area:race`, `area:shop`, `area:privacy`, `area:ci`, `area:web`
- Size: `size:S`, `size:M`, `size:L`
- Workflow: `status:ready`, `status:blocked-owner`, `needs-migration`, `needs-external-config`

### Status

- `proposed`: designed but dependency or owner decision remains.
- `ready`: dependencies and decisions are sufficient for implementation.
- `in_progress`: an isolated implementation is underway in the working tree.
- `implemented_locally`: the scoped code and local evidence exist, but review/merge/deploy evidence is still required.
- `partial_implemented_locally`: a risk-reducing slice exists, but the issue's full acceptance criteria are intentionally still open.
- `blocked_owner_decision`: legal/business/external authority is required.
- `done`: definition-of-done evidence is complete, not merely code written.

### Shared requirements

Every issue inherits `AGENTS.md` and the definition of done in `IMPLEMENTATION_PLAN.md`. In particular: no production access or real PII, preserve unrelated changes, add negative/security tests, use additive/idempotent migrations, review logs for PII/secrets, and update the affected root documentation.

## Ordered index

| Order | ID | Title | Priority | Size | Status | Depends on |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | SAFETY-001 | Preserve commerce/OAuth callbacks and isolate local Firebase Functions | P0 | S | source/test complete under #99; provider/live callback unproven | — |
| 2 | CI-001 | Repair test gates and secure the deployment pipeline | P0 | L | partial: #103 baseline + #124 hosted Jest; #126 SPA gate and remaining gates open | SAFETY-001 |
| 3 | SUPPLY-001 | Remove vulnerable dependency chains and stage SDK/build upgrades | P0 | L | partial: A/#127 and B/#192 delivered; C source/tests tracked by #202; D–G open | CI-001 baseline |
| 4 | SEC-001 | Replace the Firestore admin catch-all with resource-specific rules | P0 | M | source merged #123; Firebase live unproven | — |
| 5 | CONFIG-001 | Fail closed on server environment and commerce configuration | P0 | M | CONFIG-001A merged in #149/PR #150; CONFIG-001B1 tracked in [#151](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/151); B2 blocked; not deployed | CI-001A recommended |
| 6 | AUTH-001 | Require verified email for member and privileged claims | P0 | M | partial: #98/#196 merged; Functions guard tracked in #209; Firebase live unproven; parent open | SEC-001 recommended |
| 7 | AUTH-002 | Replace the legacy static-key membership synchronization endpoint | P0 | M | waiting on remaining AUTH-001 | AUTH-001 |
| 8 | OAUTH-001 | Make Strava token lifecycle server-only, transactional, and auditable | P0 | M | represented by live [#88](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/88); proposed/unclaimed | SAFETY-001/#99; SEC-001 and AUTH-003 for A; staged deferral/cutover with ABUSE-001A for C |
| 9 | AUTH-003 | Introduce scoped admin capabilities, MFA, and recent authentication | P1 | L | proposed | AUTH-001, AUTH-002, SEC-001 |
| 10 | ABUSE-001 | Enforce native App Check and privacy-preserving abuse limits | P0 | L | partial: Enterprise browser source/tests tracked in [#159](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/159); provider config, native enforcement, rate limits, and live proof open | CI-001 baseline |
| 11 | PAY-001 | Add strict request schemas and immutable monetary snapshots | P0 | L | partial: PAY-001A complete in [#157](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/157); race request/event-field adoption tracked in PAY-001B1 [#219](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/219); snapshots and remaining B/C/D work open | ABUSE-001 interface agreed |
| 12 | PROMO-001 | Disable unmodeled Stripe promotions until discounts are authoritative | P0 | S | source/tests complete under open GitHub issue #102; provider inventory and deployment remain owner action | PAY-001 for any future discount contract |
| 13 | PAY-002 | Implement idempotent payment commands and explicit state machines | P0 | L | partial: PAY-002A1 pure state source/tests tracked in [#161](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/161); PAY-002B1 pure command identity tracked in [#163](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/163); registered-only journal pair tracked in PAY-002B2A [#165](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/165); PAY-002B2B lease/fence source/tests tracked in [#169](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/169); PAY-002B2C1 immutable initial plan tracked in [#173](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/173); PAY-002B2C2 pre-send evidence/cutoff tracked in [#182](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/182); PAY-002B2C3A pure closed reconciliation decision tracked in [#184](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/184); PAY-002B2C3B immutable candidate persistence tracked in [#206](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/206); PAY-002B2C3C fresh-lease later-attempt authorization tracked in [#226](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/226); PAY-002B2C4A immutable authorized attempt-2 plan tracked in [#232](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/232); PAY-002B2C4B attempt-2 pre-send evidence tracked in [#238](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/238); PAY-002B2C4C1 pure unbound result-evidence policy tracked in [#246](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/246); PAY-002B2C4C2A test-only Stripe SDK response observations tracked in [#275](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/275); PAY-002B2C4C2B1 unused server-only allowlist projection tracked in [#280](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/280); PAY-002B2C4C2B2A unused transport-consistency classifier tracked in [#285](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/285); remaining C4C2B2 controller/URL/business/time/persistence binding, result reconciliation/runtime/migration/sagas open | CONFIG-001, PAY-001 |
| 14 | PAY-003 | Build idempotent, async-aware Stripe webhook ingestion | P0 | L | PAY-003A source merged in #101; PAY-003B/C remain open; not deployed | CONFIG-001, PAY-001/PAY-002 target contract |
| 15 | RACE-001 | Add transactional race-capacity reservations | P0 | L | proposed | PAY-002, PAY-003 event contract |
| 16 | MERCH-001 | Add SKU variants and transactional inventory reservations | P0 | L | proposed | PAY-002, PAY-003 event contract |
| 17 | PAY-004 | Make cancellation authoritative and replace reusable late Payment Links | P0 | L | proposed | PAY-002, PAY-003, RACE-001 |
| 18 | PAY-005 | Build idempotent refunds, disputes, and reconciliation | P0 | L | partial: immediate amount/result containment tracked by #200/#204; complete lifecycle proposed | PAY-002, PAY-003 |
| 19 | MAIL-001 | Build an escaped, idempotent transactional email outbox | P1 | M | proposed | PAY-003 |
| 20 | DATA-001 | Replace confirmation bearer URLs and implement PII minimization | P1 | L | proposed | PAY-002, PAY-003 |
| 21 | DATA-002 | Create immutable, truthful waiver evidence | P1 | M | blocked_owner_decision | RACE-001, LEGAL-001 decision |
| 22 | ADMIN-001 | Move sensitive admin operations behind scoped APIs and durable audit | P1 | L | proposed | SEC-001, AUTH-003, PAY-002 |
| 23 | MERCH-002 | Configure shipping, tax, returns, and order communications | P1 | L | blocked_owner_decision | MERCH-001, LEGAL-001 |
| 24 | WEB-001 | Move to controlled hosting and add browser security policy | P1 | L | proposed | SAFETY-001, CI-001 |
| 25 | OBS-001 | Add payment observability, alerts, SLOs, and redaction | P1 | M | proposed | PAY-003, PAY-005 |
| 26 | RESILIENCE-001 | Establish backup, restore, retention, and audited repair | P1 | L | proposed | DATA-001, PAY-005 |
| 27 | TEST-001 | Build the Stripe/Firebase security integration and E2E suite | P0 | L | in progress through #177; most children proposed | core security/payment/data children |
| 28 | LEGAL-001 | Approve legal, tax, insurance, privacy, refund, and fulfillment policy | P0 | M | blocked_owner_decision | — |
| 29 | OPS-001 | Configure production systems and run a controlled live pilot | P0 | L | blocked by all launch gates | CI-001, TEST-001, LEGAL-001, OBS-001, RESILIENCE-001 |

---

## SAFETY-001 — Preserve commerce/OAuth callbacks and isolate local Firebase Functions

**Labels:** `priority:P0`, `type:security`, `type:reliability`, `area:web`, `area:firebase`, `size:S`
**Status:** Source/test outcome delivered under [#99](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/99); provider configuration and production callback behavior remain unproven
**Depends on:** None

### Problem

GitHub Pages routes unknown SPA paths through `public/404.html`. The original bridge stored only `window.location.pathname`, dropping Stripe success/cancel query parameters, receipt capabilities, and Strava OAuth `code/state`. Separately, the Firebase client connected Auth and Firestore to local emulators but left Functions pointed at the deployed project.

### Scope

- Preserve same-origin pathname, search, and hash through the GitHub Pages root redirect.
- Clear temporary redirect state before restoration and reject malformed, protocol-relative, or cross-origin targets.
- Send only the site origin as the referrer when either Pages document loads a subresource.
- Use a fully synthetic Firebase configuration in development/test.
- Connect shared Auth, Firestore, and Functions clients to their loopback emulators and stop startup if connector setup fails.
- Route the existing direct CSV Function URL through the same local/production resolver.
- Keep App Check, Analytics, and Sentry off locally; do not initialize App Check, Analytics, or Sentry on an initial capability callback URL.
- Add focused callback, environment, failure, direct-URL, and monitoring tests.

### Acceptance criteria

- [x] `/register/success?session_id=cs_test_x&reg=r1#done` restores exactly after the 404 bridge.
- [x] `/account/strava/callback?code=x&state=y` restores query parameters.
- [x] Cross-origin and protocol-relative stored targets are discarded.
- [x] Both Pages documents apply `strict-origin` before their first subresource.
- [x] Auth, Firestore, and Functions all connect to emulators in development.
- [x] Development/test Firebase configuration contains no production project identifiers.
- [x] App Check, Analytics, and Sentry do not initialize locally, even when public config is present.
- [x] App Check, Analytics, and Sentry do not initialize on an initial capability callback carrying query or fragment state.
- [x] Every Auth/Firestore/Functions connector failure stops local startup.
- [x] The direct CSV export resolves to the local Functions emulator outside production.
- [x] None connects to an emulator in a production build.
- [x] Production build contains the bridge and passes without changing unrelated sitemap content.
- [x] A demo-only CLI smoke reports Auth, Firestore, and Functions ready on the documented loopback ports.

### Verification

- Node 20: 10/10 standalone SPA navigation/referrer-policy tests.
- Node 20: 31/31 focused Firebase/monitoring tests and 4 frontend suites / 47 tests.
- Node 20: Functions lint and 17/17 Functions tests.
- Java 17 + Firebase CLI: demo-only Auth/Firestore/Functions readiness and loopback-port smoke.
- Diagnostic production compile invoked without the sitemap-generating prebuild.
- No production callback, account, data, provider call, Firebase deployment, or profile repair was tested.

### Agent handoff

Do not redesign routing or hosting in this issue; WEB-001 owns that. Optimized previews still target production Firebase, so private preview behavior remains blocked on #105/CONFIG. Firebase emulators do not make Stripe, Strava, or email safe. ABUSE-001A must explicitly defer App Check enforcement on `lookupRegistration`, `lookupOrder`, and `stravaExchangeCode` while the initial capability guard is active. DATA-001A owns the two payment-confirmation handoffs; OAUTH-001C within live [#88](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/88) owns the Strava exchange handoff. Do not weaken the guard. Do not include any real callback token in fixtures. #118 still owns the reported profile failure.

---

## CI-001 — Repair test gates and secure the deployment pipeline

**Labels:** `priority:P0`, `type:security`, `type:testing`, `area:ci`, `size:L`, `needs-external-config`
**Status:** Published as tracker [#105](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/105). [#103](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/103), [#124](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/124), and [#126](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/126) provide the local/hosted frontend and SPA baselines. CI-001B3 [#167](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/167) owns the dedicated hosted command-journal Firestore transaction gate. CI-001B4 [#186](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/186) merged through [PR #189](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/189) as exact main `bec7d5e365eacb418563a172029f241f660d9768`; exact PR run `29291402007` and post-merge run `29291515653` passed. CI-001B4A [#227](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/227) and CI-001B4B [#239](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/239) are focused reductions of that exact lint ledger; together they leave the gate at 106 files, 123 configured errors, and 7 warnings. [#135](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/135) owns the manual exact-commit, backend-first source gate and Git-triggered Netlify production containment. [#133](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/133) owns protected OIDC/environment configuration, and [#136](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/136) owns the actual profile-recovery release. Branch-required-check configuration, scanning, staging/live evidence, remaining lint-debt cleanup, and protected Netlify publication remain open, so the pipeline is still non-compliant overall.
**Depends on:** SAFETY-001

### Problem

Before #103, frontend tests failed because the Jest environment lacked `TextEncoder`. That child repaired the local baseline, and #124 adds it to hosted CI. #167 adds a separate named Node 20/Java 17 job for the PAY-002B2A Firestore transaction suite and makes both protected-release CI reads require it. The job uses one explicit demo project, Firestore only, committed lockfiles, and no cloud/provider authority. CI-001B4/#186 replaces the mutating, ignored `lint:fix` step with a blocking exact-record check that initially covered 102 JS/JSX/TS/TSX files. The same gate now scans 106 files. It disables the repository-wide severity-masking `eslint-plugin-only-warn` hook inside the lint process. CI-001B4A/#227 removes exactly one reviewed `arrow-body-style` record without changing the rule or gate. CI-001B4B/#239 removes exactly one stale `AdminMembers` unknown-rule suppression record without changing executable statements, the rule set, or the gate, leaving 123 configured errors and 7 warnings as reviewable individual records. Any added, removed, moved, or changed record and every fatal parser/configuration failure rejects with one fixed diagnostic. The checker runs directly before application tests in an exact prefix that pins the hosted runner, read-only permission, credential-free checkout, Node version, lifecycle-disabled install, lint, and adjacent clean check. Global overrides and prefix changes reject. The clean check compares tracked files with `HEAD` plus non-ignored untracked files; ignored dependency/build paths are outside that proof. This is an explicit debt baseline, not a clean-lint claim. #135 removes the automatic/fail-open release source defects: merge and release are separate, exact CI checks are re-read, release targets are fixed, OIDC replaces JSON-key wiring, lockfile tooling is used, backend precedes Pages, and Git-triggered Netlify production builds stop. The protected identity/environments and actual staged/live release remain outside that source slice.

### Scope

- Repair Jest/browser polyfills without weakening application code or globally mocking business services.
- Add a non-mutating lint command covering JS/JSX/TS/TSX; make warnings/failures meaningful.
- Require frontend tests/build, Functions lint/tests, Rules emulator tests, dependency/secret checks before deploy.
- Remove Firebase service-account material from frontend build environment.
- Make production deployment protected, explicit, and fail closed when required credentials/config are absent.
- Use short-lived GitHub OIDC/Workload Identity Federation with a least-privilege deploy identity if supported; otherwise document a time-bounded interim credential and rotation.
- Pin/review Actions and Firebase CLI versions.
- Deploy additive backend/rules/indexes before dependent frontend.

### Out of scope

- Full CRA-to-Vite migration (SUPPLY-001).
- Live Stripe secret/configuration (OPS-001).

### Acceptance criteria

- [ ] `CI=true npm test -- --watchAll=false --runInBand` passes locally and in CI.
- [x] CI-001B4/#186 provides non-mutating, exact-record frontend lint; PR run `29291402007` passed on source `0bb164904fb6a8352c6141fc44ff7cd30425e750`, and post-merge run `29291515653` passed on exact main `bec7d5e365eacb418563a172029f241f660d9768`. Branch-required-check settings remain separate.
- [ ] Rules tests run with Java 17 and include deny assertions from SEC-001.
- [ ] Deployment job cannot begin until the exact commit's required checks pass.
- [ ] Frontend build receives no service-account JSON or Stripe server secret.
- [ ] Missing production deployment authority fails the job visibly.
- [ ] GitHub production environment requires designated approval.
- [ ] Deployment order and rollback/roll-forward behavior are documented/tested in staging.

### Tests/evidence

- CI run on a pull request and protected main simulation.
- Negative job/config test showing absent credentials/config do not report success.
- Cloud IAM binding/export reviewed privately by two owners.

### Agent handoff

Repository changes can implement tests/workflow shape, but OIDC/IAM/environment protection requires an authorized owner. CI-001A/#103 owns test reliability, CI-001B1/#124 owns hosted frontend Jest, CI-001B1A/#126 owns hosted SPA safety, CI-001B2/#135 owns the protected release source gate, CI-001B3/#167 owns the focused command-journal emulator gate, CI-001B4/#186 owns the exact frontend lint gate, #133 owns cloud/environment authority, and #136 owns staged/target release evidence. Keep legacy lint-debt cleanup, scanning, branch-required-check configuration, and Netlify hosting work in separately claimed children.

---

## SUPPLY-001 — Remove vulnerable dependency chains and stage SDK/build upgrades

**Labels:** `priority:P0`, `type:maintenance`, `type:security`, `area:web`, `area:firebase`, `area:stripe`, `size:L`
**Status:** Partial; SUPPLY-001A is represented by [#127](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/127), SUPPLY-001B by [#192](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/192), and SUPPLY-001C source/tests by [#202](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/202); D–G remain open
**Depends on:** CI-001A

### Problem

The 2026-07-12 baseline production audit reported 33 root advisories (3 critical, 9 high) and 9 Functions advisories (1 high). SUPPLY-001A/#127 removes the unused `gpxparser` and obsolete `jsdom/request/form-data` chain; on a fresh Node 20 install, the root production audit falls to 22 advisories (1 critical, 8 high) while production bundle hashes remain identical. SUPPLY-001B/#192 pins the compatible React Router 6.30.4 graph and removes all three router findings, reducing that root audit to 19 advisories (1 critical, 5 high). SUPPLY-001C/#202 pins the last Firebase 11 compatibility release and its matching Rules helper; its fresh production audit reports 6 advisories (0 critical, 3 high). Firebase Admin still needs a staged major upgrade, Create React App remains unmaintained, and scanning/policy automation remains open.

### Scope

Deliver as small ordered PRs:

1. [#127](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/127): prove `gpxparser` is unused, remove it, refresh only its lockfile graph, and retest route behavior.
2. [#192](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/192): pin `react-router-dom` to 6.30.4 with `react-router` 6.30.4 and `@remix-run/router` 1.23.3; enable and test the two declarative-router future flags without changing the route tree.
3. [#202](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/202): pin the Firebase browser SDK to 11.10.0 and `@firebase/rules-unit-testing` to 4.0.1; keep the application on one compatibility boundary and repair only the Node 20 Rules harness needed to prove it.
4. Upgrade Firebase Admin/Functions with emulator and Auth/Firestore trigger tests.
5. Upgrade Stripe SDK and deliberately select/test the Stripe API version.
6. Plan and execute CRA migration to a maintained build tool without mixing payment behavior changes.
7. Add automated dependency updates, audit policy, reviewed lockfiles, and an SBOM/release inventory.

### Acceptance criteria

- [ ] No unused runtime dependency remains.
- [ ] No unexplained critical/high production advisory remains; any temporary exception has owner, reachability analysis, compensating control, and expiry.
- [ ] Auth, callable Functions, App Check, Firestore queries, routing, Stripe signature fixtures, and build pass after each upgrade.
- [ ] Bundle does not accidentally include server modules/secrets.
- [ ] Stripe API-version change has test-mode event fixtures and rollback notes.
- [ ] Build-system migration preserves SPA callbacks, SEO/sitemap behavior, code splitting, and deployment output.

### Tests/evidence

- Before/after `npm audit --omit=dev` for both lockfiles.
- Full CI and test-mode Stripe/Firebase smoke suite at every upgrade boundary.
- Bundle/dependency diff and SBOM artifact.
- SUPPLY-001A/#127: source search finds no runtime use; a fresh Node 20 lockfile install contains no `gpxparser`; 50 entries are removed with no retained package identity change; the root production audit changes from 33 to 22; all 47 frontend and 10 standalone SPA tests pass; and optimized JS/CSS asset hashes match the baseline exactly.
- SUPPLY-001B/#192: the root declaration and only the three router package records change; a fresh Node 20 production audit changes from 22 findings (1 critical, 8 high, 12 moderate, 1 low) to 19 (1 critical, 5 high, 12 moderate, 1 low), with no remaining router entry. A fail-before/pass-after test covers the compatibility warnings; the focused suite also covers double-slash normalization, wildcard-to-home navigation, login return-path handling, account routing, and the 10-test standalone callback boundary.
- SUPPLY-001C/#202: exact Firebase 11.10.0 and Rules helper 4.0.1 resolve the root production `protobufjs` path to 7.6.5 and remove Firebase's root `undici` path. The fresh production audit changes from 19 findings (1 critical, 5 high, 12 moderate, 1 low) to 6 (0 critical, 3 high, 2 moderate, 1 low). A red test proves the upgraded Rules helper cannot discover the emulator in the old Jest sandbox; the Node 20 native-web-API environment makes all 348 Rules cases pass. Focused Firebase/Auth/App Check tests pass 71/71, the frontend passes 198/198, Functions pass 1,077/1,077 applicable unit tests, and the callback and release-safety suites pass. Reproducible clean builds change the optimized main bundle from `main.fdd058b4.js` to `main.56edbdb7.js`: +8.29 kB gzip (about 3.3%) and +180 KiB on disk overall (about 1.0%). A dev-only older `protobufjs` remains nested under `firebase-tools`; the remaining six root and nine Functions production findings are still open.

### Agent handoff

Never use `npm audit fix --force`. Do not combine all upgrades in one unreviewable lockfile diff. SUPPLY-001A, B, and C are represented by #127, #192, and #202; do not publish duplicates. #202 is source/test evidence only: it does not publish the website, deploy Firebase, change provider settings, or prove live behavior. Stop if a later provider SDK change needs a product/runtime decision.

---

## SEC-001 — Replace the Firestore admin catch-all with resource-specific rules

**Labels:** `priority:P0`, `type:security`, `area:firebase`, `size:M`
**Status:** Source and tests merged through [PR #123](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/123) at `a7fc301e85b0aeabe396e771faea21d3fc8e7b2b`; Firebase deployment/live behavior remains unproven under #105
**Depends on:** None

### Problem

`match /{document=**}` grants browser admins read/write to every current and future document. Firestore rules are additive, so it overrides the apparent deny on member OAuth secrets and lets a compromised admin rewrite orders, registrations, audit arrays, mail, rate limits, and arbitrary collections.

### Scope

- Remove global admin access.
- Define reusable signed-in/member/admin helpers without dereferencing null auth.
- Preserve public event/product reads and members-only reads.
- Preserve the specific admin client access still required for event/product content management.
- Allow admins to read minimum member/registration/order data required by current admin UI during migration.
- Deny all client writes to registrations, orders, member roles, secrets, mail, rate limits, Stripe event inbox, audit/authz records, and future unmatched collections.
- Deny OAuth secret reads to every client, including admins.
- Reverse tests that intentionally assert unsafe access and add future-collection/mail/financial-write denial tests.

### Acceptance criteria

- [x] Admin client cannot read `members/{uid}/secrets/*` in the tested source Rules.
- [x] Admin client cannot create/update/delete registration/order payment state or audit data.
- [x] Admin client cannot read/write an unmatched arbitrary collection.
- [x] Admin client cannot create `mail`, modify rate limits, webhook ledgers, or authorization/audit records.
- [x] Current admin event/product list/editor and member/order/registration read views retain only required access.
- [x] Public, member, unverified, and owner/self-service behavior remains explicitly tested.
- [x] Rules compile in the emulator and all 295 Rules tests pass on Node 20/Java 17.
- [ ] #105 deploys the exact revision to protected staging and proves synthetic allow/deny plus rollback before production.

### Tests/evidence

- [PR #123](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/123) contains protected collection/collection-group, admin read/write, hostile catalog, owner-profile, and legacy-draft coverage.
- Two independent exact-commit reviews approved with no P0/P1/P2 findings.
- The merge workflow explicitly skipped Firebase because deployment authority was absent; green CI is source evidence only.

### Agent handoff

Do not compensate by moving sensitive data into a different admin-readable document. ADMIN-001 later replaces remaining direct catalog/editor writes with scoped APIs.

---

## CONFIG-001 — Fail closed on server environment and commerce configuration

**Labels:** `priority:P0`, `type:security`, `type:reliability`, `area:firebase`, `area:stripe`, `size:M`
**Status:** CONFIG-001A source/tests merged through [#149](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/149) / PR #150 as `2c62b8dd`; Firebase and Stripe configuration remain unproven. CONFIG-001B1 source enforcement is tracked in [#151](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/151). CONFIG-001B2 remains blocked on a safe operator path, command/provider-object recovery, and protected deployment.
**Depends on:** CI-001A recommended

### Problem

The assessment found production-origin fallbacks, a webhook mode default, and an unenforced `COMMERCE_ENABLED`. CONFIG-001A removes the origin/mode/key fail-open source behavior. CONFIG-001B1 adds the read-only command-enforcement layer, but an audited no-deploy operator control and recovery drill still do not exist. Missing/mistyped deployment or runtime controls must never enable commerce.

CONFIG-001A [#149](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/149) owns only the typed invocation-time environment/origin/expected-mode boundary, server-key mode compatibility on the four key-bound Functions, removal of production-origin fallbacks, and fixed no-side-effect tests. Webhook and mail remain free of the Stripe API key.

CONFIG-001B is split because source enforcement is not the same as an operable emergency procedure. B1 [#151](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/151) owns the exact deploy ceiling, fresh server-only runtime admission read, current command matrix, browser-deny proof, and honest in-flight boundary. B2 owns the protected audited writer, operator drill, existing Stripe-object recovery, deployment, and provider proof. Do not claim B1 alone is an officer-usable kill switch.

### Scope

- Create one typed server-configuration module with an allowlisted environment name, required validated site origin, explicit expected Stripe livemode, commerce-enabled state, and safe emulator behavior.
- Reject production origin defaults; require HTTPS outside local/demo environments and an exact allowed origin/host.
- Verify local/demo cannot accept a live Stripe key/mode and production cannot accept test mode/key.
- Make every Session, refund, Payment Link/catalog create, and other new commerce command check a server-owned global and appropriate per-domain switch before any external side effect.
- Keep webhook ingestion, reconciliation, refunds needed for incident resolution, and read-only operations running while new commerce is disabled according to an explicit matrix.
- Validate configuration before request data, Firestore writes, email enqueue, or Stripe calls; return safe operator-visible error codes.
- Document typed parameters/Secret Manager bindings and a tested rotation/deploy sequence without logging values.

### Acceptance criteria

- [ ] Missing/malformed environment, site origin, expected mode, or commerce switch fails closed before external/local business writes.
- [ ] Local/demo execution rejects live Stripe configuration; production rejects test configuration.
- [ ] No server code silently falls back to `https://runmprc.com`.
- [ ] Disabled checkout blocks race, merchandise, late-payment, and catalog object creation with no Stripe side effect.
- [ ] Verified webhooks and reconciliation continue while checkout is disabled; incident refund behavior follows the approved matrix.
- [ ] Global/per-event/per-product switches are server-authoritative and cannot be bypassed by the browser.

### Tests/evidence

- Table-driven environment/config combinations, malicious origins, absent values, key/mode mismatch, and no-side-effect assertions.
- Emulator tests for kill-switch races and webhook/reconciliation continuity.
- Redacted staging parameter inventory and disable/enable drill; no production change in the coding issue.

### Agent handoff

Implement only the live CONFIG child claimed in `GITHUB_ISSUE_SLICES.md`. Never print or pattern-match an entire secret; use provider-safe key-mode metadata/prefix only where documented. External parameters, runtime-control mutation, Secret Manager, deployment, and provider changes need their authorized owner issue.

---

## AUTH-001 — Require verified email for member and privileged claims

**Labels:** `priority:P0`, `type:security`, `area:auth`, `area:firebase`, `size:M`
**Status:** Partial. AUTH-001A [#98](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/98) merged through [PR #107](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/107) as `ce22c110f2132b157bd8a0d43b065585e0b43cb5`; its Firebase deployment skipped. AUTH-001B [#196](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/196) merged as `a8801770e97cf21d81f3307f5893734115140d8f` and owns the role-based Firestore Rules source/test slice. AUTH-001C [#209](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/209) merged through [PR #211](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/211) as `85751dac1b27b9dbb0beb70ff3c432c8da4e609d` and owns the matching current Functions role guards. AUTH-001D1 [#213](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/213) tracks the browser role-projection match. None is proven live. Remaining mirror/revocation, authoritative-membership, capability/recent-auth, roster-export, and legacy-sync work is open, so the parent is not complete.
**Depends on:** SEC-001 recommended

### Problem

Both the legacy member synchronization function and admin role callable grant claims based on email without requiring `userRecord.emailVerified`. An attacker can pre-register a known member address, not verify it, and later receive membership when that email is imported. Privileged guards and rules check only the role string.

AUTH-001A now rejects unverified targets at the two existing role-grant endpoints. Do not duplicate that merged slice. It is not proof that Firebase production runs the new code, and it does not complete the remaining parent requirements below.

AUTH-001B [#196](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/196) is the distinct Rules outcome. A `member` or `admin` role authorizes a role-based Firestore operation only when Firebase's token also carries exact boolean `email_verified == true`. Missing, false, string, numeric, or profile-mirror values deny. UID-bound profile read/update and connection-metadata read remain identity self-service so an unverified person can recover; verification never creates membership or admin authority. This source/test boundary is not Firebase deployment or live proof.

AUTH-001C [#209](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/209) is the distinct current Functions outcome. One decoded-token policy is used by the shared admin guard, checkout's member-only/member-price role lookup, and registration CSV export. It requires exact boolean `email_verified === true` plus exact `member` or `admin`; request/profile substitutes and malformed, inherited, accessor-backed, or proxied claims deny. Admin and CSV denial precedes their Firestore work. Checkout keeps its existing configuration/event/rate-limit order, but an unverified role cannot permit member-only access, member pricing, a registration write, or a Stripe call. It preserves generic caller-facing failures and does not claim CSV minimization, recent-auth, scoped capabilities, deployment, or live behavior.

AUTH-001D1 [#213](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/213) is the separate browser consistency outcome. The identity service projects `member` or `admin` into UI state only from one refreshed ID-token result with exact own data `email_verified === true` and the exact role. Missing, false, malformed, inherited, accessor-backed, proxied, unknown, or case-changed values project no privileged browser role. Exact `unverified` may remain only as a non-authoritative display state. This prevents a browser from presenting protected controls that #196/#209 must reject; it adds no server authority, grant, profile write, revocation, deployment, or live proof.

Adjacent account-email recovery is represented by canonical live parent [#120](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/120), not by a new AUTH-001 role-grant child. AUTH-MAIL-002A [#145](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/145) merged the account-creation/request split as `46557c7` but is not published. AUTH-MAIL-002B [#153](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/153) merged the truthful My Account resend result and browser cooldown as `23bca8c8`, but protected release run `29252492614` stopped before build and published nothing. AUTH-MAIL-002C1 [#155](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/155) tracks one neutral password-reset request result and repeat-safe browser cooldown. AUTH-MAIL-002C2 is represented by live child [#194](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/194): a verification-only `/auth/action` source route that scrubs capability state, requires an explicit click and provider `VERIFY_EMAIL`, and exposes only fixed non-identifying results. It must not be configured as Firebase's project-wide custom handler while reset-password and recover-email modes remain unsupported. None grants membership, proves provider delivery, reconciles the Firestore verification mirror, or proves Firebase API enumeration protection.

### Scope

- Reject member/admin/capability grants when the target Firebase user's email is unverified.
- Require verified email at sensitive member/admin server guards and Firestore rule helpers.
- Make browser member/admin role projection mirror that exact token check without treating UI state as authority.
- Define behavior for non-email providers and accounts with no email.
- Reconcile/update the member profile's email-verification mirror after verification or token refresh.
- Revoke refresh tokens/force claim refresh on demotion and security-sensitive role changes.
- Add an audited error/result for skipped unverified membership imports without exposing account enumeration publicly.

### Acceptance criteria

- [ ] Unverified known-email account cannot receive member/admin claim through any endpoint.
- [ ] A forged request field cannot override Firebase's verified token/user-record value.
- [ ] Verified user can be granted an allowed role by an authorized actor.
- [ ] Sensitive rule/function access requires both capability and verified email where policy says so.
- [ ] Browser member/admin controls require the same exact token facts and cannot substitute profile/request data.
- [ ] Demotion has documented token revocation/propagation behavior.
- [ ] Existing tests with privileged contexts explicitly set verification state.

### Tests/evidence

- Attack-path unit and Rules emulator tests for unverified member/admin.
- Browser projection tests for malformed claims plus a captured Auth callback that emits no privileged role.
- Verified promotion/demotion and self-demotion protection tests.
- Emulator flow showing verification mirror/claim refresh.

### Agent handoff

Do not auto-promote a user merely because they verify email; authoritative club membership is a separate input. Do not put profile data in custom claims.

---

## AUTH-002 — Replace the legacy static-key membership synchronization endpoint

**Labels:** `priority:P0`, `type:security`, `area:auth`, `area:firebase`, `size:M`, `needs-external-config`
**Status:** Ready after AUTH-001
**Depends on:** AUTH-001

### Problem

`updateMemberRole` uses one shared `X-API-Key` from deprecated `functions.config()`, with no operator identity, replay protection, App Check, workload authentication, or durable audit. The API can change up to 100 roles per call and Firebase will decommission `functions.config()` deployments in March 2027.

### Scope

- Inventory the caller (`appengine/syncToFirestore.js` or another job) and decide whether it should be retired, moved to an authenticated admin import, or authorized through workload identity/OIDC.
- Remove the static shared-key public endpoint.
- Normalize/deduplicate input, require verified email, apply an allowlisted role/capability set, and cap batch size.
- Add a command ID/payload hash so retries are idempotent.
- Record actor/workload, source, old/new role, reason/import ID, outcome, and timestamp in append-oriented audit records.
- Migrate remaining configuration from `functions.config()` to Secret Manager/typed parameters only where still required.

### Acceptance criteria

- [ ] No public shared static key can change membership.
- [ ] Each import/action has a cryptographically verified caller and stable request ID.
- [ ] Unverified/missing accounts are reported safely and never promoted.
- [ ] Replaying the same import creates no duplicate changes/audit side effects.
- [ ] Admin grants are impossible through the membership importer.
- [ ] Legacy endpoint/config is removed and deployment succeeds without `functions.config()`.

### Tests/evidence

- Invalid/expired/wrong-audience caller tests.
- Duplicate import, mixed success, unverified target, role allowlist, and size-limit tests.
- Private IAM/workload configuration evidence.

### Agent handoff

External workload identity configuration needs an authorized owner. Do not replace one unauthenticated shared secret with a different long-lived shared secret and call the issue complete.

---

## OAUTH-001 — Make Strava token lifecycle server-only, transactional, and auditable

**Labels:** `priority:P0`, `type:security`, `area:auth`, `area:strava`, `size:M`, `status:proposed`, `needs-external-config`
**Status:** Represented by live [#88 — STRAVA-001](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/88); proposed, unassigned, and unclaimed
**Depends on:** SAFETY-001/#99 for C; SEC-001 and AUTH-003 capability model for A; ABUSE-001A may proceed with `stravaExchangeCode` deferred, then C proves its safe cutover

**Canonical live tracker:** [#88](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/88). OAUTH-001A/B/C are bounded slices inside that tracker, not separate tickets to publish without first splitting and cross-linking #88.

### Problem

SEC-001 removes browser access to stored OAuth secrets, but that does not complete the token lifecycle. Tokens remain plaintext at rest, refresh-token rotation has no transaction/version guard, scopes/revocation/disconnect are not fully governed, and durable access/refresh audit is absent. Concurrent refresh can overwrite a newly rotated token and a compromised server identity may have more token access than required.

### Scope

- Keep authorization code exchange, access token use, refresh, and disconnect entirely server-side with strict owner/capability checks.
- Create the OAUTH-001C callback handoff before App Check is enforced on `stravaExchangeCode`; keep `code`/`state` out of third-party startup while preserving state verification and server-only exchange.
- Store token version/provider athlete reference, scope set, expiry, last refresh outcome, and minimum operational metadata separately from public member profile.
- Use transaction/compare-and-set or a lease/version protocol so concurrent refresh cannot lose a rotated refresh token.
- Minimize approved Strava scopes and reject unexpected returned scope/account binding.
- Implement idempotent disconnect with provider revocation where supported and local deletion/tombstone behavior.
- Record redacted connect/refresh/failure/revoke audit; never log codes or tokens.
- Make and record a threat-model decision on application-layer encryption/KMS versus Secret Manager/IAM-only protection, with rotation/recovery consequences.

### Acceptance criteria

- [ ] No browser/admin rule can read or write token material.
- [ ] Concurrent refresh preserves the newest valid rotated token and returns one coherent result.
- [ ] Exchange/refresh verifies account binding and exact allowed scopes.
- [ ] `stravaExchangeCode` remains excluded from App Check enforcement until OAUTH-001C proves the protected callback handoff; after cutover, missing/invalid/valid App Check behavior is tested.
- [ ] Disconnect revokes provider access when possible and makes local reuse impossible.
- [ ] Logs/audit contain no authorization code, access token, refresh token, or full secret document.
- [ ] Service IAM and encryption decision have named owner, rationale, and review date.

### Tests/evidence

- Concurrent refresh, stale-version, rotated-token, retry, provider rejection, scope mismatch, wrong-user, disconnect/reconnect, and redacted-log tests.
- OAUTH-001C encoded/case/trailing callback, wrong/replayed state, and App Check handoff tests without a real member token.
- Test-provider or mocked revocation evidence; private IAM/encryption review for hosted closure.

### Agent handoff

Use OAUTH-001A/B/C as bounded outcomes within canonical tracker [#88](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/88). A owns refresh concurrency, B owns scopes/revocation/governance, and C owns the initial protected callback handoff. Do not publish any of them as a duplicate ticket; if #88 must be split, first make #88 the explicit tracker and cross-link the claimed child. Never call the real Strava API with a member token in tests and never migrate/export production token documents into the workspace.

---

## AUTH-003 — Introduce scoped admin capabilities, MFA, and recent authentication

**Labels:** `priority:P1`, `type:security`, `area:auth`, `area:firebase`, `size:L`, `needs-migration`, `needs-external-config`
**Status:** Proposed
**Depends on:** AUTH-001, AUTH-002, SEC-001

### Problem

One `admin` claim currently unlocks event content, registrations, members, products, orders, refunds, exports, roles, and—in the original rules—secrets. There is no repository evidence of MFA, re-authentication for refunds/role grants, rapid privilege revocation, or two-person protection for critical configuration.

### Scope

- Define capability claims: `event_manager`, `registrar`, `shop_manager`, `fulfillment`, `finance_admin`, `identity_admin`, `platform_admin` (names may be refined once).
- Map each function, Firestore read, admin route, export, and operation to the minimum capability.
- Keep `admin` temporarily as a migration alias, then remove it.
- Require verified email and MFA for privileged roles; enforce recent authentication for refunds, exports, role grants, and security changes.
- Add token revocation/refresh on demotion and a break-glass/last-platform-admin policy.
- Add append-oriented role-change audit and quarterly access review report.

### Acceptance criteria

- [ ] Race director cannot refund merchandise or grant roles.
- [ ] Shop lead cannot view DOB/emergency contacts or manage membership.
- [ ] Finance admin can execute approved refund/reconciliation without editing catalog/identity.
- [ ] Sensitive actions reject stale/non-MFA authentication according to approved threshold.
- [ ] Migration preserves access for named operators and has rollback/lockout recovery.
- [ ] Capability matrix is documented and covered by function/rules/route tests.

### Tests/evidence

- Table-driven authorization tests for every capability/action pair.
- Token demotion/revocation/refresh tests.
- Staging MFA/recent-auth demonstration and private access inventory.

### Agent handoff

Split claim migration, MFA/recent-auth, and UI route projection into separate PRs under the same epic if needed. Do not use Firestore profile fields as the trusted authorization source.

---

## ABUSE-001 — Enforce native App Check and privacy-preserving abuse limits

**Labels:** `priority:P0`, `type:security`, `type:reliability`, `area:firebase`, `size:L`, `needs-external-config`
**Status:** Partial. ABUSE-001A1 browser Enterprise source/tests are tracked in live [#159](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/159). Provider configuration, native callable enforcement, rate limits, alerts, deployment, and live proof remain open.
**Depends on:** CI-001A recommended

### Current atomic boundary

ABUSE-001A1 changes only the browser provider class from reCAPTCHA v3 to `ReCaptchaEnterpriseProvider`. It preserves local/test and initial capability-callback shutdown, requires the existing public build variable, keeps token auto-refresh, and retains fixed redacted diagnostics. Its tests use a synthetic key and no provider network call.

This source slice does not configure an Enterprise key/domain policy, set a build variable, publish the website, exchange a live token, or enforce App Check on a Function. ABUSE-001A2 must separately inventory safe callables, preserve the DATA-001A/OAUTH-001C callback deferrals, add native runtime enforcement with emulator behavior, observe staged metrics, and prove missing/invalid/valid requests. #113/#133/#136/WEB-001 retain project, protected configuration, deployment, provider readback, and live verification.

### Problem

App Check is optional on the client and enforced only by a custom `ENFORCE_APP_CHECK === true` branch that is not configured in repository workflows. Rate limiting trusts the first `X-Forwarded-For`, stores raw IP/email, depends on an unverified TTL policy, and lacks per-business/user/concurrency/cost controls.

### Scope

- Configure reCAPTCHA Enterprise for each web environment and observe App Check metrics.
- Replace custom fail-open checks with Firebase `enforceAppCheck: true` runtime options on sensitive callable functions.
- Inventory the exact callable group. Mark `lookupRegistration` and `lookupOrder` deferred until DATA-001A supplies a tested safe confirmation handoff. Mark `stravaExchangeCode` deferred until OAUTH-001C within canonical tracker #88 supplies a tested safe OAuth handoff.
- Evaluate limited-use/replay-protected tokens for checkout/refund commands after measuring web support and latency.
- Derive client address only from platform-trusted request metadata.
- HMAC rate-limit identifiers with a bound rotating secret; do not store raw email/IP.
- Add scopes for IP/pseudonymous email, authenticated UID, event/product, and command ID as appropriate.
- Provision and verify Firestore TTL; set function instances/concurrency/timeouts/budgets.
- Add metrics/alerts for App Check rejects, rate-limit rejects, Stripe/API object creation, and cloud cost anomalies.

### Acceptance criteria

- [ ] Hosted sensitive callables reject missing/invalid App Check without relying on an optional env toggle.
- [ ] The enforcement inventory explicitly excludes the three initial-callback callables until their named handoff dependency merges; a test prevents accidental early enforcement.
- [ ] Local emulator/CI behavior is explicit and cannot silently route to production.
- [ ] Rate-limit documents contain no raw email/IP and expire automatically.
- [ ] One attacker cannot block a victim solely by repeatedly submitting the victim's known email; mitigation/policy is documented.
- [ ] Valid retries with the same command ID do not consume duplicate external side effects.
- [ ] Abuse/cost alerts link to a runbook and named owner.

### Tests/evidence

- Missing/invalid/valid App Check tests in staging.
- Source inventory tests for enforced versus deferred callables, plus callback regression tests before any deferred callable moves to enforcement.
- Rate-limit boundary, concurrent transaction, expiry, HMAC rotation, and spoofed-header tests.
- Private console evidence for Enterprise key/domain, enforcement, TTL, budget, and alerts.

### Agent handoff

App Check is not authentication. Do not remove Auth/capability checks or rely on it as the only bot/fraud control. Do not enforce it on `lookupRegistration`, `lookupOrder`, or `stravaExchangeCode` while #99 suppresses the reCAPTCHA provider on an initial capability URL. Move each callable only after DATA-001A or OAUTH-001C within canonical tracker #88 proves a safe handoff and the callback regression passes.

---

## PAY-001 — Add strict request schemas and immutable monetary snapshots

**Labels:** `priority:P0`, `type:security`, `area:stripe`, `area:race`, `area:shop`, `size:L`
**Status:** Partial. PAY-001A source/tests are complete in live [#157](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/157). PAY-001B1 race/volunteer request and event-field adoption is tracked in live [#219](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/219). PAY-001B2 snapshots, PAY-001C/D, deployment, and live behavior remain open.
**Depends on:** ABUSE-001 interface agreed

### Current atomic boundary

PAY-001A adds dependency-free strict-root-object, root-budget, bounded array/string, integer-cents, fixed-currency, calendar-date, canonical-URL, conservative-email, fixed-error, and closed-enum safe-log primitives. Unknown configured root keys reject; nested values remain data-only/budgeted until endpoint-owned exact schemas validate them. The libraries return new immutable values, contain no Firebase, Stripe, network, logger, clock, or random dependency, and make no such call themselves. A supplied array item parser must be trusted, pure, synchronous, and endpoint-owned. Exact review, merge, and hosted-CI status belong to [#157](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/157).

PAY-001B1 [#219](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/219) is the first endpoint adoption. The website projects only the selected participant/volunteer answers and omits a volunteer tier. The race callable parses its exact current compatible root and runner shape before Firestore, preserves the opaque event ID, encodes callback values, then matches answers to the selected bounded server event/volunteer field schema before any rate-limit write, role/capacity work, token creation, registration write, Product creation, or Checkout call. Its fixed error does not echo fields or values. Exact branch, review, merge, and CI evidence belongs to #219.

PAY-001B1 does not create immutable event-field, price, or waiver snapshots; inspect or migrate existing events; add request IDs/idempotency/capacity holds; deploy Firebase; configure Stripe; or prove production protection. Those remain **NOT AVAILABLE YET** under PAY-001B2, PAY-001C/D, and later payment issues.

### Problem

Public/admin Functions validate only a few required strings. Names, phones, dates, notes, tracking values, custom fields, arrays, URLs, amounts, and nested payload size are weakly bounded. Event-required custom fields and allowed options are enforced only in HTML. Monetary records store one list amount but not an immutable expected/actual breakdown.

### Scope

- Select a maintained schema library compatible with CommonJS/Node 20 or implement small explicit validators if that is safer.
- Define versioned schemas for race checkout, merch checkout, lookup, role/admin actions, refunds, cancellation, substitutions, late/comp registration, exports, and Strava exchange.
- Bound total payload, object depth, field count, strings, arrays, enums, integer cents, dates, URLs, and quantities; reject unknown fields.
- Normalize email consistently; Unicode-normalize/bound names without banning legitimate names.
- Validate race custom fields against the server event/volunteer schema, including required fields and select options.
- Add immutable snapshots: expected subtotal, discount policy/version, currency, event/product/variant title/ID, price tier, waiver version/hash, and schema version.
- Centralize safe error codes/messages and redacted logging.

### Acceptance criteria

- [ ] Scripted clients cannot omit required event fields, submit an invalid option, or inject arbitrary nested extras.
- [ ] Floats, negative/unsafe/over-limit cents, invalid currency, excessive quantity, and oversized payloads fail before Firestore/Stripe calls.
- [ ] Merchandise requires a valid variant whenever variants exist.
- [ ] Admin notes/tracking/substitution/refund fields are bounded and typed.
- [ ] Stored records identify validation/schema version and expected-price snapshot.
- [ ] Public errors reveal no secret/provider internals or account-enumeration detail.

### Tests/evidence

- Table/fuzz-like tests for nulls, arrays-as-objects, prototype keys, deep nesting, Unicode length, hostile HTML, invalid dates/URLs, extra keys, and money boundaries.
- Tests proving Stripe/Firestore mocks are not called after validation failure.

### Agent handoff

Keep schemas close to the trusted Functions boundary and expose derived TypeScript/client types separately. Do not treat client TypeScript interfaces as runtime validation.

---

## PROMO-001 — Disable unmodeled Stripe promotions until discounts are authoritative

**Labels:** `priority:P0`, `type:security`, `area:stripe`, `size:S`
**Status:** source and exact tests are complete under open GitHub issue [#102](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/102); pre-change Session/provider inventory, protected deployment, provider readback, and live verification remain open, so do not close the GitHub issue yet
**Depends on:** PAY-001 for any future enabled discount model

### Problem

The original race and merchandise Checkout creators enabled arbitrary Dashboard promotion codes while local records stored only list/subtotal price. A mathematically consistent discounted Stripe total could therefore be fulfilled without a server-approved eligibility, policy/version, or expected total. Refund/reporting state could disagree with the charge.

### Scope

- Set `allow_promotion_codes: false` in every current Checkout Session creator.
- Add `schemaVersion: "1"` only to newly created Session and PaymentIntent metadata. This is an additive marker, not schema enforcement: legacy metadata remains accepted, and allowlisting/migration stays with PAY-003B.
- Require a complete Stripe adjustment breakdown and treat unknown or nonzero discount, tax, or shipping amounts as permanent anomalies requiring review while those features are disabled.
- Add creator payload tests and signed webhook tests, including a 100% discount and legacy outstanding Session.
- Inventory and disable/restrict active promotion configuration or outstanding Sessions in test/staging before release; production provider changes belong to OPS-001.
- If promotions are later desired, open a new issue under PAY-001/PAY-002 for server-approved code/campaign eligibility, immutable discount snapshot, actual total/refund/reconciliation, limits, expiry, audit, and migration before changing this guard.

### Acceptance criteria

- [x] Neither race nor merchandise Session payload permits Stripe promotion-code entry; automatic tax is also explicit-off.
- [x] Unknown or nonzero discount, tax, or shipping adjustments never make a local record paid/fulfilled and create durable review evidence.
- [x] Complete all-zero adjustment Sessions continue through normal amount/currency validation.
- [x] No checkout UI or API claims a promotion is accepted.
- [ ] Provider inventory/release checklist accounts for Sessions created before the change.

### Tests/evidence

- Exact Stripe Session payload assertions for both creators.
- Signed zero, partial, and full-discount webhook fixtures with no-fulfillment assertions.
- Redacted test/staging inventory of outstanding promotion-enabled Sessions/codes before deployment.

### Agent handoff

The local webhook/creator patch is a safety default, not a complete discount feature. Do not remove the quarantine simply because the Stripe arithmetic balances.

---

## PAY-002 — Implement idempotent payment commands and explicit state machines

**Labels:** `priority:P0`, `type:reliability`, `type:security`, `area:stripe`, `area:firebase`, `size:L`, `needs-migration`
**Status:** Partial. PAY-002A1 pure state source/tests are tracked in live [#161](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/161). PAY-002B1 pure command-identity source/tests are tracked in live [#163](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/163). PAY-002B2A registered-only journal source/tests are tracked in live [#165](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/165). PAY-002B2B lease/fence source and tests are tracked in live [#169](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/169). PAY-002B2C1 immutable initial-plan source/tests are tracked in live [#173](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/173). PAY-002B2C2 pre-POST evidence and retry-cutoff source/tests are tracked in live [#182](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/182). PAY-002B2C3A pure closed reconciliation-decision source/tests are tracked in live [#184](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/184). PAY-002B2C3B immutable reconciliation-candidate persistence source/tests are tracked in live [#206](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/206). PAY-002B2C3C fresh-lease later-attempt authorization source/tests are tracked in live [#226](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/226). PAY-002B2C4A immutable authorized attempt-2 plan source/tests are tracked in live [#232](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/232). PAY-002B2C4B attempt-2 pre-send source/tests are tracked in live [#238](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/238). PAY-002B2C4C1 pure unbound result-evidence source/tests are tracked in live [#246](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/246). PAY-002B2C4C2A synthetic Stripe SDK response observations are tracked in live [#275](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/275). PAY-002B2C4C2B1 unused server-only allowlist projection source/tests are tracked in live [#280](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/280). PAY-002B2C4C2B2A unused transport-consistency classifier source/tests are tracked in live [#285](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/285). The remaining C4C2B2 controller/URL/business/time/persistence binding, result persistence/reconciliation, runtime adoption, real legacy inventory/migration, and checkout sagas remain open.
**Depends on:** CONFIG-001 and PAY-001

### Current atomic boundary

PAY-002A1 defines only a dependency-free version-1 target: separate payment, registration, fulfillment, confirmed-refund, and per-dispute reducers; fixed cross-dimension validation; and a synthetic legacy classifier/redacted aggregate report. Orders/registrations have no canonical singular `disputeStatus`; each dispute is validated separately against paid payment context. Operational `fulfilled`, `transferred`, and `cancelled` legacy values require separate compatible payment evidence rather than manufacturing payment state. It does not import Firebase/Stripe, expose a Function, change the webhook, write a compatibility field, enumerate a real record, or deploy.

The next boundaries remain separate. A later inventory/migration child must use #113-approved data categories and a dry-run before writes. PAY-002B1 [#163](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/163) owns only pure caller-scoped command keys, payload fingerprints, and deterministic Stripe keys with closed environment/mode pairing. A provider attempt is one logical generation, not an HTTP retry. PAY-002B2A [#165](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/165) owns only the atomic `checkoutRequests/{commandKeyHash}` registered record plus deterministic revision-1 `auditEvents` partner. Exact existing pairs are read-only; same-key command-type/schema/payload conflicts and malformed pairs reject. Environment and caller scope derive different B1 keys; there is no cross-scope UUID query. B2A adds no lease, execute/send permission, result replay, provider plan/attempt, or reconciliation.

PAY-002B2B [#169](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/169) owns the unused lease/fence source and tests. It preserves those B2A records exactly and stores mutable state separately at `checkoutRequests/{commandKeyHash}/lifecycle/current`. A fixed 60-second server lease fingerprints a trusted UUID v4 holder; a monotonic fence rejects stale or expired workers; each real change appends one deterministic audit. Terminal success stores only a command-bound server-only commitment, not a business/Stripe result, action proof, or replay value. The lease does not authorize the caller or permit a provider request.

PAY-002B2C1 [#173](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/173) owns only the unused immutable initial-plan source and tests. While the exact current lease/fence is active, it binds attempt `1` to one Stripe account, mode, API version, the static `checkout_session_create` → `/v1/checkout/sessions` POST mapping, canonical parameter set, deterministic B1 key, and original binding fence. C1 rejects arbitrary or object-ID-bearing paths; later operations need an explicit reviewed mapping. Raw account, parameters, and key are never stored; command-bound commitments are equality evidence, not anonymization, configured-account proof, a send marker, or provider-execution proof. An exact active-lease retry is read-only, a valid takeover can observe but cannot rewrite the same plan, and conflicts or malformed partners fail closed.

PAY-002B2C2 [#182](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/182) owns only the unused pre-POST marker, deterministic audit, and fixed 23-hour automatic-retry cutoff. It preserves B2A, B2B, and C1 records byte-for-byte. Under the exact current lease/fence and exact attempt-1 plan, `recordInitialStripeSendEvidence` creates `providerAttempts/0000000001/sendEvidence/first` plus `auditEvents/commerce_provider_send_{commandKeyHash}_0000000001`, or creates neither. Both bind a command-bound digest of every immutable C1 plan field. The first atomic creation, and an exact retry, return fixed `send_permitted` only when a post-transaction trusted-time check remains strictly before the transaction-validated lease's captured expiry and the persisted deadline. That second check does not re-read lifecycle state. Lease/deadline equality, later time, clock rollback, paired missing/unreadable time, or a changed/replaced C1 plan returns fixed `reconciliation_required` or fails closed without advancing. These classifications are retry-safety evidence only: they do not authorize a caller, prove the configured account, report a Stripe outcome, make a request, advance to attempt `2`, or replay a result.

PAY-002B2C3A [#184](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/184) owns only the unused pure closed attempt-1 evidence policy. Its exact flat version-1 record contains closed evidence categories and no provider-object, business, member, account, metadata, amount, timestamp, URL, free-text, or raw-status-code identifier/payload value. Only the complete matching tuple for trusted proof that endpoint execution never began, or the complete matching tuple for an exact verified expired/unpaid Session with verified expiry and an explicitly eligible new logical generation, returns `new_attempt_candidate`. The complete matching exact-open or verified-success tuple returns `existing_attempt_found`; every single-field difference, timeout, lost connection, provider error, old/pruned key, missing/not-found object, empty/partial search, unknown/processing state, mismatch, or conflict returns `reconciliation_required`. All outputs are fixed/frozen and non-identifying.

C3A is not a reconciler or authorization boundary. It stores nothing, calls nothing, has no runtime/index import, cannot send/execute/advance or create attempt `2`, and does not replay a provider result.

PAY-002B2C3B [#206](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/206) owns only the unused immutable reconciliation-candidate record/audit pair. It snapshots one exact C3A input, then validates the exact B1 registration, B2 lease history, C1 attempt-1 plan, and complete C2 record/audit. It may persist only an exact `new_attempt_candidate`, only at or after C2's stored 23-hour deadline, and only when the current validated lease is expired. Before either time gate, it writes nothing and returns the unchanged C3A candidate. The deterministic record and audit carry command-bound complete-plan/send commitments, closed evidence enums, observed fence/expiry, trusted time, and a complete-record digest. Exact retries are read-only. Changed valid evidence conflicts; orphan, malformed, future, or foundation-mismatched records fail closed without repair. No raw account/key/parameters/IDs/money/free text/provider response or attempt `2` is stored or returned.

C3B's fixed `requires_separate_authorization` result is not provider retrieval/truth, caller authorization, send permission, response replay, or a business transition. C3C must separately authorize/version a later attempt only after the persisted proof, an allowed business transition, and a fresh lease. The Checkout Session parts of provider-calling PAY-002C/D also require C4A plan binding and the C4B/#238 pre-send gate; C3C alone does not make those runtime children ready. C4A and C4B are limited to `checkout_session_create`. PAY-002D catalog objects, PAY-004 Session expiry, PAY-005 refunds, and provider-calling admin commands each require separately reviewed operation-specific plan, pre-send, result, and reconciliation boundaries. PAY-003B, RACE-001B, and MERCH-001B retain their own listed state and runtime dependencies.

PAY-002B2C3C [#226](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/226) owns only the unused immutable attempt-2 authorization record/audit pair. `authorizeNextStripeProviderAttempt` validates the exact B1/B2/C1/C2/C3B chain, repeats the complete safe C3A tuple check, and accepts only the matching `retry_same_operation` or `replace_expired_unpaid` transition plus an opaque lowercase SHA-256 record commitment. The current holder/fence must be active, later than C3B's observed fence, and its deterministic lease audit must prove acquisition at or after C3B persistence with valid predecessor chronology. The opaque commitment is command-bound before storage but is not current business-state proof; a future trusted runtime must derive it from a server-side business-record transaction.

The deterministic nested record and `commerce_provider_authorization` audit bind attempts `1` and `2`, complete plan/send/reconciliation commitments, the closed transition, an attempt-2 key fingerprint, fresh fence, and trusted time. Exact retry and later-lease observation are read-only. Changed valid input conflicts; unsafe evidence and malformed/orphan/future/foundation-mismatched pairs fail closed without repair. The fixed `provider_attempt_authorized` result says only `requires_plan_binding`; it exposes no identity, evidence, path, hash, key, timestamp, or send/execute flag. C3C creates no attempt-2 plan or pre-send marker, calls no provider, changes no business record, and has no runtime/index import.

PAY-002B2C4A [#232](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/232) owns only the unused immutable attempt-2 provider-plan record/audit pair. `bindAuthorizedStripeProviderPlan` revalidates the exact B1/B2/C1/C2/C3B/C3C chain and current active lease before creating `providerAttempts/0000000002` with `auditEvents/commerce_provider_attempt_{commandKeyHash}_0000000002`, or creating neither. The current holder/fence must match; trusted time must be at or after lease acquisition and authorization and strictly before lease expiry.

Version 1 is equality-only. The attempt-2 account, mode, API version, operation, endpoint, and canonical parameters must equal attempt 1. Only the internally derived attempt-2 key commitment, current binding fence/time, attempt number, and C3C authorization provenance may differ. The fixed `provider_plan_bound` or `provider_plan_existing` result says only `requires_pre_send_evidence`; it exposes no sensitive or send/execute value. Exact retry and later valid lease observation are read-only. Changed valid input conflicts; orphaned, malformed, future, impossible-chronology, or foundation-mismatched partners fail closed without repair. C4A creates no send evidence, calls no provider, changes no business record, and has no runtime/index import. PAY-002B2C4B [#238](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/238) owns the separate attempt-2 pre-send evidence.

PAY-002B2C4B [#238](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/238) owns only the unused attempt-2 pre-POST record/audit pair. `recordAuthorizedStripeSendEvidence` revalidates the exact B1-through-C4A chain and current active lease before creating `providerAttempts/0000000002/sendEvidence/first` with `auditEvents/commerce_provider_send_{commandKeyHash}_0000000002`, or creating neither. The accepted operation is only `checkout_session_create` at `POST /v1/checkout/sessions`.

C4B preserves the existing version-1 plan-commitment bytes. A separate `providerPlanCommitmentSchemaVersion: 2` digest covers every authorized C4A plan field, its nanosecond binding time, and both C4A authorization-provenance fields. Both C4B partners carry that commitment and provenance. The marker uses one prepared trusted time and an immutable deadline exactly 23 hours later. Exact retry and later valid lease observation never extend it.

After the transaction, a fresh trusted-time check returns fixed `send_permitted` / `pre_send_recorded` only while time has not rolled back and remains strictly before both the transaction-captured current lease expiry and stored deadline. Equality, later time, rollback, or unreadable paired time returns fixed `reconciliation_required` / `provider_outcome_unknown`; stale lease input fails as `lease_stale`. Changed input conflicts, and malformed/orphan/future/detached pairs fail closed. C4B never creates attempt `3`, calls Stripe, writes business state, replays a result, or enters an endpoint/index. Product/Price creation, Session expiry, refunds, and privileged provider operations require separate operation-specific boundaries.

PAY-002B2C4C1 [#246](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/246) owns only the unused pure `classifyAuthorizedStripeCheckoutResultEvidence` policy. It accepts only a primitive, length-bounded, canonical JSON string encoding the exact 16-field reported attempt-2 Checkout Session assertion envelope. Deterministic reserialization must match the input. Its sole exact tuple returns fixed `unbound_result_candidate`; all 46 alternate enum values reconcile, and malformed/non-canonical serialized values or non-string objects throw one fixed redacted error before hostile property access. The input and output contain no raw Stripe object, Session ID/URL, money, timestamp, provider body, or personal data.

C4C1 has no dispatch or idempotency proof, raw-result projector, journal write, result persistence, provider call, endpoint/index import, or business transition. Its candidate still requires trusted dispatch evidence, persistence, and business validation. C4B/C4C1 alone make no complete runtime child ready. PAY-002C still waits for PAY-001B2, RACE-001B, and a trusted dispatch/result-persistence boundary. PAY-002D still waits for PAY-001C, MERCH-001B, separate Product/Price boundaries, and the same Checkout Session runtime result work. PAY-003B and later cancellation, refund, and provider-admin work retain their listed dependencies.

PAY-002B2C4C2A [#275](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/275) owns only one test file that observes installed `stripe` 14.25.0 Checkout Session create responses through its exported but experimental/unstable `HttpClient` interface and a synthetic in-memory fake. This is an installed-version dependency-upgrade gate, not a provider contract. Selected Session fields are own data properties. `lastResponse` is the same fake raw-response object attached by the SDK as own, non-enumerable, and non-writable; SDK-added header observations are distinct from fake-supplied `statusCode` and are not an exhaustive production-response model.

Unknown fields, synthetic customer/contact data, metadata, a client secret, and unvalidated fragment-bearing or custom `.invalid` URLs can survive deserialization. Whole-object JSON omits `lastResponse` but retains unsafe fields. A normal Stripe error envelope rejects, while a bare non-2xx response without it may resolve. No later code may enumerate, spread, clone, stringify, log, or persist the whole Session, and no dynamically captured raw value may enter a snapshot, log, issue, or artifact.

C4C2A's fake client controls every body and header value. Its observations and resolve/reject behavior prove no Stripe/provider origin, account control, dispatch, delivery, idempotency-key use, plan/send binding, application environment, business clock, payment, capacity, inventory, or business state. It adds no production source, projector, canonical C4C1 evidence, journal, provider call, persistence, endpoint/index import, or runtime adopter.

PAY-002B2C4C2B1 [#280](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/280) owns only the unused pure `projectStripeCheckoutSessionObservation` allowlist. It reads each selected own data descriptor once from an untrusted Session-like object and its SDK-attached `lastResponse`, rejects proxies/accessors/inherited selected fields/coercion, and ignores every unknown field without enumeration. The fresh frozen null-prototype output fixes schema `1`, provider `stripe`, and operation `checkout_session_create`, then retains technically bounded server-only Session business primitives. Those fixed labels are not provider-origin or execution proof. It reduces a raw URL to `bounded_https_capability_present` or `absent`; request ID, idempotency key, Stripe account ID, API-version text, and response status become only fixed redacted categories. It returns no raw URL, callback, request/key/account value, metadata, customer/contact data, client secret, response body/headers/socket, or raw response.

C4C2B1's `untrusted_checkout_session_projection` is forgeable, server-only, unsafe to log or expose, and not persistence-authorized. A bounded Session ID is not result or business proof. The URL category does not approve a host, callback, or fragment, and response categories do not prove provider origin/account, dispatch/delivery, idempotency-key use, plan/send/configuration binding, current time, payment, capacity, inventory, retention, persistence, or business state. #280 adds no SDK/provider call, C4C1 positive mapping, journal write, endpoint/index/runtime import, deployment, or live behavior.

PAY-002B2C4C2B2A [#285](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/285) owns only the unused pure `classifyStripeCheckoutSessionResponseBinding` policy. It accepts one frozen null-prototype exact schema-1 capsule containing an already-created exact #280 projection plus separately supplied observed and expected API-version, idempotency-key, and optional Stripe-account primitives. It revalidates both exact contracts without coercion. Exact API version `2023-10-16`, exact non-missing key equality, matching optional account observations, expected-200, bounded request-ID, and bounded HTTPS-capability categories produce only a fresh fixed `untrusted_transport_binding_candidate`. Valid mismatch, missing mandatory evidence, one-sided account, or contradictory/unsafe projection category returns fixed `reconciliation_required`; malformed input throws one fixed redacted error.

#285 does not call #280, read or re-read a Session or `lastResponse`, cross an asynchronous boundary, retain references, call Stripe, or write anything. The raw Session ID, URL, request ID, API version, key, account, source object, personal data, and secret never enter output, logs, persistence, or artifacts. Matching absent account observations prove only equality, not platform-account identity or control. The word `expected` gives no provenance. The candidate is not C4C1 evidence and proves no provider origin/account, same-SDK-promise capture, C4A/C4B/configuration binding, dispatch/delivery, idempotent request use, approved URL/callback, current time, business state, retention, persistence, replay, or runtime adoption.

The remaining C4C2B2 runtime boundary remains open. It must control the SDK promise, capture the projection and raw facts synchronously, derive expected values from trusted C4A/C4B and protected configuration evidence, validate the memory-only capability URL against approved origins/callbacks, bind the projection to trusted current-time and business facts, persist only approved server evidence under the retention decision, and return a current URL without logging or persisting the URL. The later saga must persist only a server-only Session ID, expiry, and minimal reviewed evidence—not the Checkout URL—and retrieve/revalidate by ID before URL replay.

B2A/B2B/C1/C2/C3B/C3C/C4A/C4B add no TTL. Deleting paired plan, send, reconciliation, or authorization evidence could remove a durable duplicate barrier, so [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) must approve retention and a server-only tombstone or equivalent durable barrier before any journal record is removed. CI-001B3 [#167](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/167) runs the exact demo-project/opt-in command-journal suite as a separate hosted release prerequisite; #169, #173, #182, #206, #226, #232, and #238 expand that same file. Hosted results remain synthetic source proof only. The current foundations, including C3A/C3B/C3C/C4A/C4B/C4C1, test-only C4C2A, source-only C4C2B1, and source-only C4C2B2A, are unused: they add no endpoint/index export, Firebase deployment, Stripe/provider configuration, production read/write, website change, or officer behavior. Source, tests, merge, website publication, `runmprc.com` verification, Firebase deployment, provider configuration, production data, and live behavior remain separate states.

### Problem

Checkout Session, Stripe Product/Price/Payment Link, and Refund creation have no idempotency keys. One overloaded `status` field mixes payment, registration, fulfillment, cancellation, refund, transfer, and dispute state. Network loss/retry can duplicate external operations; impossible transitions are currently allowed.

### Scope

- Define separate `paymentStatus`, `registrationStatus`, `fulfillmentStatus`, confirmed `refundStatus`, and one record/state per dispute with allowed structural transition matrices. Any singular dispute summary is derived compatibility only.
- Keep/derive legacy `status` during an additive migration.
- Require client/admin `commandId` UUIDs; hash caller scope + ID into `checkoutRequests`/`commands` records with payload fingerprint.
- Reusing the same ID/payload returns the same result; different payload fails.
- Create local business/command record before external API call.
- Pass deterministic Stripe idempotency keys for Sessions, Products/Prices where applicable, refunds, and other creates.
- Persist saga step, attempt number, external ID, last error code, retryability, and timestamps.
- Add compensating actions and recovery rules for lost response and known failure.
- Move audit from mutable unbounded arrays toward append-oriented events or a bounded compatibility layer.

### Acceptance criteria

- [ ] Retrying a lost race/merch checkout response returns one business record and one active Session.
- [ ] Command ID reuse with a different payload is rejected.
- [ ] A paid/fulfilled/refunded/cancelled record cannot enter an impossible predecessor state.
- [ ] Refund retry cannot create a second refund for the same approved command.
- [ ] A crash between Firestore and Stripe is recoverable without guessing or manual field edits.
- [ ] Legacy records remain readable and the migration is dry-runnable/idempotent.

### Tests/evidence

- Pure table-driven transition tests.
- Concurrent duplicate command tests.
- Inject failure before/after external mock returns and before/after local persistence.
- Migration dry-run/backfill report on emulator fixtures representing every legacy status.

### Agent handoff

This is a shared domain foundation, not a UI task. Split state model/migration and command-idempotency infrastructure into sequential PRs if needed, but do not let race/shop implement incompatible keys or states.

---

## PAY-003 — Build idempotent, async-aware Stripe webhook ingestion

**Labels:** `priority:P0`, `type:security`, `type:reliability`, `area:stripe`, `area:firebase`, `size:L`
**Status:** `partial_implemented_locally`; a backward-compatible safety slice and unit evidence exist, while the PAY-001/PAY-002 migration and provider/emulator rehearsal remain open
**Depends on:** CONFIG-001 and PAY-001/PAY-002 target model; initial patch must remain compatible

### Problem

The current webhook verifies signatures but has no Event-ID ledger. It marks every Checkout completion paid without validating payment status, actual amount/currency, environment, metadata, or predecessor state; omits async outcomes; handles order expiry/disputes incompletely; and cannot resolve persistence-first/late metadata references reliably.

### Scope

- Verify method, signature over raw body, generic error response, expected environment/livemode, and supported event types.
- Create `stripeEvents/{event.id}` durable inbox/dedupe records without PII.
- Atomically apply business transition and processed marker where possible; define lease/retry/dead-letter behavior otherwise.
- Resolve business record from schema-versioned trusted metadata/client reference; support legacy Session/PaymentIntent query fallback during migration.
- Handle paid/unpaid `checkout.session.completed`, async success/failure, expiration for registration and order, refund totals, and disputes for both domains.
- Validate object/mode, Session/PaymentIntent ownership, expected amount, currency, discount policy, metadata, and allowed predecessor state.
- Store actual subtotal/discount/tax/shipping/total, PaymentIntent/Charge IDs, event/object references, and redacted transition audit.
- Quarantine permanent anomalies and return `5xx` only for retryable failures.
- Prevent completion from resurrecting terminal cancelled/refunded/fulfilled records.

### Acceptance criteria

- [ ] Exact duplicate Event ID produces no second transition/email/counter/inventory/refund effect.
- [ ] Distinct out-of-order Events reduce to a valid final state.
- [ ] `completed` with `payment_status != paid` stays pending/processing.
- [ ] Async success confirms; async failure fails/releases through the approved service.
- [ ] Wrong amount, currency, environment, metadata, or Stripe ownership never marks paid.
- [ ] Registration and merchandise expiry/refund/dispute paths are represented.
- [ ] Unknown/terminal transitions are safely ignored/quarantined and alerted.
- [ ] Successful processing and durable acceptance meet the defined latency/retry semantics.

### Tests/evidence

- Signed fixtures for immediate registration/order success, unpaid completion, async outcomes, duplicate/reordered events, mismatches, metadata-direct and legacy lookup, terminal-state protection, expiry, partial/full refunds, disputes, invalid signature, transient Firestore failure, and permanent quarantine.
- Emulator transaction integration test plus test-mode Stripe delivery rehearsal.

### Agent handoff

The in-progress slice may add safe confirmation and dedupe before the full PAY-002 migration. Clearly document remaining gaps; do not call partial unit coverage production-ready.

---

## RACE-001 — Add transactional race-capacity reservations

**Labels:** `priority:P0`, `type:feature`, `type:reliability`, `area:race`, `area:firebase`, `size:L`, `needs-migration`
**Status:** Proposed
**Depends on:** PAY-002 and PAY-003 event contract

### Problem

Capacity is a count-then-create query outside a transaction. Two concurrent final-seat requests can both succeed. Pending Sessions hold seats for their default lifetime but cleanup waits seven days. `registeredCount` is displayed and initialized but never updated.

### Scope

- Define participant capacity/reserved/paid counters and counter schema version on the event or dedicated counter record.
- Build an idempotent dry-run/backfill that counts legacy active participant registrations and reports drift.
- In one transaction, validate registration window/visibility/capacity, increment reserved once, and create the local pending/processing registration and checkout command.
- Set a deliberate Session/hold expiry and store it.
- Convert reserved to paid on verified payment; release once on expiry, async failure, authoritative cancellation, or policy-approved full refund.
- Make free participant and comp flows use the same counter; volunteers are separate.
- Define duplicate command reuse, admin late/comp behavior, event close/cancel behavior, and optional waitlist as follow-up.
- Replace UI-derived `registeredCount` with authoritative projected counts.

### Acceptance criteria

- [ ] In 20+ concurrent attempts for one remaining seat, at most one holds/succeeds.
- [ ] Duplicate request holds one seat.
- [ ] Expiry/cancellation/failure releases exactly one seat.
- [ ] Paid confirmation does not double-count; duplicate webhook has no effect.
- [ ] Volunteers do not consume participant capacity.
- [ ] Admin late/comp cannot silently exceed capacity; explicit override is permissioned/audited if approved.
- [ ] Counter backfill can rerun and reports no unexplained drift before cutover.

### Tests/evidence

- Firestore emulator concurrency tests for final seat, duplicate request, expiry/payment race, cancellation/payment race, comp/free/volunteer, and migration.
- Staging Stripe Session expiry rehearsal.

### Agent handoff

Do not hold a Firestore transaction open across a Stripe API call. Use the saga in `STRIPE_COMMERCE_DESIGN.md`. Waitlist can be a separate issue if not needed for launch.

---

## MERCH-001 — Add SKU variants and transactional inventory reservations

**Labels:** `priority:P0`, `type:feature`, `type:reliability`, `area:shop`, `area:firebase`, `area:stripe`, `size:L`, `needs-migration`
**Status:** Proposed
**Depends on:** PAY-002 and PAY-003 event contract

### Problem

Products contain independent size/color arrays and one price, with no canonical SKU or stock counts. The backend allows omitted size/color even when options exist and can sell the final item repeatedly.

### Scope

- Add `products/{id}/variants/{variantId}` with immutable SKU, option values, price/currency, sellable status, physical `onHand`, held `reserved`, and cumulative-reporting `sold`; availability is `onHand - reserved`.
- Build admin/import validation that prevents duplicate option combinations/SKUs and unsafe negative changes.
- Migrate existing product options in dry-run/report mode; require owner stock counts before activation.
- Require one valid variant and launch quantity policy in checkout.
- Transactionally reserve available stock with the local order/command.
- On verified payment, decrement `reserved` and `onHand` and increment `sold`; on expiry/failure/cancellation release only `reserved`.
- Separate returns/restock/write-off from financial refund.
- Derive product `sold_out` display from variants without using it as the integrity control.

### Acceptance criteria

- [ ] Every sellable option combination maps to one SKU/variant.
- [ ] Omitted, invalid, inactive, duplicate, or price-mismatched variant fails server-side.
- [ ] Concurrent final-unit attempts cannot make availability negative or create more than one hold.
- [ ] Migration/admin adjustment tests prove `sold` is never subtracted twice and approved restock increments physical `onHand` only.
- [ ] Duplicate request/webhook holds/sells once.
- [ ] Expiry/cancellation releases once; refund alone does not restock.
- [ ] Admin stock adjustment is scoped, reasoned, audited, and cannot erase history.

### Tests/evidence

- Emulator concurrency and transition tests for final unit, multiple variants, duplicate command, expiry/payment race, refund/return, and stock adjustment.
- Migration report verified by merchandise owner.

### Agent handoff

Start with quantity one if a multi-item cart is not explicitly required. Multi-line atomic reservation and shipping calculation should be a separate design.

---

## PAY-004 — Make cancellation authoritative and replace reusable late Payment Links

**Labels:** `priority:P0`, `type:security`, `type:reliability`, `area:stripe`, `area:race`, `area:shop`, `size:L`
**Status:** Proposed
**Depends on:** PAY-002, PAY-003, RACE-001; MERCH-001 for shop release

### Problem

Admin cancellation changes only Firestore; the Checkout Session remains payable and the webhook can reopen a cancelled record. Late registration creates a reusable Payment Link whose generated Sessions are not stored/resolved, so payment never reconciles and link reuse can charge multiple times.

### Scope

- Separate unpaid cancellation, paid cancellation-with-refund decision, event/product closure, and exception review.
- For unpaid active checkout, persist cancellation command, expire the exact Stripe Session, then release capacity/inventory once under a recoverable saga.
- Handle payment racing with cancellation by retrieving canonical Stripe state and entering paid-after-cancel review/refund policy.
- Expire open Sessions when an event/product/variant is disabled according to bounded batch/job behavior.
- Replace late-add Payment Links with one-off, expiring, idempotent Checkout Sessions tied to one registration and command.
- Communicate late checkout URL through an authorized, expiring channel; prevent multiple active attempts unless versioned.
- Migrate/deactivate legacy Payment Links and reconcile any charges.

### Acceptance criteria

- [ ] Cancelled unpaid record cannot subsequently be paid through the old Session.
- [ ] Cancellation retry is idempotent and hold releases once.
- [ ] Payment/cancel race never silently loses money or resurrects terminal state.
- [ ] One late registration produces at most one successful paid Session and reconciles through normal webhook logic.
- [ ] Legacy Payment Links are inventoried, deactivated, and reconciled.
- [ ] Paid cancellation requires explicit permission/reason/refund choice.

### Tests/evidence

- Stripe mock/test-mode races for cancel before/after completion, lost expire response, duplicate cancel, event closure batches, late link reuse, and payment-after-cancel.

### Agent handoff

Do not mark local cancelled before considering the live Stripe Session and recovery state. Never email a reusable unrestricted Payment Link as a shortcut.

---

## PAY-005 — Build idempotent refunds, disputes, and reconciliation

**Labels:** `priority:P0`, `type:security`, `type:reliability`, `area:stripe`, `size:L`
**Status:** Partial. Immediate amount containment is tracked in [#200](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/200), and resolved-result containment source/tests are tracked in [#204](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/204); the broader refund/dispute/reconciliation system remains proposed.
**Depends on:** PAY-002, PAY-003, AUTH-003 for final permissions

### Problem

Refund functions call Stripe without idempotency, immediately overwrite local status, weakly validate amount/current state/remaining balance, and do not track cumulative actual refund. Dispute handling is registration-only and audit-only. No scheduled reconciliation proves Stripe and Firestore agree.

PAY-005A1 [#200](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/200) is the narrow immediate containment outcome. It makes both current partial-refund entry points accept only a primitive positive safe-integer amount below the stored original cents, requires every admitted partial request to send that exact `amount` to Stripe, and derives partial/full classification from the explicit action. Invalid caller or stored values stop before Stripe construction/refund creation and before business-record writes. A provider exception returns a fixed result-not-confirmed, do-not-retry, and escalate message because Stripe may already have accepted the request. This does not add idempotency, remaining-refundable provider truth, concurrency control, event-finalized totals, capabilities, deployment, or live proof.

PAY-005A2 [#204](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/204) is the companion resolved-result containment outcome. Before Stripe construction, both endpoints require one exact stored `pi_` target, positive safe-integer original cents, and lowercase `usd`. After one provider call, only a plain `refund` object with a bounded `re_` ID, exact `succeeded` status, matching primitive PaymentIntent/currency, and a permitted positive safe-integer amount can reach the local success write. A partial must equal requested cents; an explicit full action accepts Stripe's returned full-remaining amount up to the original total and audits that validated actual amount. A thrown, malformed, mismatched, pending, action-required, failed, cancelled, or unknown Stripe result gets the same fixed do-not-retry response and no local success write is attempted. If the later local write reports an error or its acknowledgement is lost, the same fixed response is returned but the local record is unknown because the write may have committed. This still does not create a durable pre-send operation, idempotency, provider retrieval/reconciliation, event-finalized totals, concurrency control, capabilities, deployment, or live proof.

### Scope

- Create refund command records with stable ID, actor/capability, reason, requested integer cents, payment snapshot, status, and Stripe idempotency key.
- Validate against Stripe's actual captured and cumulative refunded totals, not original list price alone.
- Model pending/succeeded/failed/cancelled refund and cumulative amount; let verified events finalize.
- Protect concurrent partial/full refunds and repeated clicks/timeouts.
- Handle disputes for orders and registrations across required lifecycle events; alert finance with no unnecessary PII.
- Build scheduled and operator-triggered reconciliation for Sessions/PaymentIntents/refunds/disputes/local records/counters/event inbox.
- Classify deterministic safe repair versus quarantine; create audited idempotent repair commands.

### Acceptance criteria

- [ ] Same refund command can be retried without a second refund.
- [ ] Two concurrent partial refunds cannot exceed remaining amount.
- [ ] Equal/over-limit/non-integer/invalid-state refund fails clearly.
- [ ] Local final totals come from verified Stripe state and preserve fulfillment/registration state separately.
- [ ] Race and merchandise disputes alert and reconcile through closure.
- [ ] Reconciliation detects orphan Stripe payment, false local paid, amount/currency mismatch, duplicate mapping, stale saga, and refund/dispute mismatch.
- [ ] Ambiguous mismatches are quarantined, not overwritten automatically.

### Tests/evidence

- Failure injection before/after Stripe response; duplicate/concurrent partials; pending/failed/succeeded events; full-after-partial; dispute lifecycle; reconciliation fixture for every category; repair idempotency.
- Staging finance review of report totals.
- PAY-005A2/#204: a 47-case pure validator matrix rejects coercion, prototypes, accessors, malformed/mismatched values, and every non-succeeded status while returning only a frozen validated projection. The initial dual-endpoint red matrix exposed 46 unsafe preflight/result cases, and two additional red cases exposed raw post-provider storage failures. The final 174 focused tests prove no Stripe call for invalid stored targets, one call for admitted requests, no local success write attempt for a rejected Stripe result, no success response after synthetic pre-commit or commit-then-error local-write failures, the same fixed do-not-retry response at both ambiguous boundaries, and validated full-remaining cents in the audit. The commit-then-error case proves why a lost acknowledgement leaves local state unknown and requires reconciliation.

### Agent handoff

Do not duplicate PAY-005A1 [#200](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/200) or PAY-005A2 [#204](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/204). These are immediate containment only. Separate durable refund command/state from the broader reconciliation worker into sequential PRs. Never hand-edit Firestore to make reconciliation pass, and never retry an ambiguous provider result blindly.

---

## MAIL-001 — Build an escaped, idempotent transactional email outbox

**Labels:** `priority:P1`, `type:security`, `type:reliability`, `area:firebase`, `area:privacy`, `size:M`, `needs-external-config`
**Status:** Proposed
**Depends on:** PAY-003

### Problem

Registration email triggers check a marker, add a random `mail` document, then update the marker. Trigger retries can enqueue duplicates. User/event values are interpolated into HTML without escaping, enabling club-branded malicious markup. “Sent” currently means queued, not delivered. Merchandise/refund/cancellation/fulfillment/dispute communications and bounce handling are absent.

### Scope

- Create deterministic outbox IDs such as `{businessId}:{messageType}:{version}` in a transaction with the triggering state.
- Escape every dynamic HTML value or use provider templates with escaping-by-default.
- Store delivery lifecycle separately: queued, provider accepted, delivered if available, bounced/failed/suppressed.
- Implement idempotent registration and order confirmation first; add approved cancellation/refund/fulfillment templates.
- Never include bearer tokens, emergency contacts, DOB, full addresses, or arbitrary admin notes.
- Rate-limit/abuse-protect free/volunteer flows that can target third-party email addresses.
- Configure and document sender domain, SPF, DKIM, DMARC, provider credentials, bounce/suppression handling, and monitoring.

### Acceptance criteria

- [ ] Trigger/event retry creates exactly one outbox message per type/version.
- [ ] Hostile names/event titles/locations render as text, not markup/link/image/script.
- [ ] Queue success is not mislabeled delivered.
- [ ] Payment confirmation is sent only after verified paid/non-payment confirmed state.
- [ ] Failure/bounce is visible and retry rules cannot spam the recipient.
- [ ] Browser admins cannot create arbitrary `mail` documents.

### Tests/evidence

- Hostile HTML/URL/control-character fixtures; concurrent/retried trigger; provider failure/retry; duplicate webhook; suppression/bounce fixture.
- Private DNS/provider verification evidence.

### Agent handoff

Keep templates generic until legal/communications copy is approved. Do not weaken escaping to allow Firestore-authored raw HTML.

---

## DATA-001 — Replace confirmation bearer URLs and implement PII minimization

**Labels:** `priority:P1`, `type:security`, `type:compliance`, `area:privacy`, `area:web`, `area:firebase`, `size:L`, `needs-migration`
**Status:** Proposed
**Depends on:** PAY-002, PAY-003

### Problem

High-entropy confirmation tokens are stored plaintext with no expiry and placed in query strings. They can leak through history, screenshots, monitoring, analytics, logs, and referrers. Registrations/orders retain DOB, emergency contacts, shipping addresses, arbitrary extras, Stripe IDs, and audit emails without field-specific retention or deletion/export workflow.

### Scope

- For paid checkout, use `{CHECKOUT_SESSION_ID}` only and a server endpoint that retrieves/verifies Stripe/local ownership before returning a sanitized projection.
- For signed-in users, prefer UID ownership and verified-email linking policy.
- For anonymous free/legacy lookup, store only a token hash, add expiry/rotation/one-time exchange as appropriate, use URL fragment/session state, and scrub history immediately.
- Add restrictive referrer/analytics/error-monitoring behavior to confirmation/account/admin routes.
- Define data classification and owner-approved field retention; separate long-lived accounting/waiver evidence from short-lived operational PII.
- Implement report-only then active redaction/deletion jobs, user access/deletion export, and backup implications.
- Create role/purpose-specific projections and remove PII from logs/audit notes.

### Acceptance criteria

- [ ] Long-lived plaintext bearer capability is absent from query strings and stored records.
- [ ] Guessing a business ID/Session ID alone does not expose another person's PII.
- [ ] Confirmation projection includes only necessary name/item/status/amount fields.
- [ ] Analytics/Sentry/referrer behavior cannot capture capability or sensitive URL state.
- [ ] Retention job is idempotent, dry-runnable, auditable, and preserves legally required minimum evidence.
- [ ] Access/deletion requests authenticate the subject and do not erase required financial/audit evidence improperly.

### Tests/evidence

- Cross-user/expired/replayed/tampered token and Session tests; browser history/referrer/monitoring inspection; retention fixtures across statuses/dates; backup/restore deletion notes.

### Agent handoff

Retention durations require LEGAL-001 owner approval. Implement mechanisms and report-only modes without inventing legal periods.

---

## DATA-002 — Create immutable, truthful waiver evidence

**Labels:** `priority:P1`, `type:compliance`, `type:security`, `area:race`, `area:privacy`, `size:M`, `needs-migration`
**Status:** Blocked on owner/legal/insurance decisions
**Depends on:** RACE-001 and LEGAL-001 waiver decision

### Problem

Normal registration stores timestamp/version but no immutable text/hash/provenance. Admin comp and late-add paths currently set `waiverAcceptedAt=now` even though the participant did not accept anything. Substitution preserves or rewrites runner identity without collecting the substitute's acceptance.

### Scope

- Establish approved waiver versioning, effective date, canonical text/PDF location, content hash, event association, and retention.
- Record acceptance provenance: participant-authenticated or anonymous flow, timestamp, waiver hash/version, registration ID, and approved contextual evidence.
- Define minor/guardian behavior, if applicable, with counsel/insurance.
- Separate `waiver_required`, `waiver_pending`, and `waiver_accepted`; never fabricate acceptance on admin creation.
- Make comp/late/substitute flows send a one-time acceptance request before confirmed eligibility.
- Freeze old waiver evidence even when event waiver text changes.
- Provide audited admin view/export of minimum evidence.

### Acceptance criteria

- [ ] Every confirmed participant has required acceptance for the exact immutable waiver version or an approved documented exception.
- [ ] Admin-created record cannot claim participant acceptance.
- [ ] Substitute cannot see the prior runner's sensitive data and must accept independently.
- [ ] Editing an event creates a new waiver version rather than rewriting evidence.
- [ ] Evidence retention/access follows approved policy and survives required backup/restore.

### Tests/evidence

- Version change, comp/late, substitution, anonymous/authenticated, retry, expired acceptance link, minor/guardian decision, and immutable snapshot tests.
- Approved waiver/policy reference stored outside public issue as appropriate.

### Agent handoff

Stop until legal/insurance owners approve evidence and minor policy. Code agents must not write waiver language or decide whether IP/user-agent collection is appropriate.

---

## ADMIN-001 — Move sensitive admin operations behind scoped APIs and durable audit

**Labels:** `priority:P1`, `type:security`, `type:feature`, `area:firebase`, `area:auth`, `size:L`, `needs-migration`
**Status:** Proposed
**Depends on:** SEC-001, AUTH-003, PAY-002

### Problem

Admin clients directly read/write events/products and, under the original catch-all, could directly alter any record. Some function actions still allow impossible transitions or unbounded notes. Inline mutable `auditLog` arrays can grow/contention-limit records. CSV export exposes a fixed broad set including DOB, emergency contacts, and Stripe IDs without purpose, re-auth, or export audit.

### Scope

- Build scoped server APIs for event/product configuration fields that affect money, capacity, inventory, visibility, waiver, Stripe catalog, or lifecycle.
- Keep harmless editorial direct writes only if rules and audit requirements justify them; otherwise move all admin mutations server-side.
- Enforce capability, verified email, App Check, recent auth where required, strict schema, current state, reason, and idempotent command.
- Replace inline audit arrays with append-oriented audit events protected from client mutation; define retention/query indexes.
- Return role-appropriate projections so race/shop/membership/finance roles see minimum data.
- Split exports into check-in roster, emergency sheet, finance report, and fulfillment report with minimum columns, bounded size/streaming, re-auth, reason, watermark/identifier, and durable export audit.
- Correct substitution ownership and waiver flow.

### Acceptance criteria

- [ ] No client can directly mutate price, payment, capacity/inventory counter, Stripe ID, refund, role, waiver evidence, audit, or secret fields.
- [ ] Every admin command has actor/capability/target/reason/old-new/result/correlation audit.
- [ ] Forbidden state/capability combinations are table-tested.
- [ ] Race director/shop lead/finance/membership projections contain no unrelated PII.
- [ ] Exports are purpose-specific, formula-safe, audited, and require approved authentication.
- [ ] Audit cannot be edited/deleted by ordinary browser admins.

### Tests/evidence

- Capability matrix tests, hostile/bounds inputs, duplicate commands, impossible transitions, audit immutability, export PII column snapshots/formula fixtures/large dataset.

### Agent handoff

This is an epic-sized issue. Split APIs by domain after the common auth/schema/audit middleware lands. Preserve current admin functionality through expand-and-contract deployment.

---

## MERCH-002 — Configure shipping, tax, returns, and order communications

**Labels:** `priority:P1`, `type:feature`, `type:compliance`, `area:shop`, `area:stripe`, `size:L`, `needs-external-config`, `status:blocked-owner`
**Status:** Blocked on owner/accountant policy
**Depends on:** MERCH-001, LEGAL-001, MAIL-001

### Problem

Checkout collects US/Canada shipping address but the platform has no approved shipping rates/methods, pickup option, country/tax policy, return/restock process, customer delivery commitment, or order/refund/fulfillment communication. Local `amountCents` excludes discount/tax/shipping breakdown.

### Scope

- Obtain owner/accountant decisions for sellable jurisdictions, tax nexus/treatment, Stripe Tax, shipping/pickup methods/rates, delivery estimates, returns/exchanges/lost packages, and refund of shipping/fees.
- Model/store expected and actual subtotal, discount, tax, shipping, and total separately.
- Set Stripe product tax codes and automatic-tax/address behavior if approved.
- Configure allowed countries and shipping rates/methods server-side.
- Add fulfillment transitions, tracking validation, pickup flow, return inspection/restock/write-off, and customer notifications.
- Minimize shipping address after fulfillment/return/legal window.

### Acceptance criteria

- [ ] Checkout total/tax/shipping exactly reconciles with local actual breakdown.
- [ ] Unsupported destination/method cannot order.
- [ ] Fulfillment cannot occur before paid; refund does not automatically restock.
- [ ] Customer receives approved order, shipment/pickup, cancellation, return, and refund communication once.
- [ ] Address access/retention is role-limited and documented.
- [ ] Stripe Dashboard/tax/export configuration is reviewed by finance.

### Tests/evidence

- Supported/unsupported destination, tax on/off/error, shipping/pickup totals, lost payment response, fulfillment/refund/return, and retention tests.
- Private accountant/owner approval and Stripe configuration evidence.

### Agent handoff

Do not enable Stripe Tax, Canada shipping, or collect additional addresses until policy/finance decisions are explicit.

---

## WEB-001 — Move to controlled hosting and add browser security policy

**Labels:** `priority:P1`, `type:security`, `type:maintenance`, `area:web`, `size:L`, `needs-external-config`
**Status:** Proposed
**Depends on:** SAFETY-001, CI-001

### Problem

GitHub Pages relies on a JavaScript 404 bridge for every deep link and offers limited application-controlled response headers. The app loads external fonts/images/maps/services and parses stored HTML with `html-react-parser` without sanitization. No deployed CSP, frame-ancestor, referrer, permissions, or nosniff policy is declared.

### Scope

- Evaluate and migrate production/staging to Firebase Hosting (preferred with current stack) or an equivalent owned CDN supporting SPA rewrites, preview channels, rollbacks, custom domain, and headers.
- Preserve canonical domain, redirects, SEO, sitemap, `404`, OAuth/Stripe callbacks, assets, and GitHub workflow protections.
- Inventory scripts/styles/images/fonts/connect/frame/form/network endpoints and create a restrictive tested CSP.
- Add HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame protection via CSP, and safe caching.
- Remove arbitrary stored HTML in favor of structured content, or sanitize with a maintained allowlist and test it.
- Validate external URLs and prevent dangerous schemes/open redirects.
- Add preview/staging smoke and rollback test.

### Acceptance criteria

- [ ] Direct navigation/callback/reload works with server rewrite; no query/hash bridge loss.
- [ ] Security headers are visible on production/staging responses and do not require unsafe broad CSP exceptions.
- [ ] Stored hostile HTML cannot execute/inject active content.
- [ ] App Check/Auth/Stripe/Strava/Sentry/Analytics still function under documented policy.
- [ ] Canonical/robots/sitemap/custom domain/TLS and rollback are verified.
- [ ] Old GitHub Pages deployment cannot accidentally overwrite production after cutover.

### Tests/evidence

- Automated header/CSP tests; route/callback smoke; hostile HTML/URL fixtures; accessibility/build/SEO checks; DNS/TLS/rollback evidence.

### Agent handoff

Hosting cutover changes external state and needs DNS/owner approval. Implement configuration and staging validation first; do not redirect production autonomously.

---

## OBS-001 — Add payment observability, alerts, SLOs, and redaction

**Labels:** `priority:P1`, `type:reliability`, `type:operations`, `area:stripe`, `area:firebase`, `area:privacy`, `size:M`, `needs-external-config`
**Status:** Proposed
**Depends on:** PAY-003, PAY-005 interfaces

### Problem

Observability is optional client Sentry/Firebase Analytics. There are no structured payment metrics, webhook/reconciliation alerts, privileged-action alerts, redaction policy, or runbook-linked SLOs. Sentry records user email and enables replay on error, which may expose PII from registration/account/admin routes.

### Scope

- Define structured server log schema with environment, release, request/command/business/Stripe correlation IDs, state transition, latency, and sanitized error category.
- Add metrics for checkout attempts/results, reservations, verified paid propagation, webhook acceptance/process failures/quarantine/age, refunds/disputes, reconciliation mismatches, email failures, App Check/rate-limit rejects, and counter drift.
- Implement alerts and dashboards for objectives in `SYSTEM_DESIGN.md`; every alert links to an owner/runbook.
- Configure Sentry environments, sampling, retention, source maps, field/URL scrubbing, user pseudonymization, and replay masking/disablement on sensitive routes.
- Define analytics consent/purpose and prohibit PII/high-cardinality secrets in event parameters.
- Add deploy/release markers and a support-safe correlation code.

### Acceptance criteria

- [ ] Paid-but-unconfirmed, wrong-total, failed/quarantined webhook, dispute, refund failure, negative/drift counter, and stale reservation create actionable alerts.
- [ ] Logs/monitoring contain no raw body, secret, bearer token, Checkout URL, full email/IP/address/DOB/emergency contact.
- [ ] Sensitive browser form text/URL query state is not visible in Sentry replay/event payloads.
- [ ] Dashboards distinguish staging/test/live and release version.
- [ ] Alert test reaches primary and backup, and runbook drill resolves a synthetic incident.

### Tests/evidence

- Automated log-redaction snapshots with hostile/sensitive fixtures; synthetic alert tests; Sentry/analytics payload inspection; SLO dashboard screenshot/export without PII.

### Agent handoff

Do not add a high-cardinality metric label for email, business ID, Session ID, or Event ID. Keep those in restricted structured logs only as approved opaque references.

---

## RESILIENCE-001 — Establish backup, restore, retention, and audited repair

**Labels:** `priority:P1`, `type:reliability`, `type:compliance`, `area:firebase`, `area:privacy`, `size:L`, `needs-external-config`
**Status:** Proposed
**Depends on:** DATA-001, PAY-005

### Problem

The repository has no verified Firestore/Auth/config backup inventory, restoration exercise, retention-aware backup policy, or standardized audited repair tooling. Payment records may need roll-forward rather than code rollback because Stripe continues emitting events.

### Scope

- Inventory recovery requirements for Firestore, Firebase Auth, Secret Manager versions, Stripe configuration/reports, email templates/suppression, DNS, GitHub environments, and source artifacts.
- Configure least-privilege encrypted Firestore backups/exports with owner-approved retention and monitoring.
- Document which external systems are authoritative and which configuration must be recreated rather than restored.
- Build isolated non-production restoration procedure and validate references/counters/indexes/rules.
- Run payment reconciliation after restore without contacting live Stripe from restored test data.
- Implement idempotent audited repair commands for reconciliation categories; no manual multi-field edits.
- Define release rollback/roll-forward compatibility, schema version, and checkout-disable behavior.
- Align backup deletion/minimization with approved retention and legal constraints.

### Acceptance criteria

- [ ] Scheduled backup succeeds and access/retention alerts are monitored.
- [ ] Restore into a new isolated project completes within approved recovery objective and passes integrity checks.
- [ ] Restored environment cannot send live email, call live Stripe, or serve production DNS.
- [ ] Counter/event/refund reconciliation reports expected results on restored fixtures.
- [ ] Repair commands are idempotent, permissioned, reasoned, and audited.
- [ ] Recovery gaps for Auth/Secrets/Stripe/DNS are explicitly documented with owners.

### Tests/evidence

- Dated restore drill, sampled record/hash/count report, rules/index verification, no-external-side-effect proof, repair dry-run/apply/rerun report.

### Agent handoff

Cloud backup configuration changes external state and needs an authorized owner. Never download a production backup into a local workspace for testing.

---

## TEST-001 — Build the Stripe/Firebase security integration and E2E suite

**Labels:** `priority:P0`, `type:testing`, `type:security`, `area:stripe`, `area:firebase`, `size:L`
**Status:** In progress through focused children [#175](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/175) and [#177](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/177); the wider integration/E2E program remains proposed
**Depends on:** Core SEC/AUTH/ABUSE/PAY/RACE/MERCH/MAIL/DATA work

### Current child status

TEST-001A is split so a small safety foundation can be reviewed before any end-to-end expansion. TEST-001A1 merged through [#175](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/175) as `e6d8929698b95ddcda78b00108cc7665bf9f5e01`: Functions tests receive deterministic reserved fixtures, one shared synthetic Stripe signer, fail-closed checks for supplied production/live configuration, and a Node transport guard that permits only loopback emulator targets. TEST-001A2 is tracked in [#177](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/177) for a bounded emitted-artifact scanner, its deliberate synthetic test suite, one exact named CI job, and both protected-release job lists. It uploads no artifact. Neither child authorizes provider calls, production data, Firebase deployment, or live payment testing.

### Problem

Before this planning pass, Functions had seven tests and about 20% line coverage; webhook tests covered only invalid signature/method. Firestore rule tests cover many paths but intentionally asserted unsafe admin access. There is no test proving the cross-system sagas under concurrency/retry/provider failure.

### Scope

- Define test layers: pure schema/state reducers, Functions unit tests, Firestore/Auth/Functions emulator integration, signed Stripe fixtures/CLI, React flow tests, and isolated staging E2E.
- Build deterministic factories with synthetic PII and no live network fallback.
- Cover the full matrix in `STRIPE_COMMERCE_DESIGN.md`, including duplicate/out-of-order events, async, mismatches, idempotency failure injection, capacity/SKU concurrency, cancellation/payment races, refunds/disputes, email, confirmation, RBAC, App Check, and reconciliation.
- Add explicit production-host/key guard that fails tests if environment resembles production/live.
- Set meaningful coverage thresholds on trusted payment/auth/state modules; do not chase coverage on static UI.
- Make CI artifacts show test/coverage/reconciliation results without sensitive fixture data.

### Acceptance criteria

- [ ] Every P0 payment and auth invariant has at least one positive and one negative automated test.
- [ ] Concurrent last-seat/SKU tests are deterministic and pass repeatedly.
- [ ] Failure injection covers every Firestore-before/after-Stripe boundary and retry.
- [ ] Signed fixtures cover all configured Stripe event types, duplicates, ordering, livemode, amount/currency/reference mismatches.
- [ ] Rules tests prove protected paths for anonymous/member/every admin capability.
- [ ] Staging E2E passes with Stripe test mode and dedicated Firebase project.
- [ ] No test can invoke production or expose real PII/secrets.

### Tests/evidence

This issue is itself the test program. Produce a traceability table mapping each system invariant/risk ID to tests and attach the release test report.

### Agent handoff

Split by layer/domain into sequential PRs, starting with trusted state/schema and emulator fixtures. Do not make external network tests required for every fast unit-test run; keep a separate gated staging suite.

---

## LEGAL-001 — Approve legal, tax, insurance, privacy, refund, and fulfillment policy

**Labels:** `priority:P0`, `type:compliance`, `type:operations`, `status:blocked-owner`, `size:M`
**Status:** Blocked on MPRC leadership and qualified advisers
**Depends on:** None; runs in parallel

### Problem

Live Terms and Privacy pages explicitly say they are placeholders. Code cannot decide the club's refund/cancellation policy, waiver evidence/minor policy, merchandise tax nexus, shipping/returns, data retention, incident notification, accessibility obligations, or vendor agreements.

### Scope

Owners obtain appropriate legal, tax/accounting, insurance, and organizational review and record approved decisions for:

- Terms, privacy notice, contact/security reporting, cookies/analytics/Sentry, vendors and international transfers if relevant.
- Event cancellation/reschedule/refund/transfer/substitution and processing-fee policy.
- Versioned waiver, evidence, minor/guardian requirements, and retention.
- Merchandise sales tax, supported jurisdictions, shipping/pickup, delivery, returns/exchanges/lost goods.
- Data collection necessity, subject access/deletion, field-specific retention, backup deletion, incident notification.
- Support, disputes, chargebacks, accessibility, acceptable use, and prohibited sales.

Publish versioned approved content and configuration inputs without putting privileged advice/private data in the repository.

### Acceptance criteria

- [ ] Placeholder warnings and dates are replaced with approved versioned content before live mode.
- [ ] Every required data field has purpose/retention/access owner.
- [ ] Refund/transfer/cancellation and waiver decisions map to explicit state transitions.
- [ ] Tax/shipping/product decisions map to Stripe/catalog configuration.
- [ ] Vendor list/agreements and security/privacy contact are established.
- [ ] Leadership records approval and next review date privately.

### Tests/evidence

- Product/engineering traceability checklist from each approved rule to implementation issue/config/test.
- Content review for links, dates, contact, accessibility, and version/hash.

### Agent handoff

This issue cannot be completed autonomously. Agents may inventory questions, wire approved copy, and test versioning, but must not generate policy and mark it legally approved.

---

## OPS-001 — Configure production systems and run a controlled live pilot

**Labels:** `priority:P0`, `type:operations`, `area:stripe`, `area:firebase`, `needs-external-config`, `status:blocked-owner`, `size:L`
**Status:** Blocked by all launch gates
**Depends on:** CI-001, TEST-001, LEGAL-001, OBS-001, RESILIENCE-001 and every P0 commerce/security issue

### Problem

Repository code cannot prove external production configuration. MPRC needs owned accounts, isolated environments, MFA/roles, secrets, webhooks, App Check, IAM, DNS, email, Radar, alerts, backups, and a controlled live transaction before broadly accepting money.

### Scope

- Complete the ownership roster in `OPERATIONS_RUNBOOK.md` with primary/backup and least privilege.
- Create/verify dedicated staging Firebase project and Stripe test/sandbox endpoint; keep production isolated.
- Configure Secret Manager bindings, expected livemode/origin, commerce kill switch, App Check Enterprise/enforcement, TTL, budgets, IAM, protected GitHub environments/OIDC, email domain, Sentry redaction, backups, DNS/hosting, and Stripe event allowlist.
- Verify Stripe account legal/support/statement/payout settings, team MFA/passkeys/roles, Radar, tax/shipping decisions, webhook secret rotation, alert ownership, and reconciliation schedule.
- Run full staging dress rehearsal and incident/kill-switch/restore drills.
- Execute one approved low-value live purchase/registration, verify every system/report/email/counter, and optionally issue an approved refund.
- Observe and reconcile before broad enablement; document go/no-go with two-person approval.

### Acceptance criteria

- [ ] All P0 issues are `done` with evidence; no placeholder policy remains.
- [ ] Staging cannot reach live Stripe/production Firebase and local cannot reach either.
- [ ] Production secrets/roles/IAM/MFA/config are reviewed by two owners and rotation tested.
- [ ] Checkout kill switch, webhook failure, orphan payment, admin compromise, and restore drills pass.
- [ ] Controlled live transaction matches Stripe amount/currency/receipt/fee/payout, Firestore states/counters, email, and reconciliation.
- [ ] Any pilot refund/dispute path reconciles as expected.
- [ ] Broad launch has named coverage, alerting, freeze window, and rollback/roll-forward plan.

### Tests/evidence

- Private launch packet with commit/checks, non-secret configuration exports/screenshots, staging matrix, restore/incident drills, pilot Stripe/local reconciliation, approvals, and residual risks.

### Agent handoff

This issue changes live external state and requires explicit authorized owners. An agent may prepare checklists/scripts and analyze redacted results, but must not enable live checkout, alter DNS/payouts, or use production credentials without direct authority.

---

## Suggested GitHub milestones

1. **M0 — Safe development baseline:** SAFETY-001, CI-001A, CONFIG-001, initial SUPPLY-001.
2. **M1 — Trust boundaries:** SEC-001, AUTH-001, AUTH-002, OAUTH-001, ABUSE-001, PAY-001, PROMO-001.
3. **M2 — Payment integrity core:** PAY-002, PAY-003, RACE-001, MERCH-001.
4. **M3 — Complete lifecycle:** PAY-004, PAY-005, MAIL-001, DATA-001, DATA-002, MERCH-002.
5. **M4 — Operable platform:** AUTH-003, ADMIN-001, WEB-001, OBS-001, RESILIENCE-001, remaining CI/SUPPLY work.
6. **M5 — Launch qualification:** TEST-001, LEGAL-001, OPS-001.

## Historical publication checklist

The program is partially published. Treat unchecked rows as future governance work, not permission to bulk-create issues.

- [x] Use an approved authenticated GitHub workflow.
- [ ] Create labels and milestones above.
- [ ] Create only dependency-ready, non-duplicate issues after searching the live milestone; never bulk-publish the snapshot.
- [ ] Add dependency links and project-board status.
- [x] Mark SAFETY-001, SEC-001, PAY-003, and PROMO-001 with distinct source, review, merge, deployment, provider, and live-verification states.
- [ ] Assign business-owner issues to humans; do not assign LEGAL-001/OPS-001 solely to a coding agent.
- [ ] Link root design documents from every issue and link GitHub issue URLs back into this file.
- [ ] Do not include secrets, private account IDs, customer data, or confidential legal advice in issue bodies/evidence.
