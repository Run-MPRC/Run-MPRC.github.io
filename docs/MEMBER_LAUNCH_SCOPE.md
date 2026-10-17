# Minimum member launch

**October 15, 2026 decisions.** Dave approved building and deploying the agreed release. Online membership dues are included; paid MPRC race checkout, race refunds and bib transfers follow a separate release. This document records scope and technical requirements, not deployed payment capability or legal-policy approval.

## Member experience

1. Read public running, joining and contact information without an account.
2. Create a personal account and verify its email address.
3. Read and accept the club-approved waiver when it becomes available.
4. Choose individual membership at $25 or family membership at $30 for the full calendar year.
5. Pay once through hosted Checkout, or join an already-paid family using its private invitation.
6. Receive current-member status automatically when identity, waiver and confirmed paid-term requirements are satisfied.
7. Sign up for and cancel free events within their capacity and signup windows.

No additional discretionary membership-approval queue follows satisfied requirements. Officers retain a narrowly authorized, audited dues-confirmation control for the in-person convenience; the public site must not advertise an external-payment option or its instructions. Payment confirmation must never be a browser-editable Paid field or a role toggle.

The approved voluntary cancellation rule preserves access through the paid term without an automatic refund. No automatic renewal subscription, prorating, surcharge, grace period or future-year advance purchase is inferred. Use the club's local calendar year in America/Los_Angeles: January 1 through the exclusive start of January 1 the following year. Renewal is a separate one-time purchase for its own year; no automatic subscription or grace period is selected. Persist the year and exact server-owned boundaries before payment activation.

## Family membership

Participating family members use separate verified accounts under one stable opaque Family ID and share its paid calendar-year term. They do not each pay dues. The price is per family membership, not per family account.

The Family ID identifies the family; it is not sufficient authorization to join one. Proposed enrollment uses a privately shared, expiring, single-use invitation tied to the family. A signed-in verified recipient deliberately redeems it; the server checks the paid term and required consent, binds only that UID and records one immutable result. Retrying the same redemption creates no second relationship. Wrong, reused, expired or revoked invitations deny without revealing another family's details. Public search and automatic email matching are excluded. No custom invitation email service is required; the existing member can share the private invitation.

Keep a shared family term/payment reference and separate per-person account associations/waiver evidence. Do not weaken the existing one-UID membership authority by assigning one account to everybody. One family payment must not be represented as several independent payments. Family lapse or a provider reversal must not leave a child association granting access indefinitely. Do not grant eligibility from a Family ID stored only in a browser profile or an old Auth claim.

Guardian consent, minor accounts, any invitation age requirements and treatment when someone leaves a family still need approved handling. Do not collect children's data or allow one adult to sign another adult's waiver by inference. No household-size limit or relationship test has been invented.

## Payment and activation boundary

Use the existing Stripe direction and a one-time hosted payment flow. Reuse reviewed dues checkout/activation/reversal contracts where compatible; their presence in source is not a complete provider integration.

- The server chooses the plan, integer USD cents (2500/3000), exact year/term, consent version and account/family binding.
- Persist a caller-scoped command and immutable expected payment before the provider call. Fence concurrent duplicate purchases and retain the same provider idempotency key across uncertain retries. Do not automatically issue a new purchase after an ambiguous result.
- A browser return, email match or unchecked provider field never proves payment. Verify provider signature, exact account, test/live realm, paid state, amount, currency, metadata/schema and immutable order/term binding.
- Process webhook events durably and idempotently, including webhook-before-redirect, duplicate/out-of-order events, wrong/failed/unpaid events, late payment after calendar rollover and committed/lost-response retry.
- Derive the member/family term and personal entitlement automatically from confirmed payment and required identity/consent. A stale revision must not cause a paid order to be silently lost; retain a bounded reconciliation/recovery path.
- A successful family invitation consumes existing payment evidence and never creates a new charge. A suspended or expired family cannot issue active-member access.
- Provider refunds/disputes and exceptional/manual corrections require a safe reviewed response even though self-service refund issuance is outside this minimum release. Do not invent the club's refund or partial-payment/reversal policy.
- Test with fictional data and Stripe test mode in isolated staging first. Live provider activation requires the final policy, protected release and provider/finance evidence. Never test a charge, refund, role change or email against production.

Any required tax treatment or change to advertised totals needs the club's approved decision. No unapproved promotion, tax, shipping, processing surcharge, stored card credential or recurring subscription is introduced.

## Low-cost operation

Keep Firebase and runmprc@gmail.com as the club identity. Use named officer accounts with scoped permissions, MFA and a safe recovery procedure. Dave remains sole backend release/recovery owner; that accepted continuity risk does not appoint a new backup.

Prefer static public information, bounded event/member reads, no polling and the existing small zero-minimum Functions. Use built-in Auth verification/reset/recovery and Stripe-hosted payment UI; custom marketing/event/invitation mail can wait. Do not add a subscription service, database rewrite or general importer.

Check current Firebase trial/usage and the club's actual Stripe pricing privately before deciding ongoing operating spend. Existing $10 usage alerts are not a bill cap or an approved recurring budget. Stripe's [published pricing](https://stripe.com/pricing) is a reference, not proof of this account's terms; validate the provider account and approved fees before live release.

## First engineering slice and release evidence

[#737](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/737) changes new free-event admission only: current membership and capacity are read in one transaction; after-read expiry/suspension blocks new entry, while existing cancellation and exact saved retry remain safe. It does not add annual activation, Checkout, family enrollment, IAM or deployment. See the [officer source procedure](./officers/STAGING_COMMUNITY.md#current-membership-for-free-events--737-source-only).

Next, complete the real account-recovery qualification and one coherent test-mode membership purchase/activation/family-enrollment workflow. Keep generic commerce/race/shop work out unless it is an actual dependency. Qualify current Rules/App Check, narrow runtime identities, exact backend-first publication, compatible rollback/isolated restoration and an officer screen-only walkthrough for the selected release.

The [privacy, retention and waiver drafts](./legal/MEMBER_LAUNCH_DRAFTS.md) remain for club review. Source changed, tests passed, merge, staging deployment, production deployment, provider configuration and real behavior must be evidenced separately. #731's accepted fictional race evidence remains closed; no deleted fixture or sealed harness is reused.

## Screen preparation — October 16, #739

The current staging-only membership/free-event screen gains native-session fencing, closed response parsing, a bounded display lifetime and responsive layout. Backend status adds `schemaVersion: 1` and server `observedAtMs`; no persisted record changes. Release the compatible backend before its frontend. An old backend or malformed response displays an unavailable state instead of retaining old membership/signup controls. The client freshness timer never extends membership, chooses capacity or contacts a provider. Automatic token-session observation can trigger one status reread; freshness expiry itself requires explicit Refresh status and does not poll.

The lint inventory adds the two new clean TypeScript files only. Existing reviewed findings remain byte-for-byte unchanged: 113 errors and six warnings elsewhere. No lint rule or allowance is weakened.

Online annual dues, private family enrollment, account-recovery/provider qualification, approved policy and the final protected production release remain incomplete. The prototype request screen explicitly says online dues and family invitations are unavailable; it does not imply that a manual approval queue is the approved final membership flow.

### Native member-screen checkpoint

On October16, Functionv7/archive and Hosting source799565e were verified independently; all62 artifact files/deep routes matched. Ten genuine browser Auth/AppCheck/member/retry/expiry/cancellation checks passed with newly owned fictional fixtures, followed by exact cleanup. Headless sign-in was rejected; normal headed Chrome sign-in and attestation passed without relaxing any guard. Full-site screenshots then caught a global fixed-header CSS collision; the member navigation now uses an equivalent ARIA landmark without matching the site-wide `nav` selector. Its separate Hosting receipt is required. Function bytes and permissions are unchanged by this correction. These checks do not qualify Stripe, real dues, email delivery, family enrollment or production.
