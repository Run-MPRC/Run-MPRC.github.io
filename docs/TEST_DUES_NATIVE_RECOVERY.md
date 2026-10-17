# Test dues native failure and recovery evidence — October 17, 2026

The bounded failure and recovery batch passed in the club sandbox and `run-mprc-staging`. Real payments and production remain unavailable. Read this with the preceding [core hosted evidence](./TEST_DUES_HOSTED_EVIDENCE.md); neither receipt is a real-member launch approval.

Officer impact: interrupted or late test payments retain their original purchase and evidence. Verified payment can recover after a missed callback or restored account. A refund holds membership; expired or failed payments cannot silently create another charge or extend a term.

Officer documentation: [Test annual dues](./officers/TEST_DUES.md), the officer entrypoint, root checkpoints and specialist dues guides point to this receipt. The backup officer stops a stuck purchase and asks Dave for reconciliation. Provider operations, fixture creation and cleanup remain specialist work.

Deployment evidence: the website, Firebase and club Stripe sandbox were checked independently. No application, Rules, IAM, secret version or production deployment changed in this batch. The disable/restore lease lasted 70,768 milliseconds; the disabled interval was inside that bound. The endpoint was restored to its original enabled configuration.

## Source, approval and isolation

Tests ran from clean main `b8b26ac413485fb5561d6804a908b493bbafa619`, the documentation merge following application source `71f59e26753b87f398b243cce5e995a44fcc538b`. Both already had genuine Opus 5.5 medium approval and exact PR/main six-job, every-step green CI. See the preceding receipt and [PR745](https://github.com/Run-MPRC/Run-MPRC.github.io/pull/745).

Genuine Opus 5.5 medium approved the exact private fixture/browser helpers, corrected failure/recovery helpers and fenced retirement helper before their external mutations. The operator checked model provenance, zero permission denials and file hashes. Two rejected recovery-helper revisions were not executed. Sixteen focused guard checks passed: eight fixture/identity checks, two atomic-write checks and six cleanup-fence checks. These are helper checks, not a replacement for application CI.

Only eight new owner-marked fictional `example.test` accounts participated. Ordinary native browser Auth and reCAPTCHA Enterprise App Check were used in RUN (MPRC) Chrome. No debug token, custom token, emulator connection, credential export or real member data was used. The test key and signing secret stayed in process memory through their existing pinned staging Secret Manager versions. No account, permission or secret rotation was performed. Neither the earlier deleted hosted fixtures nor sealed #731 fixtures were recreated.

## Observed failure and recovery behavior

| Check | Native result and qualification |
| --- | --- |
| Caller binding | An ordinary authenticated caller naming another owned account received `permission-denied`. |
| Current Auth metadata | Disabling the account or removing verified-email status denied the same cached browser JWT. Restoring native Auth metadata restored access. |
| Default tenant | Native project configuration reported `allowTenants: false`; ordinary sign-in used the default tenant. A forged client `tenant` field received `invalid-argument`. This is not a test with an issued foreign-tenant JWT. |
| Concurrent preparation | Two different request IDs yielded one open order and one `already-exists` rejection. Native provider inventory found one Session for that order. |
| Committed response loss | After a real deployed prepare committed, the browser helper deliberately discarded its result. One retry and two concurrent retries of the saved request returned the same order and single native Session. This was consumer fault injection, not an observed network outage. |
| Unknown provider-create result | A private wrapper made the actual Stripe create call, then deliberately discarded the response before binding it. Native Firestore retained the prepared unbound order. The deployed callable resumed it with the original provider key and bound the same Session. |
| Closed retry horizon | A separate fixture clock was backdated six minutes. The deployed resume rejected the unbound order without a replacement create. Its one native Session was later expired normally. This did not wait six minutes or change the deployed clock. |
| Amount, currency and nonce mismatch | Three actual, unpaid sandbox Sessions differed from the persisted expectation. Test-secret-signed synthetic completion envelopes reached the deployed webhook; each returned 503 and retained a `pending` receipt, with no paid term or membership. All three Sessions were expired while the endpoint was paused. |
| Account and realm mismatch | Signed synthetic envelopes with a foreign account, live Event flag or live object flag returned 400 with no event receipt. No live Stripe object or live key was used. |
| Async and out-of-order envelopes | Signed synthetic async-success, async-failure, expiration and completion envelopes used real current Stripe Session state. Unpaid stayed unpaid; paid stayed active; replay after the real refund stayed held. Each accepted envelope returned 200 and its receipt read `processed`. These are native handler/provider-read checks, not real asynchronous payment-method transactions. |
| Missed callback | The exact isolated test endpoint was paused after excluding foreign participants/open Sessions. A genuine $25 hosted payment returned to an open purchase with no active membership shown and no completion receipt. Normal **Check payment status** retrieved provider truth and activated the payer at member/term revision 1. No Stripe event was fabricated by reconciliation. |
| Refund and retry | A full refund of that exact owned sandbox payment succeeded. Repeating the saved provider key returned the same refund. The real `charge.refunded` Event read `processed`; the order became `held`, and the matching membership became suspended at revision 2. Late synthetic completion/async callbacks did not remove that hold or change the term end. |
| Account loss during payment | A saved Checkout was paid while its fictional account was disabled. The real completion Event processed, retaining payment and term evidence as `paid_pending_activation` without canonical membership. After account restoration, normal sign-in and **Check payment status** activated the same purchase at revision 1. |
| Old-year payment | A privileged fixture used a backdated 2025 order and an explicitly adjusted current hosted Session lifetime. A genuine current sandbox payment and real completion Event retained `paid_pending_activation` for the original December 31, 2025 term, without membership or a 2026 extension. Reconciliation preserved that result. This is injected old-year state, not historical time passage. |
| Declined card | Stripe's documented insufficient-funds test card produced the native hosted decline. Its PaymentIntent remained `requires_payment_method`, received zero, and granted no membership. Link/browser card saving was declined. |
| Expiration recovery | Real expiration Events processed for four normal owned unpaid Sessions. Purchases without a PaymentIntent became expired. The failed-card Session, which retained a PaymentIntent, stayed conservatively locked and inactive. Resume did not reopen checkout or offer another purchase; specialist reconciliation is still required. |
| Restore and inventory | The original eight-event/API-version endpoint was re-enabled after 71 seconds. Reviewed restore mode subsequently verified it was already restored, without another pause. Final native inventory found ten owned Sessions: three complete and seven expired; one per normal order and three deliberate mismatch Sessions. No foreign Session was created during the batch. All eleven matching real Events had zero pending webhooks. |

The original missed-callback completion Event was created while the endpoint was disabled and remained without a delivery receipt. Three mismatch expiration Events were also generated while disabled. Zero pending webhooks does not mean these Events were delivered or processed. The later real refund and the normal expiration Events were delivered and processed after restoration.

## Cleanup, recovery and evidence ownership

Both temporary staging tabs were signed out and closed. The named browser SDK app was released before closing its tab. Markers were stopped, and all eight exact fictional Auth identities were disabled and revoked before deletion. Twenty-six disposable records were deleted with identity/data/update-time fences. Final native reads confirmed all eight identities and all 32 allowed disposable paths absent. Thirty-three order, account-anchor, term and audit records matched their pre-cleanup hashes. Webhook/event evidence was retained, including the three intentional pending mismatch receipts. No financial record was deleted to conceal an unresolved state.

The native release verifier then downloaded both ACTIVE v1 Function archives again: each was 99,003 bytes with SHA256 `c31a22edab34872dd10c3d3a44e12fdccf933dcb5659fb4db9ca99229d6c908b`. The public source marker remained `71f59e2`; runtime, secret references, keyless authority and existing community/profile targets matched the earlier verified release. No new build or deployment was required, and the preexisting local build was untouched.

Dave retains the bounded private run manifest, exact-file approvals, selected browser/provider receipts and cleanup fences. They are historical evidence, not reusable test access. Two transient UI diagnostic outputs included test Checkout URLs. The one affected saved AX receipt was scrubbed; both Sessions are now complete/expired. A final scan of saved JSON/text receipts found no actual Checkout URL or secret. No credential, Checkout URL or raw payment/customer payload is included in this repository.

For a future supervised run, Dave supplies new uniquely owned fixtures and a newly reviewed plan. Do not recreate deleted identities or replay this run's financial intent keys. If a purchase is held, expired with a PaymentIntent, or has an unknown outcome outside the original retry window, keep its evidence and stop for specialist reconciliation. Do not issue another charge, edit financial records or infer a refund policy. The private one-time pause harness is not an officer procedure; its interrupted/late recovery requires Dave and the original provider intent evidence.

## Qualification limits

This qualifies the tested card-only staging flow and the specifically labelled native failure boundaries. It does not qualify an issued foreign-tenant JWT, an actual asynchronous payment-method UI or full dispute lifecycle, restricted-key permissions, a real calendar rollover, real distributed outages or atomic Auth/Firestore revocation. The existing unit/emulator suites cover further withdrawal, suspension, revision-conflict and failed-write transitions; those are not claimed as new native tests here.

The failed-card expiry screen still describes the saved purchase as open and cannot reopen its expired Session. This is a safe lock, not a complete self-service recovery experience. The officer guide requires stopping and escalating it. Do not describe it as automatic failed-payment recovery.

Family invitations/other-account enrollment, approved waiver/privacy/retention/guardian wording, live payment exception policies and production/live-money approval remain separate. The connected test flow is not the completed real-member launch.
