# Stripe, Race Registration, and Merchandise Design

**Status:** Required production design; current code is a test-mode prototype
**Last reviewed:** 2026-07-13
**Related:** [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md), [SECURITY.md](./SECURITY.md), [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md)

This document defines how MPRC should configure Stripe and how race-registration and merchandise money flows must behave. It deliberately separates repository implementation from external Stripe account configuration: source code can declare required secret names and behavior, but it cannot prove that the production Stripe account, event destination, bank account, roles, tax settings, Radar controls, or secrets are correctly configured.

## 1. Launch status

**Do not enable or advertise live checkout yet.** The initial 2026-07-12 assessment found unsafe payment confirmation, no Event-ID ledger, enabled unmodeled promotions, and callback loss. Repository safety slices now validate paid/amount/currency/mode/explicit livemode, reject unapproved adjustments, deduplicate Events, protect terminal/refund state, and preserve callbacks. PAY-003A [#101](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/101) is merged source; PROMO-001 [#102](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/102) supplies the adjustment guard and exact tests. Neither statement is deployment, provider, or live-behavior evidence, and these slices do not close the payment architecture. These residual conditions still prevent safe production use:

- Checkout creation lacks validated fail-closed environment configuration, command idempotency, a persistence-first saga, and the canonical versioned state/schema contract.
- The webhook still needs canonical reducer/reservation/outbox integration, explicit metadata schema allowlisting/migration, retry/dead-letter operations, TTL/alerts, emulator integration, and Stripe test-mode delivery rehearsal.
- A webhook can arrive before the registration/order record is written.
- Late-registration Payment Links cannot be reliably mapped back to their registration and are reusable.
- Race capacity is checked with a non-atomic count; merchandise has no SKU inventory reservation.
- Cancelling locally does not expire an open Stripe Session, so a later payment can reopen the record.
- Promotion entry and automatic tax are disabled in both current Session creators. Exact creator/webhook tests quarantine any nonzero discount, tax, or shipping charge. Outstanding pre-change Session/provider inventory, deployment, and live verification remain open under PROMO-001.
- Success credentials remain in query strings even though the Pages fallback now preserves them; DATA-001 must remove long-lived plaintext capabilities and scrub browser/monitoring state.
- Production App Check enforcement is optional and fail-open.
- Legal, privacy, cancellation/refund, tax, shipping, and waiver content is not approved for launch.

The issue sequence in [GITHUB_ISSUES.md](./GITHUB_ISSUES.md) closes these gaps in dependency order.

## 2. Stripe account and environment model

### Required account controls

- The Stripe account must be owned by MPRC, not an individual developer.
- Require MFA for every Stripe team member; prefer phishing-resistant security keys for administrators and finance roles.
- Assign least-privilege Stripe roles. Only a small finance group should issue refunds or change payout settings.
- Enable payout and bank-account change notifications to more than one trusted officer.
- Record legal entity, tax, statement descriptor, public support contact, website, and fulfillment/refund policies accurately.
- Configure Radar and review rules before live sales. Start with Stripe defaults and add rules only from observed abuse, not guesses.
- Restrict webhook destinations to the event types this application handles.
- Maintain two named owners for key rotation, webhook delivery failures, disputes, and account recovery.

### Environment isolation

| Concern | Local/CI | Staging | Production |
| --- | --- | --- | --- |
| API mode | Stripe test objects and fixtures | Stripe sandbox/test mode | Stripe live mode |
| Secret key | Local secret override, never committed | Staging-scoped secret | Production-scoped secret |
| Webhook secret | Stripe CLI signing secret | Staging endpoint secret | Production endpoint secret |
| Firebase project | Emulator | Dedicated staging project | Dedicated production project |
| Site origin | `http://localhost:3000` | `https://dev.runmprc.com` | `https://runmprc.com` |
| Data | Synthetic | Synthetic/approved test data | Real customer and runner data |

Never let a development build fall back to production Functions. Never share a webhook signing secret between endpoints or modes. A test-mode Event cannot mutate a production business record; the webhook processor must compare the incoming Stripe `livemode` flag to its environment configuration.

CONFIG-001A [#149](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/149) implements this matrix as an invocation-time source guard for the current Functions. Configuration parsing returns only the environment name, canonical site origin, and expected livemode; it never returns or stores the complete Stripe key. The two checkout creators and two admin action Functions validate only the documented test/live marker on their bound `sk_` or restricted `rk_` server key. Webhook and confirmation-mail Functions validate the non-secret matrix without receiving that key. Invalid configuration returns a fixed failure before any local business or outside-provider side effect. Provider parameters, secrets, account mode, deployment, and live behavior still require separate private evidence.

PAY-002B1 applies the same closed pairing to Stripe idempotency keys: `production` requires `live`; `local`, `test`, and `staging` require `test`; every other pair fails. The environment remains bound into the idempotency-key digest rather than being treated as an unverified label.

### Commerce admission and incident continuity

CONFIG-001B1 [#151](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/151) adds a source-only command admission matrix. It does not create an officer control or enable commerce.

| Operation | Deploy ceiling | Runtime control | Resource control | Continues during new-commerce pause |
| --- | --- | --- | --- | --- |
| Race paid/free/volunteer, comp, late registration | `COMMERCE_ENABLED=true` | global + race on | event `checkoutEnabled=true` | No |
| Merchandise checkout | `COMMERCE_ENABLED=true` | global + merchandise on | product `checkoutEnabled=true` | No |
| Registration/order refund | valid typed config; ceiling may be false | incident refunds on | Existing record rules remain | Yes |
| Signed Stripe webhook | None from this switch | None | Existing verified transition rules | Yes |
| Confirmation mail | None from this switch | None | Existing eligibility rules | Yes |

The runtime document is the exact versioned server-only `systemConfig/commerce` record. A false deploy ceiling denies new commerce before a Firestore read. New-commerce commands that pass that ceiling, and every refund command, read the runtime record fresh. Missing/malformed control or a missing resource flag means disabled; no browser role can read/write the control or set the resource flag. Unknown future command domains deny until explicitly integrated.

The read is the admission point. It cannot cancel a Stripe request already in flight or make an existing Session/Payment Link unpayable. PAY-002/PAY-004 own command journals and provider-object expiry. The current local `cancel` action also does not expire Stripe. CONFIG-001B2 must add the protected audited writer and a private staging drill before this can be called an operational kill switch.

### Secret inventory

| Name | Consumer | Storage | Notes |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Checkout, refund, reconciliation functions | Google Secret Manager, bound only to those functions | Prefer the narrowest key Stripe supports for the required API resources; never expose it to React. |
| `STRIPE_WEBHOOK_SECRET` | Webhook ingress only | Google Secret Manager | Unique per event destination and environment. |
| `STRIPE_LIVEMODE_EXPECTED` | Webhook/reconciler | Non-secret environment parameter | Explicit `true` or `false`; fail deployment/startup if absent. |
| `COMMERCE_ENABLED` | Current checkout/admin commerce commands | Non-secret environment parameter | Exact deploy-time ceiling; not the no-deploy runtime switch and never consulted by webhook/mail. |
| `SITE_ORIGIN` | Checkout and email links | Validated environment parameter | Exact allowlisted HTTPS origin in hosted environments. |
| `REACT_APP_RECAPTCHA_SITE_KEY` | Browser App Check | Build environment | Public site key; not a secret. Use a separate key per environment. |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava functions | Secret Manager | Separate from Stripe and bound only to Strava functions. |

The Firebase web API configuration is not a server secret, but its project, Auth, Firestore, and App Check configuration must still be restricted and monitored.

## 3. Payment method policy

For the first live release, enable card-class immediate methods only unless the team explicitly implements and tests delayed methods. Wallets delivered through the card payment method can still be available through Stripe Checkout. If ACH, bank debit, cash vouchers, or any delayed-notification method is enabled, `checkout.session.completed` can represent authorization rather than settled payment. Fulfillment must wait for `checkout.session.async_payment_succeeded` or a verified successful PaymentIntent, and failure must be handled.

The backend should remain correct if a delayed method appears accidentally:

- `checkout.session.completed` + `payment_status=paid` may confirm payment.
- `checkout.session.completed` + `payment_status=unpaid` stays in `processing`/`pending_payment` and does not consume final fulfillment side effects.
- `checkout.session.async_payment_succeeded` confirms payment.
- `checkout.session.async_payment_failed` transitions to a failed state and releases the reservation if policy allows.

## 4. Money representation

- Store all amounts as integer minor units: `amountExpectedCents`, `amountPaidCents`, `amountRefundedCents`, and `discountAmountCents`.
- Store a lowercase ISO currency code alongside every amount; launch with `usd` only.
- Reject `NaN`, floats, negative values, unsafe integers, and values above a documented maximum.
- Never infer the amount paid from the catalog after checkout. Catalog price can change; the business record stores the expected snapshot and Stripe stores the charged total.
- Keep Stripe IDs as references, not proof: Session, PaymentIntent, Charge, Refund, Product, Price, and Event IDs each have different semantics.
- Do not put PII, waiver text, emergency contacts, or secrets in Stripe metadata. Use opaque local IDs and a schema version.

### Shared request-safety primitives (PAY-001A)

PAY-001A is tracked in live issue [#157](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/157). It adds two pure CommonJS libraries for later server endpoint work:

- `requestValidation` accepts an exact root plain object with own data properties, rejects unknown configured root keys and dangerous keys anywhere, returns a new deeply frozen value, and applies one technical budget across a strict-object tree. Nested values are data-only and budgeted; every nested object still needs an endpoint-owned exact schema. The hard ceilings are depth 6, 100 object/array entries, 50 items per array, 128 code points/512 bytes per key, 2,000 code points/8,192 bytes per string, and 64 KiB serialized. Every endpoint must define a smaller business limit where appropriate.
- Its scalar helpers accept only nonnegative integer cents (maximum 100,000,000 technical cents, with a lower endpoint limit expected), launch currency `usd`, canonical calendar dates, canonical HTTPS DNS URLs, explicitly enabled canonical test/development loopback URLs, and conservative bounded ASCII email syntax. URL syntax validation is not an outbound-host authorization or SSRF allowlist. Email syntax is not proof of identity, membership, or delivery.
- `safeLogging` creates only a new frozen five-field projection—event, operation, outcome, code, and environment—from fixed low-cardinality values. It cannot copy request bodies, arbitrary keys, IDs, URLs, contact details, addresses, Stripe/OAuth material, or raw errors, and it does not call a logger.
- Failures expose one fixed message and a fixed reason category. Supplied values and provider details are not included.

The libraries contain no Firebase, Stripe, provider, logger, network, clock, or random dependency and make no such call themselves. `parseBoundedArray` deliberately invokes a supplied item parser; that parser must be trusted, pure, synchronous, and endpoint-owned.

These helpers are a source/test foundation only. No checkout, refund, admin, webhook, Firebase, or Stripe endpoint imports them in PAY-001A. Endpoint schemas, immutable business-price snapshots, deployment, and production behavior remain **NOT AVAILABLE YET** under PAY-001B/C/D and later payment issues.

## 5. Catalog model

### Race pricing

The server reads an event pricing snapshot and selects one of the configured tiers:

- `member`: requires a current server-verified member or authorized admin claim.
- `non_member`: public default.
- `early_bird`: requires a server-side cutoff comparison.
- `comp`: created only by an authorized event manager under an explicit waiver policy.
- `free`: a configured zero-price participant registration.
- `volunteer`: no race payment and a distinct capacity policy.

The current client-computed tier is display-only. The server selection is final. An unavailable or malformed tier fails closed.

### Merchandise variants

Products need SKU-level variants rather than independent `sizes[]` and `colors[]` arrays:

```text
products/{productId}
  title, description, status, images, taxCode, shippingPolicy

products/{productId}/variants/{variantId}
  sku
  optionValues: { size, color }
  priceCents
  currency
  onHand
  reserved
  sold
  status
  stripeProductId
  stripePriceId (optional)
```

Every sellable combination has one canonical variant ID. Here `onHand` means physical sellable stock currently held, `reserved` is the subset temporarily held for unpaid Checkout, and `sold` is a cumulative reporting counter. Availability is `onHand - reserved`; do not subtract cumulative `sold` again.

### Stripe Products and Prices

Do not lazily create Stripe Products from an anonymous checkout request. Concurrent checkouts can create duplicates and give public traffic permission to drive catalog writes. Product/Price creation should occur in an authenticated catalog-management function or an idempotent deployment/synchronization job.

Two valid implementation patterns exist:

1. Persist Stripe Price IDs per event tier/SKU and use them in Checkout. This provides clear Stripe reporting and immutable price snapshots.
2. Use server-authored `price_data` for each Session while persisting an MPRC/Stripe Product mapping. This is simpler for infrequent races but creates many inline prices.

For merchandise, persistent Products and Prices are recommended. For one-off races, either is acceptable if updates are idempotent and reporting is clear. The choice must not move price authority to the browser.

## 6. Checkout request contract

Every checkout request includes a client-generated UUID `requestId`. The server binds it to a normalized payload fingerprint and caller scope, stores only a hash as the Firestore key, and rejects reuse with different data.

### Race request

```json
{
  "requestId": "uuid",
  "eventId": "opaque-id",
  "signupType": "participant",
  "requestedPriceTier": "member",
  "runner": {
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "phone": "...",
    "dateOfBirth": "YYYY-MM-DD",
    "emergencyContactName": "...",
    "emergencyContactPhone": "..."
  },
  "customFields": {},
  "waiver": {
    "accepted": true,
    "version": "..."
  }
}
```

The server validates field presence, type, Unicode-normalized length, allowed options, date format/range, event-defined custom field schema, waiver version, registration window, event visibility, member eligibility, rate limit, and payload size. Unknown custom keys are rejected rather than stored.

### Merchandise request

```json
{
  "requestId": "uuid",
  "productId": "opaque-id",
  "variantId": "opaque-id",
  "quantity": 1,
  "buyer": {
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "phone": "..."
  }
}
```

Launch with quantity `1` unless cart and multi-line inventory semantics are explicitly implemented. The server ignores client price/title values because none are accepted in this contract.

### Response

```json
{
  "businessId": "registration-or-order-id",
  "state": "checkout_ready",
  "checkoutUrl": "https://checkout.stripe.com/...",
  "expiresAt": "timestamp"
}
```

Within PAY-002B2C2's conservative stored safe-send window, returning the same request reuses the exact B2C1 plan, parameters, and Stripe idempotency key. After that window—or when first-send time is unknown—the server must stop automatic POST retries; PAY-002B2C3 must reconcile stored/provider/webhook evidence before returning a Session or allowing an explicit new attempt. If a Session is proven expired, a versioned new attempt can be created against the same business record only under an explicit verified transition.

### Pure command identity and provider-key contract (PAY-002B1)

PAY-002B1 is tracked in live [#163](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/163). It defines three pure values for later server commands:

1. A command key hashes contract version, environment, server-derived caller-scope kind/value, and one canonical lowercase UUID v4. It deliberately excludes command type, so reusing the same caller command ID for a different operation reaches the same future journal record and can be rejected.
2. A separate payload fingerprint hashes contract version, trusted command type, and the endpoint-schema-validated canonical payload. Object key order is normalized; array order remains meaningful; only deeply frozen, accessor-free, proxy-free, bounded JSON-like data with integer numbers is accepted.
3. A Stripe idempotency key hashes expected provider mode, bounded provider operation, command key, and immutable provider-attempt number. It exposes no raw caller, UUID, payload, business/provider ID, or personal value and stays below Stripe's 255-character limit.

Version 1 supports only the closed caller scopes `firebase_uid`, `anonymous_principal`, and the fixed `internal_system` principal. It does not support multi-tenant Firebase Auth. A future multi-tenant version must bind the verified tenant identity into the command key rather than treating a UID alone as globally unique.

A Firestore worker-lease takeover is not a new provider attempt. Here, provider attempt means one logical provider generation, not an HTTP retry count. A network error, timeout, Stripe `5xx`, or unknown outcome never advances it. PAY-002B2C1 binds the immutable initial plan without send permission. Before a conservative B2C2 stored first-send deadline, retry may use only that exact plan, parameters, attempt, and key. Stripe may prune a key after at least 24 hours; after the safe deadline—or when first-send time is unknown—B2C2 must stop automatic POST retries and B2C3 must reconcile stored provider references plus verified webhook/metadata or authorized operator evidence. B2C3 may authorize a later provider attempt only after separately proven non-execution or an explicitly safe corrected/new logical operation. PAY-002B2A owns first registration, and PAY-002B2B owns lease/fence and terminal-commitment state without provider-send permission.

Command hashes and fingerprints are pseudonymous server-only identifiers, not anonymization. They must not be returned to browsers or placed in logs, URLs, analytics, screenshots, or public evidence. This source contract performs no authorization, Firestore/Stripe call, clock/random operation, deployment, or provider configuration. No endpoint imports it yet, so it does not currently prevent a duplicate payment operation.

### Registered-only command journal (PAY-002B2A)

PAY-002B2A is tracked in live [#165](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/165). Its unused server-only transaction creates exactly one registered command and its deterministic first audit event, or creates neither:

```text
checkoutRequests/{commandKeyHash}
  journalSchemaVersion, commandIdentityVersion, endpointSchemaVersion
  environment, callerScopeKind, commandType, payloadFingerprint
  state=registered, revision=1, createdAt, updatedAt

auditEvents/commerce_command_{commandKeyHash}_0000000001
  auditSchemaVersion=1, aggregateType=commerce_command, commandKeyHash
  commandRevision=1, eventType=command_registered, fromState=null
  toState=registered, environment, callerScopeKind, commandType, occurredAt
```

The command timestamps and audit timestamp are one trusted Firestore Timestamp captured before the transaction callback. All reads occur before writes. The callback may rerun and contains only Firestore reads/writes—no logger, clock, random generator, network call, or mutable application-state side effect. An absent pair becomes the pair atomically. An exact pair returns the fixed frozen `registered_existing` classification without a write. The result contains only `journalSchemaVersion: 1`, `outcome: registered_new|registered_existing`, and `state: registered`; it has no `shouldExecute` flag. A command-type, endpoint-schema-version, or payload-fingerprint mismatch under the same B1 key is a conflict. Because environment and caller scope are part of the B1 key, a different environment or caller scope derives a different document; B2A does not query for cross-scope UUID reuse. An environment or caller-kind mismatch stored under an existing key is malformed corruption. An orphan, malformed, future-version, unexpected-state, or timestamp-mismatched pair fails closed without repair.

Neither document stores the raw caller, command UUID, payload, personal data, Stripe key/object, provider attempt, result, lease, or failure text. Registration is not authorization and is not execution permission. B2A has no endpoint or index export and no lease, fence, execute/send decision, result replay, provider request, provider plan, attempt advancement, clock-based recovery, or reconciliation transition. PAY-002B2B and the complete PAY-002B2C1/B2C2/B2C3 chain remain required before any business or provider side effect can claim command retry safety.

B2A adds no TTL. Deleting the pair can make an old command appear new. Before any later retention job removes it, the owner-approved policy in [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) must define a server-only tombstone or equivalent durable duplicate barrier that preserves conflict detection without raw identity or payload data. Until then, deletion is not safe.

CI-001B3 [#167](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/167) runs this exact opt-in demo Firestore suite in a separate named hosted job and requires that job in protected-release source checks. The standard differently named demo run still skips the isolated suite. This is synthetic source proof only. It does not deploy Firebase, configure Stripe, or prove live behavior.

### Lease, fence, and terminal commitment target (PAY-002B2B)

PAY-002B2B source/tests are tracked in live [#169](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/169). They preserve the B2A root and revision-1 audit exactly. Mutable state is stored separately at `checkoutRequests/{commandKeyHash}/lifecycle/current`, so an old registration can still be compared byte-for-byte and a malformed or orphan lifecycle fails closed.

The target uses a fixed 60-second server lease. Trusted server code supplies one canonical lowercase UUID v4 for each worker attempt, but the journal stores only a command-bound SHA-256 fingerprint. The raw lease ID is never stored, returned, or logged. The first holder gets fence `1`. An exact same-holder retry before expiry is read-only, another active holder gets a fixed busy result with no fence or expiry, and an expired takeover increments the fence. A stale holder, stale fence, or expired lease cannot finish the command.

The only terminal states are `succeeded` and `failed_final`. Success stores a write-once command-bound commitment to a later server-only business result; final failure stores no reason. The commitment is not a business or Stripe result, proof that an action happened, or a value that can replay a response. Every real lifecycle change appends one deterministic audit event. Recovery reads, busy observations, exact terminal retries, and rejected conflicts append nothing.

This lease is concurrency evidence only. It grants no authorization, inventory or capacity claim, price approval, execute/send permission, provider plan, safe POST retry, reconciliation decision, or result replay. PAY-002B2C1/B2C2/B2C3 and the domain-specific PAY-002C/D work remain required before any Stripe call can claim retry safety. #169's source is unused; no endpoint adopts it, and no Firebase deployment, Stripe/provider configuration, production read/write, website change, or live behavior is claimed.

### Immutable initial provider-plan target (PAY-002B2C1)

PAY-002B2C1 source/tests are tracked in live [#173](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/173). They preserve the B2A registration and B2B lifecycle documents and audits exactly. While the exact current holder/fence is leased and unexpired, one transaction may create only:

```text
checkoutRequests/{commandKeyHash}/providerAttempts/0000000001
auditEvents/commerce_provider_attempt_{commandKeyHash}_0000000001
```

The immutable plan binds provider `stripe`, attempt `1`, HTTP `POST`, environment, test/live mode, API version, endpoint path, operation, and the original binding fence. C1 supports only the reviewed static pair `checkout_session_create` → `/v1/checkout/sessions`; it rejects arbitrary or object-ID-bearing paths. A later operation needs an explicit reviewed mapping rather than caller-selected path flexibility. The raw Stripe account ID, canonical provider parameters, and exact B1 idempotency key are not stored. Versioned length-framed commitments bind each value to the command hash. Those commitments are pseudonymous equality evidence only: they do not prove that a configured credential controls the account, that Stripe received a request, or that a result exists.

An exact plan/audit retry requires the current active holder/fence and performs no write. The plan's stored binding fence and time must also fit the exact deterministic lease audit for that original fence, including its acquisition time and fixed 60-second expiry. Fence `1` must start exactly at the lifecycle's preserved creation time. A later binding fence also requires its exact immediate predecessor lease audit and cannot start before that predecessor expires. This is bounded corruption detection over the server-only append history, not cryptographic proof of every older audit event. After expiry, a worker must take over before it can observe the fixed existing classification; takeover never rewrites the original plan, binding fence, or timestamp. A conflicting plan, stale holder/fence, terminal lifecycle, malformed/orphan/future pair, missing required lease audit, or preseeded audit fails closed without repair. The fixed output contains only schema versions, `provider_plan_bound|provider_plan_existing`, and state `planned`; it exposes no plan, commitment, fence, timestamp, provider value, or send decision.

C1 has no first-send marker, safe-resend clock, Stripe call, provider response, ambiguity state, reconciliation evidence, or later-attempt transition. PAY-002B2C2 must atomically persist pre-POST evidence, reuse only the exact plan/key inside a conservative source-owned window, and require reconciliation after an old or unknown send time. PAY-002B2C3 must append verified evidence and authorize a later attempt only after proven non-execution or an explicitly safe corrected/new logical operation. Timeout, connection loss, `5xx`, an old/pruned key, a missing object reference, or incomplete search never proves non-execution.

#173 remains unused source. It adds no endpoint/index export, provider adapter, Firebase deployment, Stripe account/key/domain configuration, production read/write, website change, or live behavior.

## 7. Persistence-first checkout saga

External Stripe calls cannot be part of a Firestore transaction. Use this sequence:

1. Validate the request and read server-controlled catalog/event state.
2. Derive the PAY-002B1 command key and payload fingerprint; PAY-002B2A must register and compare them, PAY-002B2B must provide the current fence, PAY-002B2C1 must bind the immutable initial plan, and B2C2/B2C3 must complete their send/reconciliation gates before any provider call.
3. In one Firestore transaction:
   - Reuse a matching prior request or reject a conflicting reuse.
   - Lock/read the event capacity counter or SKU variant.
   - Verify availability.
   - Increment `reserved` exactly once when applicable.
   - Create the registration/order in `checkout_creating` with an immutable expected-price snapshot.
   - Store `capacityHeld` or `inventoryHeld` so release is idempotent.
4. Create the Stripe Checkout Session with the PAY-002B1 versioned mode/operation/command-hash/provider-attempt key. Do not put a raw registration, order, caller, or provider ID in that key.
5. Include `client_reference_id`, `metadata.type`, `metadata.schemaVersion`, and the opaque local ID(s).
6. Store Session ID, URL, expiry, and attempt state.
7. Return the URL.
8. If Stripe definitively rejects creation, run a compensating transaction that marks the attempt failed and releases the hold once.
9. If the function loses its response after Stripe creates the Session, PAY-002B2C2 retries the exact B2C1 plan/key only inside its stored safe-send window. After the deadline—or when first-send time is unknown—it stops POSTing; B2C3 reconciles stored provider references plus verified webhook/metadata evidence before completing step 6.

Create the local business record before calling Stripe. That lets a very fast webhook resolve metadata directly and eliminates the current record-not-found race.

Set a deliberate Checkout expiry appropriate for scarce inventory. Stripe's allowed range and current API behavior must be verified during implementation. The application cleanup threshold must match the actual Session expiry rather than waiting seven days.

## 8. Capacity reservation design

Use counters stored on the event document or a dedicated counter document updated in the same transaction as registration creation:

```text
participantCapacity
participantReservedCount
participantPaidCount
participantReleasedCount (optional audit metric)
counterVersion
```

Before enabling the counter, run an idempotent backfill that counts existing active participant records (`pending`, `processing`, `paid`, `comp` according to migration policy), writes a versioned baseline, and reports discrepancies. Every subsequent transition updates both registration and counter in one transaction.

Rules:

- Volunteers do not change participant counters.
- Free participants reserve a seat and move directly to confirmed.
- Pending/processing Sessions hold a seat until payment, explicit cancellation, async failure, or expiry.
- Full refund/cancellation releases a seat only if event policy and cutoff permit it.
- A release checks `capacityHeld == true`, sets it false, and decrements once.
- Partial refunds do not release automatically.
- Admin comps and late registrations use the same reservation service; they cannot bypass capacity silently.

## 9. Inventory reservation design

In the variant transaction:

```text
available = onHand - reserved
require available >= quantity
reserved += quantity
order.inventoryHeld = true
```

On paid webhook, decrement both `reserved` and `onHand` by the quantity and increment cumulative `sold`. On Session expiry, async failure, or pre-payment cancellation, decrement only `reserved`. A refund does not automatically return stock: a separate approved return/inspection action increments `onHand` for resellable stock or records damaged/write-off disposition. Migration and admin adjustment tests must assert these semantics explicitly.

Do not represent inventory solely with `product.status == active|sold_out`. Product status is merchandising; the SKU counter is the sellability constraint.

## 10. Checkout Session configuration

For every Session:

- `mode: payment`.
- Server-controlled line items and currency.
- A validated same-origin HTTPS success URL and cancel URL.
- `client_reference_id` equal to the local business ID.
- Minimal metadata: `type`, `schemaVersion`, local ID, and event/product/variant ID as needed.
- `customer_email` only when needed and validated.
- Shipping collection only for flows that ship physical goods, with an approved country list.
- Explicit payment-method policy.
- Deliberate expiration for reserved capacity/inventory.
- Promotion codes and automatic tax disabled under PROMO-001 until approved monetary snapshots and policies exist. Exact creator-payload tests cover both current Session creators. The webhook requires a complete Stripe adjustment breakdown and quarantines any nonzero discount, tax, or shipping amount. Pre-change Session/provider inventory, deployment, and live verification remain open.
- A stable Stripe idempotency key supplied in request options.

Do not put the confirmation bearer token in `success_url`. Use Stripe's `{CHECKOUT_SESSION_ID}` placeholder. The success API retrieves and validates the Session server-side and returns a sanitized business projection. The success page is informational; fulfillment remains webhook-driven.

For free anonymous registrations, return an opaque receipt token, store only a cryptographic hash, place it in a URL fragment or session state rather than the query, remove it from browser history immediately, apply expiry, and rate-limit lookups. Authenticated users should use UID ownership instead.

## 11. Webhook endpoint and event inbox

### Ingress requirements

- Accept `POST` only.
- Read the exact raw bytes.
- Require the `Stripe-Signature` header.
- Verify with the endpoint-specific secret and Stripe's maintained library.
- Reject malformed or invalid signatures with `400` and a generic response.
- Enforce a reasonable body size at the platform/edge where possible.
- Do not log full payloads, checkout URLs, customer data, or secrets.
- Listen only for required event types.

### Required event types

Initial set:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded` or the selected refund event model
- `charge.dispute.created`
- dispute lifecycle events required by the finance runbook

The exact refund/dispute event set should be selected against the Stripe API version during implementation.

### Durable processing

Use `stripeEvents/{event.id}` as a durable inbox/dedupe record. Store event type, Stripe object ID, livemode, received/processed timestamps, attempt count, status, code version, and local business path—no customer PII.

A successful business transition and `processed` event marker must be atomic where possible. If using a queue, webhook ingress durably enqueues/creates the event before returning `2xx`; a worker leases and processes it. Duplicate Event IDs produce no duplicate transition. Because Stripe can generate distinct Events for the same object transition, the business state machine must also be idempotent by object ID and transition.

Stripe does not guarantee delivery order. Never assume Checkout completion arrives before a refund or dispute. When state is ambiguous, retrieve the canonical Stripe object and reduce it into the current local state.

### Verification before marking paid

At minimum verify:

- Expected `livemode` for this deployment.
- Session `mode` and object type.
- Metadata schema and local record reference.
- Session ID ownership (or attach it exactly once from trusted metadata for a persistence-first record).
- Payment status appropriate to the event.
- Currency equals expected currency.
- `amount_total` equals the allowed expected total after a validated discount policy.
- Local record is in an allowed predecessor state.
- PaymentIntent is not already attached to another local business record.

Store actual total, discount, tax, shipping, Stripe customer reference if required, PaymentIntent ID, and Charge reference. An anomaly enters `payment_review`/quarantine and alerts operations; it never silently marks paid.

## 12. Payment and business state machines

Payment, registration, fulfillment, confirmed refunds, and each dispute are separate dimensions. PAY-002A1 is tracked in live [#161](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/161) as the pure version-1 source/test contract. It does not change the current webhook, write a record, or migrate/deploy anything.

### Payment state

```mermaid
stateDiagram-v2
    [*] --> not_required
    [*] --> checkout_creating
    checkout_creating --> checkout_open
    checkout_creating --> checkout_failed
    checkout_open --> processing
    checkout_open --> paid
    checkout_open --> failed
    checkout_open --> expired
    checkout_open --> cancelled
    processing --> paid
    processing --> failed
```

Text alternative: one Checkout attempt moves forward from creating to open, then to processing or one terminal result. A raw state regression never starts a second attempt; PAY-002B2A registers the B1 identity, while PAY-002B2B/C must fence and bind the provider attempt.

### Registration state

`reserved -> confirmed|cancelled`; then `confirmed -> attended|no_show|transferred|cancelled`. Waiver acceptance and eligibility are attributes/evidence, not inferred from payment state. A substitute must accept the applicable waiver; an admin cannot silently transfer the original person's acceptance.

### Fulfillment state

`unfulfilled -> picking -> packed -> shipped|ready_for_pickup -> delivered|picked_up`. The three active pre-handoff states (`unfulfilled`, `picking`, and `packed`) may instead move to `cancelled`. Completed legacy orders map only to `fulfilled_legacy`; that state does not pretend delivery or pickup is known. Completed states may enter `return_requested -> returned -> written_off`. Cancellation is a separate terminal operational result.

### Confirmed refund aggregate

```mermaid
stateDiagram-v2
    [*] --> none
    none --> partially_refunded
    none --> refunded
    partially_refunded --> refunded
```

Text alternative: the status summarizes refund evidence already confirmed by Stripe. Verified cumulative integer cents remain a separate PAY-003B/PAY-005 field, and another confirmed partial refund can raise that total while the status stays `partially_refunded`. A pending refund command is a separate PAY-005 operation, so a later request cannot erase an earlier confirmed partial refund.

### Per-dispute state

Each Stripe dispute has its own state. An order or registration never stores one canonical `disputeStatus`, because a payment can rarely have more than one dispute. A separately authorized per-dispute record stores its own status; any singular business-record summary is derived compatibility only. Formal disputes move from `needs_response` to `under_review`, `won`, or `lost`. Inquiries use `warning_needs_response`, `warning_under_review`, and `warning_closed`, but an inquiry can escalate to `needs_response` on the same Dispute. Stripe also documents a rare late-win correction from `lost` to `won`. The current [Stripe Dispute object](https://docs.stripe.com/api/disputes/object) includes `prevented`, which was added in [API version 2025-08-27.basil](https://docs.stripe.com/changelog/basil/2025-08-27/add-preventions-to-dispute).

The server's Stripe client requests select `2023-10-16`, but [webhook endpoint Event versioning](https://docs.stripe.com/webhooks/versioning) is independent and the provider setting is unverified. Current webhook source neither accepts `prevented` nor validates `event.api_version`. PAY-003B must inventory and pin/validate the endpoint Event contract, then add fixtures before adopting any newer value.

A same-state observation is `unchanged`, not proven duplicate. A different Event can carry a higher confirmed partial-refund total or new dispute evidence without changing the enum. PAY-003's Event inbox and later PAY-002B2B/C/PAY-005 command state—not this reducer, a B1 digest, or B2A registration alone—prove replay. Because Stripe can deliver the first observed Event out of order, the pure reducer can accept a structurally supported first observation while the provider adapter remains responsible for signature, object, version, ownership, amount, currency, environment, and evidence checks.

Every allowed edge is only a structurally possible change. It never authorizes a caller or proves a waiver, refund decision, Session state, return/write-off decision, or provider fact. PAY-004, PAY-005, MERCH-002, LEGAL-001, scoped authorization, and provider validation must supply those gates before runtime adoption.

The #161 classifier uses only synthetic fixtures. It can split known legacy meaning into a canonical projection and fixed review reasons, but emits no write patch. Stored Session, Payment Link, PaymentIntent, Charge, refund, and dispute IDs prove only references, never provider state. Stripe IDs are opaque bounded strings; A1 does not infer their type from a fixed prefix or format. A reference that could contradict the legacy status returns review-required with no guessed projection; dispute references require separate records. Operational legacy `fulfilled`, `transferred`, or `cancelled` status never proves payment: without separate compatible payment evidence, classification returns review-required with no projection. A later inventory/adoption child must keep the existing single `status` readable, define one write-time compatibility derivation with domain context, retrieve provider truth safely, and dry-run before any additive migration.

## 13. Cancellation, expiry, and late registration

### Cancellation

- Cancelling an unpaid record expires the active Stripe Session before or as part of the saga, then releases the hold.
- If Session expiry fails transiently, keep a cancellation-pending state and retry; do not merely mark local cancelled while payment remains possible.
- Cancelling a paid record requires an explicit refund/no-refund policy and permission. It cannot be the same operation as unpaid cancellation.

`cancellation_pending` is a PAY-004 command/saga operation state, not a canonical payment status in PAY-002A1. Payment remains at its last verified value until the provider result and compensating action are known.

### Expiry

- Handle `checkout.session.expired` for both registrations and orders.
- Release the hold exactly once.
- A scheduled sweeper finds records beyond `expiresAt + grace period`, retrieves the Stripe Session, and repairs local state.

### Late registration

Do not create a reusable Payment Link per registrant. Prefer a one-off Checkout Session created through the same idempotent registration service, then communicate that URL through an authorized channel. If Payment Links are retained, restrict them, define quantity/expiry behavior, map every generated Session through trusted metadata, and prevent multiple paid Sessions from confirming or charging one registration. The simpler first-release decision is to replace the current late-registration Payment Link flow.

## 14. Promotion, tax, shipping, and receipts

### Promotions

The assessment baseline's `allow_promotion_codes: true` was not a complete promotion system. PROMO-001 repository source disables it and records explicit zero adjustments; before enabling discounts in any future issue:

```mermaid
flowchart LR
    Create["Server creates Checkout Session"] --> Disabled["Promotion entry and automatic tax disabled"]
    Disabled --> Event["Signed Stripe event"]
    Event --> Check{"Complete zero adjustment breakdown?"}
    Check -- "Yes" --> Continue["Continue normal payment checks"]
    Check -- "No, unknown, or nonzero" --> Review["Never mark paid or fulfilled; record review evidence"]
```

Text alternative: the server disables unapproved price adjustments when creating Checkout; the signed webhook continues payment confirmation only with a complete all-zero breakdown. Otherwise it records review evidence and never marks paid or fulfilled; a definitively failed or expired Session still cancels.

- Decide whether codes live in Stripe, Firestore, or both.
- Restrict eligible products/events, redemption counts, dates, currencies, and customer scope.
- Validate the applied Stripe discount on the webhook.
- Store expected, discounted, tax, shipping, and final totals separately.
- Include discounts in reconciliation and exports.
- Audit code creation and changes.

Until that work is complete, keep promotion entry and automatic tax disabled and quarantine unknown or nonzero discount, tax, or shipping adjustments.

### Tax

MPRC leadership and a qualified adviser must determine sales-tax obligations. If Stripe Tax is used, enable it intentionally per sellable item and set correct product tax codes and addresses. Do not assume race fees and merchandise share tax treatment.

### Shipping

Define supported countries, carriers, costs, pickup options, delivery expectations, lost-package handling, and return policy. Checkout shipping collection alone is not fulfillment logic. Store only the address fields needed for fulfillment, restrict access, and delete/minimize them after the retention period.

### Receipts and confirmations

Stripe can send payment receipts. MPRC sends a separate registration/order confirmation only after verified local transition. Each email has an idempotency/outbox key, escaped user-controlled content, no secret URL, and no sensitive emergency/contact details.

## 15. Refund and dispute design

### Refund request

- Require a finance-authorized user, App Check, and a recent-authentication/MFA policy.
- Validate current Stripe and local state.
- Validate integer amount against `amountPaidCents - amountRefundedCents`.
- Require an operator reason and optional customer-visible note.
- Generate a stable idempotency key per approved refund request.
- Create a local `refund_pending` operation record before or with the Stripe call.
- Let the verified Stripe event confirm final refunded totals.
- Never label a refund full merely because the request omitted `amount`; retrieve/verify totals.

### Disputes

- Record disputes for registrations and merchandise.
- Alert finance immediately with an opaque business reference and Stripe Dashboard link pattern, not full PII in chat/email.
- Preserve required evidence under the approved retention policy.
- Track opened, needs-response, won, lost, warning-closed, and funds-reinstated outcomes as supported by Stripe.
- Reconciliation must detect a Stripe dispute with no local record.

## 16. Reconciliation

Run a scheduled, idempotent reconciliation job and an operator-triggered version:

- Local pending/processing records past expected time -> retrieve Session/PaymentIntent.
- Local paid record -> verify Stripe paid total/currency and no unexpected refund/dispute.
- Stripe successful Session in the integration's time window -> verify one local business record.
- Local refund totals -> compare Stripe refund totals.
- Capacity/inventory counters -> compare source records and report drift.
- Webhook inbox -> alert failed, quarantined, or long-running items.

The job writes a report and metrics; it does not automatically overwrite ambiguous financial state. Safe deterministic repairs may be automated and must be logged.

## 17. Test matrix

Every commerce release must cover:

- Immediate successful card payment.
- Free participant and volunteer registration.
- Member price accepted and rejected.
- Registration before/after window and members-only visibility.
- Concurrent last-seat attempts; exactly one succeeds.
- Concurrent last-SKU attempts; no negative stock.
- Duplicate checkout request and mismatched request-ID reuse.
- Function timeout after Stripe creates the Session.
- Webhook arriving before the client redirect.
- Duplicate and out-of-order webhook events.
- Invalid signature and wrong webhook secret.
- Wrong livemode, amount, currency, metadata, Session, or PaymentIntent.
- `completed` with unpaid/processing status.
- Async payment success and failure.
- Session expiry and local cancellation with Stripe expiry.
- Full and multiple partial refunds, retry after timeout, and excessive refund rejection.
- Registration and merchandise disputes.
- Promotion disabled; later, allowed and disallowed discounts.
- Late-registration one-time payment.
- Confirmation email emitted once with hostile HTML-like input safely escaped.
- Reconciliation repairs a missed webhook and reports an irreconcilable anomaly.

Use Stripe test clocks/fixtures where applicable, Stripe CLI for signed local delivery, Firebase emulators for integration tests, and a separate staging end-to-end suite. No automated test uses live keys or production data.

## 18. Go-live checklist

Live checkout remains disabled until every P0 gate is evidenced:

- [ ] Production and staging Firebase/Stripe environments are isolated.
- [ ] Secret Manager bindings and rotation owners are verified.
- [ ] App Check is enforced at the function runtime and monitored.
- [ ] Checkout creation is persistence-first and idempotent.
- [ ] Capacity and SKU inventory reservations pass concurrency tests.
- [ ] Webhook inbox, async handling, amount/currency/reference verification, and duplicates pass tests.
- [ ] Local cancellation expires Stripe Sessions.
- [ ] Refunds are idempotent and permissioned.
- [ ] Promotion codes are disabled or fully reconciled.
- [ ] Success routing preserves callbacks and no long-lived bearer token remains in query/history.
- [ ] Reconciliation and payment alerts are live.
- [ ] Critical/high runtime dependency findings are remediated or explicitly risk-accepted with compensating controls.
- [ ] Terms, privacy, refund/cancellation, tax, shipping, and waiver decisions are approved.
- [ ] Stripe/Firebase/GitHub/DNS administrators use MFA and named backup owners.
- [ ] A test-mode dress rehearsal and limited live pilot complete successfully.

## 19. Primary technical references

Implementation should be checked against current first-party documentation at the time of each issue:

- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe webhook behavior and best practices](https://docs.stripe.com/webhooks)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Firebase App Check enforcement for Cloud Functions](https://firebase.google.com/docs/app-check/cloud-functions)
- [Firebase environment configuration and Secret Manager](https://firebase.google.com/docs/functions/config-env)

These links are guidance, not proof that the production account is configured correctly. The runbook requires screenshots or exported non-secret configuration evidence for launch review.
