# MPRC Platform System Design

**Status:** Target architecture and current-state assessment
**Last reviewed:** 2026-07-13
**Owners:** MPRC product, engineering, operations, and finance leads

This document is the system-level map for the Mid-Peninsula Running Club platform. It describes what exists in this repository, which parts are safe to rely on today, and the architecture required before accepting live race-registration or merchandise payments.

The repository already contains a substantial prototype: a public React site, Firebase Authentication, Firestore-backed events and products, member and admin experiences, Stripe Checkout creation, a signed Stripe webhook, order and registration administration, Firestore rules, and a small automated test suite. That is a useful foundation, but it is not yet a production-ready commerce system. In particular, payment reconciliation, replay safety, capacity and inventory reservations, environment isolation, legal content, dependency health, and operational controls are incomplete. See [SECURITY.md](./SECURITY.md) for the risk register and [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the ordered path to launch.

## 1. Goals and non-goals

### Goals

- Publish public club content, events, and merchandise.
- Support anonymous and signed-in race registration.
- Apply member pricing only when the server verifies a current member role.
- Support free, paid, complimentary, and volunteer registration paths.
- Sell physical merchandise with explicit variant and inventory tracking.
- Keep card data out of MPRC systems by using Stripe-hosted Checkout.
- Give authorized operators safe tools for registrations, orders, refunds, fulfillment, members, and event configuration.
- Make every money-affecting operation idempotent, auditable, observable, and reconcilable.
- Minimize collection and retention of personal data.
- Separate development, test, and production systems so local work cannot change production data.

### Non-goals for the first production release

- Storing or processing raw card numbers.
- Building a custom payment form.
- A multi-vendor marketplace, subscriptions, split payments, or Stripe Connect.
- International tax automation, multi-currency pricing, or international fulfillment unless approved as a separate project.
- Complex discount stacking or a public coupon engine.
- General-purpose content management.
- Replacing Stripe's receipts, dispute console, fraud tooling, or financial reports.

## 2. Architectural principles

1. **Stripe is authoritative for money; Firestore is authoritative for club operations.** A redirect, browser state, or client request never proves payment. A verified Stripe event transitions the local business record.
2. **The browser proposes; the server decides.** Prices, eligibility, capacity, inventory, refund limits, roles, and state transitions are recomputed or validated in trusted server code.
3. **Reserve scarce resources before opening Checkout.** Race capacity and merchandise inventory are held atomically in Firestore, then a Stripe Session is created as the next step of a recoverable saga.
4. **Every external side effect is idempotent.** Checkout creation, refunds, webhook consumption, emails, and reconciliation use stable business keys and tolerate retries.
5. **Financial mutations use narrow server endpoints.** Admin users may manage catalog and editorial content directly only where rules explicitly permit it. They do not directly edit payment state, OAuth secrets, event ledgers, or rate-limit data.
6. **Fail closed and reconcile.** If an amount, currency, reference, or transition is unexpected, do not mark it paid. Record the anomaly, alert an operator, and resolve it through reconciliation.
7. **Collect the minimum data for the minimum time.** Emergency contacts, birth dates, shipping addresses, OAuth tokens, analytics, and support logs require explicit purpose and retention rules.
8. **Production is never a development dependency.** Local clients use emulators and Stripe test mode; staging and production use different Firebase projects, Stripe sandboxes/accounts or keys, webhook secrets, and domains.

## 3. Current system context

```mermaid
flowchart LR
    Visitor["Visitor or member browser"]
    Admin["Club administrator browser"]
    Web["React single-page app\nNetlify live; Pages domain conflict unresolved"]
    Auth["Firebase Authentication"]
    FS["Cloud Firestore"]
    Fn["Firebase Cloud Functions\nNode.js 20"]
    Stripe["Stripe-hosted Checkout\nand Stripe API"]
    Hook["Stripe webhook endpoint"]
    Mail["Firestore Email extension\nand mail provider"]
    Strava["Strava OAuth and API"]
    Sentry["Sentry"]
    Analytics["Firebase Analytics\nNOT INITIALIZED in #139 source"]

    Visitor --> Web
    Admin --> Web
    Web --> Auth
    Web --> FS
    Web --> Fn
    Fn --> FS
    Fn --> Stripe
    Stripe --> Hook
    Hook --> FS
    FS --> Mail
    Fn --> Strava
    Web --> Sentry
```

Text alternative: browsers can use the React app, Auth, Firestore, Functions, Stripe, email, Strava, and the separately bounded Sentry path; #139 source has no browser-to-Firebase-Analytics data path, but website publication and provider behavior are not proven here.

### Current component inventory

| Layer | Current implementation | Primary locations | Assessment |
| --- | --- | --- | --- |
| Public and account UI | React 18, React Router 6, mixed JS/TS, Create React App | `src/App.jsx`, `src/pages`, `src/components` | Functional, but the build stack and several dependencies are stale. |
| Identity | Firebase email/password Auth and custom role claims | `src/services/identity`, `functions/signup.js`, `functions/setMemberRole.js` | Reasonable base; admin assurance and role-change audit controls need strengthening. |
| Operational data | Cloud Firestore | `src/services`, `firestore.rules`, `firestore.indexes.json` | Appropriate for current scale; counters and state transitions require transactional design. |
| Server API | First-generation Firebase callable/HTTP/trigger functions | `functions/` | Prototype covers most workflows; validation, idempotency, and isolation are incomplete. |
| Payments | Stripe Checkout Sessions, Payment Links, refunds, signed webhook | `functions/createCheckoutSession.js`, `createMerchCheckout.js`, `stripeWebhook.js` | Not ready for live payments until P0 issues are complete. |
| Hosting and release | Netlify currently answers `runmprc.com`. GitHub Pages still reports the same custom domain, so its default URL redirects to the Netlify-served name instead of providing an independent copy. #135 source stops automatic releases, pauses Git-triggered Netlify production builds, and removes the Pages CNAME from future protected artifacts. | `netlify.toml`, `.github/workflows/deploy.yml`, `public/404.html` | Split and conflicting as verified 2026-07-13. The existing Pages provider setting is not cleared until a controlled #136/WEB-001 release and readback prove it. #133 authority, #136 release evidence, Netlify provider triggers, DNS, headers, and rollback remain open. |
| Email | Firestore `mail` outbox designed for the Firebase Trigger Email extension | `functions/sendConfirmationEmail.js` | Extension/provider deployment is unverified; outbox creation is not transactionally idempotent and HTML needs escaping. |
| Observability | Optional Sentry; Firebase Analytics configuration remains but its runtime is not initialized by #139 source | `src/services/monitoring`, `src/services/analytics` | #134 source bounds Sentry payloads. #139 source removes every application runtime Firebase Analytics import, initialization, and emission while preserving no-op call compatibility. Website publication, provider collection/cookies and historical data, consent, retention, access, deletion, and vendor configuration remain unverified under #110/#111. |
| Third-party fitness | Strava OAuth tokens and statistics | `functions/strava.js`, `src/services/strava` | Functional prototype. The #100 source Rules deny browser token access, but Firebase deployment is unproven and transactional refresh, scopes/revocation, IAM/encryption decision, and audit remain OAUTH-001. |

The former workflow automatically published Pages before attempting Firebase and could finish green after skipping Firebase. #135 replaces that source path with a manual exact-current-commit request, exact latest CI checks, one fixed backend plan, protected short-lived identity wiring, provider readback, and Firebase-before-Pages publication. Missing authority or failed/partial verification is red. Git-triggered Netlify production builds stop, while build hooks and protected Netlify publication remain unverified. No source test clears the current Pages custom-domain claim, configures #133, deploys #136, or proves `runmprc.com`; those remain separate provider states. The App Engine synchronization script is another surface that must be documented as active or retired.

```mermaid
flowchart TD
    Merge["Merge to main"] --> CI["Exact main-push CI"]
    CI --> Request["Manual exact-commit release request"]
    Request --> Prepare["Credential-free artifact preparation"]
    Prepare --> Approval{"Protected environment approved?"}
    Approval -- "No" --> Stop["Stop — nothing published"]
    Approval -- "Yes" --> Recheck{"Main, latest CI, project, scope, authority, and artifact still valid?"}
    Recheck -- "No" --> Stop
    Recheck -- "Yes" --> Backend["Deploy fixed Firebase set once"]
    Backend --> Verify{"Exact Rules and Function revisions verified?"}
    Verify -- "No" --> Stop
    Verify -- "Yes" --> Pages["Publish Pages branch without a CNAME"]
    Merge -. "Git production build paused" .-> Netlify["Netlify / runmprc.com\nprotected publication not available"]
```

Text alternative: a merge only runs CI; a separate request prepares a public artifact, waits for protected approval, rechecks current source and authority, verifies Firebase, and only then publishes a Pages branch that no longer claims the Netlify domain.

### GitHub Pages callback handoff

```mermaid
flowchart LR
    Provider["Stripe or Strava returns to a deep link"]
    Missing["GitHub Pages 404"]
    Store["Store same-origin path, query, and fragment\nin this browser tab"]
    Root["Redirect to the site root"]
    Restore["Remove temporary state, validate origin,\nand restore the route once"]
    Router["React Router opens the callback page"]
    Reject["Discard malformed or outside-site target"]

    Provider --> Missing --> Store --> Root --> Restore
    Restore -->|safe| Router
    Restore -->|unsafe| Reject
```

Text alternative: the 404 page temporarily carries the complete return route to the root page; an early referrer policy keeps the path/query/fragment out of subresource request headers, and the root page deletes the temporary value before accepting only a same-origin route. App Check, Analytics, and Sentry stay off on that initial capability-bearing callback. The bridge does not prove payment, OAuth state, or identity. Server/provider verification still decides the result.

### Strava callback current-address cleanup — source only, not live

OAUTH-001C1G [#335](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/335) adds a second boundary after the existing Pages handoff. The Strava callback keeps only its initial `code`, `state`, and provider-error fields in temporary component memory. It replaces the current native browser and React Router entry with the same path, no address details after `?` or `#`, and no saved callback detail before the callback mounts its Auth/service work, verifies state, or starts the existing exchange attempt.

```mermaid
flowchart LR
    Route["Strava callback with made-up address details after ? or #"] --> Capture["Capture three selected fields in temporary page memory"]
    Capture --> Replace["Replace current browser and Router entry with path only"]
    Replace --> Clean{"Both current locations clean?"}
    Clean -- "Not yet" --> Wait["Wait; no state check or exchange"]
    Wait -. "Detected replacement failure" .-> Stop["Fixed accessible failure"]
    Clean -- "Yes" --> Checks["Existing sign-in, provider-error, code, and state checks"]
    Checks --> Exchange["At most one exchange attempt for the same signed-in account and app"]
    Outside["Earlier browser, provider, hosting, or network copies"] -. "Remain outside this boundary" .-> Residual["Back or history is not cleanup proof"]
```

Text alternative: the callback captures three selected made-up fields in temporary page memory, replaces the current browser and Router entry with the clean path, and proceeds to the existing checks only after both current locations are clean. Unconfirmed cleanup waits without state verification or exchange. A detected replacement failure shows the fixed stop. Cleaning the current entry does not erase earlier browser or outside copies.

The source also discards a later same-route callback. After unmount or a signed-in UID, service, Firebase resources, or app change, an obsolete browser result cannot navigate or show success. That does not cancel an exchange that already reached the server or provider; its outcome may still occur and require separate reconciliation. This child does not change the Pages bridge, provider request, server state model, App Check enforcement, scopes, membership, or deployment. Source, tests, merge, website publication, `runmprc.com` revision verification, Firebase deployment, Strava configuration, production data, and live OAuth behavior remain separate states. Canonical [#88](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/88) remains open for server-issued one-use state, expiry/replay, account and scope policy, concurrency, reconciliation, revoke/audit, IAM/encryption, provider configuration, deployment, and live proof.

### Firebase Auth action link — source only, not live

```mermaid
flowchart LR
    Mail["Private Firebase email link"] --> Bridge["Same-origin Pages handoff"]
    Bridge --> Route["/auth/action captures one code in memory"]
    Route --> Scrub["Remove query and fragment from browser history"]
    Scrub --> Wait["Wait for the member to choose Verify email"]
    Scanner["Mail scanner opens the page"] --> Wait
    Wait --> Check{"Provider says VERIFY_EMAIL?"}
    Check -- "No" --> Stop["Fixed unusable result; no account change"]
    Check -- "Yes" --> Match{"Signed-in account is safe to continue?"}
    Match -- "No" --> Stop
    Match -- "Yes or signed out" --> Apply["Apply the one-time code"]
    Apply --> Result["Fixed public result; no email or code shown"]
```

Text alternative: after the website hands off the action route, the app keeps one code only in component memory, removes it from both the visible address and router location, makes no account change when a scanner merely opens the page, and applies it only after a person chooses the button and Firebase confirms the verification operation. The result never grants membership or writes a member profile.

AUTH-MAIL-002C2 [#194](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/194) owns this verification-only source route. It ignores query-provided API keys and continuation URLs, suppresses Sentry and App Check startup while the initial capability is present, and returns only small non-identifying states. Its fixed `/account` exit performs a full clean-page load so App Check can start only after the private query is gone. Firebase configures one custom handler for verification, password reset, and email recovery. Therefore [#119](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/119) must not point the project-wide action URL at this partial route. Keep Firebase's default multi-mode handler or wait for separately reviewed coverage of every enabled mode. Website publication, provider configuration, action-link reachability, and the Firestore verification mirror remain unproven.

The direct-rewrite hosting path does not need browser storage. The existing GitHub Pages fallback from #99 briefly places the complete return route in tab-local `sessionStorage`, then its first root-page script reads and deletes that value before React starts. If the root page never loads, the value can remain until the tab closes. #194 accepts that already-merged residual only for Pages compatibility; it does not call this “memory only.” A future direct SPA rewrite should remove the bridge. The component itself never writes the code to storage or router state.

## 4. Target deployment topology

The target keeps React, Firebase, and Stripe, but places stronger boundaries around them. Migrating the frontend from GitHub Pages to Firebase Hosting is recommended before live commerce because it supports controlled SPA rewrites, preview channels, and security headers. That hosting migration is not required to design or test the backend, and must be executed as its own issue.

```mermaid
flowchart TB
    subgraph Client["Untrusted client boundary"]
      Web["React web application"]
    end

    subgraph Edge["Owned web edge"]
      Hosting["Firebase Hosting or equivalent CDN\nTLS, CSP, HSTS, SPA rewrites"]
      AppCheck["Firebase App Check\nreCAPTCHA Enterprise"]
    end

    subgraph Identity["Identity boundary"]
      FirebaseAuth["Firebase Authentication"]
      Claims["Server-managed role claims"]
    end

    subgraph Application["Trusted application boundary"]
      PublicAPI["Public callable functions\nvalidation, rate limits, App Check"]
      AdminAPI["Admin callable functions\nAuth, role, recent-auth policy"]
      Webhook["Stripe webhook ingress\nsignature verification only"]
      Worker["Idempotent payment processor\nand reconciliation jobs"]
      Mailer["Transactional email outbox"]
    end

    subgraph Data["Data boundary"]
      Firestore["Firestore domain records"]
      CommerceControl["Server-only commerce admission\nsystemConfig/commerce"]
      EventInbox["Stripe event inbox"]
      Audit["Append-oriented audit events"]
      Secrets["Google Secret Manager"]
    end

    subgraph Payment["Payment boundary"]
      Checkout["Stripe-hosted Checkout"]
      StripeAPI["Stripe API and event destination"]
    end

    Web --> Hosting
    Web --> FirebaseAuth
    Web --> AppCheck
    Web --> PublicAPI
    Web --> AdminAPI
    PublicAPI --> Firestore
    AdminAPI --> Firestore
    PublicAPI --> CommerceControl
    AdminAPI --> CommerceControl
    PublicAPI --> StripeAPI
    AdminAPI --> StripeAPI
    StripeAPI --> Checkout
    StripeAPI --> Webhook
    Webhook --> EventInbox
    EventInbox --> Worker
    Worker --> Firestore
    Worker --> Audit
    Worker --> Mailer
    PublicAPI --> Secrets
    AdminAPI --> Secrets
    Webhook --> Secrets
    FirebaseAuth --> Claims
```

Text alternative: checkout and refund commands read both domain records and the server-only commerce control; the signed webhook path does not depend on that control and continues processing payment evidence.

## 5. Trust boundaries and authorization

| Boundary | Trusted assertions | Never trust directly |
| --- | --- | --- |
| Browser | A Firebase ID token after SDK/server verification; an App Check token after Firebase verification | Price, member status, registration status, order status, redirect query parameters, product availability, capacity, inventory, or admin UI visibility |
| Firebase Auth | UID, verified token claims, token timestamps | A role copied into Firestore or sent in the request body |
| Stripe webhook | Event payload only after raw-body signature verification with the endpoint's secret | An unsigned request, a browser success redirect, or a client-provided Session ID without server retrieval/validation |
| Firestore client SDK | Reads and writes allowed by the deployed ruleset | The presence of a hidden UI control as authorization |
| Cloud Functions/Admin SDK | Application code and IAM-scoped service identity | Firestore rules as protection; Admin SDK bypasses those rules |
| GitHub Actions | Pinned workflow and environment-scoped secrets | Pull-request code with production secrets or a shared, long-lived deployment token |

### Roles

The current `unverified`, `member`, and `admin` claims should evolve toward capabilities rather than one all-powerful role. A practical first split is:

| Capability | Example users | Allowed operations |
| --- | --- | --- |
| `member` | Verified club member | Members-only content and member price |
| `event_manager` | Race director | Event content, roster, comps, substitutions; no global member roles or merchandise refunds |
| `shop_manager` | Merchandise lead | Catalog, orders, tracking, fulfillment; no event or membership administration |
| `finance_admin` | Treasurer | Refunds, reconciliation, disputes, reports |
| `identity_admin` | Membership lead | Membership verification and role administration |
| `platform_admin` | Very small break-glass group | Security configuration and role grants |

The first release may continue using `admin` in the UI, but server endpoints and Firestore rules should be narrowed by resource now so future capability claims can be introduced without rewriting payment logic.

### Current verified-role boundary — source only, not live

AUTH-001A [#98](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/98) requires an authoritative verified target before the existing grant endpoints can add `member` or `admin`. AUTH-001B [#196](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/196) requires exact boolean Firebase token claim `email_verified == true` in addition to the existing role for role-based Firestore access. AUTH-001C [#209](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/209) applies the same second gate to current Functions role consumers: shared admin callables, member-only/member-price checkout decisions, and registration CSV export. AUTH-001D1 [#213](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/213) mirrors that decision in the browser so an unverified role-bearing token cannot make member/admin controls look available before the server denies them.

```mermaid
flowchart LR
    BrowserToken["Browser reads one refreshed ID-token result"] --> BrowserCheck{"Exact verified-email and role claims?"}
    BrowserCheck -- "No" --> Hide["Project no member/admin browser role"]
    BrowserCheck -- "Yes" --> UI["Show matching member/admin controls\nUI guidance only"]
    ServerToken["Firebase verifies token for backend use"] --> ServerCheck{"Exact verified-email and role claims?"}
    ServerCheck -- "No" --> Deny["Deny role-based access"]
    ServerCheck -- "Yes" --> Rules["Specific Firestore rule"]
    ServerCheck -- "Yes" --> Function["Specific Function guard"]
    BrowserCheck -. "verification never grants" .-> UI
    ServerCheck -. "verification never grants" .-> Rules
```

Text alternative: the browser shows member/admin controls only when one refreshed token result contains exact verified-email and role claims, while Firebase independently verifies the same two facts before a specific database rule or Function uses the role; browser display is not authority and verification alone grants nothing.

The Functions policy reads decoded-token `email_verified`, not the camel-case Auth user-record field used while granting a role and not the `emailVerified` profile mirror. The browser policy also reads only the refreshed ID-token claims. Neither accepts a request or profile substitute. Missing, false, string, numeric, inherited, accessor-backed, proxied, unknown, or case-changed claims fail closed. Exact `unverified` remains a non-authoritative display state. Unauthenticated and unauthorized responses remain generic. This does not provide authoritative membership, scoped capabilities, MFA/recent-auth, token revocation, safe roster projection, or legacy-sync retirement.

All four slices are source boundaries until the exact Rules, Functions, and website revisions are deployed through the protected backend-first release and checked with synthetic staged identities. A source merge or green CI run is not live access proof.

## 6. Domain model and ownership

### Current collections

| Path | Purpose | Source of writes | Sensitivity |
| --- | --- | --- | --- |
| `events/{eventId}` | Event content, schedule, pricing configuration, capacity, waiver version | Admin client today; target event-management API for sensitive fields | Public or members-only |
| `events/{eventId}/registrations/{registrationId}` | Participant identity, waiver evidence, payment references, lifecycle | Cloud Functions and admins today; target Cloud Functions only | Restricted PII and financial metadata |
| `products/{productId}` | Merchandise catalog | Admin client today | Public plus internal configuration |
| `orders/{orderId}` | Buyer, shipping, payment, and fulfillment data | Cloud Functions and admins today; target Cloud Functions only | Restricted PII and financial metadata |
| `members/{uid}` | Profile and role mirror | Create-once signup/recovery Functions create phone-free pending profiles; self-service name-only allowlist while #178/#197 pause phone collection; server role operations | Confidential |
| `members/{uid}/connections/{provider}` | Non-secret connection metadata | Cloud Functions | Confidential |
| `members/{uid}/secrets/{provider}` | OAuth tokens | Cloud Functions | Restricted secret |
| `promoCodes/{id}` | Intended promotion configuration | Admin only | Confidential; currently not integrated into checkout validation |
| `ratelimits/{bucket}` | Abuse-control counters | Cloud Functions | Confidential operational data |
| `mail/{id}` | Transactional email outbox | Cloud Functions and email extension | Restricted PII |

### Target additions and changes

| Path or field | Purpose |
| --- | --- |
| `stripeEvents/{stripeEventId}` | Durable, non-PII webhook inbox/deduplication record with processing status and business reference |
| `checkoutRequests/{commandKeyHash}` | Immutable server-only command registration. PAY-002B2A/#165 owns the exact `registered` revision-1 record. |
| `checkoutRequests/{commandKeyHash}/lifecycle/current` | PAY-002B2B/#169 server-only lease, monotonic fence, and terminal commitment source. It is unused and is not provider-send permission. |
| `checkoutRequests/{commandKeyHash}/providerAttempts/0000000001` | PAY-002B2C1/#173 immutable lease-bound initial Stripe plan. It stores command-bound commitments, is unused, and is not account proof or provider-send permission. |
| `checkoutRequests/{commandKeyHash}/providerAttempts/0000000001/sendEvidence/first` | PAY-002B2C2/#182 separate server-only pre-POST marker with a complete C1-plan digest, its originating fence, trusted time, and persisted 23-hour automatic-retry deadline. It is unused and does not say Stripe received or completed a request. |
| `checkoutRequests/{commandKeyHash}/providerAttempts/0000000001/reconciliationEvidence/0000000001` | PAY-002B2C3B/#206 immutable server-only C3A candidate evidence. It is bound to the exact C1 plan, complete C2 record/audit, observed expired lease, and trusted time. It is unused and grants no later-attempt or send permission. |
| `checkoutRequests/{commandKeyHash}/providerAttempts/0000000001/reconciliationEvidence/0000000001/nextAttemptAuthorizations/0000000002` | PAY-002B2C3C/#226 immutable server-only authorization for one later logical provider attempt. It requires the exact C3B pair, a matching closed transition commitment, and a fresh active lease. It is unused and grants no plan or send permission. |
| `checkoutRequests/{commandKeyHash}/providerAttempts/0000000002` | PAY-002B2C4A/#232 immutable server-only attempt-2 plan. It requires the exact C3C authorization pair and current active lease. Version 1 preserves the attempt-1 account/mode/API/operation/endpoint/parameters and grants no send permission. |
| `checkoutRequests/{commandKeyHash}/providerAttempts/0000000002/sendEvidence/first` | PAY-002B2C4B/#238 immutable server-only attempt-2 pre-POST marker. It binds the complete authorized C4A plan with commitment version 2, the current fence/time, and a fixed 23-hour deadline. It is unused and does not say Stripe received or completed a request. |
| `auditEvents/{eventId}` or bounded per-record audit subcollections | Append-oriented operational and security audit trail. B2A's first event is `commerce_command_{commandKeyHash}_0000000001`; B2B appends one deterministic event for each real lifecycle change; C1 binds the first plan with `commerce_provider_attempt_{commandKeyHash}_0000000001`; C2 pairs the attempt-1 pre-send marker with `commerce_provider_send_{commandKeyHash}_0000000001`; C3B pairs candidate evidence with `commerce_provider_reconciliation_{commandKeyHash}_0000000001_0000000001`; C3C pairs later-attempt authorization with `commerce_provider_authorization_{commandKeyHash}_0000000001_0000000001_0000000002`; C4A binds the second plan with `commerce_provider_attempt_{commandKeyHash}_0000000002`; C4B pairs its pre-send marker with `commerce_provider_send_{commandKeyHash}_0000000002`. |
| `events/{id}.capacityCounters` | Transactionally maintained participant reservations, paid seats, and released seats |
| `products/{id}/variants/{variantId}` | SKU, option values, price, on-hand, reserved, and sold counts |
| `orders.paymentStatus` and `orders.fulfillmentStatus` | Separate money state from physical fulfillment state |
| `registrations.paymentStatus` and `registrations.registrationStatus` | Separate payment lifecycle from attendance/transfer/cancellation lifecycle |
| `orders/registrations.stateSchemaVersion` and `refundStatus` | Version the split business-record state contract and keep confirmed refund status/total separate from payment/operational state |
| server-only per-dispute records | Keep one state per Stripe dispute; never collapse multiple disputes into one canonical order/registration `disputeStatus` |
| `retentionJobs/{jobId}` | Optional operational record of scheduled minimization/deletion work |
| `systemConfig/commerce` | Versioned global/domain command admission; browser read/write denied; protected writer is not available yet |
| `events/{id}.checkoutEnabled` and `products/{id}.checkoutEnabled` | Explicit server-owned resource admission; missing means disabled |

Large `auditLog` arrays on registration and order documents should be replaced before they approach Firestore document-size and write-contention limits. New audit data should be append-oriented.

PAY-002A1 is tracked in live [#161](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/161). Numeric local `stateSchemaVersion: 1` is distinct from string Stripe metadata `schemaVersion: "1"`, which only versions provider reference binding. The reducers and legacy classifier are a pure source/test target: they import no Firebase or Stripe code, make no call, and are not used by an endpoint. Current records, webhook behavior, compatibility writes, real migration, deployment, and live state remain unchanged until later PAY-002/PAY-003 children adopt the contract.

PAY-002B1 is tracked in live [#163](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/163). It is also pure and unused: it separates a caller/environment/UUID command key from a command-type/payload fingerprint, then derives a deterministic Stripe key for one immutable provider attempt. Production/live and non-production/test are the only accepted environment/mode pairs. The command key intentionally excludes command type so a journal can reject reuse of one caller command ID for another operation. Hashes are pseudonymous server-only identifiers—not anonymization—and must not enter browsers, logs, URLs, or analytics. The library contains no Firestore transaction, lease, clock, result, audit, Stripe call, or authorization decision.

PAY-002B2A is tracked in live [#165](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/165). Its unused server-only transaction writes the exact `checkoutRequests/{commandKeyHash}` registered record and `auditEvents/commerce_command_{commandKeyHash}_0000000001` event together with one trusted Timestamp, or writes neither. Exact retries are read-only; command-type, endpoint-version, or payload mismatch under the same B1 key conflicts; corrupt or incomplete pairs fail closed without repair. Environment and caller scope are already bound into the B1 document ID, so a different scope creates a different record rather than a cross-scope conflict. The fixed result grants no authorization or execute/send permission and contains no hash, path, raw identity, UUID, or payload.

B2A has no endpoint/index export, lease, fence, terminal commitment, result replay, provider plan/key/object, Stripe call, provider attempt transition, safe-send clock, or reconciliation behavior. PAY-002B2B source/tests are tracked in live [#169](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/169). They keep the B2A root and revision-1 audit immutable and store mutable state at `checkoutRequests/{commandKeyHash}/lifecycle/current`. The source uses a fixed 60-second server lease, a command-bound fingerprint of a trusted UUID v4 holder, and a monotonic fence so stale or expired workers cannot finish. Each real lease or terminal change gets one deterministic audit event.

B2B terminal success stores only a command-bound commitment to a later server-only business result. That commitment is not the result itself, proof that Stripe or Firestore work happened, or response replay. The lease/fence is concurrency evidence, not authorization or provider-send permission. PAY-002B2C1/#173 owns immutable initial-plan binding. PAY-002B2C2/#182 owns only separate pre-send evidence and a conservative automatic-retry cutoff. B2C3 still owns verified reconciliation and safe attempt advancement. No TTL is safe yet: deleting both C2 partners would look like first use, so [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) must approve retention and a server-only tombstone or equivalent durable duplicate barrier before a command pair can be deleted.

PAY-002B2C1 source/tests are tracked in live [#173](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/173). With the exact current unexpired lease/fence, the unused journal can atomically create the immutable attempt-1 plan plus `auditEvents/commerce_provider_attempt_{commandKeyHash}_0000000001`. The first version accepts only the static `checkout_session_create` → `/v1/checkout/sessions` mapping, so an object ID or capability cannot enter the stored path. The plan also fixes Stripe mode, API version, original binding fence, and command-bound commitments to the account, canonical parameters, and deterministic B1 key. Raw account/parameters/key are absent. An existing plan is accepted only when its binding time fits the deterministic lifecycle audit for its original fence. An exact active-lease retry is read-only; a valid takeover may observe but cannot rewrite the plan; conflicts and malformed or missing partners fail closed.

These commitments are pseudonymous equality evidence, not authorization, configured-account proof, a pre-POST marker, provider-execution proof, or response replay. PAY-002B2C2 source/tests are tracked in live [#182](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/182). Its unused transaction recomputes the exact B1 identity and C1 plan, requires the exact active lease holder/fence, and creates only the separate marker/audit pair. Both partners bind a command-bound digest of every immutable C1 plan field, so a later coherent account, API-version, endpoint, parameter, key-commitment, or binding change cannot reuse the marker. Version 1 persists a deadline exactly 23 hours after the pre-POST marker. The first atomic creation, and an exact attempt-1 retry, are classified `send_permitted` only when a post-transaction trusted-time check is still strictly before the transaction-validated lease's captured expiry and the stored deadline. The second check does not re-read lifecycle state. Equality, later time, rollback, or paired missing/unreadable time is classified `reconciliation_required`; no attempt advancement follows.

The fixed C2 result is narrow retry-safety evidence. It is not caller authorization, configured-account proof, a claim that Stripe received the POST, a provider outcome, or response replay. Timeout, connection loss, `5xx`, a missing object reference, and incomplete search are deliberately not C2 inputs and cannot manufacture attempt `2`. B2C3 remains responsible for verified reconciliation evidence and safe later-attempt authorization. #173/#182 have no runtime/index import, Stripe/network call, Firebase deployment, provider configuration, production data, website, or live/officer effect.

PAY-002B2C3A source/tests are tracked in live [#184](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/184). The unused pure policy accepts only one exact flat version-1 Stripe attempt-1 evidence record made from closed enums. It returns one of three frozen non-identifying results: `existing_attempt_found` with `do_not_advance`, `new_attempt_candidate` with `requires_persistence_and_authorization`, or `reconciliation_required` with `requires_reconciliation`. Only the matching complete tuple for trusted proof that endpoint execution never began, or the matching complete tuple for an exact verified expired/unpaid Session plus verified expiry and an explicitly eligible new logical generation, can be a candidate. The matching complete exact-open or verified-success tuple identifies an existing attempt. Every single-field difference, timeout, lost connection, provider error category, old/pruned key, missing reference, not-found result, empty/partial search, processing/unknown state, mismatch, or conflict requires reconciliation.

C3A classification is not authorization or provider truth. The module accepts no IDs, keys, accounts, metadata, money, timestamps, business/member values, free text, URLs, or caller-selected status codes. It stores nothing, calls nothing, is imported by no runtime entry point, and cannot create attempt `2`.

PAY-002B2C3B source/tests are tracked in live [#206](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/206). The unused journal imports the unchanged C3A classifier and may persist only its exact `new_attempt_candidate` result. The deterministic evidence/audit pair is created atomically only when the complete C2 record/audit is valid, the 23-hour automatic retry deadline has arrived, and the current validated lease is expired. Equality is allowed because C2 stops automatic POST at its deadline and lease expiry. A still-active lease or an early candidate returns the unchanged C3A candidate without writing. Exact retries are read-only; a changed valid evidence tuple conflicts; a missing, malformed, orphaned, future, or foundation-mismatched pair fails closed without repair.

C3B stores only closed C3A enum values, schema versions, command-bound C1/C2 commitments, the observed fence/expiry, and one trusted time. A digest covers the complete evidence record and is carried by its deterministic audit. Raw account, key, parameters, provider/business/member IDs, money, URLs, free text, response data, and attempt `2` are absent. The fixed persisted result says only `requires_separate_authorization`. C3C must still require this proof, an allowed business transition, and a fresh lease before it can authorize/version a later attempt. Neither C3A nor C3B retrieves provider truth, calls Stripe, replays a response, changes a business record, or has a runtime/index edge. No Firebase/Stripe deployment, provider configuration, production read/write, website, or officer behavior is changed by #184/#206 source.

PAY-002B2C3C source/tests are tracked in live [#226](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/226). The unused `authorizeNextStripeProviderAttempt` API consumes only the exact validated C3B pair. It repeats the complete safe-tuple check, requires either the matching `retry_same_operation` or `replace_expired_unpaid` transition, command-binds an opaque transition-record commitment, and requires the exact current holder/fence under a lease acquired at or after C3B persistence with a later fence.

```mermaid
flowchart TD
    C3B["Persisted exact candidate + audit"] --> Gate{"Complete safe tuple?"}
    Transition["Matching closed transition commitment"] --> Gate
    L["Fresh active later-fence lease"] --> Gate
    Gate -- "No" --> Stop["No write"]
    Gate -- "Yes" --> A["Immutable attempt-2 authorization + audit"]
    A --> R["requires_plan_binding"]
    R --> P["C4A immutable attempt-2 plan + audit"]
    P --> S["requires_pre_send_evidence"]
    S --> E["C4B immutable pre-send marker + audit"]
    E --> Clock["Second trusted-time check"]
    Clock -- "Fresh" --> Permit["send_permitted"]
    Clock -- "Expired or rollback" --> Reconcile["reconciliation_required"]
    Permit -. "No Stripe request in this source" .-> F["Future trusted runtime"]
```

Text alternative: one exact saved safe candidate, matching transition, and fresh lease can authorize attempt 2; C4A may bind its plan, and C4B may record pre-send evidence only while a second clock check remains before the captured lease expiry and fixed deadline; none of these source steps calls Stripe.

The record/audit pair binds the command identity; complete C1, C2, and C3B commitments; environment/mode/operation; attempts `1` and `2`; transition kind and command-bound transition-record commitment; a command-derived attempt-2 key fingerprint; the fresh lease fence; and one trusted time. It stores no raw key, account, parameters, identity, money, URL, response, free text, or personal data. The opaque transition commitment is not current business-state proof; a future runtime must derive it from a trusted business-record transaction. Exact retry and later-lease observation are read-only. Changed valid input conflicts. Orphaned, malformed, future, unsafe, or foundation-mismatched data fails closed without repair.

The fixed result is `provider_attempt_authorized` with `requires_plan_binding`; it contains no execute/send flag or sensitive value. #226 creates no attempt-2 provider plan or pre-send record, changes no business record, calls no provider, and has no endpoint/index edge. Firestore Rules source remains unchanged and browser roles remain denied. This is synthetic source/test design evidence only: Firebase deployment, Stripe configuration, production data, website publication, live behavior, and the PAY-002C/D/PAY-003B runtime adoption remain open.

PAY-002B2C4A source/tests are tracked in live [#232](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/232). The unused `bindAuthorizedStripeProviderPlan` API revalidates the exact B1-through-C3C chain and current active lease before atomically creating the immutable attempt-2 plan and its deterministic audit. Version 1 is equality-only: account, mode, API version, operation, endpoint, and canonical parameters equal attempt 1. Only the internally derived attempt-2 key commitment, current binding fence/time, attempt number, and C3C provenance may differ.

The fixed result is `provider_plan_bound` or `provider_plan_existing`, with `requires_pre_send_evidence`. Exact retry and later valid lease observation are read-only; changed valid input conflicts; malformed, orphaned, future, impossible-chronology, or foundation-mismatched partners fail closed. The pair stores no raw identity, account, parameters, key, money, URL, response, secret, or personal data. C4A creates no send evidence, changes no business record, calls no provider, and has no endpoint/index edge. PAY-002B2C4B [#238](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/238) owns the separate attempt-2 pre-send boundary below. Other Stripe operations require their own reviewed boundaries.

PAY-002B2C4B source/tests are tracked in live [#238](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/238). The unused `recordAuthorizedStripeSendEvidence` API revalidates B1 through C4A plus the current active holder/fence before creating the attempt-2 marker and deterministic audit, or neither. Both carry `providerPlanCommitmentSchemaVersion: 2`, a digest of every C4A plan field and nanosecond binding time including the authorization schema and commitment. Existing version-1 commitment bytes remain unchanged.

The marker time is captured once before the transaction; its deadline is exactly 23 hours later and never moves on retry. After the transaction, a second trusted-time check does not re-read lifecycle state. Permission requires no rollback and a time strictly before both the captured current lease expiry and stored deadline. Equality, later time, rollback, or missing/unreadable paired time returns fixed `reconciliation_required`. Exact retry and a later valid lease observation are read-only inside the original deadline. The fixed permitted result is only `send_permitted` with `pre_send_recorded`; it does not prove caller authority, current business state, Stripe-account control, request execution, or a provider result.

C4B stores no raw identity, account, parameters, key, transition value, money, URL, response, secret, or personal data. It is limited to `checkout_session_create` at `POST /v1/checkout/sessions`; it cannot create attempt `3`, call Stripe, write a business record, or enter an endpoint/index. Product/Price creation, Session expiry, refunds, and privileged provider actions require separate operation-specific plan, pre-send, result, and reconciliation boundaries.

PAY-002B2C4C1 source/tests are tracked in live [#246](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/246). The unused pure `classifyAuthorizedStripeCheckoutResultEvidence` API accepts only a primitive, length-bounded, canonical JSON string encoding the reported 16-field attempt-2 Checkout Session assertion envelope. Parsing creates the ordinary record inside the module; non-string objects fail before property access. Its sole matching output is `unbound_result_candidate` with `requires_dispatch_evidence_persistence_and_business_validation`; every other valid closed tuple reconciles and every malformed or non-canonical serialized value fails with one fixed redacted error.

```mermaid
flowchart LR
    Report["Canonical serialized direct-response evidence"] --> Policy{"Exact C4C1 shape?"}
    Bind["Reported C4B pre-send binding"] -. "Assertion only" .-> Policy
    Policy -- "No" --> Reconcile["reconciliation_required"]
    Policy -- "Yes" --> Candidate["unbound_result_candidate"]
    Candidate --> Future["Later trusted dispatch evidence\nresult persistence\nbusiness validation"]
```

Text alternative: canonical serialized reported evidence may produce only an unbound shape candidate, which must stop until later trusted dispatch evidence, result persistence, and business validation exist.

C4C1 creates no persisted collection or audit row. It has no dispatch or idempotency proof, parses no raw Stripe object, stores no Session reference or URL, and has no journal, endpoint, index, provider, business-state, Rules, or deployment edge. C4B does not point directly to a trusted result: both the reported response and pre-send binding are untrusted assertions until a future adapter and runtime boundary validate them.

### C4C2A Stripe SDK response observation — TEST ONLY, UNUSED

PAY-002B2C4C2A is tracked in live [#275](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/275). One Node 20 suite calls the installed `stripe` 14.25.0 public Checkout Session create path through the SDK's exported but experimental/unstable `HttpClient` interface and a fully synthetic in-memory fake. This is an installed-version observation and dependency-upgrade gate, not a provider contract. It observes selected own data properties and `lastResponse`: the same fake raw-response object attached by the SDK as an own non-enumerable, non-writable property. Header-derived fields added by the SDK are observed separately from `statusCode`, which the fake raw object supplies; this is not an exhaustive model of a production `IncomingMessage`.

```mermaid
flowchart LR
    Fake["Synthetic fake HTTP body and headers"] --> SDK["stripe-node 14.25.0 public create path"]
    SDK --> Session["Forgeable Session own data"]
    SDK --> Response["Forgeable non-enumerable lastResponse"]
    Session --> Sensitive["PII, metadata, client secret, and capability URL may survive"]
    Session --> Stop["Observation only: never enumerate, clone, stringify, log, or persist whole object"]
    Response --> Stop
    Stop --> Projection["C4C2B1 unused untrusted allowlist projection"]
    Projection --> Future["C4C2B2 runtime call, URL, dispatch, persistence, and business binding"]
```

Text alternative: a fake HTTP client can make the public SDK return a Session and response metadata containing controlled values, including sensitive fields and an unvalidated URL. C4C2A is only an installed-version test observation; C4C2B1/#280 adds only an unused untrusted allowlist projection, while C4C2B2 still owns the runtime call, raw memory-only comparisons, URL approval, persistence, and business binding.

The synthetic Session demonstrates that unknown fields, customer/contact data, metadata, a client secret, a fragment-bearing standard Checkout URL, and an HTTPS custom `.invalid` URL can survive SDK deserialization unchanged. The URLs are unvalidated pass-through values. Raw JSON serialization omits `lastResponse` but retains unsafe Session fields. A normal synthetic Stripe error envelope rejects, while a bare non-2xx response without that envelope may resolve, so resolution, rejection, and status are never trusted alone. Synthetic fixture literals may live in test source, but no dynamically captured raw value may enter a snapshot, log, issue, or artifact.

The fake client controls every observed resource and header value. Neither the Session shape nor `lastResponse` proves Stripe origin, account control, dispatch, delivery, idempotency-key use, plan/send binding, application environment, business clock, payment, capacity, inventory, or business state. This does not claim that the SDK makes literally no internal platform or time observation. #275 adds no projector, validator, runtime adapter, provider call, journal/persistence, endpoint/index import, or canonical C4C1 evidence. A future saga persists only a server-only Session ID, expiry, and minimal reviewed evidence—not the Checkout URL. Any replay must retrieve the Session by that stored ID and freshly validate the URL and business/provider bindings before returning it.

Source, synthetic tests, merge, website publication, `runmprc.com` verification, Firebase deployment, Stripe configuration, production data, and live behavior are separate states. C4C2A proves only the first two when their corresponding evidence exists; it changes no officer task.

### C4C2B1 server-only Checkout Session projection — SOURCE ONLY, UNUSED

PAY-002B2C4C2B1 is tracked in live [#280](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/280). The pure `projectStripeCheckoutSessionObservation` boundary accepts one untrusted Session-like object. It rejects root and `lastResponse` proxies before reflection, requires the selected Session and response observations to be own data properties with the installed-SDK descriptor shapes pinned by C4C2A, and reads each selected descriptor once. It ignores every unknown field without enumeration or access. It imports no SDK, Firebase, Firestore, journal, configuration, clock, logger, network, filesystem, endpoint, or index.

```mermaid
flowchart LR
    Session["Untrusted Session-like object"] --> Allowlist{"Selected own data descriptors valid?"}
    Allowlist -- "No" --> Error["One fixed redacted error"]
    Allowlist -- "Yes" --> Project["Fresh frozen null-prototype projection"]
    Project --> Facts["Server-only Session business primitives"]
    Project --> Categories["URL and response facts reduced to categories"]
    Facts --> Stop["Not safe to log, expose, or persist"]
    Categories --> Stop
    Stop --> Adapter["C4C2B2 runtime call, URL, binding, persistence, and business checks"]
```

Text alternative: C4C2B1 reads only named own data fields, returns technically bounded server-only Session primitives plus redacted URL/response categories, and stops before runtime trust, persistence, or business use.

The projection fixes schema version `1`, provider `stripe`, and provider operation `checkout_session_create`, then includes a bounded Session ID, object/mode/status/payment-status values, live-mode flag, amount/currency pair, and creation/expiry integers. The fixed provider and operation labels describe this projector; they do not prove provider origin or execution. Every retained value remains forgeable and server-only; #280 does not authorize logging or persistence. The raw Checkout URL is reduced to `bounded_https_capability_present` or `absent`, without returning the URL or approving its host, callbacks, or fragment. Raw request ID, idempotency key, Stripe account ID, and API-version text are also excluded. Only fixed bounded-present/missing, expected/other API-version, and response-status categories survive. Metadata, customer/contact data, client secrets, callback URLs, response bodies/headers/sockets, and unknown fields never enter the projection.

The fixed classification is `untrusted_checkout_session_projection` with `requires_runtime_binding_persistence_and_business_validation`. It is not C4C1 positive evidence and proves no provider origin, account control, dispatch, key use, plan/send binding, configured environment, current time, payment, capacity, inventory, retention approval, persistence, or business state. C4C2B2 must control the SDK promise, compare raw memory-only response facts to trusted C4A/C4B/configuration evidence, approve the memory-only capability URL, bind current business/time facts, persist only approved server evidence, and return a current URL without logging or storing the URL.

Source change, tests, merge, website publication, `runmprc.com` verification, Firebase deployment, Stripe/provider configuration, production data, and live behavior are separate states. #280 changes no officer task and proves none of the external or live states.

### C4C2B2A Checkout Session transport comparison — SOURCE ONLY, UNUSED

PAY-002B2C4C2B2A is tracked in live [#285](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/285). The pure `classifyStripeCheckoutSessionResponseBinding` policy classifies a possible binding; it is not a binding adapter. A future controller must build one frozen null-prototype schema-1 capsule in one synchronous call stack. The capsule carries an already-created exact #280 projection plus separately captured observed and expected API-version, idempotency-key, and optional Stripe-account primitives. The policy does not call #280, inspect or re-read a Session, retain input references, await work, call Stripe, or write data.

```mermaid
flowchart LR
    P["Existing #280 projection"] --> C{"Exact closed comparison"}
    O["Observed memory-only facts"] --> C
    E["Expected memory-only facts"] --> C
    C -- "Exact technical match" --> U["Untrusted binding candidate"]
    C -- "Mismatch or missing proof" --> R["Reconciliation required"]
    U --> F["Future controller proves provenance, URL, business, time, and persistence"]
    R --> F
```

Text alternative: a future controller gives the pure classifier an already-created #280 projection plus memory-only observed and expected transport primitives; an exact comparison yields only an untrusted candidate and every mismatch stops for reconciliation.

The classifier revalidates the exact #280 schema and all capsule keys, descriptors, bounds, and prototypes without coercion. API version `2023-10-16` is the installed compatibility ceiling. A candidate also requires exact non-missing idempotency-key equality, expected-200, bounded request-ID, bounded HTTPS-capability, and either exact bounded account equality or missing account on both sides. Matching missing accounts proves transport consistency only, never platform-account identity or control. Business, environment, and time fields remain unapproved even when structurally valid.

Outputs are fresh frozen fixed three-field records: `untrusted_transport_binding_candidate` or `reconciliation_required`. They contain no Session ID, URL, request ID, raw API/key/account value, source reference, personal data, or secret. Expected inputs have no trusted provenance in this child. #285 does not establish same-promise capture, Stripe origin/account, C4A/C4B/configuration binding, dispatch, delivery, approved URL/callback, current business/time facts, retention, persistence, C4C1 mapping, replay, endpoint/index adoption, deployment, or live behavior. The remaining C4C2B2 runtime controller owns those proofs.

CI-001B3 [#167](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/167) runs the exact opt-in command-journal emulator suite as a named hosted release prerequisite; #169, #173, #182, #206, #226, #232, and #238 expand that same suite. These are synthetic source checks only. Source change, tests, merge, Firebase deployment, Stripe configuration, production data, website publication, `runmprc.com` verification, and live behavior remain separate states. The current journal source remains unused and makes no endpoint, provider, production, website, or officer change.

### PAY-003C1 commerce attempt-failure disposition — SOURCE ONLY, UNUSED

PAY-003C1 is tracked in live [#377](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/377) under PAY-003 [#106](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/106). The pure `classifyAttemptFailure` policy reads one exact flat revision-1 evidence record `{ failureDispositionSchemaVersion, failureSignal, sideEffectIdempotency, retryBudget }` drawn only from closed vocabularies and returns one frozen disposition — `retry_transient`, `dead_letter`, `quarantine_permanent`, or `ignore_duplicate` — each carrying a boolean `retryable`. `failureSignal` reuses the house transient names (`timeout`, `connection_lost`, `rate_limited`, `server_failure`, `external_dependency_failure`) plus permanent (`permanent_client_error`, `malformed_response`), reconcile-needed (`conflict`, `unknown`), and already-applied (`duplicate_replay`); `sideEffectIdempotency` is `idempotent`/`non_idempotent` and `retryBudget` is `available`/`exhausted`. It imports only `node:util`.

```mermaid
flowchart TD
    E["Exact revision-1 failure evidence"] --> D{"duplicate_replay?"}
    D -- "Yes" --> Ig["ignore_duplicate"]
    D -- "No" --> T{"Transient signal?"}
    T -- "No" --> Q["quarantine_permanent"]
    T -- "Yes" --> I{"Idempotent effect?"}
    I -- "No" --> Q
    I -- "Yes" --> B{"Retry budget available?"}
    B -- "Yes" --> Rt["retry_transient (retryable)"]
    B -- "No" --> Dl["dead_letter"]
```

Text alternative: an already-applied duplicate is ignored; any non-transient signal, or a transient signal on a non-idempotent effect, is quarantined; a transient failure on an idempotent effect retries while the caller's budget remains and otherwise dead-letters.

The safety invariant is that a non-idempotent side effect is never `retry_transient`: a transient failure on a non-idempotent effect quarantines instead, so the deferred worker can never double-apply an external create, refund, or send (external effects must be idempotent and retry-safe). Only genuinely transient signals retry, and only while `retryBudget` is `available`; an exhausted budget dead-letters; `conflict` and `unknown` fail closed to `quarantine_permanent`; `duplicate_replay` yields `ignore_duplicate` with no new delivery. `retryable` is true only for `retry_transient`.

The retry budget is an input, never a baked-in maximum count, backoff schedule, TTL, dead-letter threshold, or alert — those stay with the deferred PAY-003C worker and retention approval [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110). The module names no provider, recipient, address, money, or message and accepts no free-form identifiers, so nothing PII-shaped can ride in; malformed, proxy, accessor, inherited, extra-or-missing-key, unknown-enum, or wrong-version input throws one fixed `CommerceFailureDispositionError` that never echoes the input. The sibling `commerceOutboxState` (PAY-003B1, [#364](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/364)) validates whether a proposed delivery transition is legal but is handed the target state; this classifier derives which target a failure warrants. The `commerceProviderResult`/`commerceProviderReconciliation` classifiers answer business-advance-versus-reconcile and never emit a retry-versus-permanent verdict. It reads no clock, randomness, environment, network, Firestore, or Stripe; is imported by no runtime entry point or Functions index; stores and logs nothing; and creates no attempt, send, retry, deletion, or business record. Source change, tests, merge, Firebase deployment, Stripe configuration, production data, website publication, and live behavior remain separate states; #377 changes no officer task and proves none of the external or live states.

## 7. Business invariants

The following are correctness rules, not UI preferences:

1. `amountExpectedCents`, `currency`, and sellable item are read from server-controlled data.
2. `amountPaidCents` comes from a verified Stripe object and is stored separately from expected list price.
3. A record becomes paid only when `payment_status == paid` or an equivalent successful PaymentIntent state is verified.
4. Each Stripe event is applied at most once; applying it again produces the same final state and no duplicate email, seat, stock decrement, or refund.
5. One checkout request maps to one business record and at most one active Stripe Session.
6. A member price requires a currently verified `member` or authorized admin claim at checkout time.
7. Participant reservations never exceed event capacity. Volunteers do not consume participant capacity unless an event explicitly configures a volunteer cap.
8. Variant reservations never exceed sellable on-hand inventory. A product-wide `active` flag does not imply every size/color is available.
9. Full refunds, terminal cancellations, and expired unpaid Sessions release capacity or inventory exactly once according to policy.
10. Partial refunds do not silently release a seat or fulfilled product.
11. A paid record cannot be changed to cancelled without an explicit policy decision about refunding or retaining funds.
12. Financial state cannot be edited directly from a Firestore client.
13. A waiver record identifies the exact waiver version/text hash accepted, timestamp, event, registrant, and acceptance context.
14. Confirmation pages display only sanitized fields and do not rely on bearer credentials left in URLs or referrer logs.

## 8. Core workflows

### 8.0 Account profile setup and recovery

Issue [#118](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/118) adds a create-once recovery path for accounts whose `members/{uid}` record is missing after the Firebase cutover. It is a source design until the exact Function, current Rules, and dependent website are deployed backend-first and proven with a synthetic account.

```mermaid
sequenceDiagram
    actor M as Signed-in member
    participant W as Account page
    participant F as ensureMemberProfile Function
    participant A as Firebase Auth Admin
    participant D as Firestore

    M->>W: Open My Account
    W->>F: Empty request + verified Firebase sign-in
    alt setup fails
        F-->>W: Generic unavailable result
        W-->>M: Hide Edit; show retry/sign-out path
    else setup continues
        F->>D: Read only members/{caller UID}
        alt profile exists
            D-->>F: Exists
            F-->>W: ready=true; no write or claim change
        else profile missing
            F->>A: Load caller's authoritative Auth record
            F->>D: Transactionally create one phone-free pending profile
            F-->>W: ready=true
        end
        W->>D: Read caller profile through Firestore Rules
        alt read succeeds
            D-->>W: Profile
            W-->>M: Show profile and name-only Edit
        else read fails
            D-->>W: Generic failure
            W-->>M: Hide Edit; show retry/sign-out path
        end
    end
```

The callable accepts no UID or profile fields. A missing record receives bounded name, email, verification, and provider fields from Firebase Auth plus `role: unverified`; while phone collection is paused, the server writes the existing schema-compatible empty phone field instead of copying `user.phoneNumber`. It never copies a member/admin claim, dues, payment, or discount state. Existing records and claims remain byte-for-byte unchanged. This may expose a pre-existing claim/profile mismatch instead of guessing how to repair it; the identity/membership workflow must resolve that mismatch explicitly. App Check is required by the shared boundary only when deployed enforcement is configured, so release evidence must prove that setting before calling App Check live.

DATA-001C1 [#178](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/178) pauses optional phone display and collection in My Account. The owner-profile projection omits `phoneNumber`, the client validates and writes only `fullName`, and the Rules source rejects every browser phone mutation while allowing an existing phone value to remain unchanged during a name edit. DATA-001C2 [#197](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/197) extends the same pause to the shared signup/recovery helper: a new profile keeps the empty phone schema field even when Firebase Auth already has a phone. The create-once transaction leaves every existing profile unchanged. Firestore still authorizes and transports the owner's complete document at its document-level boundary; #116 retains future server projections for broader administrative reads. Neither slice deletes, migrates, exports, or inspects existing phone data, changes Google Forms/providers, or proves spam causation. Source is not live protection until the exact Rules and both profile Functions are deployed/read back before the dependent website revision is published and verified.

The server chooses initial timestamps. The current self-edit path sends a Firestore server timestamp, but the Rules source type-checks rather than independently proves that edit timestamp. Do not describe arbitrary profile edit timestamps as server-authoritative until a coordinated Rules/API issue closes that residual.

### 8.0a Provider-neutral membership authority and entitlement — SOURCE ONLY, UNUSED

MEMBERS-IDENTITY-001A [#208](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/208) defines one unused pure contract that keeps a stable MPRC membership separate from the Firebase account used to sign in. A membership record can exist without a UID. Such a record grants no website entitlement. Google, WhatsApp, Strava, email equality, a profile role, and any browser field remain projections or inputs to future reviewed workflows; none is membership authority.

```mermaid
flowchart LR
    M["Stable opaque MPRC membership ID"] --> L{"Explicit UID association recorded?"}
    A["Firebase account"] --> L
    L -- "No or conflicting" --> N["Not entitled"]
    L -- "Yes" --> T{"Versioned term decision complete?"}
    T -- "Missing or decision pending" --> P["Policy decision pending"]
    T -- "Suspended, ended, future, or expired" --> N
    T -- "Approved and inside explicit start/end" --> E["Fixed current-member result"]
    X["Google / WhatsApp / Strava / email / role"] -. "Never grants membership" .-> N
```

Text alternative: a stable membership receives the fixed current-member result only after an explicit UID association and a complete approved term whose explicit half-open time range contains the evaluation time. Missing, conflicting, suspended, ended, future, expired, or undecided state fails closed. External identities, channels, matching email, and roles never grant membership.

The CommonJS module creates an account-independent revision-1 snapshot, records one explicit account association, records already-decided term references monotonically, and derives one of three frozen non-identifying results: current member, not entitled, or decision pending. It accepts exact plain objects, bounded server-minted opaque identifiers, safe-integer time values, one current term rather than an unbounded mutable history, and a last-command marker for immediate idempotent retry. An exact last-command retry is read-only. A changed last-command retry, a second/different UID association within the snapshot, a stale record revision, an exhausted safe-integer revision, a skipped or repeated term revision, a reversed time range, an unsupported version/state, an extra field, an accessor, or a proxy fails through one fixed error.

This contract does not verify a person, payment, plan, evidence item, refund, dispute, or policy decision. It does not choose calendar-year versus anniversary terms, grace, prices, plan eligibility, retention, or legacy disposition. Its identifier grammar is not a semantic privacy classifier; a future trusted server must mint opaque values and establish every referenced fact. The last-command marker prevents only an immediate changed retry; command IDs are not a durable global replay registry. Durable cross-record UID uniqueness, full command replay history, append-only audit, Firestore schema/Rules, custom claims, token refresh/revocation, runtime authorization, migration, and deployment are later children behind #110, #113, #114, AUTH-003/ADMIN, and the protected release work.

The module is imported by no runtime or Functions index. It reads no clock or environment, calls no Firebase/Stripe/provider service, stores nothing, logs nothing, changes no current profile/role/claim, and cannot make #81, annual renewal, discounts, roster export, or officer membership tools available. Source tests and a merge are not Firebase deployment or live behavior proof.

### 8.0b Officer manual off-platform dues-evidence command — SOURCE ONLY, UNUSED

MEMBERS-ADMIN-001A [#395](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/395) defines one unused pure contract for the first MEMBERS-ADMIN-001 [#115](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/115) behavior: recording an owner-approved off-platform dues confirmation for a membership term without creating or claiming a Stripe payment. It turns one exact officer-audit envelope into the exact approved `record_term_decision` command the §8.0a reducer already accepts, plus a paired immutable audit record stamped with an off-platform provenance. It decides no policy; every owner-meaningful value is carried through as an opaque token.

```mermaid
flowchart LR
    O["Officer-attested off-platform dues-evidence envelope"] --> V{"Exact envelope: opaque actor / capability / recent-auth / evidence references, safe-integer revisions, half-open term window?"}
    V -- "Missing, malformed, non-opaque, out of range, reversed, or wrong version" --> F["One fixed fail-closed error, no command"]
    V -- "Valid" --> C["Approved record_term_decision command, owner values carried through verbatim"]
    V -- "Valid" --> A["Paired audit record: provenance manual_off_platform, no Stripe or charge identifier"]
    C --> R["§8.0a reducer accepts the command and approves the linked term"]
```

Text alternative: a well-formed officer envelope — bounded opaque references for actor, capability, recent authentication, membership, evidence category, evidence, reason, and correlation; safe-integer expected and term revisions; an opaque term ID, plan reference, and policy version; and a half-open start/end window — projects the exact approved `record_term_decision` command the §8.0a reducer accepts, plus a paired immutable audit record stamped with an off-platform provenance and carrying no Stripe or charge identifier. Any missing, extra, non-opaque, out-of-range, reversed, wrong-version, accessor, or proxy input fails closed through one fixed error and produces no command.

The CommonJS module validates one exact envelope with the same fail-closed primitives as §8.0a — bounded server-minted opaque identifiers, safe-integer revisions and half-open time bounds, exact plain objects only — and returns two frozen values: the reducer command, whose command type and `approved` term state are the fixed identity of this manual path, and the audit record, which names who acted, under what capability and recent re-authentication, on which membership and term, with what off-platform evidence category and reference, and why. The audit record carries no Stripe, charge, session, or contact identifier, so "records dues without claiming an external charge" is a testable invariant. The module re-declares the reducer's validation primitives and its command schema version locally so the contract stays standalone; an integration test imports the shipped reducer and fails if that version ever drifts.

This contract does not verify an actor, capability, recent authentication, evidence item, plan, price, term calendar, or policy decision. It does not read or write the authoritative record, mint the applied prior/new revision, stamp a server time, record a command result, associate a UID, refresh or revoke entitlement, or register a durable command ID for replay. Its identifier grammar is not a semantic privacy classifier; a future trusted runtime must mint every opaque value, verify the officer's capability and recent authentication under AUTH-003, establish each referenced fact, apply the command against the current record, and persist the completed audit entry.

The module is imported by no runtime or Functions index. It reads no clock or environment, calls no Firebase/Stripe/provider service, stores nothing, logs nothing, changes no current profile/role/claim, mints no identifier, and cannot make manual dues recording, an officer review queue, or any officer membership tool available. Source tests and a merge are not Firebase deployment or live behavior proof.
### 8.0c Entitlement-to-authorization-claim reconciliation — SOURCE ONLY, UNUSED

MEMBERS-IDENTITY-001E [#373](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/373) defines one unused pure contract that bridges the §8.0a entitlement result and the deferred custom-claim lifecycle. `membershipAuthority.js` (#208) derives whether a subject is a current member but explicitly defers "custom claims, token refresh/revocation" to a later child; nothing yet derives, from that entitlement, whether the membership authorization claim in a token **should** be present and — when it drifts — whether to grant or revoke it. #81 requires that custom claims carry authorization only, and names access-revocation as first-class. A second invariant is encoded: membership governs **only** the member authorization claim. The officer (`admin`) role is administered separately ([#115](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/115), `setMemberRole`); gaining or losing membership never grants or revokes it.

```mermaid
flowchart LR
    V["Entitlement + email verification + observed member/officer claims"] --> G{"Well-formed authorization-only evidence?"}
    G -- "No" --> X["One fixed error, input never echoed"]
    G -- "Yes" --> D{"Entitled current member AND email verified?"}
    D -- "Yes" --> DP["Desired member claim present"]
    D -- "No, pending, or unverified" --> DA["Desired member claim absent (fail-closed)"]
    DP --> C{"Matches the observed member claim?"}
    DA --> C
    C -- "Yes" --> AL["aligned"]
    C -- "No, desired present" --> GM["grant_member"]
    C -- "No, desired absent" --> RM["revoke_member"]
    O["Observed officer (admin) claim"] -. "Never enters the member-claim decision" .-> C
    AL --> Z["grantsAuthority: false / officerRoleAffected: false"]
    GM --> Z
    RM --> Z
```

Text alternative: the desired member claim is present only for a subject the §8.0a contract deems a current member whose sign-in email is verified; not entitled, decision pending, or unverified all fail closed to a desired-absent claim, so a stale claim is revoked. A desired state that matches the observed member claim is aligned; a missing entitled claim is grant_member; a present unentitled claim is revoke_member. The observed officer role never enters the decision, so an officer whose membership lapses is reconciled to revoke_member while the admin role is left untouched.

The CommonJS module accepts an exact five-field revision-1 evidence object whose values are drawn only from closed authorization vocabularies — an entitlement disposition, an email-verification flag, and the observed member and officer claim states — and derives one of three frozen non-identifying dispositions. The verified-email requirement mirrors the existing `roleGrantPolicy.js` rule for the `member` role. Every result hard-codes `grantsAuthority: false` and `officerRoleAffected: false`. An unknown enum value, a wrong version, an extra or missing field, an accessor, an inherited field, or a proxy fails through one fixed error that never echoes the input.

This contract writes no claim, mints and revokes no token, and derives the reconciliation verdict only. The evidence carries authorization state alone — never a provider ID, phone, profile field, roster, address, or token, exactly as #81 requires of custom claims. It invents no prices, plans, terms, retention duration, deletion window, or access-revocation SLA; those stay with #114/#110 and the owner. The entitlement derivation itself (§8.0a), the officer-role grant path (#115), and consent/link teardown ([#367](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/367)/[#370](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/370)) are separate contracts. The actual custom-claim write, token refresh, and revocation remain gated on the AUTH-001/AUTH-003 Functions/Admin authorization work.

The module is imported by no runtime or Functions index. It requires only `node:util`, reads no clock or environment, calls no Firebase/Stripe/provider service, stores nothing, logs nothing, changes no current profile/role/claim, and cannot make #81 or live claim reconciliation available. Source tests and a merge are not Firebase deployment or live behavior proof.
### 8.0d Provider-neutral versioned consent state — SOURCE ONLY, UNUSED

MEMBERS-IDENTITY-001D [#370](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/370) defines one unused pure contract that derives the current effective consent state for a single (provider, subject, scope) track under the policy version now in force. It sits beside the §8.0a membership authority and the external-account link contract (`membershipProviderLink.js`, [#367](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/367)), which consumes a consent value that it itself defers. Consent is provider-neutral: email/password, Google, WhatsApp, and Strava share one identical rule, and no consent state is membership authority.

```mermaid
flowchart LR
    V["Consent evidence: provider, subject, scope, latest decision, its policy version, policy version in force"] --> G{"Well-formed and coherent?"}
    G -- "No" --> R["One fixed error, input never echoed"]
    G -- "Yes" --> D{"Latest recorded decision?"}
    D -- "None" --> NC["not_consented"]
    D -- "Withdrawn" --> W["withdrawn"]
    D -- "Granted" --> P{"Granting version equals the version in force?"}
    P -- "Equal" --> AC["active"]
    P -- "Differs" --> RA["reaffirmation_required"]
    NC --> Z(["grantsAuthority: false"])
    W --> Z
    AC --> Z
    RA --> Z
    X["Any consent decision"] -. "Never grants membership, price, or role" .-> Z
```

Text alternative: given the latest recorded consent decision for a track and the policy version now in force, the contract returns one of four fixed dispositions. No recorded decision yields not_consented; a withdrawn decision yields withdrawn regardless of any version; a granted decision yields active only when its policy version equals the version in force, and reaffirmation_required otherwise. Every result carries grantsAuthority false. Malformed or incoherent evidence fails closed through one fixed error that never echoes the input.

The CommonJS module publishes a revision-1 schema, a frozen provider-neutral enum set, and one fixed error, and classifies an exact seven-field evidence object — schema version, provider, opaque subject and scope references, latest decision, its policy version, and the policy version in force. A recorded decision must carry an opaque policy version and a `none` decision must carry exactly null, so an incoherent decision/version pairing, an unknown enum, a non-opaque or PII-shaped reference, a wrong version, an extra field, a missing field, an accessor, or a proxy all fail through the one error. Policy versions are compared for equality only.

This contract invents no policy. It sets no prices, plans, or terms, writes no policy text, and defines no retention duration, deletion window, or access-revocation SLA — those remain with #110 and the owner. It assumes no version ordering, recency, or precedence: a differing policy version is simply superseded and routed to reaffirmation, and which version is current is the caller-supplied requiredPolicyVersion. `grantsAuthority` is hard-coded false on every result, so consenting to link WhatsApp or share Strava never confers membership, price, payment state, or role. It derives the current state only — the append-only capture of consent events and their versioned history, withdrawal side effects such as link teardown and claim revocation, the retention/minimization/deletion matrix (#110), and provider-specific WhatsApp consent wiring (#87) are later work, gated on the remaining AUTH-001 Functions/Admin authorization protections.

The module is imported by no runtime or Functions index. It reads no clock or environment, calls no Firebase/Stripe/provider service, stores nothing, logs nothing, changes no current profile/role/claim, and cannot make #81, versioned WhatsApp consent, or any officer membership tool available. Source tests and a merge are not Firebase deployment or live behavior proof.
### 8.0e Provider-neutral external-account link and collision — SOURCE ONLY, UNUSED

MEMBERS-IDENTITY-001C [#367](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/367) defines one unused pure contract that sits beside the §8.0a membership authority and classifies how a single external-account link is reconciled and where a link collision is refused. Email/password, Google, WhatsApp, and Strava are one provider-neutral vocabulary with identical rules; a link is a minimal derived identity projection and never membership evidence. Every classified result carries `grantsAuthority: false`, so no connection, matching identifier, or observed link ever confers membership, price, payment state, or role.

```mermaid
flowchart LR
    I["Provider link evidence"] --> V{"Exact, opaque, in-vocabulary?"}
    V -- "No" --> ERR["One fixed error; no echo"]
    V -- "Yes" --> D{"Desired linked?"}
    D -- "Yes" --> C{"Bound to a different membership?"}
    C -- "Yes" --> COL["collision"]
    C -- "No" --> K{"Consent granted?"}
    K -- "No" --> BLK["blocked — consent_required"]
    K -- "Yes" --> O{"Observed state known?"}
    D -- "No (unlinked)" --> O
    O -- "No" --> OP["observation_pending"]
    O -- "Yes" --> AL{"Desired equals observed?"}
    AL -- "Yes" --> ALN["aligned"]
    AL -- "No" --> RC["reconcile_link or reconcile_unlink"]
    COL -.-> NA["Every result grants no authority"]
    BLK -.-> NA
    OP -.-> NA
    ALN -.-> NA
    RC -.-> NA
```

Text alternative: a well-formed link request is classified in one deterministic pass. A request to link is refused as a collision when the opaque account reference is already bound to a different membership, and is blocked when consent is not granted; otherwise an unknown observation is pending, a matching desired/observed pair is aligned, and a mismatch is a link or unlink reconciliation. Malformed, non-opaque, PII-shaped, out-of-vocabulary, extra-field, accessor, or proxy input fails through one fixed error that never echoes the input. No result grants authority.

The CommonJS module exposes a schema version, one frozen input/disposition enum set, one fixed error, and one classifier over an exact eight-field evidence object: schema version, provider, opaque membership ID, opaque non-secret `providerAccountRef`, consent, desired state, observed state, and the membership the account is currently bound to (or none). The opaque-identifier grammar structurally rejects raw email- and phone-shaped references. Collision detection consumes caller-supplied binding evidence rather than reading any index; the classifier holds no state and mints no identifiers.

This contract decides nothing about prices, plans, term boundaries, renewal, retention, or roster disposition, and it issues no custom claim, token, or role — those remain with §8.0a, #114/#115, #110/#113, and the AUTH-003/ADMIN work. Its identifier grammar is not a semantic privacy classifier; a future trusted server must mint opaque references and establish every bound-elsewhere fact. Durable cross-membership uniqueness, consent capture and withdrawal side effects, provider connect/disconnect execution, Firestore schema/Rules, and reconciliation scheduling are later work gated on the remaining AUTH-001 Functions/Admin authorization protections.

The module is imported by no runtime or Functions index. It reads no clock or environment, calls no Firebase/Stripe/provider service, stores nothing, logs nothing, changes no current profile/role/claim, and cannot make #81, provider linking, or any officer tool available. Source tests and a merge are not Firebase deployment or live behavior proof.
### 8.0f Immutable membership term/evidence receipt ledger — SOURCE ONLY, UNUSED

MEMBERS-DUES-001A [#345](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/345) defines one unused pure contract that preserves the immutable renewal/evidence history the §8.0a authority cannot hold by itself. The §8.0a reducer keeps only one replaceable current-term snapshot, so each recorded term decision overwrites the previous one. This contract records each term decision as an ordered, append-only receipt and projects any receipt back into the exact `record_term_decision` command the shipped authority already accepts, without duplicating that reducer.

```mermaid
flowchart LR
    E["Empty ledger (receiptRevision 0)"] --> A["Append receipt: termRevision equals one-based position"]
    A -- "Reused command/receipt id, skipped or repeated revision, reversed range" --> X["Fails closed"]
    A -- "Exact re-append of the tail command" --> R["Read-only; returns the same ledger"]
    A --> H["Ordered append-only history; earlier receipts never change"]
    H --> P["Project one receipt with an expected revision"]
    P --> C["Exact record_term_decision command accepted by the 8.0a authority"]
```

Text alternative: a ledger starts empty and grows only by appending one term/evidence receipt at a time, where each receipt's term revision equals its one-based position, command and receipt identifiers are unique across the whole history, and earlier receipts are never mutated. An exact re-append of the most recent command is read-only. A reused identifier, a skipped or repeated revision, a reversed time range, an unsupported version/state, an extra field, an accessor, a proxy, or a tampered snapshot fails through one fixed error. Any receipt projects into the exact versioned `record_term_decision` command that the §8.0a authority accepts, so the two contracts compose without a shared type.

The CommonJS module creates an empty versioned ledger, creates one frozen receipt from an opaque evidence bundle (receipt id, command id, term revision/state/id, explicit half-open start/end, and opaque plan/evidence/policy references), appends receipts as an immutable ordered history with monotonic position-bound revisions and global identifier uniqueness, treats an exact tail re-append as read-only, and projects a receipt into the frozen `record_term_decision` command input. It accepts exact plain objects, bounded server-minted opaque identifiers, and safe-integer time values only.

This contract does not verify a person, payment, plan, evidence item, refund, dispute, or policy decision, and it grants no entitlement by itself. It does not choose calendar-year versus anniversary terms, grace, prices, currency, plan eligibility, retention, tax, or legacy disposition; every reference is an opaque caller-supplied token and only technical bounds — a positive-duration range and a monotonic position-bound revision — are enforced. Durable persistence and replay, Firestore schema/Rules, custom claims and token refresh/revocation, cross-record uniqueness, runtime authorization and adoption, migration, and deployment are later children behind #114 and the protected release work.

The module is imported by no runtime or Functions index and updates no officer procedure because it makes nothing officer-observable. It reads no clock or environment, calls no Firebase/Stripe/provider service, stores nothing, logs nothing, and changes no current profile/role/claim. Source tests and a merge are not Firebase deployment or live behavior proof.

### 8.1 Paid race registration

PAY-001B1 [#219](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/219) adds only the browser projection and first two server validation steps below. The website sends the active field set and omits volunteer tier. The callable preserves the opaque event ID, accepts an exact bounded envelope before Firestore, matches answers against the admitted selected server fields, and encodes callback values. It does not add the target request ID, snapshot, transaction, reservation, idempotent Session saga, safe confirmation capability, deployment, or live proof.

```mermaid
sequenceDiagram
    actor R as Runner
    participant W as Web app
    participant F as Registration function
    participant D as Firestore
    participant S as Stripe
    participant H as Webhook processor

    R->>W: Submit identity, waiver acceptance, request ID
    W->>W: Keep active answers; omit volunteer price tier
    W->>F: Callable request + Auth/App Check when available
    F->>F: Validate exact bounded request envelope
    F->>D: Read commerce control and event
    D-->>F: Admitted server event field schema
    F->>F: Match participant or volunteer answers
    F->>D: Transaction: validate event snapshot, reserve capacity, create pending registration
    F->>S: Create Session after command gate; later generation also needs reconciliation gate
    F->>D: Attach Session ID and expiry
    F-->>W: Stripe-hosted Checkout URL
    W->>S: Redirect to Checkout
    S-->>H: Signed Checkout event
    H->>D: Atomic dedupe + amount/currency/reference validation + state transition
    H->>D: Enqueue confirmation email exactly once
    S-->>W: Redirect using Session ID only
    W->>F: Request sanitized checkout result
    F->>S: Retrieve/verify Session if reconciliation is needed
    F-->>W: Confirmed, processing, failed, or support-required state
```

Text alternative: the website sends only the active signup fields; the server then accepts only a small exact request, preserves and safely encodes the event identity, and matches answers to the selected server fields; the target flow later reserves locally before Stripe, accepts payment only through the signed webhook, and returns only a sanitized result.

If Stripe Session creation fails, the function releases the reservation in a compensating transaction. If the function crashes after Stripe creates the Session, PAY-002B2C2 retries only the exact B2C1 plan/key inside its stored safe-send window. After that deadline—or when first-send time is unknown—it stops POSTing. C3A can classify already-verified evidence, and C3B can persist only a candidate after the retry and lease gates; neither retrieves provider truth, authorizes, or advances. C3C must complete the separate fresh-lease authorization gate, C4A must bind the immutable later plan, and C4B/#238 must record its own pre-send evidence before a later POST. A scheduled job releases abandoned reservations and reconciles records that missed a webhook.

### 8.2 Free or volunteer registration

The same server validation and Firestore transaction are used, but no Stripe call occurs. The registration moves directly to its confirmed non-payment state. Anonymous confirmation uses a short-lived or hash-stored opaque receipt token that is removed from browser history immediately; signed-in users can use ownership by UID.

### 8.3 Merchandise purchase

Merchandise uses the same checkout saga but reserves a specific SKU/variant. Stripe shipping collection is copied into the order only after a verified paid event. Payment status and fulfillment status remain separate. A paid order may be `unfulfilled`, `packed`, `shipped`, `delivered`, `cancelled`, or `returned` without corrupting the payment ledger.

### 8.4 Refund

An authorized finance action creates a separate refund-operation record with a stable idempotency key. Stripe executes the money movement; the webhook is the canonical confirmation. That operation may show `refund_pending` while waiting, but the order/registration aggregate `refundStatus` remains at its last confirmed value. Repeated clicks or network retries must return the original refund rather than create another one. A full registration refund may release capacity according to event policy; a merchandise refund does not modify inventory until the return/stock disposition is explicitly recorded.

### 8.5 Webhook processing

The ingress verifies method, raw payload, signature, and secret. Relevant event types are written or claimed using the Stripe Event ID. Business processing validates object type, livemode/environment, metadata schema version, business reference, Session/PaymentIntent ownership, currency, and amount. Unknown transitions are quarantined for review. Stripe does not guarantee event order, so each transition is based on current domain state and the retrieved Stripe object when necessary.

### 8.5a Idempotent side-effect outbox delivery-state contract — SOURCE ONLY, UNUSED

PAY-003B1 [#364](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/364) defines one unused pure contract for the *side-effect outbox* named by parent PAY-003 [#106](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/106): the durable delivery lifecycle of an internal side-effect intent a confirmed command produces, such as a transactional email to send or a role grant to apply. It is a sibling of the `functions/commerceState.js` business-state reducers in the same non-throwing result-object idiom, and does not duplicate them, the provider-call classifiers, or the Firestore-backed command journal. It governs only *whether a delivery step is allowed and how many attempts have begun*, never a recipient, message, or provider.

```mermaid
flowchart LR
    Q["queued\nattempts = 0"] -->|"begin attempt (+1)"| D["dispatching"]
    D -->|"provider accepted"| S["dispatched"]
    D -->|"transient failure"| R["retry_scheduled"]
    D -->|"permanent failure"| X["dead_letter"]
    D -->|"caller suppressed"| U["suppressed"]
    R -->|"begin attempt (+1)"| D
    R -->|"give up"| X
    S -->|"provider confirmed"| V["delivered"]
    S -->|"reversed"| X
    S -->|"caller suppressed"| U
```

Text alternative: a side-effect intent starts `queued` with zero attempts. Entering `dispatching` — the only edge that begins a fresh provider attempt — increments a monotonic attempt counter by exactly one; every other edge holds it unchanged. `dispatching` resolves to `dispatched`, `retry_scheduled`, `dead_letter`, or `suppressed`; `retry_scheduled` returns to `dispatching` or gives up to `dead_letter`; `dispatched` resolves to `delivered`, `dead_letter`, or `suppressed`. The terminals `delivered`, `dead_letter`, and `suppressed` have no outgoing edges and cannot be resurrected. Any other edge, a backward or wrong-delta counter, or a count incoherent with the state fails through a fixed reason.

The CommonJS module reduces the mutable `{ deliveryState, attemptCount }` pair and returns a frozen `{ accepted, outcome, changed, state, attemptCount, reason }` verdict — `applied`, `unchanged`, or `rejected` with a fixed reason code — never throwing and never echoing raw input. It also validates the exact record `{ outboxStateSchemaVersion, outboxKey, intentType, deliveryState, attemptCount }`, where `outboxKey` and `intentType` are bounded opaque server tokens, and returns a frozen canonical projection or a fixed rejection reason. A same-state replay must keep the identical count and is idempotent (`unchanged`). Lifecycle/attempt coherence — `queued` with exactly zero attempts, any other state with at least one — is enforced on both operands. A proxy, accessor, getter, extra or missing key, `Object.prototype` pollution, unknown state, or non-integer/negative/unsafe count is rejected without leaking the input.

This contract invents no policy. It fixes no maximum retry count, backoff schedule, time-to-live, dead-letter threshold, or alert; it holds no recipient, address, message body, template, or provider identity; and it decides nothing about *when* to retry, suppress, or dead-letter. `outboxKey` and `intentType` are opaque caller-supplied tokens, never an email or other PII; bounce and suppression are modeled as caller-supplied edges rather than distinct policy states. Those numbers and decisions belong to later PAY-003B/PAY-003C children and to MAIL-001, exactly as `commerceState` leaves capacity, price, and provider identity out.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock or environment, calls no Firebase/Stripe/provider service, stores nothing, logs nothing, and changes no delivery, email, role, or business record. It does not persist or replay an outbox, define Firestore schema or Rules, run a retry or quarantine worker, or wire into `sendConfirmationEmail.js` or `stripeWebhook.js`. Source tests and a merge are not Firebase deployment or live behavior proof.

### 8.5b Idempotent event-inbox deduplication and ordering disposition — SOURCE ONLY, UNUSED

PAY-003B2 [#397](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/397) defines one unused pure contract for the *event inbox* named by parent PAY-003 [#106](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/106) and by §8.5: the ingress decision of whether one verified event, already reduced to closed evidence, should be processed, ignored, or quarantined *before* any canonical reducer runs. PAY-003A already claims events by id inline in `stripeWebhook.js`; this contract extracts the *decision itself* as a standalone, owner-reviewable function, exactly as PAY-003C1 extracted the failure decision. The pure `classifyEventInboxDisposition` policy reads one exact flat revision-1 evidence record `{ eventInboxSchemaVersion, priorRecord, objectOrdering }` drawn only from closed vocabularies and returns one frozen disposition — `process`, `reprocess_incomplete`, `ignore_duplicate`, `ignore_stale`, or `quarantine` — each carrying a boolean `appliesEffect`. `priorRecord` is the durable inbox state for the exact event id (`absent`, `pending`, `applied`, `ignored`, `quarantined`); `objectOrdering` is the incoming event's position relative to the last-applied state for the same business object (`first_for_object`, `advances`, `equal`, `stale`, `indeterminate`), supplied as evidence from current domain state because event order is not guaranteed. It imports only `node:util`.

```mermaid
flowchart TD
    E["Exact revision-1 inbox evidence"] --> S{"id already applied or ignored?"}
    S -- "Yes" --> Ig["ignore_duplicate"]
    S -- "No" --> Qp{"id quarantined?"}
    Qp -- "Yes" --> Qz["quarantine"]
    Qp -- "No" --> Oi{"order indeterminate?"}
    Oi -- "Yes" --> Qz
    Oi -- "No" --> Os{"order stale?"}
    Os -- "Yes" --> St["ignore_stale"]
    Os -- "No" --> Oe{"order equal?"}
    Oe -- "Yes" --> Ig
    Oe -- "No" --> Pp{"prior attempt pending?"}
    Pp -- "Yes" --> Rp["reprocess_incomplete (appliesEffect)"]
    Pp -- "No" --> Pr["process (appliesEffect)"]
```

Text alternative: an event id already applied or already decided a no-op is ignored regardless of any fresh ordering claim; a quarantined id or an event whose order cannot be established fails closed to quarantine; a strictly older event is dropped as stale and a same-position event as a duplicate; only a fresh, in-order event that is not yet settled applies an effect — resuming a crashed `pending` attempt as `reprocess_incomplete` or a first-seen `absent` id as `process`.

The safety invariant is that `appliesEffect` is true only for `process` and `reprocess_incomplete`, and only for a `first_for_object`/`advances` event whose `priorRecord` is `absent` or `pending`: an already-`applied` id can never re-apply (exactly-once), an `indeterminate` or `stale` order never applies (fail closed to quarantine or drop), and an `equal` order is an idempotent replay. Because the event id is the deduplication key, `applied` and `ignored` short-circuit ahead of the ordering test, so no late-arriving ordering evidence can re-drive a settled effect; `reprocess_incomplete` is safe only because the downstream canonical apply is itself idempotent.

This contract invents no policy and duplicates no sibling. It fixes no retry count, backoff schedule, TTL, or dead-letter threshold — those stay with the deferred PAY-003C worker, `commerceFailureDisposition` (PAY-003C1, [#377](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/377)), and retention approval [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110). It decides *whether to admit an event*, never *whether a delivery step is legal* (the `commerceOutboxState` outbox contract, PAY-003B1, [#364](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/364)) and never *which target a failure warrants* (PAY-003C1). It computes no business transition — `functions/commerceState.js` owns the payment/registration/refund reducers that run only after this gate returns an applying verdict — and it does not call the `commerceProviderResult`/`commerceProviderReconciliation` classifiers. `priorRecord` and `objectOrdering` are closed enums, so no id, amount, address, or other PII-shaped value can ride in; malformed, proxy, accessor, inherited, extra-or-missing-key, unknown-enum, or wrong-version input throws one fixed `CommerceEventInboxError` that never echoes the input.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and creates no inbox record, claim, deduplication write, quarantine, or business record. It defines no Firestore schema or Rules, runs no ingress verifier or worker, and wires into no `stripeWebhook.js` or reducer. Source change, tests, merge, Firebase deployment, provider configuration, production data, website publication, and live behavior remain separate states; #397 changes no officer task and proves none of the external or live states.

### 8.6 Conservative public event projection — SOURCE ONLY, UNUSED

EVENTS-001A [#121](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/121) defines the canonical public event view and its approved source contract; [#399](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/399) builds its first **conservative, safe-by-default** slice as one unused pure contract, in the same throwing-classifier idiom as the commerce siblings (`commerceEventInboxDisposition`, `commerceOutboxState`). The pure `projectPublicEvent` policy reads one exact flat revision-1 evidence record of **only** public-candidate fields — `{ publicEventSchemaVersion, eventId, sourceRevision, lifecycleStatus, eventType, title, summary, startsAt, endsAt, timezone, locationText, publicUrl, accessibilityText, publishedAt, updatedAt }` — validates every field, then returns one frozen verdict: a minimized **public view** (`visibility: 'public'`) for a `published`/`updated` event (as `scheduled`) or a `cancelled` event (as `cancelled`); a single shared frozen **withheld** verdict (`visibility: 'withheld'`, `publicEvent: null`) for a `draft`, `reviewed`, or `archived` record; or a thrown `PublicEventProjectionError`. It imports only `node:util`, and it neither reads, syncs, nor scrapes the Google Site — it decides the *shape and admissibility of a public view*, not where source content comes from.

```mermaid
flowchart TD
    E["Exact revision-1 public-candidate evidence"] --> V{"all fields valid and allowlisted?"}
    V -- "No" --> X["reject — PublicEventProjectionError"]
    V -- "Yes" --> L{"lifecycle status"}
    L -- "draft / reviewed / archived" --> W["withheld — publicEvent null"]
    L -- "published / updated" --> Ps["public — scheduled"]
    L -- "cancelled" --> Pc["public — cancelled"]
```

Text alternative: any record whose fields are not all present, well-formed, and on the public allowlist is rejected outright; a well-formed record that is not in a publicly-visible lifecycle state (`draft`, `reviewed`, `archived`) is withheld with a null view that carries no field from the record; only a `published` or `updated` event projects a public `scheduled` view and a `cancelled` event a public `cancelled` view, each minimized to the allowlisted fields plus a derived `publicStatus`.

The safety invariant is an **allowlist, never a denylist**: the evidence key set is closed and counted, so a field that is not on the public allowlist — which is exactly how a protected value (discount or promotion code, registration or guest list, form response, payment state, provider identifier, waiver evidence, emergency contact, private location, door or access instruction, member contact detail, internal note, audit record, provider credential, or unreviewed markup) would arrive — makes the key set wrong and is rejected, not passed through. The projection is therefore false-negative-safe: its worst case withholds a borderline field, and it can never leak a protected one. Because the allowlist names only public fields, the source carries no PII, credential, or provider-identifier vocabulary. Every text field rejects C0/C1 control characters, the Unicode line/paragraph separators, and the `<`/`>` markup delimiters and is length-bounded, so no arbitrary HTML, script, or embed can reach the public site; the one URL field is a strict https allowlist (https scheme only, lowercase dotted host, optional conservative path — no other scheme, userinfo, port, query, or fragment); timestamps are UTC instants validated by shape and component range with no clock or `Date` dependency, paired with an explicit IANA `timezone` so the instant is never daylight-saving-ambiguous, and the `endsAt >= startsAt` and `updatedAt >= publishedAt` invariants are enforced by fixed-width string comparison. Validation always precedes the lifecycle gate, so a malformed draft is rejected rather than silently withheld.

This contract invents no policy and duplicates no sibling. It is a *projection*, not a classifier: it decides *what a public event view may contain*, never *whether an event should be admitted* (the `commerceEventInboxDisposition` inbox gate, §8.5b) or *whether a delivery step is legal* (the `commerceOutboxState` outbox contract, §8.5a). It fixes no draft/review/publish workflow, audit trail, persistence, minimal query index, recurrence, exception, or postponement expansion, and no source-of-record split — those remain with #121 and its gating owner decisions [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) (field-split approval) and [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) (source classification). Malformed, proxy, accessor-backed, inherited, extra-or-missing-key, unknown-enum, wrong-version, or invariant-violating input throws one fixed `PublicEventProjectionError` that never echoes the input.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and creates, publishes, or persists no event, draft, or public record. It defines no Firestore schema or Rules, runs no importer or publish worker, and wires into no endpoint or Google-Site sync. Source change, tests, merge, Firebase deployment, provider configuration, production data, website publication, and live behavior remain separate states; #399 changes no officer task and proves none of the external or live states.

### 8.7 Approval-gated social post lifecycle and audit — SOURCE ONLY, UNUSED

INSTAGRAM-002A [#401](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/401) builds the first **conservative, safe-by-default** slice of parent INSTAGRAM-002 [#92](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/92): one unused pure contract for the *approval-gated lifecycle of a social post*, in the same non-throwing frozen-verdict idiom as the commerce outbox sibling (`commerceOutboxState`, §8.5a). It governs only *whether a lifecycle transition is allowed and whether a publish is authorized*, never a caption, media reference, or provider. The pure `classifySocialPostTransition(current, command)` reducer reads the durable record `{ socialPostSchemaVersion, lifecycleStatus, sourceKind, payloadHash, approvedHash, authorActor, approverActor }` and one exact revision-1 command `{ socialPostSchemaVersion, type, expectedLifecycle, payloadHash, actor, capability, selfApprovalAllowed }`, both drawn only from closed vocabularies and opaque tokens, and returns one frozen verdict — `applied`, `unchanged`, or `rejected` with a fixed reason code — never throwing and never echoing raw input. A companion `validateSocialPostRecord` validates the same durable record and returns a frozen canonical projection or a fixed rejection reason. It imports only `node:util`.

```mermaid
flowchart LR
    Df["draft"] -->|"submit (officer)"| Pr["pending_review"]
    Pr -->|"approve (reviewer)"| Ap["approved"]
    Pr -->|"reject (reviewer)"| Df
    Ap -->|"schedule (reviewer)"| Sc["scheduled"]
    Sc -->|"begin_publish (system)"| Pb["publishing"]
    Pb -->|"provider confirmed"| Pd["published"]
    Pb -->|"provider failed"| Fa["failed"]
    Pb -->|"provider indeterminate"| Ou["outcome_unknown"]
    Fa -->|"retry (system)"| Sc
    Ou -->|"reconciled published"| Pd
    Ou -->|"reconciled failed"| Fa
    Df -->|"edit — new hash, approval cleared"| Df
```

Text alternative: a post starts `draft`; an officer editor `submit`s it to `pending_review`; a reviewer `approve`s it to `approved` or `reject`s it back to `draft`; a reviewer `schedule`s an approved post; only a system publisher may `begin_publish` a scheduled post into `publishing`; the provider outcome resolves `publishing` to `published`, `failed`, or `outcome_unknown`; a system publisher may `retry` a `failed` post back to `scheduled`, and a system reconciler may settle an `outcome_unknown` post to `published` or `failed`. Any `edit` from a non-terminal editable state returns the post to `draft`, mints a new payload hash, and clears any recorded approval; `cancel` moves any non-publishing, non-terminal post to the terminal `cancelled`. Every human edge requires an officer capability and every machine edge a system capability, so a client that presents neither can drive no edge.

The safety invariant is that **no post is published without a recorded human approval bound to its exact current payload hash**: the record itself is invalid in any `approved`/`scheduled`/`publishing`/`published`/`failed`/`outcome_unknown` state unless `approvedHash === payloadHash` and an `approverActor` is present, so an approval can never outlive the content it approved. Approval is recorded only by the `approve` command, only from `pending_review`, and only under a reviewer capability; any `edit` resets the lifecycle to `draft` and clears the approval, so a post edited after approval must be re-reviewed before it can schedule or publish. Self-approval — the same actor authoring and approving — is refused unless an explicit `selfApprovalAllowed` owner flag is set on the command, and defaults closed. A command names the `expectedLifecycle` it believes current, so a duplicate or concurrent command against an already-advanced post fails as `state_conflict` rather than re-applying, and an approval carrying a stale `payloadHash` fails as `stale_approval`.

This contract invents no policy and duplicates no sibling. It is an approval-and-lifecycle reducer, not a projection or an admission gate: it decides *whether a lifecycle transition is legal and whether a publish is authorized*, never *what a public view may contain* (the `projectPublicEvent` projection, §8.6), *whether an event should be admitted* (the `commerceEventInboxDisposition` inbox gate, §8.5b), or *whether a delivery step is legal* (the `commerceOutboxState` outbox contract, §8.5a). It holds only opaque hashes, closed enums, and opaque capability-scoped actor tokens — never a caption, media reference, alt text, URL, timezone, disclosure flag, recipient, or request body; the canonical `payloadHash` **binds** content by equality without holding it. Only an intentionally public event source (`sourceKind: 'public_event'`) may become a post; membership, discount, WhatsApp, and Strava sources have no representation. The provider adapter, audit store, scheduling clock, retry and reconciliation cadence, Firestore schema/Rules, and endpoints remain with #92, #93, and their gating owner decisions; schema is additive by construction (a `socialPostSchemaVersion` constant) with no migration to run. Malformed, proxy, accessor-backed, inherited, extra-or-missing-key, unknown-enum, or wrong-version input is rejected through a fixed reason that never echoes the input.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and creates, approves, schedules, publishes, or persists no post, draft, approval, or audit record. It defines no Firestore schema or Rules, runs no publish or reconciliation worker, and wires into no endpoint or Instagram/provider adapter. Source change, tests, merge, Firebase deployment, provider configuration, production data, website publication, and live behavior remain separate states; #401 changes no officer task and proves none of the external or live states.

### 8.8 Conservative membership-roster CSV export — SOURCE ONLY, UNUSED

MEMBERS-ROSTER-001A [#403](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/403) builds the first **conservative, safe-by-default** slice of parent MEMBERS-ROSTER-001 [#116](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/116): one unused pure contract for the *safe spreadsheet serialization of an officer-only membership roster*, in the same throwing-projection idiom as the public-event sibling (`projectPublicEvent`, §8.6). It governs only *how already-authorized roster rows are serialized into a download-safe CSV*, never who may download one, whether a caller is authorized, or whether a given member belongs on the roster. The pure `projectMembershipRosterCsv(evidence)` reads one exact revision-1 record `{ membershipRosterSchemaVersion, columnProfile, asOf, rows }` — an owner-approved column-profile name drawn from a closed registry, a UTC as-of instant, and an array of plain row objects — validates every part, projects each row onto only the profile's allowlisted columns, makes every cell spreadsheet-safe, and returns one frozen artifact `{ membershipRosterSchemaVersion, columnProfile, columns, asOf, rowCount, csv, characterLength }`; any invalid evidence throws a single fixed `MembershipRosterProjectionError` that never echoes input. It imports only `node:util`.

```mermaid
flowchart TD
    E["Exact evidence { version, columnProfile, asOf, rows }"] --> V{"envelope, profile, asOf, row-count valid?"}
    V -- "No" --> X["reject — MembershipRosterProjectionError"]
    V -- "Yes" --> C["columns := owner-approved profile registry[columnProfile]"]
    C --> P["each row → project onto allowlisted columns only"]
    P -- "hostile row / over key-count" --> X
    P --> N["each cell → reject unsafe control chars, bound length,<br/>neutralize formula lead, RFC 4180 always-quote"]
    N -- "unsafe / over-length cell" --> X
    N --> J["CRLF-join header + rows; enforce total-length bound"]
    J -- "over total-length" --> X
    J --> A["frozen CSV artifact + rowCount + characterLength"]
```

Text alternative: evidence that is not an exact four-key revision-1 record, or that names a column profile outside the closed owner-approved registry, or whose as-of value is not a validly-shaped UTC instant, or whose row set exceeds the row bound, is rejected outright; otherwise the approved profile fixes the exact ordered column set, and every row is projected onto only those columns — any key a row carries that is not in the profile is dropped and never serialized, and a column a row omits renders as an empty cell; each cell is then rejected if it carries an unsafe control character or exceeds the cell-length bound, prefixed with an apostrophe if it begins with a spreadsheet formula lead, and always double-quoted with internal quotes doubled; the header and rows are joined with CRLF and the whole output is rejected if it exceeds the total-length bound; the result is a frozen artifact carrying the row count and character length alongside the CSV text.

The safety invariant is an **allowlist, never a denylist**, applied per row: the output columns are fixed by the owner-approved profile before any row is read, and each row is projected onto exactly those columns, so a protected value — an Auth UID, internal document ID, custom claim, date of birth, emergency contact, address, waiver text, provider or payment identifier, OAuth token, arbitrary note, invite link, or discount code — that appears on a source row can never reach a cell, even if it is added to the underlying documents later. The projection is therefore false-negative-safe: its worst case omits a column the owner has not yet approved, and it can never leak a protected one; no protected-field name appears in the module source. The serialized text is spreadsheet-injection-safe by construction: any cell whose first character is a formula lead (`=`, `+`, `-`, `@`, tab, or carriage return) is prefixed with an apostrophe so a spreadsheet treats it as text, every field is unconditionally quoted with internal quotes doubled and records CRLF-separated per RFC 4180 so embedded commas, quotes, and newlines round-trip, and every cell is rejected if it carries a C0 control character other than tab/LF/CR, DEL, a C1 control, or a Unicode line/paragraph separator. Cells are strictly `string`-or-`null` (a caller pre-stringifies; `null` renders empty and any non-string is rejected), the as-of instant is validated by shape and component range with no clock or `Date` dependency, and row count, per-row key count, per-cell length, and total output length are all bounded so no single evidence record can force unbounded work.

This contract invents no policy and duplicates no sibling. It is a *serializing projection* over a set of already-authorized rows, not a single-record view projection or a lifecycle reducer: it decides *how a roster is safely rendered for spreadsheet download*, never *what a public web view may contain* (the `projectPublicEvent` projection, §8.6, which admits or withholds one event for public visibility and carries no CSV, formula-injection, or per-row column-minimization surface), *whether a social post may advance or publish* (the `classifySocialPostTransition` reducer, §8.7), *whether an inbound event should be admitted* (the `commerceEventInboxDisposition` gate, §8.5b), or *whether a delivery step is legal* (the `commerceOutboxState` contract, §8.5a). It owns the serialization *mechanism* and never the *policy*: the two seed column profiles it ships are a conservative minimum, and parent #116 selects one owner-approved column profile from [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) that replaces or extends them; which members appear, the current-term inclusion rule, and truthful status labeling remain with #116 and its canonical-membership dependencies [#81](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/81) and [#114](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/114). Malformed, proxy, accessor-backed, inherited, extra-or-missing-key, unknown-profile, wrong-version, or over-bound input throws one fixed `MembershipRosterProjectionError` that never echoes the input.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and reads, queries, exports, downloads, or persists no member, roster, or audit record. It defines no Firestore schema or Rules, enforces no capability, MFA, recent-authentication, or download flow, writes no export-audit event, and wires into no endpoint or Google-Sheets delivery. Source change, tests, merge, Firebase deployment, owner field/access approval, production data, website publication, and live behavior remain separate states; #403 changes no officer task and proves none of the external or live states.

### 8.9 Idempotent channel-reconciliation task derivation — SOURCE ONLY, UNUSED

CHANNEL-QUEUE-001A [#405](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/405) builds the first **conservative, safe-by-default** slice of parent CHANNEL-QUEUE-001 [#90](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/90): one unused pure contract for the *idempotent derivation of channel-reconciliation tasks from a single member's authoritative membership change*, in the same throwing-derivation idiom as the roster and public-event siblings (`projectMembershipRosterCsv`, §8.8; `projectPublicEvent`, §8.6). It governs only *which ensure/remove task each supported channel needs and what its stable identity is*, never who runs the task, whether a provider API may act, or what any channel's current occupant list is. The pure `deriveChannelReconciliationTasks(change)` reads one exact revision-1 record `{ channelReconciliationSchemaVersion, memberRef, membershipVersion, membershipActive, channelDesired }` — an opaque member reference, a monotone membership version, an active flag, and an exact per-provider desired-standing boolean map over the closed supported set `{ google, strava, whatsapp }` — validates every part and returns one frozen artifact carrying one task per supported provider `{ taskId, provider, action, mode, membershipVersion }` plus a `taskCount`; any invalid change throws a single fixed `ChannelReconciliationError` that never echoes input. It imports only `node:util`.

```mermaid
flowchart TD
    E["Exact rev-1 change { version, memberRef, membershipVersion, membershipActive, channelDesired }"] --> V{"envelope, opaque ref, bounded version,<br/>boolean active, exact provider map valid?"}
    V -- "No" --> X["reject — ChannelReconciliationError"]
    V -- "Yes" --> P["for each supported provider, fixed order"]
    P --> A{"membershipActive AND desired[provider]?"}
    A -- "Yes" --> Pr["ensure_present"]
    A -- "No" --> Ab["ensure_absent"]
    Pr --> T["task { stable taskId, provider, action, manual mode, version }"]
    Ab --> T
    T --> R["frozen { tasks, taskCount }"]
```

Text alternative: a change that is not an exact five-key revision-1 record, or whose member reference is not an opaque url-safe token bearing a letter, or whose membership version is not a bounded non-negative integer, or whose active flag is not a strict boolean, or whose desired map is not an exact boolean entry for each supported provider, is rejected outright; otherwise the contract emits exactly one task per supported provider, in a fixed order, each with a stable composite identity, a `manual` write mode, and an action that is `ensure_present` only when the member is active and desired in that channel and `ensure_absent` otherwise — so a lapse ensures absence in every channel and a reactivation restores presence — and returns the frozen task set with its count.

The safety invariant is that the derivation reads **one member's own desired standing and never a channel's occupant list**, so a restricted provider roster is never ingested and can never leak into a task or a log; the worst case of a malformed change is a thrown error and no tasks, never a partial or mislabeled reconciliation. Task identity is a deterministic composite of the member reference, the provider, and the membership version joined by a delimiter that none of those parts may contain, so the same membership version always yields byte-identical identities — a duplicate, retried, or out-of-order delivery of the same change collapses onto the same tasks rather than multiplying them, and a genuinely newer version yields distinct identities that supersede the old ones. The member reference is an opaque, bounded, url-safe token that must contain a letter, so a bare all-digit value with the shape of a telephone number is rejected and can never become a task identity; the record carries no contact detail, invite link, secret, or credential, and no such field name appears in the source. Every supported provider carries a `manual` write mode from a closed registry: no provider API writes channel membership until its own discovery ticket proves a supported, authorized API. Every part of the record is read through an own-enumerable-data descriptor with no getter invoked, and a proxy, a non-`Object.prototype` prototype, an inherited key, an extra or missing key, or an out-of-range value is rejected.

This contract invents no policy and duplicates no sibling. It is a *derivation* from a membership delta, not a serialization, a public-view projection, or a lifecycle reducer: it decides *which reconciliation task each channel needs and its stable identity*, never *how a roster is rendered for download* (the `projectMembershipRosterCsv` serializer, §8.8), *what a public web view may contain* (the `projectPublicEvent` projection, §8.6), *whether a social post may advance or publish* (the `classifySocialPostTransition` reducer, §8.7), *whether an inbound event should be admitted* (the `commerceEventInboxDisposition` gate, §8.5b), or *whether a delivery step is legal* (the `commerceOutboxState` contract, §8.5a). It owns the derivation *mechanism* (which task, which identity, which mode) and never the policy of which channels a member is entitled to — that arrives as the desired-standing input, owned upstream by [#81](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/81) and [#86](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/86) — or when a provider becomes automatable. The queue, the stable-ID command deduplication at persistence, the claim/lease lifecycle, the operator UI, the append-oriented audit, and the periodic desired-versus-observed report remain with #90 and its dependencies. Malformed, proxy, accessor-backed, inherited, extra-or-missing-key, unknown-provider, wrong-version, or out-of-range input throws one fixed `ChannelReconciliationError` that never echoes the input.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and derives, claims, performs, or persists no queue task, provider action, or audit record. It defines no Firestore schema or Rules, runs no reconciliation worker, and wires into no endpoint or provider adapter. Source change, tests, merge, Firebase deployment, provider configuration, production data, website publication, and live behavior remain separate states; #405 changes no officer task and proves none of the external or live states.

### 8.10 Idempotent channel-task claim arbitration — SOURCE ONLY, UNUSED

CHANNEL-QUEUE-001B [#407](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/407) builds the next **conservative, safe-by-default** slice of parent CHANNEL-QUEUE-001 [#90](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/90): one unused pure contract for the *claim arbitration of a channel-reconciliation task*, in the same non-throwing frozen-verdict reducer idiom as the outbox and social-post siblings (`commerceOutboxState`, §8.5a; `classifySocialPostTransition`, §8.7) rather than the throwing-derivation idiom of its own parent's first slice (`deriveChannelReconciliationTasks`, §8.9). It governs only *whether a worker may claim a task now*, never who the authorized workers are, what the task's provider action is, or when the clock reads — the caller supplies the current instant. The pure `classifyChannelTaskClaim(task, command)` reads one durable task record `{ channelTaskSchemaVersion, taskId, status, leaseHolder, leaseExpiresAt }` and one claim command `{ channelTaskSchemaVersion, type, expectedStatus, actor, capability, asOf, leaseExpiresAt }`, and returns one frozen verdict — a grant `{ decision: 'granted', reason, grant: { status, leaseHolder, leaseExpiresAt } }` or a denial `{ decision: 'denied', reason }` — and **never throws**. It imports only `node:util`.

```mermaid
flowchart TD
    I["durable task record + claim command"] --> V{"both exact & well-formed?"}
    V -- "No" --> M["deny malformed_task / malformed_command"]
    V -- "Yes" --> Ty{"a claim, by the operator capability,<br/>opening a lease after asOf?"}
    Ty -- "No" --> D1["deny unsupported_command /<br/>capability_denied / invalid_lease"]
    Ty -- "Yes" --> C{"expectedStatus == task.status?"}
    C -- "No" --> D2["deny state_conflict"]
    C -- "Yes" --> S{"task status"}
    S -- "completed / failed" --> D3["deny terminal_state"]
    S -- "claimed & lease live" --> D4["deny already_claimed"]
    S -- "pending, or claimed & lease expired" --> G["grant claimed { new holder, new lease }"]
```

Text alternative: a task or command that is not an exact, well-formed record is denied `malformed_task` or `malformed_command`; a command that is not a claim, or not by the single closed claim capability, or that opens a lease not strictly after the supplied instant, is denied `unsupported_command`, `capability_denied`, or `invalid_lease`; a command whose expected status does not match the task's current status is denied `state_conflict`; a terminal (completed or failed) task is denied `terminal_state`; a claimed task whose lease is still live is denied `already_claimed`; and a pending task, or a claimed task whose lease has expired relative to the supplied instant, is granted a fresh claim naming the new holder and the new lease expiry.

The safety invariant is that **at most one worker holds an active lease on a task**: a claim against a task with a live lease is always denied `already_claimed`, and a recorded lease is treated as expired only when the caller-supplied instant is at or past it, so a reclaim can never race a still-active worker. Lease expiry is decided by lexical comparison of fixed-width UTC timestamps — lexical order equals chronological order — so the contract reads no clock and constructs no `Date`; the caller alone supplies the instant, keeping the decision pure and deterministic. Optimistic concurrency via `expectedStatus` means a duplicate or out-of-order claim that observed a stale status is denied `state_conflict` rather than acting on a state it did not see. Actors, lease holders, and task identities are opaque, bounded, url-safe tokens; the record carries no contact detail, invite link, secret, or credential, and no such field name appears in the source; each denial is a shared frozen object carrying only a decision and a reason, so the verdict echoes none of the input. Every part of both records is read through an own-enumerable-data descriptor with no getter invoked, and a proxy, a non-`Object.prototype` prototype, an inherited key, an extra or missing key, an unknown enum, a wrong version, or an incoherent lease/holder pairing yields a frozen denial verdict, never a throw and never a partial decision.

This contract invents no policy and duplicates no sibling. It is a *claim reducer* over a single task's lease, not a *derivation* of tasks from a membership delta (`deriveChannelReconciliationTasks`, §8.9), a *serialization* of a roster for download (`projectMembershipRosterCsv`, §8.8), a *public-view projection* (`projectPublicEvent`, §8.6), a *post lifecycle* (`classifySocialPostTransition`, §8.7), an *inbox admission gate* (`commerceEventInboxDisposition`, §8.5b), or a *delivery-step contract* (`commerceOutboxState`, §8.5a). It owns the claim-arbitration *mechanism* (may this claim be granted, and what lease does it open), never the policy of which identities may hold the claim capability — enforced upstream — nor the lease duration, which the caller sets as the new expiry. The queue itself, the stable-ID command deduplication at persistence, the renew/release/complete/fail/escalate transitions, the operator UI, the append-oriented audit, and the periodic desired-versus-observed report remain with #90 and its dependencies.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and claims, performs, or persists no queue task, provider action, lease, or audit record. It defines no Firestore schema or Rules, runs no reconciliation worker, and wires into no endpoint or provider adapter. Source change, tests, merge, Firebase deployment, provider configuration, production data, website publication, and live behavior remain separate states; #407 changes no officer task and proves none of the external or live states.

### 8.11 Point-in-time self-service Strava club-status classification — SOURCE ONLY, UNUSED

STRAVA-002A [#409](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/409) builds the first **conservative, safe-by-default** slice of parent STRAVA-002 [#89](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/89) (a self-service MPRC club-status check without roster scraping): one unused pure contract for the *classification of a single member's own Strava club-membership read into an advisory status*. It follows the throwing-validator idiom of the public-event and roster projections (`projectPublicEvent`, §8.6; `projectMembershipRosterCsv`, §8.8) — a malformed envelope throws — rather than the non-throwing reducer idiom of the outbox and claim siblings. It governs only *which informational status to report back to that one member*, never whether that member gains any MPRC capability, which club is the configured MPRC club (the caller supplies the configured identity), or when the clock reads (the caller supplies the instant). The pure `classifyStravaClubStatus(evidence)` reads one exact record `{ stravaClubStatusSchemaVersion, configuredClubId, fetchOutcome, memberClubIds, checkedAt }` — where `memberClubIds` is that one signed-in member's own club memberships, as their own token would report — and returns one frozen advisory verdict `{ stravaClubStatusSchemaVersion, status, reason, retryable, advisory, checkedAt }`, or throws a fixed `StravaClubStatusError` that echoes no input. It imports only `node:util`.

```mermaid
flowchart TD
    I["one exact club-status evidence record"] --> V{"exact & well-formed envelope?<br/>(version, club id, outcome, checkedAt)"}
    V -- "No" --> T["throw StravaClubStatusError"]
    V -- "Yes" --> O{"fetchOutcome"}
    O -- "ok, club list well-formed" --> P{"configured club in the<br/>member's own list?"}
    P -- "Yes" --> M["member / in_club<br/>(advisory, not retryable)"]
    P -- "No" --> N["not_member / not_in_club<br/>(advisory, not retryable)"]
    O -- "ok, club list absent or hostile" --> T
    O -- "missing_scope / revoked / not_authorized" --> U1["unknown<br/>(advisory, not retryable)"]
    O -- "rate_limited / provider_outage" --> U2["unknown<br/>(advisory, retryable)"]
    O -- "failed, but a club list is present" --> T
```

Text alternative: an evidence record that is not an exact, well-formed envelope — a wrong version, a non-numeric or out-of-range configured club identity, an unknown fetch outcome, or a malformed instant — throws a fixed `StravaClubStatusError` that echoes no input. A successful (`ok`) read whose accompanying club list is well-formed is classified `member`/`in_club` when the one configured club identity is among the member's own memberships and `not_member`/`not_in_club` otherwise, each advisory and not retryable; a successful read whose club list is absent or hostile in any way instead throws. A well-formed but unsuccessful read yields `unknown`: `missing_scope`, `revoked`, and `not_authorized` are not retryable (they need a re-authorization), while `rate_limited` and `provider_outage` are retryable (a backoff-and-retry is the right response). A failed read that nonetheless carries a club list is incoherent and throws.

The central safety invariant is that **the verdict is advisory and confers nothing**: its status is a bare informational label, and the frozen verdict carries no entitlement, pricing, role, or access field — a `member` status never grants MPRC website membership, member pricing, or Google/WhatsApp access, all of which are authorized elsewhere from their own evidence. The second invariant is that **no roster is ever ingested**: the record carries only the one signed-in member's own club memberships, never a club's occupant list, and the contract has no field in which a roster could arrive — so none can leak into a verdict or a log, mirroring the parent's requirement never to use the Club Members/Admins/Activities endpoints scheduled for removal on 2026-09-01. The member's own club list is reduced to a single presence test against the configured identity and is never echoed, so not even that one member's full list of clubs appears in the verdict. The check is point-in-time and on demand — the caller supplies the instant, which the verdict echoes, and the verdict is explicitly `advisory: true`, a snapshot rather than a continuously synchronized state. A well-formed but unsuccessful read never guesses membership; it returns `unknown` with the reason and a `retryable` flag so the caller can choose a backoff-retry or a re-authorization. Every part of the record is read through an own-enumerable-data descriptor with no getter invoked, and a proxy, a non-`Object.prototype` prototype, an inherited key, an extra or missing key, an unknown enum, a wrong version, an out-of-range value, or a club list present on a failed read is rejected with a throw, never a partial or wrong status — the classification is false-negative-safe.

This contract invents no policy and duplicates no sibling. It is a *point-in-time membership classifier* over one member's own club list, not a *derivation* of reconciliation tasks from a membership delta (`deriveChannelReconciliationTasks`, §8.9), a *claim arbitration* over a task lease (`classifyChannelTaskClaim`, §8.10), a *roster serialization* for download (`projectMembershipRosterCsv`, §8.8), a *public-view projection* (`projectPublicEvent`, §8.6), a *post lifecycle* (`classifySocialPostTransition`, §8.7), an *inbox admission gate* (`commerceEventInboxDisposition`, §8.5b), or a *delivery-step contract* (`commerceOutboxState`, §8.5a). It owns the classification *mechanism* (which status, which reason, whether a retry helps), never the policy of which club is the configured MPRC club — the caller supplies the configured identity — whether a last-check result may be stored, or what any status entitles. The live token-scoped `GET /athlete/clubs` fetch, the minimal last-check persistence and cache/backoff policy, and the on-demand user-only display remain with #89 and its dependency #88 (STRAVA-001).

The module is imported by no runtime or Functions index and requires only `node:util`. It performs no network call — the read of the member's own memberships happens upstream and arrives as evidence — and reads no clock, randomness, environment, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and grants, performs, or persists nothing beyond the returned verdict. It defines no Firestore schema or Rules, calls no Strava endpoint, and wires into no endpoint or provider adapter. Source change, tests, merge, Firebase deployment, provider configuration, production data, website publication, and live behavior remain separate states; #409 changes no member's status and proves none of the external or live states.

### 8.12 Idempotent channel-task lifecycle-transition arbitration — SOURCE ONLY, UNUSED

CHANNEL-QUEUE-001C [#411](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/411) completes the worker-lifecycle triad of parent CHANNEL-QUEUE-001 [#90](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/90): where CHANNEL-QUEUE-001A derives tasks (`deriveChannelReconciliationTasks`, §8.9) and CHANNEL-QUEUE-001B arbitrates the initial *claim* (`classifyChannelTaskClaim`, §8.10), this slice arbitrates every *post-claim transition* — renew, release, complete, fail, and escalate — as one unused pure contract. It stays in the non-throwing frozen-verdict reducer idiom of its claim sibling and of the outbox and social-post reducers (`commerceOutboxState`, §8.5a; `classifySocialPostTransition`, §8.7). It governs only *whether a proposed transition on an already-claimed task may be applied now, and what task state results*, never who the authorized workers are, what a task's provider action is, or when the clock reads — the caller supplies the current instant. The pure `classifyChannelTaskTransition(task, command)` reads one durable task record `{ channelTaskSchemaVersion, taskId, status, leaseHolder, leaseExpiresAt }` and one lifecycle command `{ channelTaskSchemaVersion, type, expectedStatus, actor, capability, asOf, leaseExpiresAt, resultCode }`, and returns one frozen verdict — a grant `{ decision: 'granted', reason, next: { status, leaseHolder, leaseExpiresAt, resultCode? } }` or a denial `{ decision: 'denied', reason }` — and **never throws**. It imports only `node:util`.

```mermaid
flowchart TD
    I["durable task record + lifecycle command"] --> V{"both exact & well-formed,<br/>per-type fields coherent?"}
    V -- "No" --> M["deny malformed_task /<br/>malformed_command / unsupported_command"]
    V -- "Yes" --> Cap{"capability matches<br/>the transition?"}
    Cap -- "No" --> D0["deny capability_denied"]
    Cap -- "Yes" --> C{"expectedStatus == status,<br/>non-terminal, status == claimed?"}
    C -- "No" --> D1["deny state_conflict /<br/>terminal_state / not_claimed"]
    C -- "Yes" --> E{"escalate?"}
    E -- "Yes" --> L1{"lease live?"}
    L1 -- "Yes" --> D2["deny lease_active"]
    L1 -- "No" --> G1["grant escalated { escalated, no holder }"]
    E -- "No (renew/release/complete/fail)" --> H{"actor is holder<br/>& lease live?"}
    H -- "No" --> D3["deny not_lease_holder / lease_expired"]
    H -- "Yes" --> G2["grant renewed / released /<br/>completed / failed"]
```

Text alternative: a task or command that is not an exact, well-formed record is denied `malformed_task` or `malformed_command`; a command whose type is not one of the five transitions is denied `unsupported_command`, and one whose per-type fields do not cohere (a renew without a new lease, a complete or fail without its result class, a release or escalate carrying either) is denied `malformed_command`; a command whose capability does not match the transition's requirement is denied `capability_denied`; a command whose expected status does not match the task's current status is denied `state_conflict`; a terminal (completed or failed) task is denied `terminal_state`; a task that is not currently claimed is denied `not_claimed`. An **escalate** is then granted only when the lease is no longer live relative to the supplied instant, moving the task to `escalated` and clearing the holder — a still-live lease is denied `lease_active`. A **renew/release/complete/fail** is granted only to the current lease holder while the lease is still live — a foreign actor is denied `not_lease_holder` and an expired lease `lease_expired`; a renew whose new lease does not extend strictly past the supplied instant is denied `invalid_lease`, and the grants move the task to `claimed` with the new lease, `pending` released, or a terminal `completed`/`failed` carrying the closed-enum result.

The first safety invariant is that **at most one active worker advances a task across its whole lifecycle**: a renew, release, complete, or fail is granted only when the command's actor is the recorded lease holder and the recorded lease is still live relative to the caller-supplied instant, so a lapsed worker can never commit over a task that may have been reassigned. The second is that **stale claims escalate but never silently complete**: escalation is reserved to the closed supervisor capability and is granted *only* once the lease has expired, and it resolves to the non-terminal `escalated` state — a supervisor can never use escalate to mark a task done, and a live lease is always left to its worker (`lease_active`). Least-privilege authorization is enforced by matching the command's single closed capability to the transition (`channel_operator` for the worker transitions, `channel_supervisor` for escalate) before any state is read. The audit result is sanitized to a closed enum: a completion carries only `applied`, `already_current`, or `manual_completed`, and a failure only `provider_outage`, `manual_action_required`, `not_supported`, or `rejected` — never free text, and the verdict echoes none of the input. Optimistic concurrency via `expectedStatus` denies a duplicate or out-of-order transition that observed a stale status (`state_conflict`) rather than acting on a state it did not see, and terminal tasks are frozen. Lease liveness is decided by lexical comparison of fixed-width UTC timestamps — lexical order equals chronological order — so the contract reads no clock and constructs no `Date`; the caller alone supplies the instant. Every part of both records is read through an own-enumerable-data descriptor with no getter invoked, and a proxy, a non-`Object.prototype` prototype, an inherited key, an extra or missing key, an unknown enum, a wrong version, or an incoherent per-type field pairing yields a frozen denial verdict, never a throw and never a partial decision — the arbitration is false-negative-safe.

This contract invents no policy and duplicates no sibling. It is a *lifecycle-transition reducer* over an already-claimed task's lease, not the *claim acquisition* of that lease (`classifyChannelTaskClaim`, §8.10, which admits a first worker; this slice governs only what that worker, or a supervisor, may do afterward), a *derivation* of tasks from a membership delta (`deriveChannelReconciliationTasks`, §8.9), a *point-in-time membership classifier* (`classifyStravaClubStatus`, §8.11), a *roster serialization* for download (`projectMembershipRosterCsv`, §8.8), a *public-view projection* (`projectPublicEvent`, §8.6), a *post lifecycle* (`classifySocialPostTransition`, §8.7), an *inbox admission gate* (`commerceEventInboxDisposition`, §8.5b), or a *delivery-step contract* (`commerceOutboxState`, §8.5a). It owns the transition-arbitration *mechanism* (may this transition apply, and what task state results), never the policy of which identities may hold the worker or supervisor capability — enforced upstream — nor the lease duration, which the caller sets as the renewed expiry. The queue itself, the stable-ID command deduplication at persistence, the operator UI showing claimant/lease/stale/escalated state, the append-oriented audit record, and the periodic desired-versus-observed report remain with #90 and its dependencies.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and applies, performs, or persists no queue transition, provider action, lease, or audit record. It defines no Firestore schema or Rules, runs no reconciliation worker, and wires into no endpoint or provider adapter. Source change, tests, merge, Firebase deployment, provider configuration, production data, website publication, and live behavior remain separate states; #411 changes no officer task and proves none of the external or live states.

### 8.13 Members-only discount-view access resolution — SOURCE ONLY, UNUSED

MEMBERS-CONTENT-001A [#413](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/413) builds the first **conservative, safe-by-default** slice of parent MEMBERS-CONTENT-001 [#83](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/83) (a first-party members-only discounts page that replaces URL secrecy with access gated on verified current membership): one unused pure contract for *what discount view, if any, an already-server-verified principal may read right now*. It is a **non-throwing frozen-verdict** reducer in the idiom of the claim and lifecycle siblings (`classifyChannelTaskClaim`, §8.10; `classifyChannelTaskTransition`, §8.12), here combining an access gate with a field-minimizing projection. It authenticates no one, reads no session, and decides no one's membership — the caller supplies the principal's already-server-verified standing (auth state, email-verification, membership status and expiry, content-admin flag) and the current instant as evidence, and this contract turns that evidence plus a raw discount catalog into exactly the view the principal is entitled to. The pure `projectMemberDiscounts(principalEvidence, catalog)` reads one principal record `{ membersContentSchemaVersion, authState, emailVerified, membershipStatus, membershipExpiresAt, contentAdmin, asOf }` and one catalog `{ membersContentSchemaVersion, rows }` of discount records `{ discountId, status, title, terms, redemption, expiresAt, sourceOwner, lastReviewedAt }`, and returns one frozen verdict — a denial `{ decision: 'denied', reason }` carrying no content, or a grant `{ decision: 'granted', reason, asOf, discountCount, discounts }` whose discounts carry only the member-visible fields — and **never throws**. It imports only `node:util`.

```mermaid
flowchart TD
    I["principal evidence + discount catalog"] --> V{"principal an exact,<br/>well-formed record?"}
    V -- "No" --> D0["deny malformed_principal"]
    V -- "Yes" --> A{"signed in?"}
    A -- "No" --> D1["deny not_signed_in"]
    A -- "Yes" --> E{"email verified?"}
    E -- "No" --> D2["deny not_verified"]
    E -- "Yes" --> M{"active unexpired member,<br/>or content admin?"}
    M -- "No" --> D3["deny membership_expired /<br/>membership_inactive"]
    M -- "Yes" --> C{"catalog exact &<br/>well-formed?"}
    C -- "No" --> D4["deny malformed_catalog"]
    C -- "Yes" --> P["grant: project each published,<br/>unexpired, well-formed row to<br/>member-visible fields only"]
```

Text alternative: a principal that is not an exact, well-formed record is denied `malformed_principal`; a principal that is not signed in is denied `not_signed_in`; a signed-in principal whose email is not verified is denied `not_verified`; a verified, signed-in principal who is neither an active membership that is unexpired relative to the supplied instant nor an authorized content admin is denied `membership_expired` (when the status is active but the date has passed) or `membership_inactive` (any other non-active status); only then, for an entitled principal, is the catalog read — a catalog that is not an exact, well-formed record is denied `malformed_catalog`, and otherwise the verdict is a grant whose discounts are each row that is well-formed, currently `published`, and not expired relative to the supplied instant, projected onto only the member-visible fields. Membership expiry and discount expiry both treat the supplied instant as exclusive: an expiry at exactly the instant is expired.

The first safety invariant is **withhold-by-default**: the only paths to a grant are a verified, signed-in, active, unexpired member or a verified, signed-in content admin, and every other principal — anonymous, unverified, pending, expired, revoked, or an ordinary signed-in non-member — is denied with a verdict that carries no discount field at all, so a denial can leak nothing. The second is **field minimization by allowlist**: a granted discount is rebuilt from only `discountId`, `title`, `terms`, `redemption`, and `expiresAt`, so the stored record's internal `status`, `sourceOwner`, and `lastReviewedAt` are structurally absent from the output — dropped, not blanked — and a source key outside the allowlist can never be carried. The third is **status and expiry filtering**: only currently published, not-yet-expired discounts appear, so a draft, an archived, or an expired discount disappears from the view. The fourth is **point-in-time evaluation**: membership expiry and discount expiry are both decided against the one caller-supplied instant by lexical comparison of fixed-width UTC timestamps — lexical order equals chronological order — so the contract reads no clock and constructs no `Date`, and a demoted, revoked, or expired principal is denied as soon as the evidence reflects it, bounding stale access to the evidence's own freshness. The fifth is **no raw HTML**: every content field is a bounded plain-text string with all control characters and the Unicode line/paragraph separators rejected, no field is interpreted as markup, and the contract neither parses nor emits HTML. Finally the contract is **hostile-input-safe**: every field of every record is read through an own-enumerable data descriptor with no getter ever invoked, a proxy, a non-`Object.prototype` prototype, an inherited, extra, missing, or symbol key, or an out-of-shape value causes a malformed principal to be denied and a malformed discount row to be silently withheld from the view rather than partially rendered — the resolution is false-negative-safe.

This contract invents no policy and duplicates no sibling. It is a *members-only-content access resolver* over a discount catalog, not a *point-in-time membership classifier* over one member's own club list (`classifyStravaClubStatus`, §8.11, which reports an advisory status that confers nothing; this contract instead decides content visibility and projects the content), a *roster serialization* for download (`projectMembershipRosterCsv`, §8.8, which minimizes columns for an officer export; this minimizes fields for a member view and gates on membership first), a *claim* or *lifecycle* arbitration over a task lease (`classifyChannelTaskClaim`, §8.10; `classifyChannelTaskTransition`, §8.12), a *derivation* of reconciliation tasks (`deriveChannelReconciliationTasks`, §8.9), a *public-view projection* (`projectPublicEvent`, §8.6), or a *post lifecycle* (`classifySocialPostTransition`, §8.7). It owns the visibility-resolution *mechanism* (may this principal see the discounts, and which fields of which discounts), never the policy of who is a member or an admin — the caller supplies that already-verified standing — nor how the evidence is proven, stored, or displayed. The Firestore discount schema and deployed Rules (or the verified server projection that enforces reads), the member route with its loading, sign-in-return, pending, and authorized states, the noindex and sitemap exclusion, the content migration and Google Site archival, and every write path remain with #83 and its dependencies.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; and grants, performs, or persists nothing beyond the returned verdict. It defines no Firestore schema or Rules, enforces no live read, and wires into no route or projection. Source change, tests, merge, Firebase deployment, Rules deployment, production data, website publication, and live behavior remain separate states; #413 exposes no discount and proves none of the external or live states.

### 8.14 Officer membership-to-account identity-association command — SOURCE ONLY, UNUSED

MEMBERS-ADMIN-001B [#415](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/415) builds the **association** half of parent MEMBERS-ADMIN-001 [#115](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/115) (*Add audited officer membership association and manual activation*): one unused pure contract for *whether a given officer may, right now, bind an eligible membership to an existing verified Firebase Auth account, and what audited outcome that produces*. It is a **non-throwing frozen-verdict** reducer in the idiom of the claim and lifecycle siblings (`classifyChannelTaskClaim`, §8.10; `classifyChannelTaskTransition`, §8.12), here an officer-command authorizer over two entities. It authenticates no one, verifies no capability, and reads no record — the caller supplies the officer's command and the already-server-read state of one membership and one target account (plus any collision the server has already detected), and this contract decides the audited association outcome. The pure `classifyMembershipAssociation(state, command)` reads one state envelope `{ membershipAdminSchemaVersion, membership, account, collision }` — where `membership` is null or `{ membershipId, status, term, duesConfirmed, linkState, linkedUid }` and `account` is null or `{ uid, emailVerified, linkedMembershipId }` — and one officer command `{ membershipAdminSchemaVersion, type, commandId, actor, capability, recentAuthSatisfied, membershipId, targetUid, expectedTerm, expectedMembershipLinkState, asOf, deadline }`, and returns one frozen verdict — an association `{ decision: 'associate', reason, next }`, an explicit review `{ decision: 'review', reason }`, or a denial `{ decision: 'denied', reason }` — and **never throws**. It imports only `node:util`.

```mermaid
flowchart TD
    I["officer command + server-read state<br/>(membership, account, collision)"] --> V{"command & state exact,<br/>well-formed records?"}
    V -- "No" --> D0["deny malformed_command /<br/>malformed_state"]
    V -- "Yes" --> T{"type handled, capable,<br/>recently authed, fresh?"}
    T -- "No" --> D1["deny unsupported_command /<br/>capability_denied /<br/>recent_auth_required /<br/>command_stale"]
    T -- "Yes" --> AC{"verified target account,<br/>active dues-confirmed<br/>right-term membership?"}
    AC -- "No" --> D2["deny account_missing / email_unverified /<br/>membership_not_found / membership_not_active /<br/>dues_unconfirmed / wrong_term"]
    AC -- "Yes" --> L{"membership already<br/>linked?"}
    L -- "to this UID" --> G1["associate already_associated"]
    L -- "to another UID" --> D3["deny membership_linked_elsewhere"]
    L -- "unlinked" --> X{"link-state as expected,<br/>UID free, no collision?"}
    X -- "No" --> D4["deny state_conflict /<br/>uid_linked_elsewhere,<br/>or review the collision"]
    X -- "Yes" --> G2["associate associated<br/>+ derive_membership_claim"]
```

Text alternative: a command or state that is not an exact, well-formed record is denied `malformed_command` or `malformed_state`. For a well-formed pair, type and authorization are decided before any entity is examined — a recognized-but-unhandled command type is denied `unsupported_command`, an actor lacking the association capability is denied `capability_denied`, a command without recent authentication is denied `recent_auth_required`, and a command at or past its deadline is denied `command_stale` (the deadline is exclusive). Only then is the target account read — a missing account is denied `account_missing` and an unverified account email `email_unverified` — followed by the membership: missing is `membership_not_found`, any non-active status is `membership_not_active`, unconfirmed dues is `dues_unconfirmed`, and a term other than the officer-confirmed term is `wrong_term`. A membership already linked to the selected UID is the idempotent `already_associated`; one linked to a different UID is denied `membership_linked_elsewhere`. An unlinked membership whose observed link-state differs from the officer's optimistic expectation is denied `state_conflict`, a target UID already bound to any membership is denied `uid_linked_elsewhere`, and any detected collision (`duplicate_account`, `email_changed`, `household_overlap`, `contact_email_conflict`) is routed to explicit `review` — never auto-resolved. Only a capable, recently-authenticated, fresh command over a verified account and an active, dues-confirmed, right-term, unlinked membership with a free UID and no collision yields `associated`, whose `next` names the membership, the linked UID, the linked state, the term, and an `entitlementAction: 'derive_membership_claim'` signal.

The first safety invariant is **withhold-by-default**: the only path to an association is a sufficiently-capable, recently-authenticated officer acting through a fresh command on a verified account and an active, dues-confirmed, right-term, unlinked membership with a free UID and no detected collision; every other input denies or routes to review. The second is that **email is never an authorization key**: the decision turns solely on the officer's *explicitly selected* `membershipId` and `targetUid` and the server-read state — there is no email address anywhere in the command, and the account carries only a verification boolean, so a unique normalized-email match can only ever be an upstream suggestion, structurally absent from this decision. The third is that the contract **never auto-resolves ambiguity**: any collision the server flags becomes an explicit `review` verdict rather than an association, so a duplicate account, a changed email, a household overlap, or a contact-email conflict always reaches a human. The fourth is that it **never fabricates payment state**: association is gated on `duesConfirmed` already being true for the term, and the contract records and confirms no payment and carries no amount, price, or charge in its output. The fifth is that **entitlement is only signalled, never granted**: an association emits an `entitlementAction` for the caller to derive the membership claim *after* the canonical link transition persists, and the reducer itself sets no role, writes no claim, and mints no token. The sixth is **least privilege with recent authentication first**: command type, capability, recent authentication, and freshness are all decided before any account or membership fact is examined, so an unauthorized or stale command learns nothing about the entities. The seventh is that the resolution is **idempotent and concurrency-safe**: it is a pure deterministic function, so re-applying an identical command yields an identical verdict; a membership already bound to the selected UID is the idempotent `already_associated`; and an optimistic `expectedMembershipLinkState` mismatch is a `state_conflict` rather than a blind write. Finally the contract is **hostile-input-safe**: every field of the envelope and of each nested membership and account sub-record is read through an own-enumerable data descriptor with no getter ever invoked, and a proxy (including a revoked one), a non-`Object.prototype` prototype, an inherited, extra, missing, or symbol key, or an out-of-shape value denies as malformed rather than being partially interpreted or throwing.

This contract invents no policy and duplicates no sibling. It is the *officer-authorized membership-to-canonical-identity association command*, and it is deliberately neither of its two closest neighbours: §8.0b `membershipManualEvidence` (MEMBERS-ADMIN-001A, #395) is the officer *dues* command — it records off-platform dues into an approved term decision and explicitly *does not associate a UID*; this contract is exactly that deferred association command, gated on the dues it does not itself record. §8.0e `membershipProviderLink` (#367) reconciles an *external provider* account link (email/password, Google, WhatsApp, Strava) as a minimal derived identity projection that is *never authority* and carries `grantsAuthority: false`, with no officer, capability, recent-auth, membership-eligibility, review-queue, or entitlement concern; this contract instead authorizes an *officer* to bind an *eligible* membership to the *canonical Firebase Auth* identity, gates on membership status/dues/term, routes ambiguity to human review, and signals entitlement derivation. It is likewise not the entitlement→claim reconciliation (`membershipClaimReconciliation`, §8.0c, which decides whether a claim should be present; this only signals that a derivation should run), the membership authority/entitlement reducer (`membershipAuthority`, §8.0a), a task claim or lifecycle arbitration (§8.10/§8.12), or a members-only-content access resolver (`projectMemberDiscounts`, §8.13). It owns the association-authorization *mechanism* — may this officer bind this membership to this identity now, and what audited transition and entitlement signal result — never the policy of who the officer is or how their capability and recent authentication are proven, which the caller supplies as evidence. Verifying the officer, capability, and recent authentication (AUTH-003); reading and writing the authoritative record; minting the durable command ID for replay-deduplication and rejecting a conflicting-payload replay; deriving and writing the custom claim (§8.0c/#373); the actual UID-link write; Firestore schema and Rules; and any route or UI remain with #115 and its dependencies. Bulk import, auto-linking by email, creating Auth accounts, and admin-role grants (`setMemberRole`) are explicitly out of scope for #115.

The module is imported by no runtime or Functions index and requires only `node:util`. It reads no clock, randomness, environment, network, Firestore, or provider service; is imported by no endpoint; stores and logs nothing; changes no current profile, role, or claim; mints no identifier; and grants, performs, or persists nothing beyond the returned verdict. It defines no Firestore schema or Rules, enforces no live authorization, and wires into no route. Source change, tests, merge, Firebase deployment, Rules deployment, production data, and live behavior remain separate states; #415 authorizes no real association and proves none of the live states.

## 9. Consistency and failure model

Stripe and Firestore cannot share a distributed transaction. Checkout and refunds are therefore explicit sagas:

- A Firestore transaction protects local uniqueness and scarce-resource counters.
- A stable PAY-002B1 Stripe key identifies one logical provider generation. A lease takeover or HTTP retry is not a new generation. PAY-002B2C1 binds the immutable attempt-1 plan; B2C2 may retry only that exact plan/key inside its conservative stored send window; after that window or with unknown send time, it stops automatic POST. C3A classifies only closed verified evidence, C3B persists only the exact candidate after the stored cutoff and current lease expiry, C3C separately authorizes a later generation, C4A binds its immutable plan, and C4B/#238 records the separate attempt-2 pre-send pair and clock gate. C4C1/#246 can classify one canonical serialized reported shape only as unbound. None proves a provider result, dispatch, persistence, or business validity.
- The business record stores the saga step and external ID.
- A compensating transaction releases a reservation after a known failure.
- A webhook advances successful external state.
- A scheduled reconciler repairs missed, delayed, or out-of-order outcomes.
- Operators receive alerts for records that remain in intermediate or review states beyond their service-level threshold.

Returning a `2xx` response to Stripe means the event has been durably accepted or safely processed. A transient storage failure returns `5xx` so Stripe retries. A permanent validation anomaly is durably quarantined and acknowledged so it does not create an endless retry storm.

## 10. Environment model

| Environment | Firebase | Stripe | Domain | Data policy |
| --- | --- | --- | --- | --- |
| Local source runtime | Firebase Emulator Suite under `demo-mprc-local` | Not safe by Firebase emulation alone | `localhost:3000` | Synthetic data only; browser Firebase traffic is loopback-only |
| CI | Ephemeral emulators and mocks | Stripe fixtures/signature tests; optional isolated test account | None | Synthetic data, no production secrets |
| Staging | Dedicated non-production Firebase project | Stripe sandbox/test keys and its own webhook endpoint | `dev.runmprc.com` | Synthetic or consented test records only |
| Production | Dedicated production Firebase project | Live restricted keys and production webhook secret | `runmprc.com` | Real data under documented retention and access policies |

```mermaid
flowchart LR
    Browser["Local React app\nlocalhost:3000"]
    Auth["Auth emulator\n127.0.0.1:9099"]
    Firestore["Firestore emulator\n127.0.0.1:8080"]
    Functions["Functions emulator\n127.0.0.1:5001"]
    Providers["Stripe, Strava, email,\nand other outside providers\nNOT isolated by Firebase"]

    Browser --> Auth
    Browser --> Firestore
    Browser --> Functions
    Functions -.-> Providers
```

Text alternative: the local browser uses only the three loopback Firebase emulators. A Function can still call an outside provider, so Firebase emulator readiness alone does not authorize checkout, refund, email, or Strava testing.

#99 source selects a fully synthetic Firebase configuration for development/test, connects Auth, Firestore, and Functions to the loopback ports above, stops startup when connection setup fails, and leaves App Check, Analytics, and Sentry off locally. #139 additionally keeps Firebase Analytics off in every source environment and removes the direct Waiver SDK bypass pending an approved #110 policy. The Firebase CLI must still report all three emulators ready before the app is opened. Mocked endpoint tests alone do not prove listening processes, website publication, provider behavior, or deletion of earlier provider data/cookies.

Optimized builds—including current Netlify previews and a locally served `build/` directory—use `NODE_ENV=production` and still target production Firebase. They are restricted to public, read-only visual review until #105/CONFIG establishes a separate staging configuration. Do not sign in, open private/admin pages, or test Firebase/provider actions in those previews.

`SITE_ORIGIN`, Firebase project IDs, App Check keys, Stripe keys, webhook endpoints, Sentry environments, and email providers must be environment-scoped. Live and test webhook secrets are never interchangeable. The repository still needs an explicit staging project before end-to-end rollout.

CONFIG-001A [#149](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/149) adds the source boundary for current commerce and confirmation-mail Functions: local is exact loopback, tests use HTTPS `.test`, staging is exactly `https://dev.runmprc.com`, and production is exactly `https://runmprc.com`. Test/live expected mode must match the server-key marker on the four key-bound Functions. Webhook and mail receive no Stripe API key, and invalid settings stop before rate-limit, business, mail, event-ledger, or Stripe writes. This source boundary does not create staging, configure Secret Manager or Stripe, deploy Firebase, enable commerce, or prove live behavior.

CONFIG-001B1 [#151](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/151) adds a second source boundary for current commands. A false deploy ceiling denies new race, free/volunteer, merchandise, comp, and late-registration work before Firestore. Commands that pass it then require the fresh versioned `systemConfig/commerce` global/domain decision and an explicit resource flag. Registration/order refunds always read the separate incident-refund decision, so disabling new commerce does not silently disable response work. Missing or malformed controls mean disabled. Browser clients cannot read the global document or set resource admission fields. Webhook and confirmation mail deliberately have no edge to this control.

The admission read is a clear linearization point, not a distributed lock. A command admitted on revision N can finish after revision N+1 disables new work, and an already-open Stripe Session or Payment Link can remain payable. PAY-002/PAY-004 own command journals, drain/expiry, and provider-object recovery. CONFIG-001B2 and #105/#133/#136 own the protected writer, drill, deployment, and provider evidence; none is made live by B1 source.

## 11. Security, privacy, and compliance posture

Hosted Checkout reduces MPRC's card-data scope because payment details are entered on Stripe's domain, but it does not make the surrounding system automatically secure or compliant. MPRC still owns access control, application security, privacy disclosures, waiver evidence, fulfillment, refunds, disputes, incident response, vendor configuration, and data retention.

Before launch, MPRC leadership must approve:

- Terms, privacy policy, refund/cancellation policy, fulfillment/shipping policy, and waiver language reviewed by appropriate counsel.
- Stripe account ownership, MFA, least-privilege team roles, bank/payout controls, Radar policy, support contacts, and webhook ownership.
- Tax nexus and sales-tax handling for merchandise and race fees.
- Record-retention periods for financial records, waiver evidence, emergency contacts, birth dates, shipping addresses, support logs, and analytics.
- A named incident commander and a way to disable checkout quickly.

Technical controls and the current findings are detailed in [SECURITY.md](./SECURITY.md). This repository documentation is engineering guidance, not legal, tax, insurance, or PCI certification advice.

## 12. Reliability and service objectives

Initial objectives should be modest and measurable:

| Objective | Initial target |
| --- | --- |
| Checkout API availability | 99.9% during open registration windows, excluding Stripe/Firebase outages |
| Webhook durable acceptance | 99% under 10 seconds; 99.9% under 60 seconds |
| Paid-to-confirmed propagation | 99% under 60 seconds for immediate methods |
| Duplicate fulfillment/refund | Zero tolerated |
| Capacity or inventory oversell caused by application race | Zero tolerated |
| Reconciliation backlog | No unresolved paid/missing-local or local-paid/missing-Stripe item older than 15 minutes during launches |
| Critical security alert response | Acknowledged within 30 minutes during an active paid event window |

These targets require structured logs, alerting, Stripe delivery monitoring, a reconciliation job, and a documented on-call owner. See [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).

## 13. Deployment and migration strategy

Use expand-and-contract changes so the deployed frontend and backend remain compatible:

1. Add new fields, endpoints, ledgers, and state handling while continuing to read old records.
2. Deploy backend functions, rules, and indexes before clients that depend on them.
3. Backfill counters, state fields, and business references with a dry-run report and an idempotent migration.
4. Switch new checkout creation to the new path in Stripe test mode.
5. Exercise webhook retries, duplicates, out-of-order events, refunds, expired Sessions, and reconciliation.
6. Run a limited live pilot with one low-risk product or capped event.
7. Observe and reconcile before broad launch.
8. Remove legacy status fields and direct-write permissions only after all active records and clients have migrated.

Never test migration or reconciliation logic for the first time against production records.

## 14. Architecture decisions

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| ADR-001 | Use Stripe-hosted Checkout rather than custom card UI | Keeps raw card data out of MPRC systems and uses Stripe's optimized payment surface | Accepted |
| ADR-002 | Keep Firebase/Firestore for the first commerce release | Existing implementation and operational scale fit; changing databases would add risk without fixing payment correctness | Accepted |
| ADR-003 | Treat Stripe webhooks plus reconciliation as payment truth | Redirects are lossy and spoofable; webhooks are retryable but can be delayed or duplicated | Accepted |
| ADR-004 | Use application idempotency records and Stripe idempotency keys | Required for safe retries across the Firestore/Stripe boundary | Accepted |
| ADR-005 | Atomically reserve capacity and SKU inventory before Checkout | Prevents overselling under concurrent requests | Accepted |
| ADR-006 | Separate payment state from registration/fulfillment state | Avoids impossible overloaded states such as a fulfilled order becoming merely `refunded` | Proposed for phased migration |
| ADR-007 | Move financial and secret mutations behind narrow functions | The current admin catch-all is too broad for least privilege and auditability | Accepted target |
| ADR-008 | Launch with card-class immediate methods only unless delayed methods are fully tested | Simplifies initial fulfillment while the webhook still handles asynchronous outcomes safely | Proposed; finance/product approval required |
| ADR-009 | Prefer Firebase Hosting for the commerce frontend | Controlled rewrites, preview environments, and response headers are operationally safer than the current GitHub Pages fallback | Proposed |

## 15. Open product and governance decisions

The following cannot be safely decided from code alone and are tracked as launch-gate issues:

- Who owns Stripe, Firebase/GCP, DNS, GitHub, email delivery, and Sentry accounts?
- Who may grant roles, issue refunds, view participant PII, export rosters, and access payouts?
- Are guest registrations allowed for every race, and which fields are truly required?
- Does a refund release a race spot automatically? What happens after bib assignment or an event cutoff?
- Are transfers/substitutions allowed, and how is waiver acceptance re-collected from the substitute?
- Will merchandise be shipped, picked up, or both? Which countries and tax jurisdictions are supported?
- Are discounts required at launch? If so, who can create them and how are they represented in reporting?
- What is the retention period for waiver evidence and accounting records, and when are high-risk operational fields deleted?
- What uptime and response coverage will exist during an event launch?

Until these decisions are recorded, implementation should use the safest narrow behavior: no unverified member discount, no inventory below zero, no paid-to-cancelled transition without an explicit refund decision, no delayed fulfillment on an unpaid Session, no live promotion codes, and no broad export or secret access.
