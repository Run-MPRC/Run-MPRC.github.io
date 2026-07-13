# MPRC Atomic GitHub Issue Slices

**Prepared:** 2026-07-12
**Purpose:** Decompose the large trackers in `GITHUB_ISSUES.md` into one-agent, one-reviewable-PR implementation issues
**Implementers:** Claude Sonnet, Terra/Luna, Codex, or a human contributor following `AGENTS.md`

> **Live status note (2026-07-12):** this is a design catalog. GitHub issues, labels, claims, and comments are authoritative. Foundation children/trackers are published as [#99–#106](https://github.com/Run-MPRC/Run-MPRC.github.io/issues?q=is%3Aissue%20milestone%3A%22Secure%20Commerce%20%26%20Platform%20Hardening%22); search before creating anything from a row.

## Assignment contract

Every `size:L` entry in `GITHUB_ISSUES.md` is a tracker, not a coding assignment. When a dependency-ready child is not already represented in GitHub, publish it as one focused issue, link it to the tracker, and assign only one active child at a time. Each child inherits the parent problem statement, security constraints, out-of-scope boundaries, and the definition of done in `IMPLEMENTATION_PLAN.md`.

An agent-ready child has one observable outcome, one trust boundary, explicit dependencies, tests, and no unresolved owner decision. One child normally maps to one branch and one pull request. Split again if work crosses unrelated domains or migrations. `owner_action` permits an agent to prepare checklists/scripts and analyze redacted evidence, but only an explicitly authorized MPRC owner may change IAM, cloud accounts, provider settings, DNS, legal policy, production data, or live payments.

## Baseline, CI, and supply chain

| ID | Status/dependency | Bounded deliverable | Close evidence |
| --- | --- | --- | --- |
| CI-001A | merged/closed as #103 | Repair Jest browser globals and replace the stale starter test with a deterministic, no-provider-network MPRC app smoke test. | Node 20 focused/full frontend tests, changed-file lint, clean diff, and diagnostic build pass. |
| CI-001B1 | merged/closed as #124; CI-001A | Run the complete committed frontend Jest suite as a named blocking step in the hosted frontend CI job; update exact officer/engineering truth. | Exact pull-request and post-merge hosted steps passed; Firebase skipped and Netlify exact production commit remained unverified. |
| CI-001B1A | published as #126; #99 and CI-001B1 | Run the standalone same-origin SPA callback suite as a separate blocking hosted frontend step. | Local deliberate-failure proof plus the named hosted step passing on the exact pull-request and post-merge commits; no provider callback claim. |
| CI-001B2 | owner_action; CI-001B1 | Protect backend-first staging/production deployment; make lint/remaining checks fail closed; pin tools/Actions; remove frontend service-account JSON; configure OIDC/WIF, approvals, missing-config failure, smoke and roll-forward. | Required PR gate and negative credential run; private two-owner IAM review; staging deployment evidence. |
| SUPPLY-001A | ready; CI-001A | Prove `gpxparser` unused and remove its obsolete transitive chain. | `rg`/tree proof, before/after audits, root lockfile diff, full frontend checks. |
| SUPPLY-001B | ready; CI-001A | Patch React Router within compatible 6.x and resolve/test future flags without route redesign. | Navigation/callback tests, audit delta, build. |
| SUPPLY-001C | proposed; CI-001A | Upgrade Firebase web SDK within one compatibility boundary. | Auth/Firestore/Functions/App Check/emulator tests and bundle/audit diff. |
| SUPPLY-001D | proposed; CI-001A | Upgrade Firebase Admin/Functions in one supported set. | Node 20 lint/unit/emulator/trigger tests and deploy compatibility notes. |
| SUPPLY-001E | proposed; PAY-003C | Upgrade Stripe SDK and deliberately select/test an API version. | Signed fixture/test-mode diff and rollback notes; no live endpoint change. |
| SUPPLY-001F | proposed; CI-001B2, A–C | Replace CRA while preserving env handling, SPA callbacks, sitemap/SEO, code splitting, and deploy output. | Full CI, bundle/SEO comparison, staging dry run. |
| SUPPLY-001G | proposed; CI-001A | Add dependency updates, audit exceptions, secret scan, SBOM, and lockfile review policy. | Safe sample update; deliberate secret detection; sanitized SBOM. |

## Identity, OAuth, and abuse controls

| ID | Status/dependency | Bounded deliverable | Close evidence |
| --- | --- | --- | --- |
| AUTH-003A | proposed; AUTH-001/002, SEC-001 | Define capability matrix, additive claims, role-change audit, and idempotent legacy-admin migration. | Table-driven claim/action tests and emulator dry-run/rollback. |
| AUTH-003B | proposed; AUTH-003A | Apply capabilities to server functions and Firestore projections/rules. | Every capability/action pair has allow/deny tests. |
| AUTH-003C | owner_action; AUTH-003B | Enforce privileged MFA, recent-auth thresholds, revocation, and break-glass/last-admin policy. | Staging failure/success demonstrations and private owner inventory. |
| AUTH-003D | proposed; AUTH-003B/C | Migrate admin UI/routes/token refresh, prove parity, then remove legacy alias. | Route/capability/demotion tests and staged operator sign-off. |
| OAUTH-001A | proposed; SEC-001, AUTH-003B | Implement server-only, transaction/version-safe Strava token refresh so rotated refresh tokens cannot be lost. | Concurrent refresh/retry/conflict emulator tests. |
| OAUTH-001B | owner_action; OAUTH-001A | Minimize scopes, implement disconnect/provider revocation, record encryption decision, and add access/refresh/revoke audit. | Test-provider revoke/refresh evidence and approved threat decision. |
| OAUTH-001C | proposed; #99 | Create a server-safe Strava callback handoff that keeps `code`/`state` out of third parties while allowing App Check-protected `stravaExchangeCode`; retain state verification and server-only token exchange. | Encoded/case/trailing callback tests, wrong/replayed state denial, missing/invalid/valid App Check tests, and test-provider-only exchange evidence. |
| ABUSE-001A | ready; CI-001A | Replace custom fail-open App Check on an agreed sensitive-callable group with native runtime enforcement and explicit emulator behavior. Inventory every callable; defer `lookupRegistration`/`lookupOrder` to DATA-001A and `stravaExchangeCode` to OAUTH-001C until safe handoffs merge. | Missing/invalid/valid tests plus staged metrics; source inventory test proves the three callback callables remain excluded until their dependency and regression evidence exist. |
| ABUSE-001B | proposed; PAY-001A | Replace raw IP/email rate keys with versioned HMAC, trusted address extraction, multi-scope transactional limits, rotation, and TTL-compatible records. | Spoof/boundary/concurrency/rotation tests; no raw identifiers. |
| ABUSE-001C | owner_action; A/B | Configure instance/concurrency/timeouts, budgets, TTL, and App Check/rate/cost alerts. | Synthetic alert and private cloud-setting review. |

## Configuration, validation, and payment foundation

| ID | Status/dependency | Bounded deliverable | Close evidence |
| --- | --- | --- | --- |
| CONFIG-001A | ready; CI-001A | Add typed server configuration requiring environment name, validated HTTPS/local origin, explicit Stripe mode, and environment/key compatibility; remove production fallbacks. | Missing/malformed/local-live tests fail before Firestore/Stripe/email. |
| CONFIG-001B | proposed; CONFIG-001A | Implement a server-owned global/per-domain commerce kill switch checked by every Session/refund/catalog command while webhook/reconciliation remain active. | Disabled-command tests prove no external call; webhook/reconcile tests still pass. |
| PROMO-001 | implemented_locally; PAY-001A for completion | Disable promotion codes in both Session creators and quarantine any nonzero Stripe discount until an approved snapshot contract exists. | Session payload assertions plus signed discounted-Session quarantine tests. |
| PAY-001A | ready; CI-001A | Add shared strict-object, bounds/depth, integer-cents/currency/date/URL/email primitives, safe errors, and redacted logging. | Prototype/deep/Unicode/money/unknown-key tests prove no external call. |
| PAY-001B | proposed; PAY-001A | Apply race/volunteer/free schemas, validate server event custom fields/options, and persist price/waiver snapshots. | Positive/hostile dynamic-field and snapshot tests. |
| PAY-001C | proposed; PAY-001A | Apply merchandise/variant/quantity schemas and immutable merchandise price snapshots. | Variant/quantity/money/payload tests. |
| PAY-001D | proposed; PAY-001A, AUTH-003A | Apply bounded schemas to lookup/refund/cancel/substitute/late/comp/role/tracking/export commands. | Endpoint matrix with hostile/boundary/no-side-effect tests. |
| PAY-002A | proposed; PAY-001A | Build pure separate payment/registration/fulfillment/refund/dispute reducers and additive legacy mapping. | Exhaustive allowed/forbidden/reordered transition tests and dry-run map. |
| PAY-002B | proposed; PAY-002A | Build caller-scoped command journal, UUID/payload fingerprint, same-result replay, conflict rejection, lease/attempt/error/audit, and Stripe key scheme. | Concurrent duplicate/conflict and injected-failure emulator tests. |
| PAY-002C | proposed; PAY-001B, PAY-002B, RACE-001B | Convert race checkout to persistence-first record/hold plus deterministic Stripe Session saga. | One record/Session on retry at every failure boundary. |
| PAY-002D | proposed; PAY-001C, PAY-002B, MERCH-001B | Convert merchandise/catalog creation to persistence-first order/hold plus deterministic Stripe keys. | One order/Session/catalog object on retry; failure recovery tests. |

## Webhooks, capacity, inventory, and cancellation

| ID | Status/dependency | Bounded deliverable | Close evidence |
| --- | --- | --- | --- |
| PAY-003A | implemented_locally | Review/land current ingress slice: signature/method, explicit livemode, payment mode, event ledger, reference resolution, money/discount checks, monotonic refunds, terminal guards, quarantine, generic errors, webhook-only secret. | Functions lint; signed positive/negative/duplicate/out-of-order unit suite and residual-gap notes. |
| PAY-003B | proposed; PAY-002A–D, RACE/MERCH reducers | Move event handling to strict versioned schemas and canonical reducers; atomically finalize/release counters and outbox projections. | Emulator transactions for both domains, distinct duplicates, reorder, async and terminal cases. |
| PAY-003C | owner_action; A/B, CI-001A | Add retry/quarantine worker/lease semantics, TTL/dead-letter monitoring, and Stripe CLI test-mode delivery rehearsal. | Redacted signed immediate/delayed/retry/rotation evidence and alerts. |
| RACE-001A | proposed; PAY-002A | Add capacity/hold schema, expiry/indexes, compatibility reader, and dry-run counter backfill. | Full/closed/legacy fixture report and idempotent rerun. |
| RACE-001B | proposed; A, PAY-002B | Implement transaction-safe reserve/confirm/release across paid/free/comp/volunteer/admin paths. | Repeated concurrent last-seat, duplicate, expiry and nonnegative-counter tests. |
| MERCH-001A | proposed; PAY-001C, PAY-002A | Add canonical SKU/variant and conventional `onHand`, `reserved`, `sold` schema plus catalog migration: `available = onHand - reserved`. | Legacy/size/color/zero-stock migration fixtures and invariant report. |
| MERCH-001B | proposed; A, PAY-002B | Implement deterministic multi-SKU reserve; on paid decrement `reserved` and `onHand`, increment `sold`; release only `reserved`; approved restock increments `onHand`. | Concurrent last-SKU/multi-line/retry/return tests; no negative stock. |
| PAY-004A | proposed; PAY-002B/C, RACE-001B | Implement one-record cancellation that expires Session/releases hold with already-paid/expired/network race recovery. | Retry and payment/cancel race tests; no resurrection. |
| PAY-004B | proposed; A, RACE/MERCH services | Implement bulk event/product closure as bounded idempotent jobs over active Sessions/holds. | Partial failure/resume/rerun report. |
| PAY-004C | proposed; PAY-002C, PAY-003B | Replace late reusable Payment Links with one-off Checkout; inventory/deactivate/reconcile legacy links. | Retry/reuse/expiry/payment tests; owner performs Dashboard deactivation. |

## Refunds, privacy, mail, administration, and observability

| ID | Status/dependency | Bounded deliverable | Close evidence |
| --- | --- | --- | --- |
| PAY-005A | proposed; PAY-001D, PAY-002A/B | Add idempotent refund commands, remaining-balance/concurrency validation, stable Stripe keys, and event-finalized totals. | Same/conflicting/concurrent partial/full/timeout tests. |
| PAY-005B | proposed; PAY-003B | Model dispute lifecycle for orders and registrations with finance alert references. | Duplicate/reordered created/updated/lost/won fixtures. |
| PAY-005C | proposed; A/B | Build read-only scheduled/operator reconciliation and mismatch/quarantine report. | Orphan/mismatch/refund/event/counter synthetic report. |
| PAY-005D | proposed; C, AUTH-003B | Build separately authorized idempotent repair commands with reason and append audit. | Dry-run/apply/rerun and forbidden-capability tests. |
| MAIL-001A | proposed; PAY-003B | Build deterministic escaped transactional outbox and truthful queued/delivery state for registration/order confirmation. | Retry/concurrency/hostile-HTML/provider-failure tests. |
| MAIL-001B | owner_action; A, LEGAL-001 | Add approved cancel/refund/fulfillment templates and sender/DNS/bounce/suppression operations. | Template snapshots and private SPF/DKIM/DMARC/provider evidence. |
| DATA-001A | proposed; PAY-002C/D | Replace confirmation query bearer tokens with verified Session/UID projection; hash/expire/scrub anonymous free-flow capabilities. | Cross-user/guess/replay/expiry/history/referrer tests. |
| DATA-001B | blocked_owner_decision; LEGAL-001 | Define classification/purpose projections and remove PII from logs/monitoring/admin views. | Owner-approved matrix and projection/redaction snapshots. |
| DATA-001C | blocked_owner_decision; B, RESILIENCE-001A | Add dry-run-first retention/minimization and authenticated access/deletion workflows. | Date/status/hold/cross-user/dry-run/apply/rerun tests. |
| ADMIN-001A | proposed; AUTH-003B, PAY-001A, PAY-002B | Build common privileged command middleware and append-only audit. | Capability/auth/schema/idempotency/audit tests. |
| ADMIN-001B | proposed; A, RACE-001A | Move event/registration configuration and lifecycle operations to scoped APIs. | Field/state/capability tests and UI parity. |
| ADMIN-001C | proposed; A, MERCH-001A | Move catalog/order/inventory/fulfillment operations to scoped APIs. | Field/state/capability/inventory tests and UI parity. |
| ADMIN-001D | proposed; A, DATA-001B | Add purpose-specific minimum check-in/emergency/finance/fulfillment exports with re-auth/reason/bounds/formula defense/audit. | Column/PII/large/formula/capability snapshots. |
| ADMIN-001E | proposed; B–D | Cut clients over and tighten remaining direct rules to server-only. | Full Rules/admin regression; no compatibility catch-all. |
| OBS-001A | proposed; PAY-003A | Add correlation-based structured logs with allowlisted fields/redaction. | Sensitive/hostile log snapshots. |
| OBS-001B | proposed; A, PAY-005C | Add low-cardinality payment/event/refund/reconcile metrics and SLO dashboards. | Synthetic metric and dashboard review. |
| OBS-001C | owner_action; A/B | Configure alerts, Sentry/analytics privacy policy, retention, and incident drill. | Redacted payload inspection and triggered alert/runbook handoff. |

## Merchandise policy, hosting, resilience, test program, and launch

| ID | Status/dependency | Bounded deliverable | Close evidence |
| --- | --- | --- | --- |
| MERCH-002A | blocked_owner_decision; LEGAL-001 | Record approved tax, shipping/pickup, countries, returns/exchanges, address retention, and support inputs. | Leadership/accountant traceability sign-off. |
| MERCH-002B | proposed; A, MERCH-001B | Apply server shipping/tax config and actual total snapshots/reconciliation. | Test-mode taxable/pickup/shipping/mismatch fixtures. |
| MERCH-002C | proposed; A/B, ADMIN-001C | Add fulfillment/return/restock state and audited operator actions. | Forbidden transitions and stock adjustment tests. |
| MERCH-002D | proposed; A–C, MAIL-001B | Add minimum customer communications/UI and address minimization. | Lifecycle/email/PII projection tests. |
| WEB-001A | owner_action; CI-001B2 | Provision isolated staging hosting, rewrites, canonical/sitemap behavior, deploy and rollback. | ADR and deep-route staging evidence. |
| WEB-001B | proposed; A | Add CSP/HSTS/frame/referrer/permissions/MIME/cache policy. | Automated header/CSP and browser flow smoke. |
| WEB-001C | proposed; A/B, PAY-001A | Sanitize/validate stored HTML/URLs and migrate unsafe content. | XSS/protocol/legacy content fixtures. |
| WEB-001D | owner_action; A–C | Execute controlled DNS cutover/rollback and retire old deploy path without enabling commerce. | Dated owner-approved cutover evidence. |
| RESILIENCE-001A | owner_action; DATA-001B, LEGAL-001 | Inventory RPO/RTO and configure least-privilege monitored backup/export retention. | Private access review and scheduled backup success. |
| RESILIENCE-001B | proposed; A, staging | Restore into isolated no-live-Stripe/email/DNS project and validate rules/indexes/counts/references/reconciliation. | Dated timed restore drill and no-external-side-effect proof. |
| TEST-001A | ready; CI-001A | Add synthetic factories, signed Stripe helpers, production-project/live-key/network guards, and artifact scrubber. | Deliberate guard and redaction failures. |
| TEST-001B | proposed; A | Add Auth/Firestore/Functions emulator saga, RBAC, Rules, and App Check integration harness. | Repeatable local/CI demo-project run. |
| TEST-001C | proposed; B, race/merch reducers | Add deterministic capacity/inventory concurrency and every local/Stripe failure-boundary test. | Repeated no-flake invariant matrix. |
| TEST-001D | proposed; B, PAY-003/PAY-005 | Add signed Stripe lifecycle, duplicate/reorder, async, refund/dispute/reconcile fixtures. | Risk/invariant traceability and coverage thresholds. |
| TEST-001E | owner_action; A–D, staging | Add browser/test-mode E2E and exact-commit release traceability report. | Redacted staging report; no live objects. |
| LEGAL-001A | owner_action | Approve privacy/terms/vendors/security contact/retention/access-deletion inputs. | Versioned approval and engineering traceability. |
| LEGAL-001B | owner_action | Approve race waiver/minor/evidence/refund/cancel/transfer/insurance inputs. | Versioned approval mapped to DATA/RACE states. |
| LEGAL-001C | owner_action | Approve merchandise tax/shipping/returns/refund/support inputs. | Accountant/leadership approval mapped to MERCH config. |
| OPS-001A | owner_action; all prerequisites ready | Complete ownership, MFA, access, secret rotation, and account inventories. | Private two-owner review. |
| OPS-001B | owner_action; A, TEST-001E | Configure isolated staging/provider systems and run full dress rehearsal. | Exact-commit matrix; any P0 gap blocks. |
| OPS-001C | owner_action; B, RESILIENCE-001B | Run kill-switch, webhook/orphan, admin-compromise, provider-outage, rotation, and restore drills. | Timed drill/corrective-action records. |
| OPS-001D | owner_action; every P0 done, C | Execute one explicitly approved bounded live pilot, reconcile/observe, then make two-person go/no-go decision. | Private financial/system evidence; default is disable on missing/anomalous evidence. |

## Publication checklist for remaining, non-duplicate rows

- [ ] Search the live milestone and issue history before creating anything.
- [ ] Publish large parents as trackers, never as one agent assignment.
- [ ] Publish only dependency-ready, unrepresented children; apply current status/owner labels accurately.
- [ ] Copy the parent constraints, this row, affected paths, and shared definition of done into each child.
- [ ] Link the exact PR/test/migration/config evidence before closing a child.
- [ ] Close a parent only after every child and every parent-level acceptance criterion passes.
