# MPRC Security, Privacy, and Risk Plan

**Status:** Pre-production security assessment
**Assessment date:** 2026-07-12
**Scope:** This repository's React application, Firebase configuration/functions/rules, Stripe integration, Strava integration, CI/CD, operational data, and documented deployment model

This is both the repository security policy and the current engineering risk register. It is not a penetration-test report, legal opinion, PCI attestation, privacy certification, or guarantee that deployed cloud settings match the repository. External Firebase, GCP, Stripe, GitHub, DNS, Sentry, and email-provider configuration must be reviewed separately.

## 1. Production readiness decision

The public informational website can continue operating with normal care. **Live race or merchandise payments should remain disabled until every P0 launch blocker below is closed and verified in a staging dress rehearsal.** The existing payment implementation is a useful prototype, but several correctness defects could mark unpaid transactions paid, lose payment callbacks, oversell race capacity, fail to reconcile late-payment links, or allow overly broad administrative access.

## 2. Reporting a vulnerability

Do not disclose a suspected vulnerability, secret, customer record, payment reference, or exploit in a public GitHub issue. Until MPRC publishes a dedicated security address:

1. Use the private contact channel listed on the live MPRC contact page.
2. State that the message is a security report and request a secure reply channel.
3. Include the affected URL/component, impact, reproduction with synthetic data, and any suggested mitigation.
4. Do not access, change, download, or retain data beyond what is necessary to demonstrate the issue.

An implementation issue must establish `security@runmprc.com` or another monitored private address, named primary/backup responders, an acknowledgement target, and a disclosure policy before commerce launch.

## 3. Severity and launch gates

- **P0 — launch blocker:** credible risk of incorrect money state, privilege compromise, secret/PII exposure, oversell, or inability to recover safely. No live payments.
- **P1 — high:** material abuse, privacy, availability, or operational-control weakness. Complete before broad launch or explicitly accept with a time-bounded compensating control.
- **P2 — medium:** defense-in-depth, maintainability, or bounded operational risk. Schedule soon after the secure pilot.
- **P3 — improvement:** useful hardening with lower immediate impact.

Closing an item requires code/configuration, automated or documented tests, deployed-environment evidence, monitoring, and an owner—not only a code diff.

## 4. Assessment-baseline risk register

The findings below describe the repository at the start of the 2026-07-12 assessment. The IDs use the `RISK-*` namespace so they cannot be confused with the independently publishable issue IDs in `GITHUB_ISSUES.md`. A working-tree fix lowers exposure only after review, merge, deployment, external configuration, and evidence; the remediation ledger after the tables records that distinction.

### P0 launch blockers

| ID | Finding and evidence | Impact | Required treatment |
| --- | --- | --- | --- |
| RISK-001 | `stripeWebhook.js` marks every `checkout.session.completed` record paid without validating `payment_status`, `amount_total`, currency, environment, metadata schema, or allowed prior state. | Delayed or anomalous payments can be fulfilled as paid; local totals can disagree with Stripe. | Implement verified payment reduction, async success/failure handling, quarantine, and reconciliation. |
| RISK-002 | Stripe Event IDs are not durably deduplicated; object transitions and emails are not comprehensively idempotent. Existing webhook tests cover only invalid signatures/method. | Duplicate/retried/out-of-order events can repeat side effects or corrupt audit/state. | Add a durable event inbox, atomic transitions, and duplicate/out-of-order tests. |
| RISK-003 | Paid Checkout Sessions are created before their registration/order record is persisted. The webhook only queries for the stored Session ID. | A fast webhook or function crash can leave a paid Stripe transaction with no local confirmation. | Use a persistence-first, idempotent checkout saga and metadata-direct lookup. |
| RISK-004 | Race capacity uses a count-then-create sequence outside a transaction; `registeredCount` is displayed but not maintained. | Concurrent users can exceed capacity; stale pending Sessions can block capacity for up to seven days. | Introduce transactional capacity counters/reservations, matching expiry, backfill, and concurrency tests. |
| RISK-005 | Merchandise has product status but no SKU/variant inventory reservation. | The club can sell unavailable size/color combinations or oversell stock. | Add canonical variants and atomic inventory holds before live merchandise. |
| RISK-006 | `main` source now removes the recursive browser-admin rule, but deployment repeatedly skipped Firebase and the live Rules revision is unproven. | A stale deployed ruleset may still expose secrets or financial/audit writes to a compromised admin session. | Use #105 to stage and deploy the exact tested #100 Rules revision, verify deny behavior with synthetic accounts, and record rollback. |
| RISK-007 | Repository source rejects unverified targets at the two existing role-grant endpoints, and AUTH-001B [#196](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/196) adds exact verified-email checks to role-based Firestore Rules. Firebase deployment, the complete server-guard inventory, verification-mirror refresh, revocation, and replacement of the legacy static-key endpoint remain unproven. | Older deployed code or a remaining role-only server guard can let an unverified known-email account use member/admin authority. | Deploy and verify the exact Rules/Functions through #105, complete the remaining AUTH-001 guard/mirror/revocation work, require authoritative membership, and retire the static-key endpoint. |
| RISK-008 | `requireAppCheck` is controlled by optional `ENFORCE_APP_CHECK`; repository/deployment config does not prove it is true. Missing site key also disables client App Check. | Public callable functions may be scripted directly, enabling abuse and cloud/Stripe cost amplification. | Use Firebase runtime `enforceAppCheck: true` for sensitive callables, reCAPTCHA Enterprise, staged metrics, and no environment fail-open. |
| RISK-009 | #99 source preserves and validates the complete same-origin Pages callback route, applies `strict-origin` before subresources, and suppresses initial callback App Check/telemetry startup; #126 adds that standalone suite as a blocking hosted CI step. No production Stripe/Strava callback has been rehearsed and the live custom domain uses a different host. | Hosting drift or an untested deployment can still break return links even when source tests pass. Enforcing App Check too early on the three callback callables would also break confirmation or Strava exchange. | Keep the hosted callback gate blocking; keep `lookupRegistration`/`lookupOrder` deferred until DATA-001A and `stravaExchangeCode` deferred until OAUTH-001C within canonical tracker [#88](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/88); verify test-mode callbacks only after provider gates; consolidate hosting under WEB-001. |
| RISK-010 | Development/test now use synthetic loopback Auth, Firestore, and Functions, but optimized previews still target production Firebase and emulated Functions can call outside providers. | A maintainer can mistake a preview or Firebase emulator for complete staging and affect production/provider systems. | Prohibit private actions in previews; add dedicated staging/config under #105/CONFIG; prove test keys/sinks before provider flows. |
| RISK-011 | Local cancellation only changes Firestore; it does not expire the active Stripe Session. The webhook can later move a cancelled record back to paid. | Customers can pay a supposedly cancelled registration/order; capacity/inventory and support state diverge. | Add explicit cancellation saga with Stripe Session expiry and allowed-state transitions. |
| RISK-012 | Late registration creates reusable Stripe Payment Links, but records have no Session ID and the webhook searches only by Session/PaymentIntent. | Late payments do not reconcile; reuse can produce multiple charges/Sessions for one logical registration. | Replace with one-off idempotent Checkout Sessions or fully constrain/map Payment Links. |
| RISK-013 | The assessment baseline permitted Stripe promotions while Firestore stored base price. Repository source now disables promotion entry and automatic tax, requires a complete adjustment breakdown, and quarantines unknown or nonzero discount/tax/shipping amounts; deployment and provider state are unproven. | An older open Session, provider drift, skipped backend release, or later guard regression could still make reporting, refunds, and local payment confirmation disagree. | Privately inventory pre-change Sessions/provider settings, release through the protected gate, verify Firebase and Stripe separately, and keep every adjustment disabled until an approved authoritative model exists. |
| RISK-014 | The 2026-07-13 Node 20 root production audit reports 19 advisories (1 critical, 5 high) after #127 removes unused `gpxparser` and #192 patches the compatible React Router graph; the Functions production audit still reports 9 advisories (1 high). Direct affected dependencies still include the Firebase client and Firebase Admin. | Known vulnerable or unmaintained runtime/build chains increase XSS, request, DoS, and supply-chain exposure. | Patch the remaining direct dependencies, then stage SDK/build-system upgrades with tests and continuous scanning. |
| RISK-015 | `Privacy.jsx` and `Terms.jsx` explicitly say `REPLACE WITH DATE` and `Placeholder template`; tax, refund, shipping, waiver, retention, and customer-support policies are not approved. | Users are asked for sensitive data and money without final disclosures/policies; disputes and regulatory obligations are unmanaged. | Obtain appropriate legal/tax/insurance review, approve versioned policies, and block live-mode configuration until complete. |

### P1 high-priority risks

| ID | Finding | Required treatment |
| --- | --- | --- |
| RISK-016 | Success/lookup bearer tokens are stored plaintext in Firestore and placed in query strings, which can enter history, screenshots, logs, analytics, and referrers. | Prefer authenticated ownership or server-verified Session IDs; hash anonymous tokens, expire them, use fragment/session state, and scrub history. |
| RISK-017 | Input validation checks only a few required fields. Names, phones, dates, notes, tracking values, custom field maps, arrays, URLs, and payload sizes are weakly bounded or unbounded. | Add shared strict schemas, allowlists, normalization, size limits, URL policy, and hostile-input tests before any write or external call. |
| RISK-018 | Event-defined required custom fields and allowed options are enforced by HTML, not by the checkout function. | A scripted client can omit required answers or inject arbitrary data into protected records/exports. | Validate against the server event schema and reject unknown/missing/invalid fields. |
| RISK-019 | Confirmation email HTML directly interpolates runner and event values; email outbox creation and sent-marker update are separate writes. | HTML injection/phishing-like content and duplicate messages on trigger retries. | Escape HTML, create deterministic outbox IDs in a transaction, and test hostile input/retries. |
| RISK-020 | Refund endpoints lack stable Stripe idempotency keys, comprehensive remaining-balance validation, and a pending/canonical webhook model. | A timeout/retry or repeated click can create ambiguous or multiple refund attempts. | Create local refund operations with stable keys and let verified Stripe events finalize totals. |
| RISK-021 | Admin state transitions accept impossible combinations: cancel paid without refund decision, fulfill unpaid/cancelled orders, substitute without new waiver, or comp without proven waiver. | Financial, legal, fulfillment, and waiver records can be inconsistent. | Centralize allowed state transitions and authorization; require reason/evidence and test every forbidden edge. |
| RISK-022 | Rate-limit documents contain raw IP/email keys and values; fixed windows are distributed only by those identifiers and cleanup depends on an externally configured TTL. | Additional PII storage, unbounded growth if TTL is absent, email-targeted denial of service, and easy distributed abuse. | HMAC identifiers with a rotating secret, verify TTL, add per-user/business budgets, and monitor rejects/cost. |
| RISK-023 | The legacy `functions.config().api.key` endpoint uses a static shared key with no replay control, source restriction, App Check, authenticated operator, or request audit. The API is also scheduled for Firebase decommissioning in March 2027. | Key theft permits bulk role changes and future deployment failure. | Retire it in favor of authenticated admin workflow or narrowly authenticated scheduled import; migrate any remaining config to Secret Manager. |
| RISK-024 | OAuth tokens are stored plaintext and browser admins can read them under current rules; refresh writes have no concurrency control. | Token theft exposes member activity data; concurrent refresh can lose a rotated refresh token. | Make secrets server/IAM-only, encrypt where risk analysis requires, transact refresh versions, minimize scopes, and audit access. |
| RISK-025 | Admin authentication relies on password Auth plus a long-lived role token; no repository evidence of MFA, recent-auth checks, re-auth for refunds/role grants, or rapid revocation workflow. | A stolen admin session has broad durable impact. | Require MFA for privileged accounts, recent-auth for sensitive actions, capability roles, short sessions/forced refresh, and break-glass procedures. |
| RISK-026 | Firestore Admin SDK bypasses rules and the Functions runtime IAM scope is not documented. #135 removes the long-lived service-account JSON path from release source, but the least-privilege short-lived deploy identity is not configured yet. | Server or CI compromise may expose the entire project; missing provider configuration also blocks release. | Complete the private IAM inventory and #133 OIDC/WIF configuration; keep runtime and deploy identities separate; never restore a JSON key shortcut. |
| RISK-027 | Sentry optionally records user email and enables 100% replay on error; analytics/privacy consent, redaction, retention, and field-deny policies are not evidenced. | Forms and account flows contain PII that may be sent to monitoring vendors unexpectedly. | Disable replay on sensitive routes or configure strict masking, avoid email user context, set scrubbing/retention, consent policy, and vendor agreements. |
| RISK-028 | No payment reconciliation job, dead-letter/quarantine workflow, or alert proves paid Stripe objects match Firestore. | Missed webhooks and partial failures can persist unnoticed. | Add scheduled reconciliation, alert thresholds, operator repair tooling, and a daily finance report. |
| RISK-029 | Hosting on GitHub Pages limits controlled response headers and relies on custom JavaScript SPA fallback. | Weaker CSP/clickjacking/referrer controls and fragile OAuth/payment routes. | Migrate to Firebase Hosting or another owned edge with SPA rewrites, CSP, HSTS, frame protection, referrer and permissions policy. |

### P2 defense-in-depth and operational risks

| ID | Finding | Required treatment |
| --- | --- | --- |
| RISK-030 | Server-side Stripe client requests select `2023-10-16`, but webhook endpoint Event versioning is configured independently at Stripe and is unverified; ingress does not validate `event.api_version`. The SDK is old and no upgrade cadence is documented. | Privately inventory the endpoint Event version; validate/pin the supported contract; schedule test-mode API/SDK and webhook-version upgrades with breaking-change fixtures before accepting newer enums. |
| RISK-031 | Lazy Stripe Product creation is concurrency-prone and reachable from anonymous checkout traffic. | Move catalog synchronization to authenticated/idempotent management functions. |
| RISK-032 | `auditLog` arrays grow within primary documents and are editable by broad admins. | Move to append-oriented, immutable-by-client audit records with retention/export rules. |
| RISK-033 | CSV export mitigates formula injection, but roster export has no explicit re-auth, download audit, row limit/streaming limit, or data-minimization profiles. | Add scoped exports, reason/re-auth, audit, minimum columns, safe filename IDs, and large-export controls. |
| RISK-034 | Webhook error response includes the Stripe library's signature error detail. | Return generic client errors; keep sanitized structured diagnostics server-side. |
| RISK-035 | The deterministic frontend Jest suite and standalone SPA callback suite run as separate blocking hosted CI steps. CI-001B4/#186 merged a non-mutating frontend lint gate over 102 JS/JSX/TS/TSX files as `bec7d5e365eacb418563a172029f241f660d9768`; exact PR and post-merge runs passed. Its reviewable baseline records every one of the 125 configured errors and 7 warnings that remain after the lint process disables the repository's severity-masking `eslint-plugin-only-warn` hook. Branch protection, lint-debt cleanup, and broader domain/integration coverage remain incomplete. | Reduce the reviewed finding baseline in focused changes, prove required branch checks, and add domain/integration coverage. Never regenerate the baseline merely to make CI green. |
| RISK-036 | #135 adds a manual exact-commit source gate, fixed profile-recovery targets, backend-first order, missing-config failure, and Git-triggered Netlify production containment. Protected environments/OIDC, isolated staging, live-Netlify publication, and rollback evidence are still absent. | Complete #133 and #136, provision isolated staging, protect the Netlify release path under WEB-001, and rehearse rollback/safe roll-forward before production. |
| RISK-037 | Account/registration deletion, export, retention, backup, and restore procedures are incomplete. | Approve retention matrix, automate minimization, support access/deletion requests, and test backup restoration. |
| RISK-038 | Source-controlled secret scan is ad hoc; no continuous secret scanner, dependency update bot, SBOM, provenance, or branch protection is documented. | Add secret/dependency/code scanning, reviewed lockfile updates, protected environments/branches, and artifact provenance appropriate to project scale. |
| RISK-039 | Some authenticated accounts can lack `members/{uid}` after the Firebase cutover; the account screen hid the read failure and exposed an update that could only fail. Manual database/account repair could corrupt roles or private data. | Use an authenticated create-once server bootstrap, keep browser creation denied, fail the UI closed, and prove backend-first deployment with synthetic accounts. |
| RISK-040 | Registration currently treats account creation and the later verification-email request as one success. A rejected request can still produce “check your inbox,” while sender delivery and Spam placement are unverified. | Return two explicit outcomes, preserve the signed-in account on email-request failure, show only generic recovery text, and verify source, website revision, and provider delivery separately. |

### Source remediation ledger

These entries are implementation evidence, not a production risk-acceptance decision:

| Risks | Source result | Remaining closure evidence |
| --- | --- | --- |
| Immediate input-containment part of RISK-020 | PAY-005A1 is tracked in live [#200](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/200). Both existing admin refund Functions share one non-coercing validator: a partial amount must be a primitive positive safe integer below the stored positive safe-integer original cents. Invalid caller or stored values stop before Stripe construction/refund creation and Firestore mutation; valid partials always include the exact `amount`; only the explicit full action omits it. Provider exceptions expose no detail and return a fixed result-not-confirmed, do-not-retry, and escalate message. Focused tests cover both race and merchandise paths, fixed errors, valid boundaries, provider failure, and malformed/equal/over/non-finite/coerced inputs. | This immediate guard does not prove the remaining refundable Stripe balance, cumulative prior refunds, command identity/idempotency, concurrency safety, pending/event-finalized state, capability/MFA/recent-auth, approved policy, Firebase deployment, Stripe configuration, or live behavior. An unconfirmed provider result remains ambiguous and requires reconciliation, not a blind retry. Complete PAY-005A, its PAY-002/PAY-003 dependencies, AUTH-003, and every listed residual gate before authorizing production refunds. |
| Foundation only for parts of RISK-011, RISK-020, RISK-021 | PAY-002A1 is tracked in live [#161](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/161). The source-only child defines versioned pure payment, registration, fulfillment, confirmed-refund, and per-dispute structural reducers; fixed cross-dimension review/rejection; and a deterministic synthetic legacy classifier/aggregate report with no IDs. Orders/registrations carry no singular canonical dispute state. Forbidden regressions fail closed, refunds/disputes do not overwrite payment state, and `paid_after_cancellation` remains paid plus cancelled plus review rather than becoming a payment enum. | This does not yet mitigate those risks in a runtime. An unchanged enum does not prove duplicate Event/command/evidence, authorization, amount monotonicity, provider state, or club policy. No endpoint imports the library and no business record is read/written or migrated. PAY-002B1 [#163](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/163) supplies pure command/attempt keys; PAY-002B2A [#165](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/165) supplies only unused registration/audit persistence; PAY-002B2B [#169](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/169) supplies unused lease/fence/terminal-commitment source and tests without provider permission; PAY-002B2C1 [#173](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/173) supplies only unused lease-bound attempt-1 plan commitments/audit; PAY-002B2C2 [#182](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/182) supplies only unused pre-send evidence/audit and the exact persisted retry cutoff; PAY-002B2C3A [#184](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/184) supplies only an unused pure closed evidence classifier with no persistence or authorization; C3B/C3C must still persist verified proof and authorize/version any later attempt; PAY-002C/D persistence-first checkout; PAY-003B Event/version/evidence adoption including same-state amount changes and separate dispute records; PAY-004/PAY-005 cancellation/refund operations; MERCH-002/LEGAL-001 return/policy gates; #113 and a later migration child real inventory/dry-run. Firebase/Stripe deployment and live behavior remain unproven. |
| Foundation only for retry/duplication parts of RISK-003 and RISK-020 | PAY-002B1 is tracked in live [#163](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/163). The pure source child defines a canonical UUID v4 boundary, a domain-separated caller/environment command hash, a command-type plus canonical frozen-payload fingerprint, and a deterministic environment/mode/operation/command/provider-attempt Stripe key. Invalid production/test or non-production/live pairs fail. Raw caller, UUID, operation, and payload values never appear in outputs. PAY-002B2C1 is tracked in live [#173](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/173) for an immutable lease-bound attempt-1 plan and deterministic audit whose account, canonical parameters, and B1 key are stored only as command-bound commitments. PAY-002B2C2 is tracked in live [#182](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/182) for a separate atomic pre-send marker/audit, a complete command-bound C1-plan digest in both partners, a post-transaction lease/deadline freshness check, and persisted 23-hour attempt-1 cutoff. PAY-002B2C3A is tracked in live [#184](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/184) for the pure exact attempt-1 reconciliation evidence policy. | Hashes and commitments are pseudonymous server-only equality evidence—not anonymization, authorization, configured-account proof, durable replay, or provider-execution proof. No endpoint imports these libraries. PAY-002B2A/#165 registers only a command/audit pair. PAY-002B2B/#169 adds a separate fixed-duration lease, holder fingerprint, monotonic fence, terminal commitment, and transition audit without provider permission. C1 does not permit a send. C2's fixed `send_permitted` is only a retry-safety classification under the exact lease/fence/plan; it is not caller authorization, configured-account proof, a Stripe call/outcome, or response replay. C2 makes no provider request and never advances attempt `1`. A changed/replaced plan fails its stored digest. Lease/deadline equality, later time, rollback, or missing/unreadable paired time returns `reconciliation_required`. C3A returns only fixed `existing_attempt_found`, `new_attempt_candidate`, or `reconciliation_required` results from closed enum evidence; a candidate is not send/advance permission. Timeout, connection loss, provider error, old/pruned key, missing/not-found object, partial/empty search, processing/unknown state, and conflict cannot become a candidate. C3B/C3C must persist verified evidence and separately authorize/version any later attempt. PAY-002C/D and PAY-005 must adopt the complete B2C chain with endpoint schemas and failure-boundary tests. Deployment, provider configuration, and live behavior remain unproven. |
| Foundation only for registration/audit parts of RISK-003, RISK-020, and RISK-032 | PAY-002B2A is tracked in live [#165](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/165). The unused server-only transaction creates one immutable `checkoutRequests/{commandKeyHash}` registered record and deterministic revision-1 `auditEvents` partner atomically. Exact retries are read-only. Same-key type/schema/payload conflicts and corrupt, orphan, future, or unexpected stored pairs fail closed without repair. Environment/caller-scope changes derive different B1 keys; a stored mismatch under one key is corruption, not a cross-scope lookup. Fixed results expose no raw identity, UUID, payload, hash, path, or Firestore detail. CI-001B3 [#167](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/167) runs its dedicated exact demo-project/opt-in suite as a named hosted job and protected-release prerequisite. | Registration is neither authorization nor execution permission. #169 keeps the root and revision-1 audit immutable, places lifecycle state in the separate server-only subcollection, fails closed on malformed partners, and proves in synthetic tests that stale workers cannot finalize. The hosted emulator result is still synthetic source proof, not deployment or provider proof. No TTL is safe: [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) must approve retention and a server-only tombstone or equivalent durable duplicate barrier before deletion. Source/tests/merge do not prove Firebase deployment, Stripe configuration, or live behavior. |
| RISK-008 | ABUSE-001A1 is tracked in live [#159](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/159). The source-only slice replaces the browser reCAPTCHA v3 constructor with the pinned Firebase SDK's Enterprise provider and preserves local/test/capability-callback shutdown, missing-key behavior, token refresh, Analytics shutdown, and fixed redacted failure diagnostics. Synthetic tests use no real key or provider call. | No Enterprise key, allowed-domain policy, provider console setting, protected build variable, token exchange, staged metric, callable enforcement, website/Firebase publication, or live behavior is configured or proven. Release `29254280177` failed closed before build because the public site-key variable was absent. Complete #113/#133, ABUSE-001A2, #136/WEB-001, staged metrics, and provider readback before enforcement or a live claim. |
| RISK-017 | PAY-001A is tracked in live [#157](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/157). The source slice adds dependency-free strict-root-object, root-budget, bounded string/array, integer-cents, fixed-currency, calendar-date, canonical-URL, conservative email, fixed-error, and closed-enum safe-log primitives. Synthetic hostile-input tests prove deep immutable copies and reject prototypes, accessors, and unknown configured root keys. The libraries contain no network, Firebase, Stripe, logger, clock, or random dependency and make no such call themselves; a supplied array item parser must be trusted, pure, and synchronous. | This library is not imported by an endpoint and is not deployed. PAY-001B/C/D must define exact race, merchandise, lookup, refund, admin, nested-object, and custom-field schemas; apply smaller business limits before every write/provider call; store immutable schema/price snapshots; and add endpoint no-side-effect tests. Safe-log primitives do not replace approved observability purpose, retention, access, transport, or provider controls. |
| RISK-001, RISK-002, RISK-034 | PAY-003A [#101](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/101) source merged as `87bd1210575882cdd06214bcb98ed38ce00f71c2`, adding durable Stripe Event deduplication, transactional transition/processed marking, paid/amount/currency/Checkout-mode/reference-shape and explicitly configured livemode checks, async outcomes, monotonic refund/terminal guards, quarantine, generic signature failures, and a webhook-secret-only binding. | Firebase was not deployed. Complete CONFIG/PAY-001/PAY-002 contracts, metadata schema allowlist/migration, canonical reducers/reservations/outbox, retry/dead-letter/TTL/alerts, emulator integration, Stripe test-mode rehearsal, protected deploy, and reconcile. |
| RISK-006, part of RISK-024/RISK-032 | #100 merged at `a7fc301e85b0aeabe396e771faea21d3fc8e7b2b`. OAuth secrets and server-owned financial/operational collections are denied; current catalog writes are restricted to inert drafts/display fields. | Firebase deployment skipped. Stage/deploy the exact Rules revision under #105, verify synthetic deny behavior, then move remaining catalog mutation to scoped APIs under ADMIN-001. |
| RISK-009 | #99 preserves same-origin path, query, and fragment state through the Pages fallback, clears temporary state, rejects unsafe targets, and suppresses monitoring startup on initial capability callbacks. #126 adds the standalone suite as the named blocking `Run SPA callback safety tests` hosted step. | Keep exact hosted evidence on #126; verify exact website publication and later run approved test-mode Stripe/Strava callbacks; WEB-001 still owns controlled hosting. |
| RISK-010 | #99 uses a fully synthetic `demo-mprc-local` configuration, connects Functions/Auth/Firestore to loopback in development/test, routes the direct CSV Function URL locally, fails startup on connector errors, and completed a demo-only three-port CLI smoke. | Current optimized previews still target production; provider calls are not isolated by Firebase. Add protected staging/config and test-provider/sink evidence before end-to-end flows. |
| Test-only foundation for RISK-010 and RISK-035 | TEST-001A1 is tracked in live [#175](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/175). The Functions Jest setup installs a fixed-error, loopback-only guard around supported Node outbound transports and rejects any supplied production-like project/origin/emulator host or live Stripe mode/key. Shared deterministic deeply frozen fixtures use reserved values, and the existing webhook suite adopts one synthetic signed-payload helper. | This is a test-process boundary, not a runtime sandbox. It does not intercept every possible native/add-on transport, isolate an emulated Function process, configure a test provider, scan emitted artifacts, deploy Firebase, or prove live behavior. TEST-001A2 [#177](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/177) separately adds the bounded artifact scrubber and named CI/release gate; later TEST-001 children must add emulator sagas and isolated staging evidence. |
| Emitted-test-output part of RISK-035 | TEST-001A2 is tracked in live [#177](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/177). Its source adds a dependency-free read-only scanner for explicit narrow artifact roots, bounded deterministic traversal, fixed redacted failures, deliberate synthetic allow/deny tests, the exact `Test artifact scrubber` CI job, and that job in both protected-release CI rechecks. Current CI still uploads no test artifact. | This scanner covers a documented bounded set of recognizable patterns; green is not a general data-loss-prevention guarantee or proof that every unknown/obfuscated value is absent. It does not inspect source, runtime logs, website builds, provider responses, production data, or an operating-system sandbox, and it does not sanitize a rejected file. Every later report producer must invoke the scanner before upload, and exact hosted evidence remains separate from source and local-test evidence. |
| Configuration part of RISK-001/RISK-010 | CONFIG-001A [#149](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/149) merged through PR #150 as `2c62b8dd`, requiring an exact environment/origin/expected Stripe mode, key-mode compatibility on the four key-bound Functions, no production-origin fallback, and no Stripe API key on webhook/mail. CONFIG-001B1 [#151](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/151) adds exact `COMMERCE_ENABLED` parsing. A false ceiling denies new commerce before Firestore; otherwise new-commerce commands and every refund perform a fresh strict server-only global/domain/resource admission read. Missing controls/resource flags mean disabled; fixed errors expose no supplied value; Rules tests deny browser control; webhook/mail remain independent. | Neither source result configures or deploys Firebase/Stripe. B1 cannot stop already-admitted commands or existing Sessions/Payment Links and has no safe operator writer. CONFIG-001B2, PAY-002/PAY-004/PAY-005, and #105/#133/#136 retain protected control, expiry/reconciliation, staging, deployment, provider readback, and drill. No live payment or email is authorized. |
| Part of RISK-007 | AUTH-001A [#98](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/98) was merged through [PR #107](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/107) as `ce22c110f2132b157bd8a0d43b065585e0b43cb5`; it rejects unverified targets at the two existing role-grant endpoints. AUTH-001B [#196](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/196) tracks the companion Rules boundary: every `member`/`admin` role authorization additionally requires exact boolean token claim `email_verified == true`, while UID-bound profile recovery remains available. Its test harness requires explicit verification state for every privileged context and covers missing, false, string, numeric, and profile-mirror substitution attempts. | Neither slice proves Firebase deployment or live access. Remaining Functions guards, verification mirror/refresh, demotion propagation, audit, authoritative membership, and legacy-sync retirement stay open. Verification alone never grants a role. |
| RISK-013 | PROMO-001 [#102](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/102) sets both current Checkout creators to promotion entry off and automatic tax off. Exact payload and signed event tests require an explicit all-zero breakdown; malformed or nonzero discount, tax, or shipping data creates durable review evidence while definitive failed/expired Sessions still cancel. | Privately inventory pre-change Sessions/provider promotion settings, keep the guard through protected staging/deploy, verify provider and live state separately, and implement an approved authoritative discount/tax/shipping contract before ever enabling it. |
| Part of RISK-014 | SUPPLY-001A [#127](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/127) removes the unused direct `gpxparser` dependency and 50 lockfile entries without changing any retained package version, source URL, or integrity hash. A fresh Node 20 install lowers the root production audit from 33 findings (3 critical, 9 high) to 22 (1 critical, 8 high), and the optimized production asset hashes remain identical. | #192 completes the separately tested router patch. Remediate or time-bound the remaining root and Functions findings through the Firebase, Stripe, build-system, and scanning slices; do not use a forced audit upgrade. |
| Part of RISK-014 | SUPPLY-001B [#192](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/192) pins `react-router-dom` and `react-router` 6.30.4 with `@remix-run/router` 1.23.3. The only lockfile identity changes are those three nodes. A fresh Node 20 production audit removes all three router findings and lowers the root total from 22 to 19 and high findings from 8 to 5. The declarative router opts into `v7_startTransition` and `v7_relativeSplatPath`; focused tests cover warning removal, double-slash normalization, wildcard navigation, login/account harnesses, and the standalone callback boundary. | The remaining 19 root and 9 Functions production findings are not accepted as safe or fixed. Patch Firebase in separate compatibility slices, replace the unmaintained build chain, and add continuous scanning. Source/tests/merge do not prove website publication or live route behavior. |
| Part of RISK-014 | SUPPLY-001C [#202](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/202) pins the Firebase browser SDK to 11.10.0 and its Rules helper to 4.0.1. A fresh Node 20 production audit falls from 19 findings (1 critical, 5 high) to 6 (0 critical, 3 high); the root production `protobufjs` path resolves to 7.6.5 and Firebase's root `undici` path is removed. The upgraded Rules helper first failed closed because Jest lacked `fetch`; a dedicated Node 20 environment exposes only the host's native web APIs, after which 348/348 Rules cases pass. Focused Firebase/Auth/App Check tests pass 71/71, the full frontend passes 198/198, and applicable Functions units pass 1,077/1,077. | The remaining 6 root and 9 Functions production findings are not accepted as safe. An older dev-only `protobufjs` remains nested under `firebase-tools`; the build chain still accounts for the root findings. The main optimized bundle grows 8.25 kB gzip (about 3.3%). Complete SUPPLY-001D/F/G through separate reviewable changes. This source/test result does not publish the website, deploy Firebase, change a provider, or prove live behavior. |
| Part of RISK-024 | SEC-001 protects token documents from every browser client. | OAUTH-001 must still add transactional refresh/versioning, scope/account binding, disconnect/revocation, IAM/encryption decision, and redacted lifecycle audit. |
| Part of RISK-027 | #99 blocks App Check, Firebase Analytics, and Sentry in local/test and on initial capability-callback startup. OBS-001A1 [#134](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/134) source disables Sentry replay, tracing, browser session tracking, client reports, member user context, breadcrumbs, attachments, transactions, and unapproved default integrations. OBS-001A2 [#139](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/139) source removes every application runtime Firebase Analytics import, initialization, and emission, preserves existing wrapper calls as provider-free no-ops, and removes the direct Waiver SDK bypass. OBS-001A3 [#142](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/142) source routes the remaining render, Auth-email, members-only, and App Check browser diagnostics through five fixed outcome identifiers and prohibits direct console calls elsewhere in application/public runtime source. Synthetic tests use mocks/canaries and make no provider call. | #110/#111 still own any future approved telemetry purpose, consent, event/parameter schema, provider settings, and residual hosted boundary. Source/tests and merge evidence do not prove website publication, the exact `runmprc.com` revision, provider transport/collection, IP/cookie behavior, console history, historical data deletion, retention, access, consent, deletion, or vendor terms. Sentry provider behavior is likewise unverified. Callback protected handoffs remain with ABUSE-001A, DATA-001A, and OAUTH-001C in #88. |
| Part of RISK-035 | The Jest environment is repaired, #124 adds the complete frontend suite as a named blocking hosted step, and #126 adds the standalone SPA callback suite. CI-001B3 [#167](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/167) merged the lockfile-bound Node 20/Java 17 `Commerce command journal emulator` job using exact demo project `demo-pay002b2-test`, Firestore only, and explicit opt-in. CI-001B4 [#186](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/186) merged through [PR #189](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/189) as `bec7d5e365eacb418563a172029f241f660d9768`, adding the no-new-dependency exact-record checker over 102 frontend files, named blocking lint step, and clean-checkout step. Exact PR run `29291402007` and post-merge run `29291515653` passed every GitHub job. | The reviewable lint baseline deliberately records 125 configured errors and 7 warnings as individual file/line/column/rule/message records; it is not a clean-lint claim. Any added, removed, moved, or changed record requires review, every fatal parser/configuration failure rejects with a fixed diagnostic, and the baseline must not be regenerated just to pass. The clean check covers tracked and non-ignored untracked files; ignored dependency/build outputs are outside this proof. Hosted source checks do not configure branch protection, deploy Firebase, or prove Stripe/live behavior. #169, #173, and #182 expand the focused commerce suite; configure/prove branch-required checks and add the broader TEST-001 suite. |
| RISK-026, RISK-036 | #135 merged through PR #138 as `9eafab1217aff7058c42240aaba72d7b93f8ed24`, replacing automatic frontend-first/fail-open GitHub deployment with a tested manual exact-current-commit gate. Post-merge staging and synthetic production probes failed closed before authentication or mutation, and published neither Firebase nor Pages. | #133 must configure protected environments and least-privilege OIDC/WIF; #136 must prove staged/target deployment and clearing/readback of the existing Pages `runmprc.com` claim; a protected WEB-001 child must establish Netlify publication and rollback. No Firebase, Pages, live-host, or provider-setting change is proven by source/static tests alone. |
| RISK-039 | The #118 source slice uses an empty authenticated callable request, bounded Firebase Auth identity fields, one transactional create-only helper shared with signup, constant responses, generic failures, and a UI that hides Edit until setup and the Rules-protected read succeed. Signup and recovery never change custom claims; browser profile creation remains denied. | Source review/merge is not deployment. Under #105, deploy the exact #100 Rules plus both `createMemberOnSignUp` and `ensureMemberProfile` before the website, prove App Check policy, use a synthetic staged account, verify rollback, then record website, Function, Rules, and live behavior separately. Never repair a real profile manually. |
| RISK-040 | AUTH-MAIL-002A [#145](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/145) merged as `46557c7`: account creation returns `accepted` or `unavailable` without exposing provider details. AUTH-MAIL-002B [#153](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/153) merged as `23bca8c8`: My Account makes no false “sent” claim, blocks rapid repeats, and applies the same 60-second browser cooldown after either outcome. Its protected release run `29252492614` stopped before build because the required public App Check key was absent, so neither frontend revision is published. AUTH-MAIL-002C1 [#155](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/155) tracks one byte-equivalent password-reset request result after provider success or failure. AUTH-MAIL-002C2 [#194](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/194) tracks the source-only `/auth/action` verification path: the initial capability suppresses Sentry/App Check, the page removes native and router query/fragment state, a scanner-style page load makes no action-code check/apply and no account mutation, and one deliberate action requires provider `VERIFY_EMAIL` before apply. Fixed results expose no email, code, raw provider error, account identity, or provider-directed navigation. Synthetic tests use mocks and canary values only. | Publish and verify each exact frontend revision separately. The existing #99 Pages bridge briefly uses tab-local session storage for the return route and deletes it before React; a failed root load can leave it until tab close, while direct-rewrite hosting avoids that residual. #194 adds no storage write. #118 profile source is merged but live behavior is unproven. Keep delivery, Spam, DNS, templates, provider handler choice, and private Firebase email-enumeration-protection readback under #119. Firebase uses one custom handler for verification, password reset, and email recovery; never point its global action URL at the verification-only #194 route until every enabled mode is safely handled, or keep the default multi-mode handler. Accepted requests do not prove delivery, browser cooldowns are not abuse controls, Auth verification does not grant membership, and the Firestore verification mirror remains unfinished AUTH-001 work. |

## 5. Threat model

### Assets

- Stripe secret keys, webhook secrets, refunds, payout/account settings, and financial reports.
- Firebase/GCP service credentials, deployment authority, Auth role claims, and App Check configuration.
- Runner identity, date of birth, phone, emergency contact, waiver evidence, and attendance.
- Buyer identity, shipping address, order history, and tracking information.
- Member profiles and Strava access/refresh tokens and activity data.
- Race capacity, merchandise inventory, discounts, email reputation, and cloud budget.
- GitHub repository, workflows, DNS/custom domain, production artifacts, and audit history.

### Relevant threat actors

- Opportunistic unauthenticated bots testing public functions and credential stuffing.
- A customer manipulating price, member tier, custom fields, checkout retries, refunds, or inventory races.
- A compromised member or admin account.
- An insider with more access than their job needs.
- A leaked CI/cloud/Stripe/OAuth secret.
- A compromised dependency, GitHub Action, browser extension, or operator device.
- Accidental operator/developer action against production.
- Webhook duplication, delay, reordering, provider outage, or partial network failure without malicious intent.

### High-risk abuse cases

1. Submit a member tier while unauthenticated or using an unverified known member email.
2. Race two last-seat/last-SKU requests.
3. Reuse a client request after a timeout to create multiple Sessions or refunds.
4. Pay a Session after the operator cancels the local record.
5. Replay or reorder a valid Stripe event.
6. Apply an unmodeled Stripe promotion and obtain goods while local records show another total.
7. Steal an admin token and read OAuth secrets or directly rewrite financial records.
8. Script public callables without App Check to create Stripe objects, Firestore writes, or cloud cost.
9. Inject markup/formulas/oversized data through names, notes, custom fields, email, or exports.
10. Cause local development to call production Functions.

## 6. Required security architecture

### Authentication

- Firebase Auth verifies identity; email ownership must be verified before member/admin grants based on email.
- Privileged accounts require MFA and a documented account-recovery process.
- Sensitive operations require recent authentication where supported.
- Auth error messages do not reveal whether an account exists beyond Firebase's approved behavior.
- Role changes force token refresh/revocation and emit a durable audit event.

### Authorization

- Server code and Firestore rules check signed token capabilities; the UI is never the enforcement point.
- Separate catalog/content editing from financial state, identity administration, exports, and secrets.
- No client—including browser admins—can write webhook inbox, payment state, refund IDs, Stripe IDs, audit events, rate limits, or OAuth secrets.
- Server service accounts use IAM least privilege because Admin SDK bypasses Firestore rules.

### App Check and abuse resistance

- Use reCAPTCHA Enterprise for web App Check and observe metrics before enforcing.
- Set runtime `enforceAppCheck: true` on every sensitive callable instead of a custom fail-open environment test.
- Consider limited-use/replay-protected tokens only for the most abuse-sensitive callable after measuring latency and SDK support.
- Keep rate limits as defense in depth; App Check is not user authorization and does not stop all valid-browser abuse.
- Apply cloud budgets/alerts and Stripe rate/error alerts so cost abuse is visible.

### Input and output safety

- Centralize strict request schemas with maximum object depth, field count, string length, array length, total bytes, integer ranges, enum values, and URL allowlists.
- Normalize email consistently; do not over-normalize names or assume ASCII.
- Validate event custom fields against the stored schema.
- Escape HTML email content, neutralize spreadsheet formulas, and let React escape browser rendering.
- Avoid rendering arbitrary HTML from Firestore. If business requirements demand it, sanitize with a maintained allowlist library and a restrictive CSP.
- Return generic errors to unauthenticated clients; log structured error codes without secrets/PII.

### Secrets

- Store server secrets in Google Secret Manager and bind each only to functions that need it.
- Never use `REACT_APP_*` for a secret; CRA embeds those values in public JavaScript.
- Keep local overrides ignored (`.secret.local`, `.env.local`) and commit only name/format examples.
- Rotate Stripe and webhook secrets independently, with an overlap plan where the provider supports it.
- Inventory owners, creation dates, consumers, last rotation, and emergency revocation steps.
- Remove long-lived GitHub service-account JSON in favor of workload identity/OIDC when feasible.

### Payment integrity

The binding design is in [STRIPE_COMMERCE_DESIGN.md](./STRIPE_COMMERCE_DESIGN.md). Its mandatory controls are server price authority, persistence-first checkout, Stripe and application idempotency, atomic capacity/inventory, verified async-aware webhooks, allowed state transitions, idempotent refunds, and reconciliation.

## 7. Data classification and retention

| Class | Examples | Baseline controls |
| --- | --- | --- |
| Public | Published event/product content, officer information intentionally on site | Integrity review; no secrets or hidden fields in same readable document |
| Internal | Catalog drafts, operational counts, non-sensitive audit metrics | Authenticated role-limited access; normal logs/backup |
| Confidential PII | Member email/phone, order contact, Strava profile metadata | Need-to-know access, redacted logs, retention limit, access/deletion process |
| Restricted PII | DOB, emergency contact, shipping address, waiver evidence | Narrow server/admin capability, export audit, encryption in transit/at rest, aggressive field-specific retention |
| Restricted secret | Stripe keys, webhook secrets, OAuth refresh tokens, deploy credentials | Secret Manager or server-only encrypted store, no browser read, rotation, access audit |
| Financial metadata | Expected/paid/refunded totals, Stripe IDs, disputes | Finance/server capability, immutable audit, accounting retention, reconciliation |

Proposed retention values must be approved by counsel, finance, insurance, and operations. A reasonable minimization starting point for discussion is:

- Unpaid/expired checkout PII: delete or anonymize within 30 days after final reconciliation.
- Emergency contact and DOB: delete after the event plus a short operational/incident window unless insurance/counsel requires longer.
- Shipping address: remove from routine operator access after fulfillment/return window; retain only fields legally required for accounting/tax.
- OAuth tokens: delete immediately on disconnect/account deletion; rotate on suspected exposure.
- Rate-limit identifiers: expire shortly after the enforcement window and store HMACs, not raw values.
- Webhook inbox: retain non-PII identifiers long enough for reconciliation/audit, then expire under policy.
- Payment/accounting and waiver evidence: retain only for the approved legal/accounting/insurance period, separately from unnecessary operational PII.

Backups and exports must honor eventual deletion/anonymization schedules and have documented access.

## 8. Logging and monitoring rules

### Log

- Correlation/request ID, function name, environment, code version, local business ID, Stripe Event/type/object ID, state transition, latency, and sanitized error code.
- Authentication UID for privileged actions, capability used, target resource, reason, and result.
- Reconciliation counts and anonymous mismatch categories.

### Do not log

- Stripe or OAuth secrets, bearer tokens, full webhook payloads, Checkout URLs, password/reset data, raw ID tokens, session cookies, full addresses, DOB, emergency contacts, or arbitrary request bodies.
- Full customer email/IP in rate-limit and security logs; use a keyed pseudonymous identifier where correlation is needed.

### Alert

- Invalid webhook signature spikes.
- Event inbox failed/quarantined/old items.
- Paid Stripe Session with no local record or amount/currency mismatch.
- Local paid record not verified in Stripe.
- Refund/dispute creation and failed refund reconciliation.
- Capacity/inventory counter drift or negative availability.
- Elevated callable rejects, App Check failures, Auth abuse, cloud budget anomalies, deploy failures, secret access, and role grants.

## 9. Secure delivery controls

- Protect `main` and production environments with pull-request review and required passing checks.
- CI must run non-mutating lint, frontend tests, Functions tests, Firestore Rules emulator tests, production build, secret scan, and dependency scan.
- Do not use `lint:fix` as the CI lint command or mask it with `|| true`.
- Pin GitHub Actions to reviewed major versions or immutable SHAs according to the project's maintenance capacity.
- Dependabot/Renovate updates are small, reviewed, and tested; do not blindly `npm audit fix --force`.
- Generate an SBOM/release dependency inventory for live commerce builds.
- Restrict production deployment to protected environment approval; use short-lived federated cloud credentials.
- Deploy backward-compatible backend/rules/indexes before dependent frontend changes.
- Record release commit, migration, function version, Stripe webhook/API version, test evidence, and rollback point.

## 10. Incident response

### Severity examples

- **SEV-1:** Stripe/GCP/GitHub secret exposure; unauthorized refund/payout/role change; confirmed PII exfiltration; active payment misclassification at scale.
- **SEV-2:** Webhook backlog or reconciliation mismatch affecting customers; capacity/inventory oversell; admin account compromise without confirmed data access.
- **SEV-3:** Bounded availability failure, attempted abuse blocked by controls, or non-sensitive data issue.

### First response

1. Name the incident commander and scribe; preserve timestamps and evidence.
2. Stop harm: disable new checkout, revoke/rotate affected credentials, revoke sessions/roles, or isolate the deployment.
3. Do not destroy logs or silently rewrite financial records.
4. Compare Stripe and Firestore using the reconciliation runbook.
5. Notify Stripe/Firebase/GitHub or other vendors through their security/support channels when relevant.
6. Determine legal, insurance, customer, and regulatory notification with qualified advisers.
7. Restore through an audited repair, test it, monitor, and document every changed record.
8. Complete a blameless post-incident review with owners and deadlines.

Specific playbooks live in [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).

## 11. Verification evidence required before live mode

- Passing CI link and commit SHA.
- Dependency scan with zero unaccepted critical/high runtime findings.
- Firestore Rules test report proving browser admins cannot read secrets or directly mutate financial records.
- App Check metrics and enforcement proof for each callable.
- Stripe test-mode event delivery showing valid, duplicate, invalid, async, expired, refund, and dispute paths.
- Concurrency test showing no capacity/SKU oversell.
- Reconciliation report with zero unexplained mismatches.
- Secret/IAM/role inventory reviewed by two owners.
- Approved policies/waiver versions and retention matrix.
- Backup restore exercise and checkout-disable drill.
- Limited live pilot report and finance confirmation that Stripe payouts/totals match local records.

## 12. Current first-party references

- [Stripe webhook best practices](https://docs.stripe.com/webhooks)
- [Stripe Checkout fulfillment and delayed methods](https://docs.stripe.com/checkout/fulfillment)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Firebase App Check enforcement](https://firebase.google.com/docs/app-check/cloud-functions)
- [Firebase Secret Manager and environment configuration](https://firebase.google.com/docs/functions/config-env)
- [Firestore IAM and least privilege](https://firebase.google.com/docs/firestore/security/iam)
- [Firestore Security Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)

Re-check first-party documentation during implementation because provider behavior and recommended controls change.
