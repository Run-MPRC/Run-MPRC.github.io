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
| 3 | SUPPLY-001 | Remove vulnerable dependency chains and stage SDK/build upgrades | P0 | L | ready | CI-001 baseline |
| 4 | SEC-001 | Replace the Firestore admin catch-all with resource-specific rules | P0 | M | source merged #123; Firebase live unproven | — |
| 5 | CONFIG-001 | Fail closed on server environment and commerce configuration | P0 | M | ready | CI-001A recommended |
| 6 | AUTH-001 | Require verified email for member and privileged claims | P0 | M | partial: #98 merged; backend live unproven; parent open | SEC-001 recommended |
| 7 | AUTH-002 | Replace the legacy static-key membership synchronization endpoint | P0 | M | ready | AUTH-001 |
| 8 | OAUTH-001 | Make Strava token lifecycle server-only, transactional, and auditable | P1 | M | proposed | SEC-001, AUTH-003 capability model |
| 9 | AUTH-003 | Introduce scoped admin capabilities, MFA, and recent authentication | P1 | L | proposed | AUTH-001, AUTH-002, SEC-001 |
| 10 | ABUSE-001 | Enforce native App Check and privacy-preserving abuse limits | P0 | L | ready | CI-001 baseline |
| 11 | PAY-001 | Add strict request schemas and immutable monetary snapshots | P0 | L | ready | ABUSE-001 interface agreed |
| 12 | PROMO-001 | Disable unmodeled Stripe promotions until discounts are authoritative | P0 | S | partial_implemented_locally | PAY-001 for final discount contract |
| 13 | PAY-002 | Implement idempotent payment commands and explicit state machines | P0 | L | ready after PAY-001 | CONFIG-001, PAY-001 |
| 14 | PAY-003 | Build idempotent, async-aware Stripe webhook ingestion | P0 | L | partial_implemented_locally | CONFIG-001, PAY-001/PAY-002 target contract |
| 15 | RACE-001 | Add transactional race-capacity reservations | P0 | L | proposed | PAY-002, PAY-003 event contract |
| 16 | MERCH-001 | Add SKU variants and transactional inventory reservations | P0 | L | proposed | PAY-002, PAY-003 event contract |
| 17 | PAY-004 | Make cancellation authoritative and replace reusable late Payment Links | P0 | L | proposed | PAY-002, PAY-003, RACE-001 |
| 18 | PAY-005 | Build idempotent refunds, disputes, and reconciliation | P0 | L | proposed | PAY-002, PAY-003 |
| 19 | MAIL-001 | Build an escaped, idempotent transactional email outbox | P1 | M | proposed | PAY-003 |
| 20 | DATA-001 | Replace confirmation bearer URLs and implement PII minimization | P1 | L | proposed | PAY-002, PAY-003 |
| 21 | DATA-002 | Create immutable, truthful waiver evidence | P1 | M | blocked_owner_decision | RACE-001, LEGAL-001 decision |
| 22 | ADMIN-001 | Move sensitive admin operations behind scoped APIs and durable audit | P1 | L | proposed | SEC-001, AUTH-003, PAY-002 |
| 23 | MERCH-002 | Configure shipping, tax, returns, and order communications | P1 | L | blocked_owner_decision | MERCH-001, LEGAL-001 |
| 24 | WEB-001 | Move to controlled hosting and add browser security policy | P1 | L | proposed | SAFETY-001, CI-001 |
| 25 | OBS-001 | Add payment observability, alerts, SLOs, and redaction | P1 | M | proposed | PAY-003, PAY-005 |
| 26 | RESILIENCE-001 | Establish backup, restore, retention, and audited repair | P1 | L | proposed | DATA-001, PAY-005 |
| 27 | TEST-001 | Build the Stripe/Firebase security integration and E2E suite | P0 | L | proposed | core security/payment/data children |
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

Do not redesign routing or hosting in this issue; WEB-001 owns that. Optimized previews still target production Firebase, so private preview behavior remains blocked on #105/CONFIG. Firebase emulators do not make Stripe, Strava, or email safe. ABUSE-001A must explicitly defer App Check enforcement on `lookupRegistration`, `lookupOrder`, and `stravaExchangeCode` while the initial capability guard is active. DATA-001A owns the two payment-confirmation handoffs; OAUTH-001C owns the Strava exchange handoff. Do not weaken the guard. Do not include any real callback token in fixtures. #118 still owns the reported profile failure.

---

## CI-001 — Repair test gates and secure the deployment pipeline

**Labels:** `priority:P0`, `type:security`, `type:testing`, `area:ci`, `size:L`, `needs-external-config`
**Status:** Published as tracker [#105](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/105). [#103](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/103) merged the deterministic local frontend Jest baseline, and [#124](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/124) added its named blocking hosted-CI step. [#126](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/126) owns the separate standalone SPA test gate. Fail-closed lint, required branch protection, dependency/secret checks, and protected backend-first deployment remain open, so the delivery pipeline is still non-compliant overall.
**Depends on:** SAFETY-001

### Problem

Before #103, frontend tests failed because the Jest environment lacked `TextEncoder`. That child repaired the local baseline, and #124 adds it to hosted CI. CI still runs a mutating `lint:fix` command and ignores its failure with `|| true`. Deployment still runs independently of CI, gives a full Firebase service-account JSON to the frontend build, installs `firebase-tools@latest`, deploys frontend before backend, and can skip or fail before proving Firebase deployment.

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
- [ ] Lint does not rewrite files and cannot be ignored.
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

Repository changes can implement tests/workflow shape, but OIDC/IAM/environment protection requires an authorized owner. CI-001A/#103 owns test reliability, CI-001B1/#124 owns the hosted frontend-Jest step, CI-001B1A/#126 owns the standalone SPA step, and the remaining CI-001B2 deployment-identity/protection work must stay in separately claimed children.

---

## SUPPLY-001 — Remove vulnerable dependency chains and stage SDK/build upgrades

**Labels:** `priority:P0`, `type:maintenance`, `type:security`, `area:web`, `area:firebase`, `area:stripe`, `size:L`
**Status:** Ready after CI baseline
**Depends on:** CI-001A

### Problem

The 2026-07-12 production audit reports 33 root advisories (3 critical, 9 high) and 9 Functions advisories (1 high). The direct router and Firebase client need patches; Firebase Admin needs a staged major upgrade. Unused `gpxparser` pulls obsolete `jsdom/request/form-data`. Create React App is unmaintained and contributes legacy dependency pressure.

### Scope

Deliver as small ordered PRs:

1. Prove `gpxparser` is unused, remove it, refresh lockfile, and retest route behavior.
2. Upgrade `react-router-dom` to the safe compatible 6.x release; test all redirects/navigation.
3. Upgrade Firebase web SDK within compatibility, then evaluate/stage the next supported major.
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

### Agent handoff

Never use `npm audit fix --force`. Do not combine all upgrades in one unreviewable lockfile diff. Stop if a major provider SDK change needs a product/runtime decision.

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
**Status:** Ready
**Depends on:** CI-001A recommended

### Problem

Several Functions default a missing `SITE_ORIGIN` to the production domain; until this pass the webhook accepted a missing expected Stripe mode. `ENVIRONMENT_NAME` and `COMMERCE_ENABLED` are documented but not validated or enforced. A missing/mistyped deployment variable can therefore create unsafe URLs, mix live/test behavior, or leave no operational kill switch.

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

Implement as CONFIG-001A/001B from `GITHUB_ISSUE_SLICES.md`. Never print or pattern-match an entire secret; use provider-safe key-mode metadata/prefix only where documented. External parameter/Secret Manager changes need an authorized owner.

---

## AUTH-001 — Require verified email for member and privileged claims

**Labels:** `priority:P0`, `type:security`, `area:auth`, `area:firebase`, `size:M`
**Status:** Partial. AUTH-001A [#98](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/98) merged through [PR #107](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/107) as `ce22c110f2132b157bd8a0d43b065585e0b43cb5`; focused source/tests are proven, but Firebase deployment skipped and the parent scope remains open.
**Depends on:** SEC-001 recommended

### Problem

Both the legacy member synchronization function and admin role callable grant claims based on email without requiring `userRecord.emailVerified`. An attacker can pre-register a known member address, not verify it, and later receive membership when that email is imported. Privileged guards and rules check only the role string.

AUTH-001A now rejects unverified targets at the two existing role-grant endpoints. Do not duplicate that merged slice. It is not proof that Firebase production runs the new code, and it does not complete the remaining parent requirements below.

### Scope

- Reject member/admin/capability grants when the target Firebase user's email is unverified.
- Require verified email at sensitive member/admin server guards and Firestore rule helpers.
- Define behavior for non-email providers and accounts with no email.
- Reconcile/update the member profile's email-verification mirror after verification or token refresh.
- Revoke refresh tokens/force claim refresh on demotion and security-sensitive role changes.
- Add an audited error/result for skipped unverified membership imports without exposing account enumeration publicly.

### Acceptance criteria

- [ ] Unverified known-email account cannot receive member/admin claim through any endpoint.
- [ ] A forged request field cannot override Firebase's verified token/user-record value.
- [ ] Verified user can be granted an allowed role by an authorized actor.
- [ ] Sensitive rule/function access requires both capability and verified email where policy says so.
- [ ] Demotion has documented token revocation/propagation behavior.
- [ ] Existing tests with privileged contexts explicitly set verification state.

### Tests/evidence

- Attack-path unit and Rules emulator tests for unverified member/admin.
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

**Labels:** `priority:P1`, `type:security`, `type:reliability`, `area:auth`, `area:firebase`, `size:M`, `needs-external-config`
**Status:** Proposed
**Depends on:** SEC-001 and AUTH-003 capability model

### Problem

SEC-001 removes browser access to stored OAuth secrets, but that does not complete the token lifecycle. Tokens remain plaintext at rest, refresh-token rotation has no transaction/version guard, scopes/revocation/disconnect are not fully governed, and durable access/refresh audit is absent. Concurrent refresh can overwrite a newly rotated token and a compromised server identity may have more token access than required.

### Scope

- Keep authorization code exchange, access token use, refresh, and disconnect entirely server-side with strict owner/capability checks.
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
- [ ] Disconnect revokes provider access when possible and makes local reuse impossible.
- [ ] Logs/audit contain no authorization code, access token, refresh token, or full secret document.
- [ ] Service IAM and encryption decision have named owner, rationale, and review date.

### Tests/evidence

- Concurrent refresh, stale-version, rotated-token, retry, provider rejection, scope mismatch, wrong-user, disconnect/reconnect, and redacted-log tests.
- Test-provider or mocked revocation evidence; private IAM/encryption review for hosted closure.

### Agent handoff

Use OAUTH-001A/B from the atomic slices. Never call the real Strava API with a member token in tests and never migrate/export production token documents into the workspace.

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
**Status:** Ready
**Depends on:** CI-001A recommended

### Problem

App Check is optional on the client and enforced only by a custom `ENFORCE_APP_CHECK === true` branch that is not configured in repository workflows. Rate limiting trusts the first `X-Forwarded-For`, stores raw IP/email, depends on an unverified TTL policy, and lacks per-business/user/concurrency/cost controls.

### Scope

- Configure reCAPTCHA Enterprise for each web environment and observe App Check metrics.
- Replace custom fail-open checks with Firebase `enforceAppCheck: true` runtime options on sensitive callable functions.
- Inventory the exact callable group. Mark `lookupRegistration` and `lookupOrder` deferred until DATA-001A supplies a tested safe confirmation handoff. Mark `stravaExchangeCode` deferred until OAUTH-001C supplies a tested safe OAuth handoff.
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

App Check is not authentication. Do not remove Auth/capability checks or rely on it as the only bot/fraud control. Do not enforce it on `lookupRegistration`, `lookupOrder`, or `stravaExchangeCode` while #99 suppresses the reCAPTCHA provider on an initial capability URL. Move each callable only after DATA-001A or OAUTH-001C proves a safe handoff and the callback regression passes.

---

## PAY-001 — Add strict request schemas and immutable monetary snapshots

**Labels:** `priority:P0`, `type:security`, `area:stripe`, `area:race`, `area:shop`, `size:L`
**Status:** Ready
**Depends on:** ABUSE-001 interface agreed

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
**Status:** `partial_implemented_locally`; creation and webhook defenses exist, but direct creator-payload tests and the future discount contract remain open
**Depends on:** PAY-001 for any future enabled discount model

### Problem

The original race and merchandise Checkout creators enabled arbitrary Dashboard promotion codes while local records stored only list/subtotal price. A mathematically consistent discounted Stripe total could therefore be fulfilled without a server-approved eligibility, policy/version, or expected total. Refund/reporting state could disagree with the charge.

### Scope

- Set `allow_promotion_codes: false` in every current Checkout Session creator.
- Treat any nonzero Stripe `amount_discount` as a permanent anomaly requiring review while discounts are disabled.
- Add creator payload tests and signed webhook tests, including a 100% discount and legacy outstanding Session.
- Inventory and disable/restrict active promotion configuration or outstanding Sessions in test/staging before release; production provider changes belong to OPS-001.
- If promotions are later desired, open a new issue under PAY-001/PAY-002 for server-approved code/campaign eligibility, immutable discount snapshot, actual total/refund/reconciliation, limits, expiry, audit, and migration before changing this guard.

### Acceptance criteria

- [ ] Neither race nor merchandise Session permits Stripe promotion-code entry.
- [ ] A nonzero discounted Session never becomes locally paid/fulfilled and is durably quarantined/alerted.
- [ ] Zero-discount Sessions continue through normal amount/currency validation.
- [ ] No UI or API claims a promotion is accepted.
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
**Status:** Ready after PAY-001
**Depends on:** CONFIG-001 and PAY-001

### Problem

Checkout Session, Stripe Product/Price/Payment Link, and Refund creation have no idempotency keys. One overloaded `status` field mixes payment, registration, fulfillment, cancellation, refund, transfer, and dispute state. Network loss/retry can duplicate external operations; impossible transitions are currently allowed.

### Scope

- Define separate `paymentStatus`, `registrationStatus`, `fulfillmentStatus`, `refundStatus`, and `disputeStatus` with an allowed transition matrix.
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
**Status:** Proposed
**Depends on:** PAY-002, PAY-003, AUTH-003 for final permissions

### Problem

Refund functions call Stripe without idempotency, immediately overwrite local status, weakly validate amount/current state/remaining balance, and do not track cumulative actual refund. Dispute handling is registration-only and audit-only. No scheduled reconciliation proves Stripe and Firestore agree.

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

### Agent handoff

Separate refund command/state from the broader reconciliation worker into sequential PRs if necessary. Never hand-edit Firestore to make reconciliation pass.

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
**Status:** Proposed
**Depends on:** Core SEC/AUTH/ABUSE/PAY/RACE/MERCH/MAIL/DATA work

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
