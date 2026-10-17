# Review membership and free events

**Status, October 16, 2026:** #739 is source preparation. The changed screen is **NOT AVAILABLE YET** on the hosted site. Local screenshots and tests use fictional accounts and a replacement test service. They do not prove Firebase, email delivery, Stripe or production behavior.

**Purpose:** check that members understand their status and can safely sign up, cancel or recover after an uncertain request.

**Approver:** Dave Liu, the sole backend release owner. A verified Opus 5.5 medium/max approval and green checks on the exact commit count as Dave's delegated code approval. Club policy and real-money activation remain separate.

**Prerequisites:** a reviewed exact commit; the specialist's compatible backend-first staging release receipt; fresh disposable staging fixtures; verified fictional account; normal App Check. Do not reuse the closed #731 accounts, IDs or harness. Do not enter real member details or payment information.

## Screen-only review after staging release

1. Open the specialist's verified staging link on a phone or narrow window.
2. Confirm the test-only notice is visible.
3. Sign in with the supplied fictional account.
4. Confirm the loading message gives way to a membership card and free-event cards.
5. Check that event dates say Pacific time.
6. Open the test waiver and deliberately tick its acceptance box.
7. Choose the named free-event signup.
8. Wait for the confirmed result and your current signup.
9. Cancel that signup.
10. Wait for the cancelled result before starting another action.
11. Ask the specialist to demonstrate the unavailable and lost-response cases with fictional fixtures.
12. Use Retry request for an uncertain action, or Refresh status to read current state without resending it.
13. Wait for the supplied short term or signup window to end.
14. Confirm old status and controls disappear with a refresh message.
15. Refresh status and confirm cancellation of an existing signup remains possible after membership lapses.
16. Sign out, then ask the specialist to remove the new disposable fixtures.

**Expected result:** only the current account's validated status appears. Account/session changes discard old requests and consent. A status display lasts at most 60 seconds from read start, often less at a known deadline; refresh is manual and does not reserve a place. A cancellation keeps the approved paid membership term and issues no refund. This screen still offers only a test membership request; online dues and family invitations are unavailable.

**Stop conditions:** real information or payment is requested; an old account's status appears; active membership remains after a supplied deadline; a failed read leaves old controls; an uncertain retry books twice; phone content overflows; or the compatible backend release is missing. Stop before more actions and tell Dave privately using only a made-up example.

**Success proof:** ask for the exact reviewed commit, green test run, dated phone/desktop screenshots, backend deployment and Hosting asset receipts, genuine staging Auth/App Check behavior and disposable cleanup. Local screenshots are layout/behavior proof only. An engineering walkthrough from a backup officer's perspective is not a human officer signoff.

**Undo:** stop the review and request the specialist's compatible backend/website rollback. Do not edit records, roles, dates or provider settings. A frontend-only source revert is not proof of rollback.

**Escalation:** Dave Liu for release, access, recovery and incident handling; club officers for waiver, retention and guardian/family policy; treasurer and provider owner for real-money activation. The specialist still owns release, fixtures, native security proof and cleanup. No officer terminal, source edit, secret handling or direct database change is part of this procedure.
