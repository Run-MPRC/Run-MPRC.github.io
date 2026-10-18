# Saved test Checkout recovery message — October 18, 2026

The hosted clarification in [#747](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/747) passed a native failed-card test in `run-mprc-staging` and the club Stripe sandbox. Both the earlier held fixture and the new fixture were retired. Real payments and production remain separate.

Officer impact: when Resume cannot reopen the same saved open purchase, the screen tells the test member to keep it and ask the test owner for reconciliation. The purchase stays locked; this is not automatic failed-payment recovery.

Officer documentation: [Test annual dues](./officers/TEST_DUES.md) gives the stop and escalation steps. The root checkpoints and specialist dues guides link to this dated receipt. Fixture setup, provider readback and retirement remain specialist work.

Deployment evidence: [PR748](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/748) changed the client message and tests. Genuine Opus 5.5 medium approved exact head `bd64d73800db803e39d59341d1b11c924bbb8754`. It merged as `30d5f27d6eb2d47a7f85529e41f82a14001153e1`, with the same reviewed tree `21e5e75b51c999e921da98bd3494119f6e22fa78`. Exact PR CI `39096452255` and main CI `39096722430` each passed all six jobs and all 62 steps, with none skipped. The two focused rendered/service suites passed 23 tests. No schema, migration, backend, Rules, IAM, dependency or provider-setting change was needed.

## Native test and result

1. A new uniquely owned fictional account signed in through the ordinary screen in RUN (MPRC) Chrome. Native Auth and normal App Check loaded the server's test offers. Only the displayed synthetic notice was accepted.
2. One $25 USD individual purchase opened one real sandbox Checkout Session. Its original order, Session, provider idempotency identity, nonce, price and calendar-year expectation were retained.
3. Stripe's [documented insufficient-funds test card](https://docs.stripe.com/testing#declined-payments) produced the native hosted decline. Link saving was unchecked and the browser card-save prompt was declined. The PaymentIntent was `requires_payment_method` with zero received; no membership existed.
4. The specialist expired only that exact owned unpaid Session with a saved idempotency intent. Native readback showed it expired and unpaid. The PaymentIntent became `canceled`, still with zero received. The genuine expiry Event processed with zero pending deliveries.
5. The saved order remained open and inactive. Normal Resume stayed on the dues page and displayed: “Checkout could not be reopened. Keep this saved purchase and ask the test owner for reconciliation. Do not start another payment.” No new-purchase controls appeared.
6. Refresh replaced the transient note with “Current test status loaded” while retaining the same open purchase. Resume reproduced the stop message. Native inventory still contained exactly one Session and one order for this fixture. No new charge, automatic unlock, refund, renewal or membership activation occurred.
7. Ordinary account-screen sign-out cleared the note and controls. The owned test tab was closed. Other tabs were preserved.

The earlier interrupted fixture was not reused. Its empty Session expired naturally without a PaymentIntent or membership, and its genuine expiry Event processed. It is cleanup evidence, not a failed-card test.

## Matching staged surfaces and cleanup

Native Hosting version `6619f96ac1a39406` is finalized at website source `30d5f27`; all 62 public files matched the retained build. The original publish command reported a generic failure after publication. Independent native/public checks qualified the release without a second deployment; the reporting cause remains unqualified. The preexisting local build was restored by all 62 hashes and was not rebuilt for this verification.

Both dues Functions remain ACTIVE v1 at backend source `71f59e26753b87f398b243cce5e995a44fcc538b`. Each downloaded archive is 99,003 bytes, SHA256 `c31a22edab34872dd10c3d3a44e12fdccf933dcb5659fb4db9ca99229d6c908b`. Read-only release verification passed before and after the native test. Runtime, secret references, authority and other Functions were unchanged. The same sandbox endpoint remained enabled with its original eight events and API version; no provider setting was changed.

Genuine Opus 5.5 medium approved the exact fixture/retirement helpers before their writes. Their seven focused guard tests passed. Each cleanup stopped its participant marker, disabled Auth and revoked refresh tokens before deletion. Identity, content-hash and nanosecond update-time fences restricted deletion to the exact owned disposable paths. Native final reads confirmed both Auth users and all eight allowed disposable paths absent; six existing disposable records were deleted. Seven retained order/account/audit hashes were unchanged. Both processed expiry-event receipts remained. No financial record was deleted.

Dave retains the bounded private manifests, redacted browser/provider receipts, screenshot, approvals and cleanup fences. They are historical evidence, not reusable login access. The screenshot is dated October 18 and accompanies the written steps above. The browser automation session was reset after sign-out. No credential, Checkout URL, raw payment payload or real member information belongs in the repository.

## Officer handoff and limits

A backup officer follows [Test annual dues](./officers/TEST_DUES.md): keep the saved purchase, stop and ask Dave to reconcile it. The officer does not edit records, handle keys, issue refunds or start another payment. Fresh access and provider/cleanup work still require Dave and the specialist.

Rendered tests cover late account/session results and newer active/held status taking precedence; this native follow-up covers the actual decline, expiry, displayed stop, refresh, repeated Resume and ordinary sign-out. It adds no claim about full dispute/async-method qualification, cross-service atomic revocation or self-service recovery. Family invitations, final privacy/waiver/retention/guardian policies, production and live-money approval remain separate.
