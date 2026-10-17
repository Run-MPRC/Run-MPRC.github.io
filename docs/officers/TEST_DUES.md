# Review annual dues in test mode

**October 16, 2026: source preparation only; NOT AVAILABLE YET.** #742 adds a separate, disabled test-only checkout and payer activation flow. The club's Stripe sandbox has not been identified or connected. No dues Function, webhook, secret access or dues screen is deployed by this change. The existing member/free-event staging release remains qualified by [#739](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/739).

**Purpose:** confirm that one fictional purchase activates the payer automatically and allows free-event signup, without a second officer membership approval.

**Approver:** Dave Liu. Exact-head Opus 5.5 medium/max APPROVE plus green CI counts as delegated code approval. Stripe account connection, provider settings, legal wording and real money require their separate owner evidence. No backup release owner has been appointed.

**Prerequisites:** the specialist supplies the exact staging release receipt, a club-owned Stripe sandbox, its matching test webhook, a fresh owner-marked fictional verified account and ordinary App Check. Every test account needs a current private test-participant marker. The specialist verifies all deployed surfaces before supplying a review link. Do not use the sealed #731 fixtures or real information.

## Planned screen review — NOT AVAILABLE YET

1. Ask the specialist to connect and qualify the sandbox through the club's private provider setup.
2. Open the supplied staging dues link and confirm the test-only notice.
3. Sign in with the supplied fictional account.
4. Read the two server offers: $25 individual or $30 family in test USD.
5. Confirm the term is the current full calendar year in Pacific time, with no automatic renewal.
6. Read the synthetic waiver and deliberately accept it.
7. Continue to the selected Stripe test checkout.
8. Use only the specialist's provider-approved test instructions.
9. Return to the dues page and choose Check payment status.
10. Wait for verified active test membership.
11. Open Membership and free events and accept the separate event test waiver.
12. Sign up for the named free event and confirm your place.
13. Ask the specialist to demonstrate a lost response, a duplicate request, unpaid checkout, expired term and revoked test access.
14. Refresh status or resume the saved checkout after an interrupted session.
15. Sign out and ask the specialist to remove the exact new fixtures.

**Expected result:** one saved purchase belongs to the payer. A return URL proves nothing. Only verified test payment for the exact account, amount, currency, order and term can activate the canonical membership used by free events. Original term and consent evidence are retained. The current screen expires within 60 seconds or sooner at a known deadline; it never polls. A family purchase creates one private Family ID and the payer's membership. Invitations and other family-account enrollment are **NOT AVAILABLE YET**; an ID alone grants nothing.

**Stop conditions:** real information or money is requested; the test notice disappears; another account's state appears; an unresolved purchase offers another charge; an old term extends into a new year; a failed read leaves controls; or a provider, account, App Check or release check is missing. Near year end, checkout may be unavailable because the provider's minimum session lifetime would cross the term boundary.

**Uncertain or held purchase:** keep the saved order and ask Dave for specialist reconciliation through a tracked change. A declined-card attempt can retain a provider payment record even after checkout expires; it stays locked for specialist reconciliation. Do not pay again, edit records, grant roles, issue refunds or change provider settings. Payment received after withdrawal, suspension, account loss, conflicting revisions or term expiry is retained for reconciliation rather than overriding that state. Rechecking verified identity can finish an otherwise unchanged pending activation. Any observed test refund/dispute places a sticky defensive hold; this does not choose a real club refund policy.

**Success proof:** exact reviewed head and green CI, native Firestore concurrency results, actual Stripe sandbox account/webhook verification, genuine staging identity/App Check, matching Function and Hosting release receipts, dated phone/desktop checks, and exact owned cleanup. Unit doubles, generated signatures and emulator transactions do not prove native Stripe or hosted payment behavior.

**Undo:** stop the review and ask the specialist to disable the test feature and apply a compatible reviewed rollback. Keep unresolved orders and immutable evidence. No officer terminal, source edit, secret or database operation is part of the review.

**Escalation:** Dave for release, test access and recovery; treasurer/provider owner for the sandbox and future live setup; officers for privacy, retention, waiver, guardian and family-definition approval. Real checkout, imports, automatic emails, subscriptions, paid races and refund issuance remain unavailable.
