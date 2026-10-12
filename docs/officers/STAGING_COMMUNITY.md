# Membership and free events — staging only

**Status:** STAGING ONLY — the Function and first website release were verified on 2026-10-11 under [#707](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/707). Pending membership requests/withdrawal, synthetic paid-term cancellation, free-event signup/cancellation, native Auth/App Check denials, retries and capacity passed hosted checks. Production is **NOT AVAILABLE YET**. The issue records the latest website source, visual review and disposable-data cleanup separately.

**Purpose:** test membership requests and free-event signup/cancellation without real members or payments.

**Approver:** Dave Liu, the sole staging release/recovery owner. No backup owner is appointed.

**Prerequisites:** the platform specialist supplies the exact reviewed release, a disposable verified account and a visibly made-up free event. Use only the staging website. Do not use real runner details or payment information.

## What the actions mean

- Request membership: records a pending request. It does not prove dues or grant membership.
- Withdraw membership request: withdraws a pending application.
- Cancel membership: records a cancellation request for an already-approved synthetic membership. Access lasts through its original paid term. No refund occurs.
- Free-event signup: confirms one place and records acceptance of the displayed test waiver.
- Cancel event signup: releases that place once. Old retries cannot cancel a later signup.

Officer review after the specialist supplies fresh disposable fixtures:

1. Open the specialist-supplied staging `/community` link.
2. Confirm the page says **Staging test only**.
3. Sign in with the disposable verified account supplied privately for this test.
4. Select **Request membership**.
5. Confirm the request is pending and does not grant paid membership.
6. Select **Withdraw membership request**.
7. Confirm the request is withdrawn.
8. Read the visibly synthetic event waiver.
9. Select its acceptance checkbox.
10. Select the event signup button.
11. Confirm your signup is confirmed and the booked count increases by one.
12. Select the event cancellation button.
13. Confirm your signup is cancelled and the place is released.
14. If the result is uncertain, use **Retry request**. It reuses the same request.
15. Use **Refresh status** to read the current result without sending a new action.
16. Sign out when the review ends.

**Expected result:** pending/withdrawn membership requests and confirmed/cancelled free registrations are visible. No charge, refund, email, role grant or real race entry occurs.

**Stop conditions:** a production address, real data, payment form, unexplained count, early loss/extension of paid access, restored suspended access, or request for secrets or direct database edits. Tell Dave privately; do not paste private details into an issue or AI tool.

**Success proof:** the specialist records exact source/CI, native Function archive and resource/IAM readback, staging Hosting release, genuine Auth/App Check denials, capacity/retry/ownership tests, and disposable-data cleanup separately. Local tests or a merge alone are not hosted proof. The term-end check uses synthetic evidence, not a real payment.

The first verified backend is version 1 from `7e3dc451368c70e4b63805927b12d413e8739b56`. Its native archive is 81,228 bytes with SHA-256 `1b78f38d8b5563e9e88482f68d5f57c3249c49c43c69b49eed3efbcd5fa7e148`. The first verified website is `60435c8fe0846625f22067b0d9b2e76171317d2b`. Thirty-eight genuine hosted boundary/lifecycle checks passed, followed by all four page actions. Twenty distinct emulator accounts and two disposable hosted accounts separately proved final-seat safety. Cancellation preserved the synthetic term evidence and access; the real server clock then ended access. No custom role claims, charges, refunds or emails were created. These are dated staging proofs, not production availability or actual payment proof.

**Undo:** stop the staging review. Ask Dave and the platform specialist to use the reviewed staging rollback or remove the one staged community service. Do not edit a member record, role, payment or production setting yourself.

The specialist's Hosting release uses Dave's existing club login for a short-lived credential kept in memory. It does not require a new saved Firebase CLI login or key file. A later documentation or release-script fix may reuse the Function only after its downloaded source exactly matches the reviewed bundle; it does not silently deploy more backend code.

**Escalation:** Dave/platform specialist for deployment, access, uncertain results or recovery. Future officer dues confirmation, event editing, paid registration/refunds, and production release require separate work. The specialist still provisions and removes test fixtures; officers do not use a terminal or change source.

## Cost and scope

## Officer review — #711 source prepared, NOT AVAILABLE YET

**Purpose:** review synthetic membership approval and free-event management. These controls are not a real dues procedure. Dave selected externally confirmed dues for later work; no real payment method, annual plan, term or confirmation authority has been chosen here.

**Approver:** Dave, sole staging/recovery owner. **Prerequisites:** #711 must record hosted acceptance. The specialist supplies an explicitly disposable verified officer account, authenticator setup, expiring approval/event permission and a short server-configured synthetic term. It is not an ordinary browser admin role. No officer changes permissions, source or records directly.

1. Open the supplied staging `/community/admin` link.
2. Confirm **Staging test only** and the staging address.
3. Enter the disposable account's sign-in details privately on this page.
4. Enter its authenticator code.
5. Check the pending test account ID against the specialist's made-up example.
6. Select **Approve test membership** for that account.
7. Confirm the request leaves the pending queue.
8. Ask the specialist to verify the member screen shows the original synthetic expiry and no payment or role grant.
9. Enter a made-up title, location, local event/signup times and capacity in **Create free test event**.
10. Select **Create closed test event**.
11. Confirm it is closed with zero bookings.
12. Select **Edit** before anyone has booked if a correction is needed.
13. Select **Open signup** when ready for the disposable member test.
14. Confirm the displayed booking count after the member signs up.
15. Use **Save capacity** only at or above the booking count.
16. Select **Close signup** to stop new entries without cancelling existing entries.
17. Select **Cancel event** only for the made-up cancellation test; this is final and sends no messages or refunds.
18. Confirm the booked member can still cancel their own signup and release the place.
19. Use **Retry saved action** for an uncertain result; do not repeatedly create new requests.
20. Use **Refresh officer status** to read current state. A successful refresh clears the saved request before a new action.
21. Sign out and sign in with the authenticator again after ten minutes, or if access is denied.
22. Sign out at the end and ask the specialist to remove all owned fixtures.

**Expected result:** one nonfinancial test approval and coherent free-event changes/counts. Editing booked event content is blocked. A cancelled event cannot reopen. At most twenty configured events are supported; old event archival is not included. Pending review shows twenty opaque test account IDs per page, no profiles/emails or export.

**Stop:** production address, real data/dues, payment, absent authenticator gate, permission unexpectedly surviving revocation, lost bookings, stale result, or a request to edit records/share secrets. Tell Dave privately.

**Proof:** exact source/CI/merge, native archive/spec/runtime plus optional TOTP and unchanged sign-in/domain/App Check settings, two capability denial matrix, membership/withdrawal and capacity/closure races, replay/expiry/revocation, actual screen/mobile/offline checks and exact disposable cleanup. Before closing #711, review these steps without a terminal; test enrollment/permission setup and cleanup remain specialist-only.

**Undo:** stop testing. Ask Dave/specialist to disable the staged capability first and verify old requests are denied, then use the reviewed staged rollback if needed. Do not try to reopen a cancelled event or change membership/payment evidence yourself. **Escalation:** Dave/platform specialist for access, deployment, uncertain results or recovery.

**Cost/security:** reuse the one min0/max2/256MB/30s community Function; no new scheduled service, dependency or polling. The runtime adds only Firestore list and read-only Auth target lookup, not user changes, claims, deletes or secrets. Permissions expire and are read on every command, including saved retries. Optional authenticator support is staging-only and uses no SMS; ordinary disposable members still use email/password. These controls and warning budgets are not a bill ceiling.

One new staging Function has zero reserved instances, at most two instances, 256 MB memory and a 30-second limit. The page reads at most 20 configured events and does not poll. Successful new commands are limited to 12 per account per minute; native Auth/App Check and request bounds are also required. These controls and the existing $10 warning budget are not a bill ceiling.

The separate runtime account has only Firestore transaction/get/create/update permissions, at project scope—not per collection. It has no Auth-user administration, deletes, secret access, key, payment or mail permission. Browser access to all new collections remains denied, including for admins. Existing profile Functions, runtime permissions, production and payment integrations are unchanged.
