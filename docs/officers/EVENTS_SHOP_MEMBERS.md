# Events, Shop, Members, and Money

**Current status:** live commerce is **NOT AVAILABLE YET**.
**Use this guide when:** a request touches registrations, members-only access, products, payments, refunds, waivers, or private data.

**Prerequisites:** a claimed issue, named business owner and backup, approved policy/value, isolated test data, and a platform specialist.
**Expected result:** a reviewed plan or test-only demonstration; no real payment, member, registration, order, or production-data change.

The repository contains screens for these jobs. Their presence does not prove the full system is safely configured or live.

There is currently no proven no-code switch that safely stops all new Stripe payments. Hiding a button, closing an event, or marking a product sold out may leave an already-created Stripe Checkout page payable.

## Approval table

| Change | Required owners |
| --- | --- |
| Public event description only | Event lead + communications lead |
| Registration dates or capacity | Event lead + platform lead |
| Price, discount, tax, product, inventory, refund, or payout | Treasurer + platform lead |
| Member access or admin role | Membership lead + platform/security lead |
| Waiver, Terms, Privacy, retention, insurance, or consent | Club officer + approved legal/privacy owner |
| Stripe, Firebase, Netlify, domain, email, or secret | Named service owner + backup |

## Safe request process

1. Open a GitHub issue before changing anything.
2. Name the business owner and backup owner.
3. Write the exact approved policy or value. Do not ask AI to invent it.
4. Ask AI to list every affected screen, data record, email, report, and outside service.
5. Require a test-only demonstration with made-up people and Stripe test mode.
6. Require negative tests: who must be denied, what retries, and what happens if a step fails.
7. Review the preview and the simple data/deployment diagram.
8. Require a rollback or safe roll-forward plan.
9. Require staging evidence before any production approval.
10. Approve a small, named live pilot only after the security launch gates are closed.

## Do not do these jobs manually

- Do not change Firestore records to “paid.”
- Do not grant admin access from the database console.
- Do not paste live Stripe or Firebase keys into code or chat.
- Do not delete registrations, orders, webhook events, or audit records to fix a display.
- Do not issue a refund in both Stripe and the website unless the approved procedure explicitly requires it.
- Do not open registration or sales because a screen appears to work locally.

## What proof is required

- Tests used fake people and test-mode payments.
- The exact commit and pull request are named.
- The website deployment is verified separately.
- The protected release proves the exact Rules and named Functions deployed first. Missing authority or a skipped/partial backend is a red stop, and the website is not published.
- Stripe or another provider is verified directly when involved.
- Counts and money reconcile after the change.
- The named officer signs off.

If any proof is missing, report the change as **not live**.

## In-person Shop catalog — LIVE

**Status:** the bounded [#473](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/473)
artifact is live as Netlify deploy `6a6dc9ea588b0c0008036312`. Its public marker
and `runmprc.com/shop` were verified on 2026-08-01. The page creates no online
order or payment. The same artifact contains Events/Calendar error display;
event records remain unavailable until a separate protected Firebase repair.

**Purpose:** show the approved MPRC Hat at $10.00 and MPRC Jacket at $25.00
without taking an order or payment online.

**Approver:** shop lead plus treasurer and communications/platform owner.

**Prerequisites:** a claimed #466 issue, its reviewed pull request and exact
commit, approval of both prices and the cash/Venmo wording, an approved website
publication, and a backup officer who can review the result without a terminal.
Use [Review, Merge, Release, and Check a Change](./PUBLISH_AND_CHECK.md). The
platform owner must give the backup officer the named release record and exact
commit; the backup officer does not run a command to discover them.

```mermaid
flowchart LR
    Review["Reviewed GitHub catalog"] --> Build["Website build"]
    Build --> Shop["/shop pickup catalog"]
    Shop --> Run["Runner checks availability at a club run"]
    Run --> Treasurer["Treasurer handles pickup and any cash or Venmo payment"]
    Shop -. "No order, payment, inventory, or ledger record" .-> Backend["Website backend"]
```

In words: reviewed public catalog text reaches `/shop`; the runner then checks
availability and completes pickup and any payment with the Treasurer at a club
run, while the page creates no backend record.

Officer steps:

1. Keep online Shop ordering and checkout unavailable.
2. Obtain the named release record and exact commit from the platform owner.
3. Open [runmprc.com/shop](https://runmprc.com/shop) only after that exact
   website revision is known.
4. Confirm the page shows `MPRC Hat` and `$10.00`.
5. Confirm the page shows `MPRC Jacket` and `$25.00`.
6. Confirm both items say to check availability with the Treasurer at a club
   run.
7. Confirm both items say pickup is in person.
8. Confirm both items say an amount still due may be paid to the Treasurer by
   cash or Venmo.
9. Confirm the page has no order form, reservation, checkout button, payment
   link, Venmo handle, or inventory promise.
10. Request any later item, price, or wording change through one reviewed issue
   and pull request. Do not edit Firebase or a payment provider.
11. Record the website publication and dated `runmprc.com/shop` check
    separately from source and test results.

**Expected result:** `/shop` is a two-item information page. It collects no
buyer information and creates no order, payment, inventory, ledger,
fulfillment, or receipt record. It is not proof that an item is available or
that a person has paid.

**Stop conditions:** any order or payment control; a payment address or private
account detail; a promise of availability; a request to mark a person paid in
the browser, Firebase, Stripe, or a spreadsheet; an unknown website revision;
or any claim that source, tests, merge, or a green workflow proves the page is
published.

**Success proof:** exact #466 pull request and merge commit; intended
old-source test failures; green focused and full frontend checks; a reviewed
system map; approved website publication; and a dated exact-revision check of
`runmprc.com/shop`. Record the actual result for the website, Firebase,
Functions, payment provider, production data, and live behavior separately.
This source slice requires no Firebase, Function, or provider change. If a
release reports one, stop and investigate instead of pre-filling “not
performed.”

**Undo:** before publication, use one reviewed frontend revert or safe
roll-forward. After publication, use the same approved website release path and
verify the replacement revision. Do not undo by editing a product, order,
payment, ledger, member account, Firebase record, spreadsheet, or provider
setting.

**Escalation:** shop lead plus treasurer and communications/platform owner. Add
the privacy/security owner if buyer, payment, account, or ledger details appear.
Use a private incident path for sensitive details; never paste them into an
issue, screenshot, email, message, or AI tool.

Catalog editing in the website and an officer payment ledger are **NOT
AVAILABLE YET**. The club mailbox is not an authorization boundary. Future
officer access must use individually attributable accounts, scoped server-side
permissions, and an audit trail.

## New-account verification message — SOURCE ONLY, NOT LIVE

**Purpose:** tell a member whether the account exists and whether the email service accepted the verification request.

**Approver:** membership lead plus identity/platform owner.

**Prerequisites:** issue [#145](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/145) is merged. Before publishing the #153 website revision, verify that the exact [#118](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/118) Rules and Functions were deployed and read back. After publishing, verify the matching profile page and the resend result/countdown from [#153](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/153) before calling My Account a working recovery path. The identity owner must confirm the plain status text. Source or merge evidence alone is not live proof. Email sender and Spam-folder improvements remain separate owner work in [#119](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/119).

```mermaid
flowchart TD
    A["Member chooses Create account"] --> B{"Was the account created?"}
    B -- "No" --> C["Show one generic try-again message"]
    B -- "Yes" --> D["Show Account created"]
    D --> E{"Did the email service accept the request?"}
    E -- "Yes" --> F["Say accepted; check Inbox and Spam"]
    E -- "No" --> G["Keep account; open My Account"]
    G --> H["Choose Request once"]
    H --> I{"Was the request accepted?"}
    I -- "Yes" --> K["Wait through the same 60-second countdown"]
    I -- "No" --> K
    K -- "Accepted result" --> J["Check Inbox and Spam once"]
    K -- "Unavailable result" --> L["Try once more, then stop and escalate"]
```

In words: account creation and each later email request are separate results. Accepted does not mean delivered. The same 60-second browser wait follows either resend result. Refreshing the page or changing accounts can reset that display, so it is not a server safety limit.

Until the prerequisites are proven, the current website message may still be wrong. Do not treat it as delivery evidence.

Officer steps after live proof:

1. Ask the member which plain status they see.
2. Do not ask for their email address, password, code, action link, or screenshot.
3. If the status says the request was accepted, ask them to check Inbox and Spam once.
4. If the message is in Spam, ask them to mark it **Not spam**.
5. If the status says the request did not finish, ask them to choose **Check My Account**.
6. If My Account is unavailable, stop. Keep the account and open a redacted incident through [Request a change](./REQUEST_A_CHANGE.md).
7. Use the next steps only after the exact [#153](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/153) website revision is published and verified. Until then, stop and escalate.
8. Ask the member to choose **Request another verification email** once.
9. Ask them to wait through the full visible 60-second countdown.
10. If the page says the request was accepted, ask them to check Inbox and Spam once. Do not promise delivery.
11. If the page says the request was unavailable, wait for the countdown and try once more.
12. If that second request is unavailable, stop. Open a redacted incident through [Request a change](./REQUEST_A_CHANGE.md).
13. Do not refresh to bypass the display, create another account, or keep clicking. Firebase can still throttle a reset browser countdown.

**Expected result:** the page says `Account created` only after creation succeeds. It separately says an email request was accepted or unavailable. My Account disables the request action for 60 visible seconds after either result. The request-result message never repeats the member's address or the provider's error. An unavailable My Account page is a stop-and-escalate result, not proof that the account failed.

**Stop conditions:** a request for private account details, more than one retry after the countdown, a production email test, refreshing to bypass the countdown, a claim that accepted means delivered, or a website revision that cannot be identified.

**Success proof:** exact pull requests and merge commits for #145, #118, and #153; green synthetic tests; exact #118 Rules and Function deployment/readback before the website; a made-up profile-page check; website publication record; separate `runmprc.com` revision check; and dated plain-text review. Provider delivery, sender branding, Spam placement, and a real mailbox remain unproven unless #119 records owner-approved private evidence.

**Undo:** publish and verify one reviewed frontend revert or safe roll-forward. Do not delete or recreate the Firebase account.

**Escalation:** membership lead plus identity/platform owner; add the communications owner for Spam or delivery problems.

Password reset is a separate recovery path. [#155](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/155) tracks one neutral result and one browser wait; it must never reuse the verification flow's `accepted` or `unavailable` account-specific wording. Until its exact website and private provider proofs exist, use only [Password reset request — NOT AVAILABLE YET](./EMERGENCY_AND_RECOVERY.md#password-reset-request--not-available-yet). Do not ask a member which address they entered.

The incoming verification link is another separate step. [#194](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/194) tracks a deliberate-click `/auth/action` source route that removes the private code from the address and never grants membership. It is **NOT LIVE** and must not become Firebase's global handler while reset-password and email-recovery modes are unsupported. After every provider and website prerequisite is proven, use only [Verification link page — SOURCE ONLY, NOT LIVE](./EMERGENCY_AND_RECOVERY.md#verification-link-page--source-only-not-live). Officers never open, copy, or request the member's link or code.

## Email/password submission one-attempt guard — SOURCE ONLY, NOT LIVE

**Purpose:** make one quick series of clicks on the existing **Sign in** or **Create account** action start only one request, while allowing a later deliberate submission after the page shows its existing general failure message.

**Approver:** membership lead plus identity/platform and privacy owners.

**Prerequisites:** issue [#500](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/500), its reviewed pull request, exact merge commit, and synthetic tests must be complete. Use only a made-up email, password, account result, and rejected value. Parent [#109](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/109) remains incomplete and externally blocked for Google sign-in. This source slice does not enable Google, link accounts, change Firebase or a provider, create a production account, deploy the website, or prove live behavior.

```mermaid
flowchart TD
    A["Member chooses existing Sign in or Create account"] --> B{"Is one email request already under way?"}
    B -- "Yes" --> C["Ignore the repeat"]
    B -- "No" --> D["Start one request and disable competing actions"]
    D --> E{"Did that one request finish successfully?"}
    E -- "Yes" --> F["Keep the existing sign-in destination or account-created result"]
    E -- "No" --> G["Show the existing general failure message"]
    G --> H["A later deliberate submission may start one new request"]
    H --> B
```

In words: the first valid email sign-in or account-creation submission starts one request and disables the other account actions. Extra submissions during that request do nothing. A success keeps the existing result. A failure reveals no provider detail and allows the member to try again deliberately after the action is available. Sequential retries remain possible; each later submission is guarded as its own attempt.

Officer review steps after the source merge:

1. Keep this guard and the Google sign-in work marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #500 issue, reviewed pull request, merge commit, and synthetic test result.
3. Confirm the tests use only a made-up email, password, account result, and rejected value.
4. Confirm two sign-in submissions made together call the existing sign-in request once with the same made-up email and password.
5. Confirm two Create-account submissions made together call the existing registration request once with the same made-up email and password.
6. Confirm the email, password, submit, mode-change, and password-reset actions are unavailable while the request is under way.
7. Confirm a successful sign-in keeps the existing checked return address or Account fallback.
8. Confirm a successful account creation keeps the existing accepted-or-unavailable verification-email result.
9. Confirm a failed sign-in or account creation shows only its existing general message and no rejected provider detail.
10. Confirm the action becomes available after that failure and each later deliberate submission starts at most one new request. Sequential retries remain possible.
11. Confirm the separate password-reset request, countdown, result, and retry behavior are unchanged.
12. Confirm no Google control, popup, redirect, account linking, membership decision, provider setting, Firebase rule, Function, or production account was added or changed.
13. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase/Auth deployment, provider configuration, account/data action, and live behavior as separate results.

**Expected result:** one quick series of submissions starts one existing email/password request. All competing account actions stay unavailable until that request settles. The existing successful sign-in or account-created result remains unchanged. The existing general failure message reveals no rejected value. A later deliberate submission starts at most one new request, and sequential retries remain possible. This browser guard does not cancel a request already started, persist through a reload, remount, another tab, device, or script, control an already-started result received after navigation or a service-context change, provide server idempotency, add Google sign-in, prove membership, or establish live availability.

**Stop conditions:** any real email, password, account, member, provider response, credential, or production data; a production Auth test; more than one provider call from one quick series of submissions; a raw provider detail on the page, in analytics, or in the console; account actions that remain active during the request; a failure that cannot be retried once; any Google, Firebase, Rule, Function, provider-setting, membership, discount, payment, account-data, or deployment change; or a claim that source, tests, merge, preview, or green CI proves the guard or Google sign-in is live.

**Success proof:** for source completion, record the exact #500 issue, reviewed pull request and merge commit, the two intended old-source duplicate-call failures, four green focused tests, the unchanged Login tests, relevant full checks, and independent lifecycle, privacy, and officer-continuity reviews. Live availability requires a separately approved website publication and dated exact-revision verification using an approved isolated made-up account. Record website publication, `runmprc.com`, Firebase/Auth deployment, Google/provider configuration, account/data action, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After a future approved publication, use the same protected website release path and verify the replacement revision. Do not undo by deleting or recreating an account, changing Firebase or provider settings, or changing membership data.

**Escalation:** membership lead plus identity/platform owner. Add the privacy/security owner if a provider detail or private account value appears. Use the private incident path and never paste an email, password, code, provider response, screenshot, or account record into an issue, message, email, or AI tool.

No system-topology diagram changes for this source slice because page structure, data movement, permissions, account ownership, provider configuration, and deployment topology are unchanged. The state-flow diagram above records only the one-attempt browser behavior.

## Checkout adjustment guard — SOURCE ONLY, NOT LIVE

**Purpose:** prevent an unknown discount, tax, or shipping charge from being treated as a valid payment.

**Approver:** treasurer plus platform owner.

**Prerequisites:** source for issue [#102](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/102) has merged, a private Stripe-owner inventory, made-up test payments, and one protected release plan covering all three affected server Functions.

```mermaid
flowchart LR
    A["Website asks Stripe for Checkout"] --> B["Promotion entry and automatic tax stay off"]
    B --> C["Stripe sends a signed result"]
    C --> D{"All adjustment amounts are present and zero?"}
    D -- "Yes" --> E["Other payment checks continue"]
    D -- "No or unknown" --> F["Keep for review; never mark paid"]
```

In words: Checkout starts with unapproved adjustments off; the server accepts the money result only when Stripe explicitly reports zero discount, tax, and shipping.

Officer steps:

1. Keep live race and shop checkout unavailable.
2. Do not create a promotion code, tax rule, or shipping rate for the website.
3. Ask the Stripe owner to review older open Sessions privately.
4. Do not put Session links, code values, customer details, screenshots, or provider IDs in GitHub or AI.
5. Wait for separate proof of source merge, Firebase deployment, Stripe readback, and made-up test behavior.

**Expected result:** a complete all-zero Stripe breakdown may continue through the other checks. Unknown or nonzero adjustments stay under review. A failed or expired Session closes locally; it keeps an adjustment or earlier warning, while an ordinary all-zero failure does not create a new warning.

**Stop conditions:** any real payment/customer data, production-mode test, missing private inventory, missing server Function, skipped Firebase work, or request to “temporarily” enable a discount.

**Success proof:** exact pull request/commit, green exact-commit checks, private redacted inventory, three named Function readbacks, Stripe test-mode results, and separate provider-owner confirmation.

**Undo:** use one reviewed three-Function revert or safe roll-forward. Do not edit a payment record, delete a webhook event, or change production Stripe settings by hand.

**Escalation:** treasurer plus platform owner; add security if an adjustment reached paid/fulfilled state.

## Fulfilled order payment-failure conflict — SOURCE ONLY, NOT LIVE

**Purpose:** keep a fulfilled order unchanged while making a signed Stripe failure or expiry visible for review when the existing payment marker does not say paid.

**Approver:** treasurer plus platform/security owner.

**Prerequisites:** issue [#337](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/337) is merged; the exact webhook Function is deployed through a protected release and read back; made-up Stripe test-mode evidence passes; and PAY-003 launch blockers remain clearly open. A merge or green workflow alone is not enough.

```mermaid
flowchart TD
    A["Stripe reports failed or expired"] --> B{"Is the order already fulfilled?"}
    B -- "No" --> C["Use the normal payment path"]
    B -- "Yes" --> D{"Does the existing payment marker say paid?"}
    D -- "Yes" --> E["Keep the order unchanged"]
    D -- "No" --> F["Keep fulfilled; require payment review"]
    F --> G["Stop manual changes and escalate privately"]
```

In words: a fulfilled order is never cancelled by this source change. If its existing compatibility marker does not say paid, the backend records one fixed review flag without copying customer details into the review note. That old marker is not separate proof from Stripe.

Steps after every prerequisite is proven:

1. Confirm the release names the exact webhook Function and commit.
2. Confirm the release readback says the Function was deployed.
3. Review only made-up test-mode failure and expiry evidence.
4. Confirm the order remains `fulfilled` in the approved test report.
5. Confirm the report says payment review is required.
6. Confirm the report contains no name, address, email, Session link, or payment secret.
7. If a real conflict is reported, stop all manual record changes.
8. Open a private finance incident with the treasurer and platform/security owner.
9. Do not copy the order, customer, Stripe, or payment details into GitHub, email, screenshots, or an AI tool.

**Expected result:** the signed Event is processed once. Fulfillment remains unchanged. A missing or non-paid compatibility marker produces the fixed `fulfilled_without_verified_payment` review result. A fulfilled order whose existing marker already says paid remains unchanged. This does not prove payment independently or decide collection, refund, shipping, stock, or customer-contact policy.

**Stop conditions:** no exact Function deployment/readback, any production test, a request to edit Firestore or Stripe manually, customer or payment details in a shared artifact, an attempt to cancel fulfillment automatically, or no named treasurer/platform owner.

**Success proof:** exact issue, pull request, merge commit, Node 20 signed synthetic tests, protected Firebase deployment and Function readback, made-up Stripe test-mode delivery, one processed Event, one redacted review audit, and a separate statement that website, provider, production-data, and live behavior were or were not verified.

**Undo:** deploy and read back one reviewed backend revert or safe roll-forward. Do not delete the Event ledger, clear the review flag by hand, change payment state, or alter fulfillment records manually.

**Escalation:** treasurer plus platform/security owner. Add the fulfillment owner only after payment evidence has been reviewed privately. Customer contact requires the separately approved communication path.

## Race signup data guard — SOURCE ONLY, NOT LIVE

**Purpose:** stop malformed or unexpected race and volunteer signup data before anything is saved or sent to Stripe.

**Approver:** event lead plus privacy/platform owner. Add the treasurer when a price path is involved.

**Prerequisites for this source review:** issue [#219](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/219) merged; the exact reviewed commit; and a redacted synthetic test report made with invented events and invented people only. This review makes no Firebase or Stripe call.

```mermaid
flowchart LR
    A["Made-up form state"] --> P["Website keeps active answers; omits volunteer tier"]
    P --> B{"Exact safe request shape?"}
    B -- "No" --> X["Fixed message; no save; no Stripe call"]
    B -- "Yes" --> C["Read the admitted event"]
    C --> D{"Answers match that event's fields?"}
    D -- "No" --> X
    D -- "Yes" --> E["Later price, capacity, and payment checks may continue"]
```

In words: the server checks the request first, then checks its answers against the admitted event; any mismatch stops with no save or Stripe call.

The website source first drops answers from the inactive participant or volunteer form and sends no price tier for a volunteer. The server still repeats every check. This source behavior is not live.

Officer source-review steps:

1. Keep live race and volunteer checkout unavailable.
2. Ask the specialist for the synthetic test report from the exact reviewed commit.
3. Confirm the report uses made-up people and made-up events only.
4. Confirm unknown fields and missing required answers are denied.
5. Confirm wrong answer types and invalid choices are denied.
6. Confirm a denial makes no registration write, rate-limit write, capacity check, token creation, Product call, or Checkout call.
7. Confirm the report contains no submitted names, email addresses, phone numbers, answers, or event field labels.
8. Record the result as source proof only.

**Expected result:** only an exact bounded request whose answers match the admitted event may reach later commerce checks. Every denial uses the same plain message and has no mutable or provider side effect.

**Stop conditions:** real member or runner data, an attempt to call Firebase or Stripe, a detailed error containing submitted data, a missing exact commit, or any side effect on denial.

**Success proof for this source review:** exact pull request and commit, green exact-commit tests, a redacted synthetic report, and a written note that Firebase, Stripe, and live behavior were not tested.

**Undo:** use one reviewed source revert or safe roll-forward. Do not edit a registration, event, payment, rate-limit record, or Stripe object by hand.

**Escalation:** event lead plus privacy/platform owner; add the treasurer and security lead if any denied request caused a write or Stripe call.

**Live-release gate: NOT AVAILABLE YET.** PAY-001B2 must first add immutable field, price, and waiver snapshots and prove compatibility without opening real registrations. A separate protected race-checkout release plan must explicitly name `createCheckoutSession`, the exact commit, an isolated staging project, Stripe test mode, owner approval, provider and Firebase readback, paid/free/volunteer checks, and rollback. No current release issue or workflow supplies that plan. Source review does not authorize deployment.

## Race price format guard — SOURCE ONLY, NOT LIVE

**Purpose:** stop an invalid selected race price before the server creates a registration identifier, a Stripe Product, or a Stripe Checkout Session.

**Approver:** event lead plus treasurer and platform/security owner.

**Prerequisites for source review:** issue [#327](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/327) is merged; the exact reviewed commit is named; and tests use made-up events and people. The private inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) is required before any deployment, data repair, or live approval. This technical format guard is not an approved business price policy.

```mermaid
flowchart LR
    A["Made-up event passes earlier checks"] --> B["Earlier request, rate, role, and capacity checks"]
    B --> C["Select one price tier"]
    C --> D{"Stored price is free or at least 50 cents, with at most eight digits?"}
    D -- "No or unknown" --> E["Fixed unavailable message; no later registration or Stripe work"]
    D -- "Yes" --> F["Later checkout safety checks may continue"]
```

In words: some earlier safety checks may already run, but an invalid selected price must stop before the server allocates a registration identifier or starts Stripe work.

Officer source-review steps:

1. Keep live race checkout unavailable.
2. Ask the specialist for the exact pull request and synthetic test report.
3. Confirm the report uses invented events and people only.
4. Confirm missing, paid prices below 50 cents, negative, fractional, oversized, or otherwise malformed selected prices get one plain unavailable message.
5. Confirm the denial creates no confirmation token, registration identifier, registration write, Stripe Product, or Checkout Session.
6. Confirm the report states that earlier rate, role, membership, or capacity checks may already have run.
7. Record the result as source proof only.

**Expected result:** the helper admits free `0`, or a stored whole-number USD value from 50 cents through Stripe's eight-digit technical limit. These technical limits are not approval to charge any amount. An invalid selected value is unavailable and no raw value appears in a result or log.

**Stop conditions:** real runner data, a real payment, a production test, a request to repair Firestore or Stripe by hand, a missing exact commit, a claim that the source is live, or evidence that a denial allocated a registration identifier or reached Stripe.

**Success proof:** exact pull request and merge commit, green synthetic tests, independent review, and a written statement that the website, Firebase, Stripe, production data, and live behavior were not changed or verified. A future live release needs separate Firebase deployment, Stripe test-mode, and readback proof.

**Undo:** use one reviewed source revert or safe roll-forward. Do not edit an event, registration, Product, Session, or payment record by hand.

**Escalation:** event lead plus treasurer and platform/security owner. Add the privacy owner if any submitted person or event detail appears in output.

## Early-bird cutoff format guard — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** treat a missing or malformed stored early-bird cutoff as inactive before later registration or Stripe work.

**Approver:** event lead plus treasurer and platform/security owner.

**Prerequisites for source review:** issue [#341](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/341) must be merged. The exact pull request and merge commit must be named. Tests must use only a made-up event, a made-up runner, and replacements that cannot contact Firebase or Stripe. A Firebase date-and-time value means the database's own `Timestamp` format. Text and an ordinary JavaScript date value do not count. The private inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) is required before deployment or data repair. This check does not approve a cutoff date, timezone, price, membership rule, or eligibility policy.

```mermaid
flowchart TD
    A["Made-up race checkout passes earlier checks"] --> B{"Cutoff uses the exact Firebase date-and-time format?"}
    B -- "No" --> C["Treat early bird as inactive"]
    B -- "Yes" --> D{"Is the test clock before the cutoff's stored millisecond?"}
    D -- "No" --> C
    D -- "Yes" --> E["Continue to the separate price check"]
    C --> F{"Did the request explicitly choose early bird?"}
    F -- "Yes" --> G["Fixed unavailable result; no later registration or Stripe work"]
    F -- "No" --> H["Use the existing member or nonmember fallback"]
```

Text alternative: after earlier checkout checks, a missing, malformed, or reached cutoff makes early bird inactive. An explicit early-bird choice receives one fixed unavailable result and stops before later registration or Stripe work. Automatic price selection uses the existing member or nonmember fallback. Only the exact Firebase date-and-time format whose stored millisecond is later than the test clock may continue to the separate price check.

Officer source-review steps:

1. Keep live race checkout unavailable.
2. Ask the platform owner for the exact #341 pull request.
3. Ask the platform owner for the exact merge commit.
4. Ask for the made-up test report from that same commit.
5. Confirm the report uses only a made-up event and runner.
6. Confirm missing, null, text, ordinary JavaScript date, altered, or distinguishably fake cutoff values are inactive.
7. Confirm one valid cutoff is active before its stored millisecond.
8. Confirm that cutoff is inactive at its stored millisecond or later.
9. Confirm malformed values cannot run a method stored inside them.
10. Confirm malformed values cannot expose their stored value in the new fixed result or guard logs.
11. Confirm an explicit early-bird request receives exactly `Early-bird pricing is no longer available`.
12. Confirm that rejection creates no confirmation token.
13. Confirm that rejection creates no registration identifier or registration write.
14. Confirm that rejection creates no Stripe Product or Checkout Session.
15. Confirm earlier checkout, access, capacity, and role checks may already have run.
16. Confirm earlier request-count safety counters may already have been written and are not rolled back.
17. Confirm automatic price selection uses the existing member or nonmember fallback when early bird is inactive.
18. Record source, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe state, production data, migration, and live behavior as separate results.

**Expected result:** only the exact current Firebase date-and-time format can make early bird active, and only while the clock is before the cutoff's stored millisecond. Missing or malformed cutoffs are inactive without running stored code or exposing the value. An explicit early-bird choice stops with the fixed unavailable result before later registration or Stripe work. Automatic selection keeps its existing fallback. The separate race price guard still checks the selected amount. This cutoff check does not approve that amount or prove that the complete checkout is safe.

**Stop conditions:** any real runner, event, registration, payment, Firebase record, Stripe object, Stripe call, or production test; a request to repair Firebase or Stripe by hand; a missing exact commit; private or raw cutoff details in shared evidence; a rejection that allocates a registration identifier, writes a registration, or reaches Stripe; deployment before the #113 inventory; or a claim that source, tests, merge, preview, or a green workflow approves the business cutoff or proves live checkout behavior.

**Success proof:** exact #341 pull request and merge commit; recorded old-source failures using made-up values; green cutoff, caller, full server, database-permission, isolated test-database commerce, website, safety, and build checks; independent security, compatibility, and backup-officer reviews; and a written statement that website publication, `runmprc.com`, Firebase, Stripe, production data, migration, and live behavior were not changed or verified. A future live release also needs an owner-approved date, timezone, price, and fallback policy; the private #113 inventory; isolated Stripe test-mode proof; exact Firebase Function deployment and readback; and rollback evidence.

**Undo:** before Firebase deployment, use one reviewed pull request that reverses the change or corrects it safely. After any approved backend deployment, use the protected backend release process and confirm the exact published Function revision. Never undo by changing an event, cutoff, registration, Product, Session, or payment record by hand.

**Escalation:** event lead plus treasurer and platform/security owner. Add the privacy owner if runner or event details appeared. Use the private incident path if a malformed cutoff may have reached registration or Stripe work. Do not copy private details, cutoff values, or provider identifiers into an issue, screenshot, email, message, or AI tool.

No main system map needs to change because this source change adds one failure stop without changing ownership, permissions, storage locations, the Stripe boundary, or website publishing. The small diagram above records the new failure path and the unchanged fallback paths.

## Race capacity format guard — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop participant checkout when the stored race capacity is malformed instead of silently treating that value as unlimited or changing it through automatic conversion.

**Approver:** event lead plus platform/security owner.

**Prerequisites for source review:** issue [#349](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/349) must be merged. The exact pull request and merge commit must be named. Tests must use only a made-up event, a made-up runner, and replacements that cannot contact Firebase or Stripe. The private inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) is required before deployment or data repair. This check does not approve a capacity number. It also does not reserve a seat or prevent two people from taking the last seat at the same time.

```mermaid
flowchart TD
    A["Made-up participant request"] --> A1["Earlier request counters may write; a members-only access check may resolve the website role"]
    A1 --> B{"Capacity is missing or exactly null?"}
    B -- "Yes" --> C["Keep the existing unlimited compatibility path"]
    B -- "No" --> D{"Capacity is one positive safe whole number?"}
    D -- "No" --> E["Fixed unavailable result; no count or later checkout work"]
    D -- "Yes" --> F["Count active participant registrations"]
    F --> G{"Active count has reached the limit?"}
    G -- "Yes" --> H["Existing event-full result"]
    G -- "No" --> I["Later role, price, registration, and payment checks may continue"]
    J["Made-up volunteer request"] --> K["Keep the separate volunteer path"]
```

Text alternative: request counters and a members-only website-role check may happen first. A participant event with missing or null capacity then keeps the existing unlimited compatibility path. A positive safe whole number uses the existing active-registration count. Any other stored capacity stops before that count and later participant price work. Volunteer signup keeps its separate path.

Officer source-review steps:

1. Keep live race checkout unavailable.
2. Ask the platform owner for the exact #349 pull request.
3. Ask the platform owner for the exact merge commit.
4. Ask for the made-up test report from that same commit.
5. Confirm the report uses only a made-up event and runner.
6. Confirm missing or exactly null capacity keeps the existing unlimited compatibility path.
7. Confirm one positive safe whole-number capacity is copied without conversion.
8. Confirm zero, negative, decimal, text, false, a computer value that is not a usable number, infinite, or oversized values are invalid.
9. Confirm objects, hidden or inherited values, and values that try to run code when inspected are invalid.
10. Confirm invalid values cannot run a stored method or automatic conversion.
11. Confirm invalid values expose no raw capacity or technical detail in the result or new guard logs.
12. Confirm a malformed public-event capacity receives exactly `Registration is unavailable for this event`.
13. Confirm the two earlier request-count safety checks may already have written counters.
14. Confirm a members-only access check may already have resolved the website role, and that work is not rolled back.
15. Confirm a malformed capacity starts no active-registration count.
16. Confirm a malformed capacity starts no later participant price-role or price work.
17. Confirm a malformed capacity creates no confirmation token, registration identifier, registration write, Stripe Product, or Checkout Session.
18. Confirm a valid configured limit counts once before later participant role and price work.
19. Confirm an active count equal to the limit keeps the existing event-full result.
20. Confirm malformed participant capacity does not change the separate volunteer path.
21. Confirm the report says this check does not prevent simultaneous final-seat oversell.
22. Record source, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe state, production data, migration, and live behavior as separate results.

**Expected result:** missing or null capacity keeps the existing unlimited compatibility path. A configured participant limit must be one positive safe whole number. Every malformed value stops with one fixed result before the active-registration count and later participant checkout work. Valid configured limits keep the existing count and event-full behavior. Volunteer signup remains separate. This source check neither approves the number nor reserves a seat.

**Stop conditions:** any real runner, event, capacity, registration, payment, Firebase record, Stripe object, Stripe call, or production test; a request to repair Firebase or Stripe by hand; a missing exact commit; a raw capacity or technical detail in shared evidence; a malformed value that starts a count or later checkout work; deployment before the #113 inventory; or a claim that source, tests, merge, preview, or a green workflow prevents concurrent oversell or proves live checkout behavior.

**Success proof:** exact #349 pull request and merge commit; recorded old-source failures using made-up values; green capacity, caller, full server, database-permission, isolated test-database commerce, website, safety, and build checks; independent security, compatibility, and backup-officer reviews; and a written statement that website publication, `runmprc.com`, Firebase, Stripe, production data, migration, and live behavior were not changed or verified. A future live release also needs the private #113 inventory, an approved capacity value, transactional seat reservations and release, concurrent final-seat proof, isolated Stripe test-mode proof, exact Firebase Function deployment and readback, and rollback evidence.

**Undo:** before Firebase deployment, use one reviewed pull request that reverses the change or corrects it safely. After any approved backend deployment, use the protected backend release process and confirm the exact published Function revision. Never undo by changing an event, capacity, registration, Product, Session, or payment record by hand.

**Escalation:** event lead plus platform/security owner. Add the privacy owner if runner or event details appeared. Add the treasurer if a registration or payment may have continued. Use the private incident path if malformed capacity may have reached registration or Stripe work. Do not copy private details, capacity values, or provider identifiers into an issue, screenshot, email, message, or AI tool.

No main system map needs to change because this source change adds one format stop without changing ownership, permissions, storage locations, the Stripe boundary, or website publishing. The small diagram above records the invalid-capacity stop, the existing count path, and the separate volunteer path.

## Race audience format guard — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop race and volunteer checkout when an event's stored public or members-only setting is draft, missing, mixed, or malformed.

**Approver:** event lead plus membership lead and platform/security owner.

**Prerequisites for source review:** issue [#351](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/351) must be merged. The exact pull request and merge commit must be named. Tests must use only a made-up event, runner, and website role with replacements that cannot contact Firebase or Stripe. New records use one `visibility` field. Older records without that field use one true-or-false `member_only` field. The private inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) must identify any real older or mixed record before deployment or repair. This check does not choose an event audience. For this guard, a website role proves only that the stored audience gate passed. The unchanged later price-role check remains separate. Neither check proves current or paid club membership.

```mermaid
flowchart TD
    A["Made-up request passes earlier counters and registration-window check"] --> B{"Exactly one allowed checkout audience?"}
    B -- "No, or value is draft, mixed, missing, or malformed" --> C["Fixed unavailable result; no audience-role or later checkout work"]
    B -- "Yes, public" --> D["Continue without the audience-role check"]
    B -- "Yes, members-only" --> E{"Exact verified website member or admin role?"}
    E -- "No" --> F["Existing members-only denial"]
    E -- "Yes" --> G["Continue to the unchanged volunteer or participant path"]
    E -. "Access check only" .-> H["Website role is not membership or payment proof"]
```

Text alternative: after earlier request counters and the registration-window check, exactly one audience that is allowed for checkout is required. A new public setting or an older false member-only flag continues without the audience-role check. A new members-only setting or an older true flag uses the existing verified website-role check. Draft is a known stored catalog value, but it is unavailable for checkout. Mixed, missing, or malformed formats also stop with one unavailable result. Passing the website-role check does not prove current or paid club membership.

Officer source-review steps:

1. Keep live race and volunteer checkout unavailable.
2. Ask the platform owner for the exact #351 pull request.
3. Ask the platform owner for the exact merge commit.
4. Ask for the made-up test report from that same commit.
5. Confirm the report uses only a made-up event, runner, and website role.
6. Confirm a new-format event that may continue checkout uses only `public` or `members_only`.
7. Confirm an older-format event has no new field and uses one exact true-or-false member-only flag.
8. Confirm a draft audience stops checkout.
9. Confirm both audience fields present stops checkout.
10. Confirm both audience fields missing stops checkout.
11. Confirm unknown, wrong-kind, hidden, inherited, or code-running audience values stop checkout.
12. Confirm rejected values cannot run a stored method or automatic conversion.
13. Confirm rejected values receive exactly `Registration is unavailable for this event`.
14. Confirm the result and new guard logs expose no stored audience value or technical detail.
15. Confirm the two request-count safety checks may already have written counters.
16. Confirm the registration-window check may already have run.
17. Confirm a malformed audience starts no website-role check.
18. Confirm a malformed audience starts no volunteer, capacity, later participant role, price, token, registration write, Stripe Product, or Checkout Session work.
19. Confirm a recognized members-only event keeps the existing website-role check and denial.
20. Confirm a recognized public event starts no audience-role check.
21. Confirm a later participant price-role check remains separate from the audience-role check.
22. Confirm passing the audience-role check proves only the stored audience gate.
23. Confirm the separate later role check keeps the existing member-price behavior without newly approving it.
24. Confirm neither role check proves paid dues, current annual membership, or eligibility beyond its existing narrow result.
25. Confirm valid made-up public and members-only participant paths keep their existing results.
26. Confirm valid made-up public and members-only volunteer paths keep their existing results.
27. Record source, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe state, production data, migration, and live behavior as separate results.

**Expected result:** exactly one audience that is allowed for checkout is required. New public and members-only settings and their older true-or-false equivalents keep their current access paths. Draft, mixed, missing, or malformed formats stop with one plain result before the audience-role check or later checkout work. The existing verified website-role check proves only the stored audience gate. The separate later role check keeps its existing member-price result. This source guard changes neither narrow result and proves no paid dues, current annual membership, or broader eligibility.

**Stop conditions:** any real runner, volunteer, event, audience, account, role, membership, registration, payment, Firebase record, Stripe object, Stripe call, or production test; a request to choose or repair an audience in Firebase by hand; a missing exact commit; a stored audience value or technical detail in shared evidence; a malformed audience that starts role or later checkout work; deployment before the private #113 inventory and an owner-approved audience; or a claim that source, tests, merge, preview, or a green workflow proves membership or live checkout behavior.

**Success proof:** exact #351 pull request and merge commit; recorded old-source failures using made-up values; green audience, caller, full server, database-permission, isolated test-database commerce, website, safety, and build checks; independent security, compatibility, identity, and backup-officer reviews; and a written statement that website publication, `runmprc.com`, Firebase, Stripe, production data, migration, and live behavior were not changed or verified. A future live release also needs the private #113 inventory, an owner-approved audience for each real event, the broader RACE/PAY staging proof, isolated Stripe test mode, exact Firebase Function deployment and readback, made-up staged account-role proof, and rollback evidence.

**Undo:** before Firebase deployment, use one reviewed pull request that reverses the change or corrects it safely. After any approved backend deployment, use the protected backend release process and confirm the exact published Function revision. Never undo by changing an event, audience, role, membership, registration, Product, Session, or payment record by hand.

**Escalation:** event lead plus membership lead and platform/security owner. Add the privacy owner if runner or account details appeared. Add the treasurer if membership or payment was inferred. Use the private incident path if a malformed audience may have reached role, registration, or Stripe work. Do not copy private details, stored audience values, provider identifiers, or role evidence into an issue, screenshot, email, message, or AI tool.

No main system map needs to change because this source guard changes no audience owner, role policy, permission, storage location, data movement, Stripe boundary, or website publishing path. The small diagram above records the new failure stop and the current new-format and older-format access paths.

## Merchandise price format guard — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop an invalid stored product price before the server creates an order identifier, changes a product record, or asks Stripe to create a Product or Checkout Session.

**Approver:** shop lead plus treasurer and platform/security owner.

**Prerequisites:** issue [#339](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/339) must be merged for source review. Use only a made-up active product, a made-up buyer, and test replacements that do not contact Stripe. The private inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) is required before any deployment or catalog repair. This price check does not approve a product, price, tax, shipping rule, return policy, or live sale.

```mermaid
flowchart LR
    A["Made-up product passes earlier checkout checks"] --> B["Read one stored price without conversion"]
    B --> C{"Whole-number USD cents from 50 through 99,999,999?"}
    C -- "No or unknown" --> D["Fixed unavailable result; no token, order, product change, or Stripe method"]
    C -- "Yes" --> E["Copy the same cents into the unfinished order and Checkout request"]
```

Text alternative: after earlier checkout and request-count checks, an invalid stored price stops before a confirmation token, order, stored Stripe Product link, or Stripe call; a whole-number price inside the stated limits is copied unchanged into both later amount fields.

Officer source-review steps:

1. Keep live Shop checkout unavailable.
2. Ask the platform owner for the exact #339 pull request and merge commit.
3. Ask for the made-up test report from that same commit.
4. Confirm the report uses only a made-up product and buyer.
5. Confirm prices that are missing, zero, below 50 cents, negative, decimal, text, special computer values that are not usable prices, or numbers longer than eight digits receive exactly `This item is unavailable`.
6. Confirm a rejected price creates no confirmation token or order identifier.
7. Confirm a rejected price writes no order or stored Stripe Product link.
8. Confirm a rejected price calls no Stripe Product or Checkout Session method.
9. Confirm 50 cents, one ordinary test price, and 99,999,999 cents are copied unchanged into the made-up order and a test Checkout request that does not contact Stripe.
10. Confirm the report says that earlier request, access, status, and option checks may already have run, and earlier request-count safety counters may already have been written and are not rolled back.
11. Record source change, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe state, catalog or order data, migration, and live behavior as separate results.

**Expected result:** malformed stored prices stop safely with one plain result and no later order, stored Stripe Product link, or Stripe call or change. Exact whole-number values from 50 through 99,999,999 pass this source check and are copied without conversion. These technical limits are not approval to charge any amount or proof that Stripe will accept a later request. Complete product and option records, stock control, safe repeat handling, checking Stripe's answer, and matching club orders to Stripe are still unfinished.

**Stop conditions:** any real buyer, product, price, order, payment, Firebase record, Stripe object, Stripe call, production test, or request to repair Firestore or Stripe by hand; a missing exact commit; a raw price or technical detail in output; a rejection that allocates an order identifier or performs a later order or stored Stripe Product-link write; or a claim that source, tests, merge, preview, or a green workflow proves Shop checkout is safe or live.

**Success proof:** exact #339 pull request and merge commit; recorded old-source failures; green price-check tests, full server tests, database-permission tests, isolated test-database commerce tests, website tests, safety checks, and build checks; independent security, compatibility, and backup-officer reviews; and a written statement that website publication, `runmprc.com`, Firebase, Stripe settings, production data, migration, and live behavior were not changed or verified. Any future live release needs a private catalog inventory, approved business policy, isolated Stripe test-mode proof, Firebase deployment and readback, proof that club orders match Stripe, and rollback evidence.

**Undo:** before Firebase deployment, use one reviewed pull request that reverses the change or corrects it safely. After any later approved backend deployment, use the approved backend release process and confirm the exact published Function revision. Never undo by changing a product, price, order, Product, Session, payment, or Stripe setting by hand.

**Escalation:** shop lead plus treasurer and platform/security owner. Add the privacy owner if buyer or order details appeared. Use the private incident path if a malformed price might have created an order or Stripe object. Do not copy private details or Stripe IDs into an issue, screenshot, email, message, or AI tool.

No main system map needs to change because this source change adds one price stop without changing who owns an account, who has permission, where records are stored, which Stripe boundary is used, or how the website is published. The small diagram above records the new failure path and the unchanged valid-price continuation.

## Stored Stripe Product binding containment — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop a malformed stored Stripe Product link before a paid race or Shop checkout creates a confirmation token, allocates a registration or order identifier, writes the Product link or registration/order record, or calls Stripe. A Product link is the stored text used to point a later Checkout request at one Stripe Product. Earlier access and request-count checks may already have run, and their safety-counter writes are not rolled back.

**Approver:** event lead and shop lead, plus treasurer and platform/security owner.

**Prerequisites:** issue [#353](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/353) must be merged, and the exact reviewed commit must be named. Use only made-up events, items, runners, and buyers with test replacements that make no Firebase or Stripe provider call. Test-only issue [#275](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/275) records the installed Stripe software shape; it is not provider proof. The private inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) is required before deployment, migration, or Product-link repair. Anonymous lazy Product creation remains concurrency-prone, **NOT SAFE**, and **NOT LIVE**.

```mermaid
flowchart TD
    A["Made-up paid race or Shop request passes earlier checks"] --> B["Inspect the stored Product link once without conversion"]
    B --> C{"Genuinely missing?"}
    C -- "No" --> D{"Primitive, non-empty custom ID of 1–255 text-count units?"}
    D -- "No" --> E["Fixed unavailable result before token, ID, mapping/business write, or Stripe"]
    D -- "Yes" --> F["Copy the same ID into the later mocked Checkout request"]
    C -- "Yes" --> G["Existing anonymous lazy Product-create path"]
    G --> H{"Bounded ID, Product kind, expected mode, and 2xx software status?"}
    H -- "No" --> I["Fixed unavailable result; no mapping, Session, or business write"]
    I --> J["Product may be orphaned: do not retry; reconcile"]
    H -- "Yes" --> K["Existing mapping-before-Session path continues"]
    G -. "Still concurrency-prone" .-> L["NOT SAFE / NOT LIVE; replace with authenticated repeat-safe catalog sync"]
```

Text alternative: a malformed present Product link stops before a new token, registration/order identifier, Product-link or registration/order write, or Stripe call. Earlier request-count safety-counter writes may already have happened and are not rolled back. Only a genuinely missing field enters the existing anonymous Product-create path. A malformed created result stops after one Product attempt but before the local mapping, Checkout Session, or registration/order write; the Product may be orphaned and must not be retried blindly. Valid custom IDs are copied without prefix assumptions. Anonymous lazy creation remains unsafe and unavailable for live use.

Officer source-review steps:

1. Keep live race registration and Shop checkout unavailable.
2. Ask the platform owner for the exact #353 pull request and merge commit.
3. Ask for the made-up test report from that same commit.
4. Confirm both the paid race and Shop paths use the same narrow Product-link check.
5. Confirm a present link must be a primitive, non-empty string from 1 through 255 JavaScript code units. A code unit is the program's unit for counting text.
6. Confirm the check does not require `prod_`, restrict characters, trim text, or convert another value into text.
7. Confirm missing is different from present `undefined`, `null`, empty, false, zero, boxed, structured, inherited, hidden, accessor-backed, or Proxy values.
8. Confirm every malformed present link returns only the endpoint's plain unavailable result.
9. Confirm a rejected stored link creates no token, registration or order identifier, Product-link write, registration/order write, Stripe access, Product, or Checkout Session.
10. Confirm earlier access and request-count checks may already have run. Their safety-counter writes are not rolled back.
11. Confirm one-character, ordinary custom, and 255-unit made-up IDs are copied once and unchanged into the mocked Checkout request.
12. Confirm a later change to the source record cannot change that copied ID.
13. Confirm only a genuinely missing field reaches the old mocked Product-create path.
14. Confirm a created result is accepted only when it has a bounded custom ID, exact Product kind, the expected test/live setting, and a 200-through-299 status from the pinned installed Stripe software.
15. Confirm a rejected created result makes no Product-link write, Checkout Session, registration write, or order write.
16. Confirm the report records no automatic retry. One Product attempt may already have succeeded and left an orphan that later needs private reconciliation.
17. Confirm one valid made-up created Product keeps this order: Product-link write, then Checkout Session, then registration or order write.
18. Confirm free participant and volunteer paths do not inspect Product links or access Stripe.
19. Confirm #359 separately disables the late-registration Product, Price, and Payment Link path in source and keeps paid late registration **NOT AVAILABLE YET**.
20. Record source, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe/provider state, catalog data, migration, and live behavior as separate results.

**Expected result:** a malformed present Product link stops before a new token, registration/order identifier, Product-link or registration/order write, or Stripe call. Earlier access and request-count checks may already have run, and their safety-counter writes are not rolled back. An accepted ID is copied without conversion or re-reading. A malformed created result stops after at most one mocked Product attempt but before any local mapping, Checkout Session, or business-record write. These checks do not prove Stripe origin, account ownership, intended catalog item, metadata binding, active status, approved price, provider delivery, or reconciliation. Missing mappings still enter anonymous lazy Product creation, which remains unsafe because public concurrent requests can create duplicate or orphaned Products.

**Stop conditions:** any real event, item, runner, buyer, registration, order, Firebase record, Stripe object, Product link, payment, provider call, or production test; a request to repair Firestore or Stripe by hand; a missing exact commit; a rejected stored link that allocates a registration/order identifier, writes a Product link or registration/order record, or reaches Stripe; a rejected created result that writes a mapping or creates a Checkout Session; an instruction to retry an unconfirmed Product creation; deployment before #113 and owner-approved mappings; or a claim that source, tests, merge, preview, or green CI makes anonymous Product creation, checkout, or the catalog safe or live. An earlier request-count safety-counter write is expected and is not this stop condition.

**Success proof:** exact #353 pull request and merge commit; recorded old-source failures; green focused race and Shop matrices, full server tests, database-permission tests, isolated test-database commerce tests, website tests, safety checks, and build checks; independent security, compatibility, and backup-officer reviews; and a written statement that website publication, `runmprc.com`, Firebase, Stripe, production data, migration, and live behavior were not changed or verified.

A future live release also needs the completed private #113 inventory and an owner-approved event/item-to-Product disposition; authenticated, repeat-safe catalog management; Product-specific steps for planning, checking before sending, recording the result, handling a lost reply, retrying safely, and matching club records to Stripe; isolated Stripe test-mode proof; protected short-lived Firebase deployment authority under #133; exact Function deployment/readback; rollback; and made-up staged proof. The profile-specific #136 release does not authorize commerce deployment.

**Undo:** before Firebase deployment, use one reviewed pull request that reverses the source change or corrects it safely. After any future approved backend deployment, use the protected commerce release process and verify the exact published Function revision. Never undo by changing an event, item, Product link, registration, order, Session, payment, or Stripe object by hand.

**Escalation:** event lead and shop lead, plus treasurer and platform/security owner. Use the private incident path if a malformed mapping may have reached Stripe or if duplicate or orphaned Products may exist. Do not copy Product links, account details, catalog records, payment data, private provider links, or real customer/member information into an issue, screenshot, email, message, or AI tool.

No main system map needs to change because this source slice adds one failure stop and changes no owner, permission, storage location, provider boundary, or publishing path. The small diagram records the new stop, the possible orphan after a rejected created result, and the unresolved anonymous lazy-create branch.

## Current paid Checkout Session result containment — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop the current paid race and Shop handlers from saving or returning a malformed or mismatched Stripe Checkout Session result. Prevent a visitor from retrying on the same page when the result is unknown.

**Approver:** event lead and shop lead, plus treasurer and platform/security owner.

**Prerequisites:** issue [#357](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/357) must be merged, and its exact reviewed commit and synthetic test report must be named. Use made-up events, items, runners, and buyers with mocked Stripe responses. Do not call Stripe or Firebase. The private provider and catalog inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113), the persistence-first PAY-002C/D work, and protected release evidence remain separate requirements.

```mermaid
flowchart TD
    A["Made-up paid request passes earlier checks"] --> B["A token or ID is allocated; a lazy Product link may already be written"]
    B --> C["Attempt one mocked Stripe Checkout Session create"]
    C --> D{"Exact result check passes?"}
    D -- "No or request rejected" --> E["No registration/order write and no Session ID or URL returned"]
    E --> F["A Stripe Session may still exist and be payable"]
    F --> G["Page shows do not retry and disables the button for this page visit"]
    G --> H["Treasurer and platform owner reconcile privately"]
    D -- "Yes" --> I["Copy only Session ID and checkout URL"]
    I --> J["Save pending record with Session ID only"]
    J --> K["Return current checkout link; payment is still unproven"]
```

Text alternative: after earlier checks, the current handler may already allocate a token or local identifier and may write a lazily created Product link. It then attempts one mocked Checkout Session. A rejected or mismatched result creates no registration/order record and returns no Session ID or URL, but Stripe may still have created a payable Session. The page therefore says not to retry and disables the button for that page visit. A valid result is copied, the pending record stores only the Session ID, and the URL is returned without being stored or logged. This does not prove payment.

Officer source-review steps:

1. Keep live paid race registration and Shop checkout unavailable.
2. Ask the platform owner for the exact #357 pull request, merge commit, and made-up test report.
3. Confirm both current paid handlers use the same narrow result check immediately after the mocked Stripe call.
4. Confirm the check accepts only the expected test/live setting, amount, USD currency, buyer email, exact closed race or Shop labels, success address, cancel address, open status, unpaid status, and payment mode.
5. Confirm the returned Session ID matches the expected test/live form.
6. Confirm the checkout link is a canonical HTTPS address on exactly `https://checkout.stripe.com`.
7. Treat that address as a temporary source-code safety policy. A Stripe custom checkout domain remains blocked until #113 records the approved private provider setting and a separate reviewed configuration change.
8. Confirm the installed Stripe software attached a successful 200 result marker.
9. Confirm unknown response fields, response identifiers, request keys, account values, headers, bodies, and raw Stripe objects are not copied, opened, logged, stored, or returned.
10. Confirm a malformed result or rejected mocked request returns one fixed private-reconciliation message and creates no registration or order record.
11. Confirm an invalid result may follow earlier request-count counter writes, token or identifier allocation, and a lazily created Product mapping. Those earlier effects are not rolled back.
12. Confirm a Stripe Session may exist even when the result is rejected. Do not retry. Escalate for private reconciliation.
13. Confirm an accepted result stores only the copied Session ID in the pending registration or order. Confirm the checkout URL is never stored or logged.
14. Confirm payment remains unproven until the verified Stripe-event path confirms it.
15. Confirm a Shop product slug is encoded as one opaque cancel-address segment.
16. Confirm free participant and volunteer registration still uses no Stripe Session and is unchanged.
17. Confirm a rejected browser request or a resolved paid result without a usable URL shows the fixed do-not-retry message, keeps the made-up form, ends the busy state, and disables another same-page submit.
18. Confirm a direct repeated handler call on that page makes no second service call.
19. Record source change, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe/provider configuration, production data, checkout, payment, and live behavior as separate results.

**Expected result:** malformed or mismatched mocked Session results stop before a registration/order write or browser redirect. Valid results copy only the Session ID and URL; only the ID is stored. A rejected or ambiguous page result becomes terminal for that page visit. This is immediate containment, not complete repeat safety, provider proof, account proof, durable result persistence, or payment proof.

**Stop conditions:** any real event, item, runner, buyer, registration, order, email, phone, address, Stripe object, Session ID, checkout URL, payment, provider call, production record, or live test; a request to inspect a raw provider result; a result error that exposes supplied or technical detail; a rejected result that writes a registration/order or returns an ID/URL; a checkout URL stored or logged; an automatic retry; or a claim that source, tests, merge, preview, or green CI makes checkout safe or live. Reloading, another tab, another device, or a scripted caller can bypass the page-only lock and must not be used as a retry method.

**Success proof:** exact #357 pull request and merge commit; old-source failures followed by green pure result, current-handler, installed-SDK observation, frontend, full server, database-permission, isolated test-database commerce, safety, lint, type, and build checks; independent security, compatibility, accessibility, and backup-officer reviews; and an explicit statement that website publication, `runmprc.com`, Firebase, Stripe/provider settings or calls, production data, checkout, payment, and live behavior were not changed or verified.

**Undo:** before publication, use one reviewed revert or safe roll-forward. After any future approved website or backend publication, use the matching protected release path and verify each affected revision separately. Never undo by changing a registration, order, Product link, Session, payment, Firebase record, or Stripe setting by hand.

**Escalation:** event lead and shop lead, plus treasurer and platform/security owner. Use the private incident path if a live request might have reached Stripe, if an unconfirmed Session might exist, or if a visitor retried. Add the privacy owner if contact, URL, token-shaped, provider, or technical detail appeared. Do not copy any such detail into an issue, screenshot, email, message, or AI tool.

The diagram above records the new current-handler result and page states. Account ownership, permissions, provider topology, data stores, and publishing topology do not change. The full persistence-first, deterministic-key, lost-reply, reconciliation, and approved custom-domain design remains PAY-002C/D and later C4 work.

## Public Checkout one-attempt guard — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** allow only the first valid race or Shop form to start the existing browser Checkout connection until the visitor leaves or reloads the page, including repeats made before the busy label appears.

**Approver:** event lead and shop lead, plus treasurer and platform/security owner. Add the privacy owner to any incident review.

**Prerequisites:** issues [#357](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/357) and [#503](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/503) must be merged, and their exact reviewed commits and made-up test reports must be named. Use only made-up events, items, runners, and buyers. Replace the website connections so the tests cannot contact Firebase or Stripe. Do not enter a checkout form in a preview or public site: those pages may point at production Firebase. This guard does not replace the PAY-002C/D server design for recording a request before contacting Stripe.

```mermaid
flowchart TD
    A["Made-up race or Shop form passes its current checks"] --> B{"Has this page visit already started a browser Checkout call?"}
    B -- "Yes" --> C["Ignore the repeated submission"]
    B -- "No" --> D["Immediately set one short-lived page marker"]
    D --> E["Show the existing busy button and use the test replacement once"]
    E --> F{"Result?"}
    F -- "Current success path" --> G["Navigate to success or Checkout"]
    F -- "Rejected or missing paid link" --> H["Use #357's fixed unknown-result stop"]
    C --> I["No second browser Checkout call or call to the disabled analytics wrapper"]
    H --> J["Stop; do not retry on this page"]
```

Text alternative: after the current page checks pass, the page immediately sets one short-lived marker. It does this before using the test replacement or showing the busy label. Another submission is ignored until the visitor leaves or reloads the page. The first result either follows the existing success path or uses #357's fixed unknown-result stop. This proves only one call from the browser's existing Checkout connection. It does not prove that Firebase or Stripe received anything. A reload, another tab or device, a script, or another program that calls the website connection directly remains outside this guard.

Officer source-review steps:

1. Keep live paid race registration and Shop checkout unavailable.
2. Ask the platform owner for the exact #503 pull request, merge commit, old-source failure, and made-up test report.
3. Confirm the tests replace every Checkout connection so no Firebase or Stripe call is possible.
4. Confirm two immediate valid race submissions call the replaced browser Checkout connection once.
5. Confirm those race submissions call the disabled analytics wrapper once.
6. Confirm the disabled analytics wrapper sends and stores no analytics event.
7. Confirm two immediate valid Shop submissions call the replaced browser Checkout connection once.
8. Confirm the test report shows that the short-lived page marker is set before the busy label appears or the first call finishes.
9. Confirm the existing submit button shows its disabled busy label while the first call is unfinished.
10. Confirm the other form controls remain editable. This change does not lock the complete form.
11. Confirm a race form with an unaccepted waiver makes no browser Checkout call.
12. Confirm the same made-up race form can make one browser Checkout call after the waiver is accepted.
13. Confirm a Shop button disabled by the current required-field checks makes no browser Checkout call when clicked.
14. Confirm one made-up free participant reaches the existing success page after one browser Checkout call.
15. Confirm one made-up volunteer reaches the existing success page after one browser Checkout call.
16. Confirm the volunteer call omits the participant price choice.
17. Confirm one made-up accepted race paid link is assigned once after one browser Checkout call.
18. Confirm one made-up accepted Shop paid link is assigned once after one browser Checkout call.
19. Confirm the race paid link is test output.
20. Confirm the Shop paid link is test output.
21. Confirm the page keeps its short-lived marker set until the visitor leaves or reloads the page.
22. Confirm a rejected call or missing paid link uses #357's fixed unknown-result stop.
23. Confirm moving directly to another event or item address on the same open screen keeps Checkout locked.
24. Stop and ask for a separate fix if an older unfinished result could affect that new address.
25. Confirm the tests use no real contact, member, order, event, Firebase, Stripe, or payment data.
26. Record the source change result.
27. Record the test result.
28. Record the merge result.
29. Record the website publication result.
30. Record the `runmprc.com` result.
31. Record the Firebase deployment result.
32. Record the Stripe result.
33. Record the outside-provider result.
34. Record the production-data result.
35. Record the checkout result.
36. Record the payment result.
37. Record the live-behavior result.

**Expected result:** one race or Shop page visit makes at most one call from the existing browser Checkout connection after the current page checks pass. Immediate repeats and repeats after the busy label appears are ignored. A failed page check does not set the short-lived marker. This page-only protection does not prove delivery to Firebase or Stripe, stop duplicate requests at the server, prove that Stripe acted, prove payment, or match Stripe records to website records.

**Stop conditions:** a second browser Checkout call or second call to the disabled analytics wrapper from the same made-up pair; a valid first call blocked by an earlier unaccepted waiver or disabled Shop button; the short-lived marker clearing before the visitor leaves or reloads the page; any real person, event, item, Session, checkout link, payment, Firebase record, Stripe call, production test, or provider detail; an instruction to retry after an unknown result; or a claim that source, tests, merge, preview, or green CI makes checkout safe or live.

**Success proof:** exact #503 pull request and merge commit; recorded old-source two-call failures followed by green immediate-repeat, page-check, free-participant, volunteer, race-link, Shop-link, and after-busy-label tests; unchanged reviewed lint counts; relevant full checks; independent security, payment-lifecycle, and backup-officer reviews; and an explicit statement that no website, `runmprc.com`, Firebase, Stripe/provider, production-data, checkout, payment, or live behavior was changed or verified.

**Undo:** before publication, use one reviewed revert or safe roll-forward. After any future approved publication, use the protected website release path and verify the exact published source separately from Firebase and Stripe. Never undo or test this guard by changing or creating a registration, order, Session, payment, Firebase record, or Stripe setting.

**Escalation:** event lead and shop lead, plus treasurer and platform/security owner. Use the private incident path if a live visitor may have submitted twice or a Checkout result is unknown. Add the privacy owner if any contact or transaction detail appeared. Do not paste that detail into an issue, screenshot, email, message, or AI tool.

No system-topology map changes are required. This source change adds one short-lived page marker and changes no account, permission, data store, server, provider, or publishing boundary.

## Late-registration amount format guard — SOURCE ONLY, NOT LIVE

**Purpose:** stop a missing, malformed, or out-of-range late-registration amount before the server allocates a registration identifier, writes a paid record, or asks Stripe to create a Product, Price, or Payment Link.

**Approver:** event lead plus treasurer and platform/security owner.

**Prerequisites for source review:** issues [#331](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/331) and [#359](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/359) are merged; the exact reviewed commits are named; and tests use only an invented event, invented runner, and mocked Stripe methods. Paid late registration and the complete Admin action system remain **NOT AVAILABLE YET**. The private inventory in [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) is required before any deployment or data repair. PAY-001D still owns the complete admin request schema, and full PAY-004C still owns one-off paid Checkout plus cleanup of legacy Payment Links. These guards do not approve a price or make that flow safe.

```mermaid
flowchart LR
    A["Made-up late-registration request passes earlier access and availability checks"] --> B["Read the amount without conversion"]
    B --> C{"Exact whole-number cents?"}
    C -- "No, below 50 unless zero, or over eight digits" --> D["Fixed stop result; no identifier, registration write, or Stripe method"]
    C -- "Exact zero" --> E["Existing path creates a local record marked paid without Stripe"]
    C -- "50 through 99,999,999" --> F["Fixed paid-unavailable result; no identifier, write, Stripe client, or link"]
    E -. "Not payment, free, comp, or membership authority; not live" .-> G["PAY-001D and full PAY-004C remain open"]
    F -. "One-off paid Checkout and legacy-link cleanup still required" .-> G
```

Text alternative: after earlier access and availability checks, malformed amounts stop with the format result. Exact zero still creates a local record marked paid without Stripe; that is not proof of payment or authority to call the registration free or comp. Every valid positive amount now stops with the paid-unavailable result before identifier allocation, writes, Stripe construction, or a link. Paid late registration is unavailable for officer use.

Officer source-review steps:

1. Keep late registration and every Admin registration action marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #331 and #359 pull requests, merge commits, and synthetic test results.
3. Confirm the test uses only an invented event and runner plus mocked Stripe methods.
4. Confirm missing values, text or objects that only look like numbers, values from 1 through 49 cents, fractions, negative values, and values over eight digits receive exactly `Invalid late registration amount`.
5. Confirm a rejected amount is not opened, transformed, printed, or copied into the result. Ask the specialist to keep the detailed object-safety proof in the synthetic test report.
6. Confirm a rejection allocates no registration identifier, writes no event or registration record, and calls no Stripe Product, Price, or Payment Link method.
7. Confirm exact zero still creates the legacy local record marked paid without Stripe. Do not treat that record as payment evidence, call it free or comp without approved authority, or treat any technical boundary as an approved price.
8. Confirm 50 cents, an ordinary positive amount, and 99,999,999 cents now receive exactly `Paid late registration is not available`.
9. Confirm every positive amount stops before registration identifier or token allocation, Firestore writes, Stripe construction, Product/Price/Payment Link calls, URL return, prompts, or logs.
10. Record source change, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe/provider state, production data, and live behavior as separate results.

**Expected result:** malformed late-registration amounts fail closed with one plain format result and no registration or provider side effect. Every valid positive amount fails closed with the fixed paid-unavailable result and no identifier, token, write, provider method, URL, prompt, or log. Exact zero retains the legacy local record marked paid without Stripe and is not payment, free, comp, or membership authority. These guards neither approve a business price nor supply one-off Checkout, legacy-link cleanup, capacity, idempotency, reconciliation, authorization, or deployment.

**Stop conditions:** any real runner, event, price, payment, Firebase record, Stripe object, provider call, or production test; a request to enter or repair a value directly in Firestore or Stripe; a missing exact commit; an amount derived from an unapproved browser choice; a rejection that allocates or writes anything; or a claim that source, tests, merge, preview, or a green workflow proves late registration is safe or live.

**Success proof:** exact #331 and #359 pull requests and merge commits; their recorded old-source failures; green synthetic boundary, Functions, Rules, commerce-emulator, frontend, safety, and build checks; independent security, compatibility, and backup-officer reviews; and a written statement that website publication, `runmprc.com`, Firebase, Stripe, provider configuration, production data, and live behavior were not changed or verified. Any future live release needs separate approved price authority, one-off payment design, Firebase deployment/readback, Stripe test-mode proof, reconciliation, and rollback evidence.

**Undo:** before any Firebase deployment, use one reviewed source-and-guide revert or safe roll-forward. After any Firebase Function deployment, use the protected backend release path or a reviewed safe roll-forward, then verify the exact Function revision, provider readback boundary, and made-up test-mode behavior. Record website publication, `runmprc.com`, Stripe/provider state, and production-data state separately. Never undo by changing an event, registration, paid status, Product, Price, Payment Link, or payment record by hand.

**Escalation:** event lead plus treasurer and platform/security owner. Add the privacy owner if runner or event details appeared. Use the private incident path if a malformed request might have created a registration or provider object. Do not copy private details or provider identifiers into an issue, screenshot, email, message, or AI tool.

No system-topology map changes are required because these source slices add stop boundaries and change no account, permission, data-store, provider, or deployment topology. The small diagram above records the current zero and positive branches.

## Paid late-registration containment — SOURCE ONLY, NOT LIVE

**Purpose:** keep officers from creating or sharing a reusable paid late-registration link while the one-off Checkout design is unfinished.

**Approver:** event lead plus treasurer and platform/security owner.

**Prerequisites:** issue [#359](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/359) is merged; the exact reviewed commit and synthetic test report are named; and no website, Firebase, Stripe, or production-data action is mixed into the source review. The private legacy-link inventory remains owner work under [#113](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/113) and full PAY-004C.

```mermaid
flowchart LR
    A["Reviewer opens the made-up source-only screen"] --> B["Only a $0 legacy local form is shown"]
    B --> C["Synthetic website test sends exact zero; no amount or tier choice"]
    C --> Q{"Response confirmed?"}
    Q -- "Yes" --> D["Server writes the legacy local record without Stripe"]
    Q -- "Rejected or unavailable" --> U["Fixed outcome-unknown stop; hide the roster and every action; no same-page retry"]
    X["Any positive scripted request"] --> Y["Fixed paid-unavailable stop before allocation, write, or Stripe"]
    D -. "Not payment, free, comp, or membership proof" .-> Z["Paid late registration remains NOT AVAILABLE YET"]
    U -. "The record may or may not exist; stop and escalate" .-> Z
    Y -. "Do not create a manual link" .-> Z
```

Text alternative: in source review with made-up data, the screen can request only the exact-zero legacy local record. A confirmed response reloads the roster. A rejected or unavailable response does not prove whether the record exists, so the screen shows one fixed stop, hides the roster and every action, and prevents a same-page retry. Any positive scripted request stops before registration allocation or Stripe. This is not a live officer procedure. Officers must not create a manual Stripe link; paid late registration remains unavailable.

Officer source-review steps:

1. Keep paid late registration marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #359 pull request, merge commit, red proof, and green synthetic test report.
3. Confirm the source-only Admin screen says `Late registration — $0 only`.
4. Confirm the form has runner fields only.
5. Confirm there is no amount field, price-tier choice, Payment Link instruction, or copy prompt.
6. Confirm the website request contains exact zero and the compatibility `nonMember` label only.
7. Confirm the server gives every admitted positive amount exactly `Paid late registration is not available`.
8. Confirm that positive stop occurs before identifier/token allocation, Firestore writes, Stripe construction, Product/Price/Payment Link calls, URL return, or logs.
9. Confirm exact zero performs no Stripe call and returns no payment link.
10. Make the made-up exact-zero request reject with an ordinary synthetic detail. Confirm the screen shows only `We could not confirm this $0 late registration. Do not try again on this page. Stop and contact the event lead, treasurer, and platform owner.`
11. Confirm the rejection detail is not inspected, shown, logged, or sent to analytics.
12. Confirm the modal, event and runner details, totals, filters, table, export, and every registration action disappear.
13. Confirm an equivalent same-page rerender does not restore a control, repeat the request, or reload the roster.
14. Treat that rejected result as unknown. The local record may or may not exist. Do not repeat the request, edit Firestore, or call it a confirmed failure.
15. Record source, tests, merge, website publication, `runmprc.com`, Firebase deployment, Stripe/provider state, legacy-link inventory, production data, and live behavior as separate results.

**Expected result:** new source cannot create or reveal a paid reusable late-registration link. The visible screen is $0-only, and positive scripted input fails closed. A rejected exact-zero request becomes one accessible outcome-unknown stop with no rejected detail, stale roster, action control, automatic reload, or same-page retry. The exact-zero record remains a legacy local compatibility result and proves neither payment nor an approved free/comp or membership decision.

**Stop conditions:** any real runner, event, payment, registration, Firebase record, Stripe object, provider call, production test, manual Dashboard link, old link click, or request to paste a link or identifier; any positive request that allocates, writes, calls Stripe, returns a URL, prompts, or logs; a rejected exact-zero request that shows technical detail, keeps stale roster or action controls, reloads automatically, or can be repeated on the same page; a request to check or repair the unknown result directly in Firestore; or any claim that source, tests, merge, preview, or green CI proves the containment is live.

**Success proof:** exact #359 pull request and merge commit; recorded 3-failure server red proof plus the old frontend rejection-detail failure, followed by green positive/zero/malformed server tests and actual-route $0-only, no-prompt, fixed-alert, hostile-rejection, hidden-state, and no-repeat tests; relevant full Functions, frontend, Rules, isolated commerce, safety, lint, type, and build checks; independent security, compatibility, accessibility, and backup-officer reviews; and explicit separate results for website, `runmprc.com`, Firebase, Stripe/provider, legacy links, production data, and live behavior.

**Undo:** before any publication, use one reviewed revert or safe roll-forward. After a future approved website or Firebase publication, use the matching protected release path and verify each exact revision separately. Never undo by creating, enabling, sending, paying, editing, or deleting a Payment Link, registration, payment record, or Firestore document by hand.

**Escalation:** event lead plus treasurer and platform/security owner. Use the private incident path if a reusable link may still be active, was shared, or may have been paid more than once. Add the privacy owner if runner or link details appeared. Do not place any link, runner detail, provider identifier, or payment detail in an issue, screenshot, email, message, or AI tool.

The small diagram records the changed late-registration screen and source data path. Account ownership, permissions, data stores, hosting, and provider topology do not change. Full PAY-004C still owns one-off paid Checkout, legacy-link inventory/deactivation/reconciliation, and protected release.

## Profile permission error

**Status: AUTOMATIC REPAIR NOT LIVE YET**

**Purpose:** help a signed-in member whose profile is missing or cannot be read.

**Approver:** membership lead plus platform/security owner.

**Prerequisites:** a new redacted incident from [Request a change](./REQUEST_A_CHANGE.md), made-up test accounts, an isolated Firebase test project, and an approved release plan. Issues [#118](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/118) and [#105](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/105) are engineering references, not places to add member details.

The planned safe flow is automatic. An officer does not create or edit the member record.

```mermaid
flowchart LR
    A["Member opens My Account"] --> B["Server checks only this member's profile"]
    B --> C{"Profile exists?"}
    C -- "Yes" --> D["Keep it unchanged"]
    C -- "No" --> E["Create one pending profile"]
    D --> F["Read through normal permissions"]
    E --> F
    F -- "Success" --> G["Edit name only; phone entry paused"]
    F -- "Failure" --> H["Hide Edit and show Try again"]
```

In words: the server preserves an existing profile or creates one pending profile for the signed-in person; editing stays hidden unless the normal read succeeds, and the temporary privacy pause permits name editing only.

Safe officer steps:

1. Ask the member to stop retrying Save.
2. Record the time and the public `/account` page address.
3. Do not record their name, email, phone, login code, or screenshot of profile details.
4. Ask them to choose **Sign out** once.
5. If the page does not clearly leave My Account, assume they are still signed in.
6. Ask them to close the browser.
7. Ask them not to let anyone else use that device until the membership lead or platform owner helps.
8. Keep the safer source behavior below marked [NOT LIVE](#my-account-sign-out-result--source-only-not-live) until exact website proof exists.
9. Open a new redacted incident through [Request a change](./REQUEST_A_CHANGE.md).
10. Use #118 only as engineering context. Do not add member incidents or private details to it.
11. Wait for the platform owner to test with a made-up account.
12. Tell the member to retry only after the website, server Function, database permissions, and live behavior are each proven.

**Expected result:** after all release proof is complete, the member sees a profile or a plain temporary-unavailable message. A missing profile is displayed as pending or unverified. The repair does not grant, remove, or change actual access. If displayed profile status and actual access disagree, stop and escalate.

**Stop conditions:** stop if anyone proposes a direct database change, login-account deletion, account recreation, role grant, real-member test, or website-only release before the server Function is live.

**Success proof:** name the merged pull request, website commit, Function deployment, database-permission deployment, made-up staged account test, `runmprc.com` check, and separate live-state check. A green workflow with “skipping Firebase deploy” is not proof.

**Undo:** ask the platform owner to prepare, approve, publish, and verify a reviewed revert or safe roll-forward. Never undo by deleting a member profile or login account.

**Escalation:** membership lead plus identity/security owner. Add the privacy owner if private information appeared. Email landing in spam is a separate delivery problem; do not treat it as proof of this permission failure.

## My Account sign-out result — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** hide account details immediately and give one truthful retry when the website cannot confirm sign-out.

**Approver:** membership lead plus identity/platform owner. Add the privacy owner if account details appeared when they should have been hidden.

**Prerequisites:** issue [#368](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/368), its exact reviewed pull request and merge commit, and tests that use only made-up accounts and results. Calling this behavior published on the website also requires a protected website publication and a separate exact `runmprc.com` revision check. Those checks prove only that the reviewed website version is present. They do not prove a real sign-out, removal of an active sign-in, or sign-out on another device. The source review must not use a real account or active sign-in. It does not change Firebase settings, provider settings, production data, or sign-ins on another device.

```mermaid
flowchart TD
    A["Member chooses Sign out once"] --> B["Hide private My Account details immediately"]
    B --> C["Show Signing out; disable the control"]
    C --> D{"Current sign-out request"}
    D -- "Finishes without an error" --> E["Stay private and pending"]
    E --> F{"Website sign-in state changes to signed out?"}
    F -- "Not yet" --> E
    F -- "Yes" --> G["Automatic redirect leaves My Account"]
    D -- "First request cannot confirm sign-out" --> H["Say result is unconfirmed; allow one retry"]
    H --> I["Member chooses retry once"]
    I --> J["Hide details; disable the control"]
    J --> K{"Current sign-out request"}
    K -- "Finishes without an error" --> E
    K -- "Second request cannot confirm sign-out" --> L["Assume still signed in"]
    L --> M["Close browser; stop device use; get help"]
```

Text alternative: the first choice immediately hides private details and blocks repeats. A request that finishes without an error does not prove sign-out. Only the current website sign-in state changing to signed out confirms sign-out to My Account and causes its automatic redirect. Simply leaving the page does not prove sign-out. If the first request cannot confirm sign-out, the page allows one retry. If the second request cannot confirm sign-out, the member must close the browser, stop use of that device, and get help.

Backup-officer source-review steps:

1. Keep this procedure marked **NOT AVAILABLE YET**.
2. Obtain the exact #368 issue, reviewed pull request, merge commit, and made-up test evidence.
3. Confirm the tests use only made-up accounts and a made-up sign-out result that does not contact Firebase.
4. Confirm the first choice immediately hides every private My Account surface.
5. Confirm the pending result says `Signing out. Keep this page open.`
6. Confirm the pending result disables the control.
7. Confirm a request that finishes without an error stays private and pending.
8. Confirm the first request that cannot confirm sign-out says `We could not confirm sign-out. You may still be signed in. Try sign out once more.`
9. Confirm the retry locks immediately.
10. Confirm the second request that cannot confirm sign-out says `We still could not confirm sign-out. You may still be signed in. Close the browser and do not let anyone else use this device until the membership lead or platform owner helps.`
11. Confirm a third request is not possible.
12. Confirm failed-request details do not reach the page, browser developer logs, tracking tools, or browser storage.
13. Record source, tests, merge, website publication, `runmprc.com`, Firebase, provider, production data, and live behavior as separate results.

**Expected result:** the first sign-out choice hides all private details immediately. Only one retry is possible. A request that finishes without an error is not shown as success. Only the current website sign-in state changing to signed out confirms sign-out to My Account and triggers its existing redirect. Leaving the page alone does not confirm sign-out.

**Stop conditions:** a real account or active sign-in; a production sign-out test; a raw error detail; private details that remain visible; more than one retry; a claim that closing the browser proves sign-out or removes another active sign-in; or a claim that source, tests, merge, preview, or green CI proves live behavior.

**Success proof:** exact #368 issue, pull request, merge commit, recorded tests that failed against the old source, green tests with made-up data, relevant full checks, and independent security and backup-officer reviews. Record website publication and exact `runmprc.com` proof separately. Record Firebase, provider, production-data, and live actions as not performed unless each has separate evidence.

**Undo:** before publication, use one reviewed revert or safe roll-forward. After a future publication, use the protected website rollback path and verify the exact revision. Never edit sign-in accounts, active sign-ins, profiles, or provider settings as an undo.

**Escalation:** membership lead plus identity/platform security owner. Add the privacy owner and use the private incident path if any account detail appeared.

This local state diagram records the changed My Account display. The change does not alter who owns accounts, what permissions exist, where data moves or is kept, or how the website is published. The system maps therefore stay unchanged.

## My Account phone collection pause — SOURCE ONLY, NOT LIVE

**Purpose:** stop My Account from accepting another phone number while the club reviews why it collects phone data, who can access it, how long it is kept, and whether the live Firebase boundary matches the reviewed source.

**Approver:** membership lead plus privacy/platform owner.

**Prerequisites:** reviewed source issues [#178](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/178) and [#197](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/197), a private redacted incident record under #112, the authorized service inventory under #113, made-up test data, and the protected backend-first release path. Do not put a member's number, spam message, screenshot, or provider record in GitHub, email, or AI.

```mermaid
flowchart LR
    Account["Member opens My Account"] --> Setup{"Profile exists?"}
    Setup -- "Yes" --> Read["Read this member's profile"]
    Setup -- "No" --> New["Create one pending profile\nwith an empty phone field"]
    New --> Read
    Read --> Name["Display and edit name"]
    Read --> Pause["Do not display or accept phone"]
    Name --> Rules["Firebase Rules allow name-only update"]
    PhoneAttempt["Browser tries a phone change"] --> Deny["Firebase Rules deny"]
    Pause --> Existing["Existing stored value stays unchanged"]
```

In words: signup or profile recovery creates a missing pending profile without copying a phone from Firebase Auth; My Account shows and edits the member's name, does not display or accept a phone number, and leaves every existing profile unchanged; the reviewed Rules deny a browser phone change.

Officer steps after every prerequisite has proof:

1. Tell members not to add a phone number in My Account.
2. Do not ask whether a member already has a number stored.
3. Do not copy a number or spam message into an issue, email, screenshot, or AI tool.
4. Keep the Google membership form, event registration, shop, and provider review separate; this source change does not alter them.
5. Ask the platform owner to identify the exact merged website, Rules, and profile-Function revisions.
6. Require the reviewed Rules and both profile Functions to deploy and pass readback before the website is published.
7. Ask the platform owner to use one made-up staged Auth account with a synthetic phone and no profile to prove the new pending profile stores no copied phone; then prove name-only editing and browser phone-write denial.
8. Check the exact website revision on `runmprc.com` without opening a real member profile.

**Expected result:** a newly created pending profile has the empty phone field even if the made-up Auth account has a phone. My Account contains no phone value, phone input, or phone browser autocomplete. A name-only change succeeds. A direct non-empty phone change is denied. Existing profiles, membership, payment status, and external forms/providers remain unchanged.

**Stop conditions:** a real member profile, a provider Console change, a database export, a request to inspect or delete stored numbers, skipped/partial Rules or profile-Function deployment, website publication before backend proof, or a proposal to treat spam timing as proof of a breach.

**Success proof:** exact #178 and #197 pull requests and merge commits; green synthetic frontend, Functions, emulator, and Rules tests; exact Rules and profile-Function deployment/readback; later website publication record; separate `runmprc.com` revision check; and a dated made-up phone-free bootstrap/name-only/phone-denial check. Google, Sentry, Stripe, and other provider evidence remains separate and private.

**Undo:** use one reviewed revert or safe roll-forward through the same backend-first gate. Do not restore browser collection or Auth-phone copying until #110 approves its purpose, notice, access, and retention, and #113/#133/#136 prove the intended live boundary.

**Escalation:** membership lead plus privacy/platform owner; use the private incident path under #112 if exposure is suspected.

## Provider-neutral membership authority — SOURCE ONLY, UNUSED

**Status: NOT AVAILABLE YET**

**Purpose:** keep a club membership separate from the account or outside service a person uses, so email, Google, WhatsApp, Strava, and a website role cannot accidentally grant membership, discounts, or officer access.

**Approver:** membership lead plus treasurer and privacy/security owner.

**Prerequisites:** issue [#208](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/208) and its command-order correction in [#451](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/451) must be merged at the exact reviewed commits for source review. Before any officer or member can use this model, #110 must approve data purposes and retention, a focused #114 child must approve term/payment rules, the identity/admin work must approve who may link or remove a website account, and reviewed Firebase schema, Rules, Functions, deployment, readback, and made-up staged behavior must all have proof. #113 separately owns legacy-source disposition. Neither source issue completes those runtime prerequisites.

```mermaid
flowchart TD
    Record["Stable club membership"] --> Change["Record a term decision or explicit account link; either may happen first"]
    Account["Website account"] --> Change
    Change --> Link{"Exact account link present?"}
    Link -- "No or conflicting" --> No["No member access"]
    Link -- "Yes" --> Term{"Latest term decision?"}
    Term -- "Decision pending" --> Wait["No access decision yet"]
    Term -- "Future, expired, suspended, or ended" --> No
    Term -- "Approved and current" --> Current["Current-member result"]
    Outside["Email / Google / WhatsApp / Strava / website role"] -. "Cannot grant membership" .-> No
```

In words: the future system starts with a stable club membership. A versioned term decision and the deliberate link to one website account may be recorded in either order. An unlinked membership grants no access even when its term is approved and current; linking it later preserves the latest term. The current-member result appears only when the exact account link and a complete approved current term are both present. Missing, conflicting, undecided, future, expired, suspended, or ended state does not grant access. Email, sign-in method, community channels, and website roles are never proof of membership.

Officer review steps after the source merge:

1. Keep every membership activation, renewal, discount, roster, and outside-channel action marked **NOT AVAILABLE YET**.
2. Do not grant a website role as a workaround.
3. Do not edit a database record as a workaround.
4. Do not match an account by email as a workaround.
5. Do not create a second account as a workaround.
6. Ask the platform owner to show the exact #208 and #451 reports using only made-up, non-identifying reference values.
7. Confirm one or more monotonic term decisions may be recorded before an account link and that the membership still returns no website entitlement while unlinked.
8. Confirm a later explicit made-up account link preserves the latest term and returns the fixed current-member result only when that term is approved and inside its explicit start/end range.
9. Confirm the original link-first order still returns `decision pending` until a complete term decision is supplied, then reaches the same result from the same final facts.
10. Confirm a different account, missing decision, future or expired range, suspension, ending, out-of-date or conflicting update, or changed immediate retry fails closed without exposing an identifier.
11. Confirm a second attempt to link the same or another website account to one membership fails, even when the update is otherwise current.
12. Confirm the reports contain no provider call, database write, claim/role change, migration, backfill, log, website route, or production record.
13. End the source review without describing the contract as a working membership system or choosing calendar, grace, price, plan, refund, dispute, or retention policy.

**Expected result:** officers can explain the future authority boundary in plain language. The unused source accepts both term-first and link-first ordering, preserves the latest term when an account is linked later, grants nothing while unlinked, and returns a fixed non-identifying result only when both prerequisites are satisfied. Current website accounts, roles, dues forms, discounts, and external channels behave exactly as before.

**Stop conditions:** any real member/account/payment/provider data; a request to infer membership from email or role; an unresolved policy choice; a direct Auth, Firestore, claim, or production edit; missing dependency/deployment proof; or a statement that green tests mean member access is live.

**Success proof:** exact #208 and #451 issues, pull requests, reviewed commits, focused synthetic reports proving both command orders and the no-entitlement-while-unlinked rule, full repository checks, two independent exact-diff reviews, and a source scan showing the module is not connected to any live Function entry point. Future availability additionally requires separately approved policy, schema, authorization, cross-record account-link uniqueness, durable command replay protection, migration decision, protected Firebase deployment/readback, made-up staging test, website publication, `runmprc.com` verification, and backup-officer walkthrough.

**Undo:** before runtime adoption, revert or safely roll forward only the reviewed #451 source/test changes and these named documentation sections through a reviewed pull request. There is no production record, migration, or backfill to repair. After any future adoption, use that child's documented rollback; never undo membership by changing a claim or database record by hand.

**Escalation:** membership lead plus treasurer and privacy/security owner. Add the platform owner for source/deployment evidence and use the private incident path if real data or unintended access is involved.

## Provider-link lifecycle reconciliation — SOURCE ONLY, UNUSED

**Status: NOT AVAILABLE YET**

**Purpose:** define how a future provider-account record can distinguish a requested link or unlink from what the provider has confirmed, without treating email, Google, WhatsApp, Strava, or that record as proof of membership, discounts, payment, a website role, or officer access.

**Approver:** membership lead plus privacy/security and platform owners.

**Prerequisites:** issue [#445](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/445), its reviewed pull request, and its exact merge commit are required for source review. The pure classifier from [#367](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/367) and current-consent contract from [#370](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/370) are its source dependencies. Use only made-up references that contain no member or provider information. Approved data purpose and retention under #110, legacy migration under #113, authorization, cross-account uniqueness, storage, provider wiring, protected deployment, readback, and live verification remain future prerequisites.

```mermaid
flowchart TD
    Start["Made-up current snapshot + command"] --> Check{"Exact and current?"}
    Check -- "No" --> Stop["Fixed rejection; no private detail"]
    Check -- "Exact latest retry" --> Same["Same frozen snapshot"]
    Check -- "Valid new command" --> Kind{"Command type?"}
    Kind -- "Consent or requested state" --> Local["Update safe local intent"]
    Kind -- "Reconciliation evidence" --> Result{"Provider result"}
    Kind -- "Change provider account" --> Replace{"Requested and confirmed unlinked?"}
    Result -- "Success" --> Known["Record the requested known state"]
    Result -- "Definitive failure" --> Keep["Keep the last known state"]
    Result -- "Outcome unknown" --> Unknown["Keep the request; mark provider state unknown"]
    Replace -- "Confirmed unlinked" --> Reset["Start the new account with unknown provider state"]
    Replace -- "Linked or unknown" --> Stop
    Same --> NoAuthority["Never grants authority"]
    Local --> NoAuthority
    Known --> NoAuthority
    Keep --> NoAuthority
    Unknown --> NoAuthority
    Reset --> NoAuthority
    Stop --> NoAuthority
```

Text alternative: the future source rejects malformed or stale input, treats an exact latest retry as read-only, handles local intent, provider evidence, and account replacement as separate commands, preserves uncertainty instead of guessing success, permits replacement only after confirmed unlink, and never grants membership or any other authority.

Backup-officer source-review steps:

1. Keep this procedure marked **NOT AVAILABLE YET**.
2. Obtain the exact #445 issue, reviewed pull request, merge commit, and synthetic test report.
3. Confirm the report uses only made-up references and labels that contain no name, email, phone, provider identifier, URL, error, or token.
4. Confirm the made-up test matrix applies the same provider-neutral contract to email/password, Google, WhatsApp, and Strava values; no live provider uses it yet.
5. Confirm a new snapshot requests unlinked state but marks the provider observation unknown.
6. Confirm the existing classifier blocks link action unless the current consent result is active; ordered provider evidence may still be recorded without granting authority.
7. Confirm a consent change does not silently make a provider call or create an unlink request.
8. Confirm an exact latest command retry returns the same frozen record. The source recomputes a SHA-256 fingerprint, which is a fixed-length one-way summary of the command type and safe payload fields; it checks the expected record version separately.
9. Confirm a changed command with the same ID, stale version, skipped result number, wrong account, reversed in-flight request, or delayed link/unlink result is rejected or marked unknown with one fixed safe boundary.
10. Confirm success records only the requested known state.
11. Confirm a definitive failure keeps the last known state and stores only a fixed error code.
12. Confirm an unknown outcome keeps the requested state but marks provider observation unknown.
13. Confirm a different provider account is accepted only after unlink is both requested and confirmed.
14. Confirm the replacement starts with unknown provider state and cannot accept a delayed result for the old account.
15. Confirm collision, consent, and drift decisions come from the already reviewed #367 classifier.
16. Confirm every record and verdict says it grants no authority.
17. Confirm the module has no runtime import, provider call, database action, claim or role change, route, interface, migration, deployment, log, or production record.

**Expected result:** the unused synthetic contract can represent ordered link, unlink, relink, failure, uncertainty, collision, and safe account replacement without granting authority. Current signup, membership, discounts, email/password, Google, WhatsApp, Strava, officer screens, provider accounts, and website behavior remain unchanged.

**Stop conditions:** any real member or provider data; a raw provider error, response, URL, token, email, phone, name, or screenshot; a production inspection; a manual database or provider action; a request to choose consent, retention, relink, or migration policy; missing prerequisite evidence; or a claim that source, tests, a pull request, merge, or green workflow makes this live.

**Success proof:** exact #445 issue, pull request, reviewed merge commit, focused and full test/lint reports, and the source-isolation scan. Record website publication, `runmprc.com` verification, Firebase deployment, outside-provider configuration, production-data changes, migration, and live behavior separately as **not performed** for this source-only issue.

**Undo:** before runtime adoption, use one reviewed revert or safe roll-forward for the two unused module/test files and these named documentation sections. No production record repair exists. Any future runtime child must provide its own data-safe rollback.

**Escalation:** membership lead plus privacy/security and platform owners. Use the private incident route if real data, unintended authority, or a provider action appears.

No system-topology map changes are required because this unused contract changes no data movement, permissions, account ownership, or deployment topology.

## Consent-decision receipts — SOURCE ONLY, UNUSED

**Status: NOT AVAILABLE YET**

**Purpose:** let a backup officer review whether unused source preserves the order of made-up technical grant/withdrawal decisions without treating a receipt as membership or legal proof.

**Approver:** membership lead plus privacy/security and platform owners.

**Prerequisites:** issue [#447](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/447), its reviewed pull request, and exact merge commit are required for source review. The existing consent-state source under [#370](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/370) must remain the only classifier. Use made-up typed references only. Purpose, notice, access, provider disclosure, retention, deletion, backup, request behavior, and public wording remain owner decisions under #110. Provider-specific capture remains #87; legacy disposition remains #113. Actor authorization, trusted capture facts, create-only persistence, durable all-history uniqueness, Firestore Rules, deployment/readback, and live verification are also future work.

A “grant” or “withdrawal” here is only a bounded caller-supplied technical decision value. The receipt is not evidence that a person was informed, authorized, or legally consented.

In this section, a **head** is the small caller-supplied summary of the latest technical decision. A **revision** is its whole-number sequence counter. A **typed reference** is a made-up identifier with a fixed format and no person or provider detail. **Frozen** means the test report shows the returned value cannot be changed in place. The source checks structure relative to the head it receives; it cannot prove that a complete, internally consistent head is genuine or came from the club's canonical records. Trusted authorization and create-only storage are required before any future runtime may rely on it.

```mermaid
flowchart TD
    M["Made-up head + made-up grant or withdrawal command"] --> C{"Exact current or latest retry?"}
    C -- "No" --> S["Fixed safe stop"]
    C -- "Exact latest retry" --> R["Same made-up receipt and head"]
    C -- "Valid next decision" --> A["One new technical receipt; head advances once"]
    A --> H["Current made-up head"]
    R --> H
    Q["Separate projector check + made-up required policy version"] --> P["Existing #370 source classifies"]
    H --> P
    R --> N["Never grants authority"]
    P --> N
    S --> N
```

Text alternative: using made-up values only, the unused source checks one ordered technical grant or withdrawal decision, treats an exact latest retry as read-only, or advances the bounded head once. In a separate check, a made-up required policy version and the current head go to the existing #370 source for classification. Malformed or conflicting input stops safely. The source does not authenticate the supplied head, ask a person for consent, contact a provider, store a durable history, or prove informed consent, authorization, notice delivery, provider acceptance, legal compliance, or live behavior; it never grants membership or access.

Backup-officer source-review steps:

1. Keep this procedure marked **NOT AVAILABLE YET**.
2. Obtain the exact #447 issue, reviewed pull request, merge commit, and synthetic test report.
3. Confirm every example uses made-up typed references with no name, email, phone, account, provider identifier, URL, token, error, policy text, or real decision.
4. Confirm the same source accepts the four already reviewed provider categories without adding a provider-specific rule.
5. Confirm an empty made-up head has revision zero and no latest receipt.
6. Confirm the first made-up grant or withdrawal creates one frozen technical receipt at revision one.
7. Confirm each later technical receipt advances exactly one revision and names the prior receipt.
8. Confirm a grant, withdrawal, and later grant remain separate receipts; the earlier made-up values do not change.
9. Confirm an exact retry of the latest command returns the same frozen head and receipt without adding a decision.
10. Confirm changed reuse of the latest command ID, a wrong track, stale or skipped revision, wrong latest receipt, unsafe revision, or malformed value stops with one fixed safe error.
11. Confirm the head contains only the latest receipt, not an ever-growing list. Separately preserved receipts and durable uniqueness remain future storage work.
12. Confirm a reused older command or receipt ID is not detectable from this bounded head and remains the future create-only storage layer's responsibility.
13. Confirm a complete but rewritten head can pass structural checks; the source alone cannot prove authenticity or canonical history.
14. Confirm a separate projector check sends an empty head, current grant, grant under another required policy version, and withdrawal to the real #370 source and gets not consented, active, reaffirmation required, and withdrawn.
15. Confirm policy versions are compared only for equality; no date, ordering, notice, legal rule, or provider rule is inferred.
16. Confirm every head, receipt, and result says it grants no authority.
17. Confirm the source has no actor field, timestamp, notice or policy text, provider call, database action, role or claim change, route, interface, migration, deployment, log, or production record.
18. End the review without describing the receipt as captured consent, an audit trail, provider acceptance, legal proof, a working member feature, or live behavior.

**Expected result:** relative to one caller-supplied made-up head, the unused synthetic source can advance one technical decision, return an exact latest retry unchanged, stop visible conflicts safely, and separately ask the existing #370 source for the current technical disposition. It does not establish that the supplied head is genuine or complete. Current signup, membership, discounts, email/password, Google, WhatsApp, Strava, officer screens, data stores, provider accounts, and website behavior remain unchanged.

**Stop conditions:** any real person, decision, member, or provider data; policy or notice text; a timestamp presented as legal evidence; a production inspection; a database or provider action; a request to choose access, retention, deletion, withdrawal, capture, or migration policy; missing prerequisite evidence; or any claim that source, tests, a pull request, merge, or green workflow makes the feature live or compliant.

**Success proof:** exact #447 issue, pull request, reviewed merge commit, focused and full test/lint reports, and an automated report showing that no live Function entry point imports the new source. Record website publication, `runmprc.com` verification, Firebase deployment, outside-provider configuration, production-data changes, migration, and live behavior separately as **not performed** for this source-only issue.

**Undo:** before runtime adoption, use one reviewed revert or safe roll-forward for the two unused module/test files and these named documentation sections. No production record repair exists. Any future persistence or provider child must provide its own data-safe rollback.

**Escalation:** membership lead plus privacy/security and platform owners. Use the private incident route if real data, unintended authority, or a provider action appears.

No system-topology map changes are required because this unused contract changes no data movement, permissions, account ownership, or deployment topology.

## Membership Offer metadata containment — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** prevent the Join route's membership structured data from giving search engines or browsers a machine-readable membership price, currency, or annual term before the club approves the versioned membership plan under #114. The visible Join-page dues sentence is unchanged. The separate static `$0` Offer for the free Saturday run is not a membership Offer and remains unchanged.

**Terms:** structured data is page information embedded for search engines. `WebPage` labels the page, `SportsOrganization` labels the club, and `Offer` labels machine-readable price or term information. The separate static `Event` labels the free Saturday run.

**Approver:** membership lead plus treasurer and communications/platform owner.

**Prerequisites:** issue [#486](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/486) and its exact reviewed pull request must be merged for source review. A protected website publication and an exact revision check on `runmprc.com` are required before describing this containment as live. Any future membership `Offer` metadata requires the owner-approved term, price, household meaning, effective date, and change process under #114; visible copy alone is not that approval.

**Steps:**

1. Ask the platform owner for the exact #486 issue, pull request, and merge commit.
2. Confirm the reviewed Join route test selects the real `/joinus` WebPage schema by its URL.
3. Confirm that schema's SportsOrganization `mainEntity` has no membership `offers`, `Offer`, `price`, `priceCurrency`, or individual annual-fee description.
4. Confirm the reviewed shared Join-schema helper has the same membership omissions.
5. Confirm both tests retain the club organization and Saturday-run event metadata.
6. Confirm the visible Join page still says `Affordable membership fees: $25/individual or $30/household per calendar year`.
7. Keep the separate static `$0` Saturday-run Event Offer distinct from the removed membership Offer.
8. Record source change, tests, merge, website publication, exact `runmprc.com` revision, Firebase deployment, outside-provider configuration, membership or payment data changes, and live behavior as separate results.

**Expected result:** the reviewed Join WebPage/SportsOrganization source keeps useful club and Saturday-run metadata but publishes no machine-readable membership Offer. The separate static Event schema may still describe the Saturday run as free. No officer edits source files, changes provider settings, or changes member or payment records for this task.

**Stop conditions:** the route-owned Join WebPage/SportsOrganization schema retains a membership `Offer`, `offers`, machine-readable membership price, currency, annual-fee description, or unapproved term; the separate free-run Event Offer is confused with membership dues; visible dues copy changes; club or Saturday-run metadata disappears; #114 approval is assumed from existing copy; a provider, Firebase, payment, account, membership record, or production-data action is requested; or source, tests, merge, preview, or a green workflow is presented as proof of live `runmprc.com` behavior.

**Success proof — source completion:** exact #486 issue, pull request, reviewed merge commit, and focused and full frontend results. These prove only the reviewed source outcome.

**Success proof — live containment (separate; not authorized by #486):** a later protected website publication record and dated exact-revision check of the public `/joinus` route-owned WebPage/SportsOrganization structured data. The check identifies the separate static `$0` Saturday-run Event Offer without treating it as membership pricing. Record Firebase, Stripe or another provider, member or payment data, migration, and live membership behavior as not changed unless each has separate private evidence and approval.

**Undo:** before publication, use one reviewed revert or safe roll-forward of the two Offer-removal hunks, focused tests, and this named section. After publication, use the protected website rollback path and verify the exact public revision. Do not restore Offer metadata until #114 records the required owner decisions and a separate reviewed issue implements them.

**Escalation:** membership lead plus treasurer and communications/platform owner. Use the private incident route if machine-readable dues disclose an unintended term or any real member, payment, account, or provider data appears.

No system-topology map changes are required because this source-only removal changes no data movement, permissions, account ownership, or deployment topology.

## My Account membership truth — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop My Account from presenting website-account details or a legacy website role as proof of current paid club membership.

**Approver:** membership lead plus treasurer and privacy/security owner.

**Prerequisites:** issue [#221](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/221) must be merged for source review. A protected website release, exact revision check on `runmprc.com`, and made-up account checks are also required before describing the wording as live. A future real membership-status display still requires the policy and server-authority work under #114 and #115; #221 does not provide it.

```mermaid
flowchart TD
    Open["Member opens My Account"] --> Load{"Profile loads?"}
    Load -- "No" --> Retry["Show a plain retry or sign-out path"]
    Load -- "Yes" --> Details["Show website-account details"]
    Details --> Created["Label the date Account created"]
    Details --> Hide["Do not show a website role as Membership"]
    Details --> Notice["Say paid membership and dues status is unavailable"]
    Identity["Account creation / email verification / website access"] -. "Not membership proof" .-> Notice
    Future["Future server-authoritative membership term"] -. "NOT AVAILABLE YET" .-> Notice
```

In words: My Account may show account details, including when the account was created, but it does not turn a website role, sign-in, email verification, or website access into proof of paid membership; the page says the real membership and dues status is not available there yet.

Officer review steps after the source merge:

1. Keep membership lookup and membership changes marked **NOT AVAILABLE YET**.
2. Do not infer paid membership from a website role.
3. Do not infer paid membership from account creation.
4. Do not infer paid membership from email verification.
5. Do not infer paid membership from website access.
6. Ask the platform owner for the exact #221 synthetic test report.
7. Confirm the report covers made-up pending, member-role, and admin-role profiles.
8. Confirm `Membership` and `Member since` are absent from each made-up profile view.
9. Confirm the account date is labeled `Account created`.
10. Confirm every made-up profile sees the same unavailable-status notice.
11. Confirm email verification remains a separate account action.
12. Confirm profile recovery, name editing, phone pause, events, Strava, and sign-out are unchanged.
13. Require a protected website publication before calling the wording live.
14. Check the published revision on `runmprc.com` without opening a real member account.

**Expected result:** the source page shows account facts without displaying a legacy role as membership. It uses `Account created`, not `Member since`. Every loaded profile sees one plain notice that paid membership and dues status is not available in My Account and that account creation, email verification, and website use do not prove current club membership. No actual membership, dues, entitlement, payment, role, provider, or member record changes.

**Stop conditions:** a real member account; a request to confirm dues or membership from the page; a manual role or database change; a change to membership policy; a Firebase, payment, Google, WhatsApp, Strava, or other provider action; skipped website publication; or a claim that source, tests, merge, or a green workflow alone proves the wording is live.

**Success proof:** for source completion, record the exact #221 issue, pull request, reviewed commit, focused account tests, full frontend checks, and merge commit. For live availability, separately record the website publication, the published revision, and a dated `runmprc.com` check with made-up accounts. Record Firebase deployment, outside-provider configuration, and production-data changes as **not performed** for this wording-only correction.

**Undo:** before publication, revert or safely roll forward the three #221 source/documentation paths through review. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com`. Never undo by changing a role, membership, payment, or database record.

**Escalation:** membership lead plus treasurer and privacy/security owner. Add the platform owner for source or publication evidence. Use the private incident path if real account or membership data appears.

## My Account registration ownership — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** show a signed-in person only race registrations already linked to that exact website account.

**Approver:** event lead plus membership and privacy/platform owners.

**Prerequisites:** issues [#374](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/374) and [#553](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/553), their exact reviewed pull requests and merge commits, and tests that use made-up accounts and registrations only. Calling this behavior live also requires a protected Firebase Function deployment and readback, a protected website publication, and a separate exact revision check on `runmprc.com`. A future officer-assisted link still requires the approved evidence and audited server workflow under [#115](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/115).

```mermaid
flowchart TD
    A["Signed-in person opens My Account"] --> B["Server uses the signed-in account ID"]
    B --> C["Find registrations with that exact stored account ID"]
    C --> D["Return the registration and event summary without runner name, email, or shirt size"]
    H["Stored runner name, email, and shirt size"] --> I["Keep out of the My Account browser response"]
    E["Matching email address"] --> F["No access and no automatic link"]
    F --> G["Future reviewed officer association under #115"]
```

Text alternative: the server uses only the signed-in account ID to find registrations and returns the registration and event summary without runner name, email, or shirt size. Stored runner details stay out of the My Account browser response. A matching email address does not reveal or automatically link a registration. A future link requires a separate reviewed officer process.

Backup-officer source-review steps:

1. Keep this procedure marked **NOT AVAILABLE YET**.
2. Obtain the exact #374 and #553 issues, reviewed pull requests, merge commits, and made-up test reports.
3. Confirm the report uses only invented account IDs, people, events, and registrations.
4. Confirm a registration with the exact signed-in account ID appears.
5. Confirm the returned summary keeps every non-runner field and registration-created order.
6. Confirm the report shows that the returned Firestore document's `runner` property was not accessed.
7. Confirm runner name, email, and shirt size do not appear in the response.
8. Confirm a registration with only a matching email address does not appear.
9. Confirm a registration owned by another account does not appear, even when its email matches.
10. Confirm the server does not read the signed-in email claim or run an email search.
11. Confirm an empty result performs no event-detail read.
12. Confirm no registration, account, payment, or provider record is changed.
13. Record source, tests, merge, Firebase deployment, website publication, `runmprc.com`, production data, and live behavior as separate results.
14. If a member says a registration is missing, stop. Do not ask them to register again or change a database record.
15. Open a redacted request through [Request a change](./REQUEST_A_CHANGE.md) for the event lead and membership owner.

**Expected result:** source returns only registrations whose stored account ID exactly matches the signed-in account, and the My Account response omits runner name, email, and shirt size while preserving every non-runner summary field. Verified or matching email does not grant access. The empty page says that no upcoming registration is linked to the account and warns that a signed-out registration may not appear. This does not delete stored runner data, link an older registration, prove payment, change membership, or repair data.

**Stop conditions:** a real member or registration; a request for an email address, confirmation link, payment detail, registration screenshot, or database lookup; a manual Firestore edit; asking the person to pay or register again; an automatic email match; skipped Firebase or website proof; or a claim that source, tests, merge, preview, or green CI proves live behavior.

**Success proof:** exact #374 and #553 issues, pull requests, reviewed commits, recorded old-source failures, green UID-only, response-minimization, and empty-state tests, relevant full checks, and independent privacy and backup-officer reviews. For live availability, separately record the exact Function deployment/readback, website publication, `runmprc.com` revision, and a made-up account check. Record provider and production-data actions as not performed unless each has separate approved evidence.

**Undo:** before publication, use one reviewed revert or safe roll-forward. After a future approved release, use the protected backend-first rollback path and verify the Function and website revisions separately. Never undo by changing, deleting, or copying a registration, account, payment, or member record.

**Escalation:** event lead plus membership and privacy/platform owners. Use the private incident path if one account may have seen another person's registration. Add the treasurer only when approved payment evidence needs private review.

This small diagram records the changed account-read boundary. It adds no new data store, provider, role, payment decision, or deployment path, so the full system maps stay unchanged.

## Strava callback failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give a member one plain next step when a Strava connection fails or the website receives an invalid success answer, without showing a provider message, callback detail, or technical error on the page or falsely returning to My Account.

**Approver:** membership lead plus platform/security owner.

**Prerequisites:** issues [#242](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/242) and [#612](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/612) must be merged for the current source review. Calling this protection live also requires a protected website publication and an exact revision check on `runmprc.com`. These source changes do not deploy Firebase, contact Strava, change provider settings, use production data, or prove live behavior.

```mermaid
flowchart LR
    A["Made-up request is rejected"] --> F["Show the fixed failure and stay on the cleaned callback page"]
    B["Made-up answer arrives without a request error"] --> C{"Exactly the two approved visible plain fields?"}
    C -- "No or check fails" --> F
    C -- "Yes" --> D["Copy the two approved values into a new result that cannot change"]
    D --> E["Return to My Account"]
```

Text alternative: a rejected made-up request uses the fixed failure and stays on the cleaned callback page; an answer delivered without a request error does the same when it is invalid or its check fails, and returns to My Account only when it has exactly the two approved visible plain fields, which the website copies into a new result that cannot change.

Officer review steps after the source merge:

1. Keep the callback wording marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #242 and #612 issues, pull requests, merged commits, and synthetic frontend test results.
3. Confirm the tests use only made-up callback values and mocked rejected, valid, or invalid exchange answers.
4. Confirm a signed-out visitor sees only the fixed sign-in instruction.
5. Confirm a made-up provider query failure shows `We could not connect Strava. Please return to My Account and try again.`
6. Confirm a made-up request error, or an answer delivered without a request error that is not exactly `ok` set to `true` plus a positive whole-number Strava athlete field named `athleteId` that the website can represent exactly, shows the same sentence and stays on the cleaned callback page.
7. Confirm missing fields, extra fields, hidden fields, fields that run code when read, invalid athlete numbers, and exceptional answer checks use the same fixed failure without navigating.
8. Confirm no made-up provider detail, invalid answer detail, or technical error appears on the page or in browser console output.
9. Confirm a missing code or state stops in the page before exchange, and a rejected server state uses the same fixed connection-failure result.
10. Confirm only the exact made-up two-field confirmation returns to My Account.
11. Confirm the website copies those two approved values into a new result that cannot be changed instead of keeping the received answer.
12. Confirm the visible `Back to account` link still works without an exchange.
13. Confirm the failure sentence is announced as an urgent screen-reader alert.
14. Record source, tests, merge, website publication, `runmprc.com`, Firebase, Strava, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed, actionable sentence for a callback query failure, a request error, or an answer delivered without a request error that does not present exactly the two approved success fields. It does not open, inspect, display, or log a rejected request value. For an answer delivered without a request error, it checks only the structure needed to admit that answer, copies the approved values into a new result that cannot be changed, and does not keep the received answer. Only that exact result returns to My Account. Existing sign-in, missing-code, missing-state, server-rejection, exact-success, and Back-to-account behavior stays in place. A valid-looking browser answer is not independent proof that Strava exchanged the code or that Firebase saved the connection. The separate OAUTH-001C1G child adds source-only cleanup of the current browser entry before callback-specific checks or exchange, #443 adds source-only App Check readiness after that cleanup, and #441 adds the source-only server state decision. None erases earlier browser, provider, hosting, or network copies or completes issue #88.

**Stop conditions:** any real member or Strava account; a request for a callback URL, authorization code, state value, provider answer, provider error, private browser history, or screenshot containing private values; a real provider call; a production Firebase or Strava change; an invalid fulfilled answer that returns to My Account; a raw detail in the page or console; or a claim that source, tests, merge, or a green workflow proves the wording or connection is live.

**Success proof:** for source completion, record the exact #242 and #612 issues, reviewed pull requests, merged commits, intended old-source failures, green synthetic service and callback tests, relevant full checks, and independent security, lifecycle, privacy, test-quality, and backup-officer reviews. For live availability, separately record the approved website publication, the published revision, and a dated `runmprc.com` check that uses no real account or callback value. Record Firebase deployment, Strava/provider configuration, and production-data actions as **not performed** for this frontend-only change.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com`. Do not undo by changing a member account, callback value, Firebase record, or Strava setting.

**Escalation:** membership lead plus platform/security owner. Add the privacy owner and use the private incident path if any callback or provider detail appeared. Do not copy the detail into an issue, message, screenshot, or AI tool.

Issue #612 changes the local path from a received answer to navigation or failure, so the small diagram above records that decision. It does not change the full system's page structure, service-to-service data movement, permissions, account ownership, provider configuration, or deployment topology. The separate #335 procedure and diagram below record the current-address data-order change.

## Strava callback current-address cleanup — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** remove made-up Strava callback address details after `?` or `#` before the page checks the callback or starts a mocked exchange.

**Approver:** membership lead plus platform/security and privacy owners.

**Prerequisites:** issue [#335](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/335) must be merged at an exact reviewed commit. Use no real Strava account, callback, code, state, provider error, or member data. Calling this published also requires a protected website release and an exact revision check on `runmprc.com`. That still does not prove live OAuth behavior. This child does not deploy Firebase, configure Strava, call the provider, or inspect production data.

```mermaid
flowchart LR
    A["Made-up callback address details after ? or #"] --> B["Keep three selected fields in temporary page memory"]
    B --> C{"Both current entries proven clean?"}
    C -- "Not yet" --> W["Wait; no state check or exchange"]
    W -. "Detected replacement failure" .-> D["Fixed accessible stop"]
    C -- "Yes" --> E["Continue the existing sign-in, error, code, and state checks"]
    E --> F["One mocked exchange may continue"]
    G["Earlier browser, provider, hosting, or network copies"] -. "Not erased" .-> H["Back is not proof of cleanup"]
```

Text alternative: the page first cleans the current browser and page entry. While cleanup is unconfirmed, it waits without checking state or starting an exchange. A detected replacement failure shows the fixed stop. Cleaning the current entry does not erase earlier history or outside copies.

Officer review steps after the source merge:

1. Keep this procedure marked **NOT AVAILABLE YET**.
2. Ask the platform owner for issue #335, the reviewed pull request, the exact merge commit, and synthetic test results.
3. Confirm every test uses only made-up callback values and mocked services.
4. Confirm the current address has no details after `?` or `#` before any callback decision, state check, or exchange.
5. Confirm the page's current route also has no address details after `?` or `#`, or saved callback detail.
6. Confirm unconfirmed cleanup keeps waiting and performs no state check or exchange.
7. Confirm a detected failed or ineffective replacement shows one fixed accessible result.
8. Confirm that failure performs no state check and no exchange.
9. Confirm a second callback loaded into the same page is discarded and does not start another exchange.
10. Confirm a changed signed-in account or service prevents an older browser result from navigating or showing success.
11. Confirm successful cleanup preserves the existing #242 sign-in, provider-error, missing-code, invalid-state, pending, success, and fixed-failure behavior.
12. Confirm made-up values do not appear in the page, console, analytics, screenshots, or saved test artifacts.
13. Record source changed, tests passed, merged, website published, `runmprc.com` revision verified, Firebase deployed, Strava configured, production data changed, and live behavior verified as separate results.

**Expected result:** the current visible callback entry is clean before processing. A cleanup failure stops safely. Callback values exist only temporarily in page memory. A changed account or service prevents an obsolete browser result from navigating or showing success, but it does not cancel an exchange that already reached the server or provider. That outcome may still occur and need separate reconciliation. Earlier browser history, address suggestions or sync, provider records, hosting records, and network records are not erased. Back may return to an earlier page and must never be treated as proof of cleanup.

**Stop conditions:** a request for a real callback, code, state, provider error, screenshot, browser-history view, developer-tools capture, or copied address; callback details remaining after cleanup; processing after cleanup failure; a real provider or Firebase service call; or a claim that source, tests, merge, or green CI proves live behavior.

**Success proof:** for source completion, record issue #335, the reviewed pull request, exact commit, intended old-source failures, green synthetic ordering/failure/lifecycle tests, relevant full checks, and independent privacy/officer review. For publication evidence, separately record the protected website publication and exact `runmprc.com` revision. Those checks do not make this procedure available or prove production OAuth behavior. A separately approved non-production plan may prove staged behavior only.

**Undo:** before publication, use a reviewed revert or corrective pull request. After publication, use the protected website rollback process and verify the restored revision. Never paste, save, inspect, or replay an old callback address during rollback.

**Escalation:** contact the platform/security and privacy owners if callback details may have appeared outside the current clean page. Use the private incident path. Do not copy a value into an issue, message, screenshot, or AI tool.

This child keeps canonical issue #88 open and incomplete. The #443 procedure below records the later source-only clean-page App Check handoff, and the #441 procedure that follows records the source-only server state boundary. Native App Check enforcement, account and scope policy, refresh concurrency, revoke/audit behavior, IAM/encryption, provider configuration, deployment, and live verification remain separate work.

## Strava App Check handoff after cleanup — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep initial App Check startup off while a made-up Strava callback is current, then prepare it only after the current browser and page locations are clean and before one mocked server exchange.

**Approver:** membership lead plus platform/security and privacy owners.

**Prerequisites:** issues [#159](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/159), [#335](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/335), [#441](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/441), and [#443](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/443) must be merged at exact reviewed commits for the complete source review. Use only made-up callbacks and accounts with mocked Firebase and Strava boundaries. Do not use or request a real site key, App Check result, Firebase project, Strava account, callback, code, state, provider response, member record, or production data. A future staged review also requires a named owner to configure and privately verify the approved Enterprise key and allowed domains, a protected backend-first release of the exact Firebase Functions and website revisions, and approved synthetic provider evidence. None of those states is available or authorized by this source issue.

```mermaid
flowchart LR
    A["Made-up recognized Strava callback\ninitial App Check remains off"] --> B{"Locations and page state clean, and native\nRouter record exact with matching key?"}
    B -- "No" --> C["Wait or fixed stop\nno readiness and no exchange"]
    B -- "Yes" --> D["One Strava-only App Check readiness attempt"]
    D -. "Missing setup or readiness failure" .-> E["Fixed connection failure\nno exchange"]
    D --> F{"Same clean account, services, resources,\napp, attempt, and open page?"}
    F -- "Changed or reinjected while mounted" --> E
    F -- "Page closed or unmounted" --> I["Inert completion\nno exchange and no stale screen"]
    F -- "Yes" --> G["One mocked exchange with the\noriginal made-up code and state"]
    H["Authentication, registration, or shop callback"] -. "Not eligible for this handoff" .-> J["Existing callback flow unchanged"]
```

Text alternative: initial App Check startup stays off while a made-up Strava callback address or saved page detail is current. After both current locations and page state are clean, and native history is absent or contains only the matching Router index, key, and empty user state, one Strava-only readiness attempt may run. Only the same clean account, services, Firebase resources, app, attempt, Router entry, and open page may admit one mocked exchange. A missing setup, readiness failure, extra saved detail, changed mounted context, or reinjected callback before that point stops with the fixed connection failure and no exchange. Closing the page makes a pending completion inert without changing a stale screen. Authentication, registration, and shop callbacks are not eligible and keep their existing flow.

Officer review steps after the source merge:

1. Keep this procedure marked **NOT AVAILABLE YET**.
2. Ask the platform owner for issue #443, the reviewed pull request, exact merged commit, and synthetic test results.
3. Confirm every test uses invented callback and account values with mocked Firebase and Strava boundaries.
4. Confirm the initial callback starts no Enterprise provider or App Check readiness work while its address or saved page detail remains current.
5. Confirm the plain, encoded-segment, case-changed, and trailing-slash Strava callback spellings keep that same initial shutdown.
6. Confirm both the current browser location and page route match the Strava callback and have no query or fragment before readiness starts.
7. Confirm page state is empty and native history is either absent or contains only the Router index, matching key, and empty user state before readiness starts. Any extra field, accessor, non-plain value, or mismatched key must stop.
8. Confirm an authentication, registration, or shop callback cannot use this Strava-only handoff.
9. Confirm one current clean callback initializes the existing Enterprise provider at most once and waits for one readiness result before exchange.
10. Confirm the source does not give the readiness method the callback code or state and does not inspect, display, return, log, or store an App Check result or provider detail.
11. Confirm a missing public key, wrong or dirty path, Enterprise construction or initialization failure, or readiness failure shows `We could not connect Strava. Please return to My Account and try again.` and makes no exchange.
12. Confirm a changed signed-in account, service, Firebase resources, app, callback attempt, route, or Router entry key stops an older mounted readiness attempt; confirm a closed page makes its completion inert.
13. Confirm a later callback loaded into the same page is cleaned and discarded and does not start another exchange. Record that it cannot cancel server or provider work if the first exchange already started.
14. Confirm duplicate rendering, rerendering, duplicate completion, and simultaneous readiness requests produce at most one Enterprise initialization, one readiness request, and one exchange.
15. Confirm one successful current readiness result allows only the original made-up code and state to reach the existing mocked exchange once.
16. Confirm ordinary production pages keep their existing eager App Check startup and local/test runtimes keep App Check off.
17. Confirm this handoff creates no membership, dues, discount, payment, member role, or admin authority.
18. Record source changed, tests passed, code merged, website published, exact `runmprc.com` revision verified, Firebase Functions deployed and read back, Enterprise provider and allowed domains configured, provider-backed token behavior evidenced, Strava configured, production data changed, and live behavior verified as separate results.

**Expected result:** the member screen and fixed connection wording stay the same. Source keeps initial capability-callback App Check startup off, waits until the current native and page locations, page state, and exact Router history wrapper are clean, prepares App Check once for the same current Strava attempt and Router entry, rechecks that context, and then makes the existing mocked exchange once. A cleanup, setup, readiness, saved-state, or mounted lifecycle failure before exchange admission shows the fixed result and makes no exchange. An unmounted completion is inert. Other callback types cannot use this method and keep their existing flow. Once exchange starts, a later change cannot cancel work already at the server or provider; it blocks another exchange and an obsolete screen update, and reconciliation may still be needed. Local/test isolation and ordinary production-page startup remain unchanged. This is source behavior only.

**Stop conditions:** any real site key, App Check result, Firebase project, member or Strava account, callback, code, state, token, provider response, browser-history capture, developer-tools capture, production record, provider request, console configuration, deployment, or live callback; readiness before both locations and saved page state are clean; an exchange before readiness; another callback type resuming App Check; more than one initialization, readiness request, or exchange; a raw or hostile value being inspected or exposed; an obsolete completion changing the page; or a claim that source, tests, merge, preview, or green CI proves provider configuration, enforcement, deployment, or live protection.

**Success proof:** for source completion, record issue #443, the reviewed pull request, exact commit, the old-source ordering failure, green focused Firebase-resources and account-callback tests, relevant full frontend and safety checks, and independent security, privacy, lifecycle, test-quality, and backup-officer reviews. Record source, tests, and merge separately. Record website publication, exact `runmprc.com` verification, Firebase deployment/readback, Enterprise provider configuration, provider-backed token evidence, Strava configuration, production-data action, and live behavior as **not performed** unless each has separate approved evidence. A future staged result does not by itself prove production or live behavior.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After a future approved publication, use the protected website rollback only when the deployed Firebase and App Check policy remains compatible with the replacement revision; otherwise stop and use a reviewed coordinated rollback or safe roll-forward. Never undo by disabling a provider or enforcement setting ad hoc, replaying a callback, changing a member record, or copying a callback or App Check value.

**Escalation:** stop and contact the platform/security and privacy owners. Add the membership lead if a member cannot reconnect. Use the private incident path if callback, App Check, provider, account, or technical detail may have appeared, another exchange may have started, or the released website and Firebase policy may not match. Do not copy the detail into an issue, screenshot, email, message, or AI tool.

This source child changes the browser's control and data order, so the local flow diagram above records it. It adds no data store, server authority, permission, account ownership, provider configuration, or deployment topology; the full system maps remain unchanged.

## Strava one-use connection check — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** make one Strava connection attempt usable only by the same signed-in account session that started it, for ten minutes and one server use.

**Approver:** membership lead plus platform/security and privacy owners.

**Prerequisites:** issue [#441](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/441) must be merged at one exact reviewed commit. Source review uses only made-up state, account, session, and provider values with mocked Firebase and Strava boundaries. A future staged release requires the exact reviewed #443 clean-page App Check handoff, configured Enterprise evidence, and the exact begin and exchange Functions deployed and read back before the matching website revision. Initial callback suppression and #443's source readiness ordering are not proof of fail-closed runtime compatibility. An approved non-production callback rehearsal is separate provider evidence; it does not by itself prove production or live behavior. A source merge, preview, green workflow, or website-only publication is not enough.

```mermaid
flowchart LR
    A["Member chooses Connect Strava"] --> B["Server creates one short-lived challenge"]
    B --> C["Server stores digest and account-session binding only"]
    B --> D["Strava returns code and challenge"]
    D --> E["Page cleans the current address"]
    E --> I["Page awaits #443 App Check readiness"]
    I --> F{"Server consumes exact challenge once?"}
    F -- "No, expired, wrong, or repeated" --> G["Fixed stop; try again from My Account"]
    F -- "Yes" --> H["Delete challenge before provider exchange"]
```

Text alternative: the server gives the signed-in member one short-lived Strava challenge but stores only its digest and account-session binding; after the page cleans the callback address and awaits the separate #443 source readiness boundary, the server deletes one exact match before exchange, and every expired, wrong, or repeated attempt stops with the same retry path.

Officer review steps after the source merge:

1. Keep this procedure marked **NOT AVAILABLE YET**.
2. Ask the platform owner for issue #441, the reviewed pull request, exact merged commit, and synthetic test results.
3. Confirm the tests use no real member, Firebase project, Strava account, callback, code, state, token, or provider request.
4. Confirm the begin Function applies its existing App Check guard, then requires a signed-in account and a valid Auth-session marker before writing a challenge.
5. Confirm the server stores no raw challenge. The retained record contains fixed schema/provider labels, a digest, UID, session marker, issue time, and expiry only. The raw challenge must not be in the database, connection record, logs, screenshots, or issue evidence.
6. Confirm starting again replaces the earlier challenge for that same website account.
7. Confirm the callback still removes current address details and completes the separate #443 source readiness boundary before it sends the made-up code and state to the server.
8. Confirm the server transaction checks the same UID and session, the exact digest, and the ten-minute expiry, then deletes the record before any Strava request or connection write. Source tests use a mocked Strava boundary.
9. Confirm missing, malformed, wrong-account, wrong-session, mismatched, expired, repeated, and simultaneous losing attempts all stop before the provider and connection write.
10. Confirm two simultaneous made-up callbacks produce at most one provider attempt.
11. Confirm a provider or database failure after consumption does not restore or reuse the challenge; the member starts again from My Account.
12. Confirm the Connect button blocks a repeated click while start is pending, navigates only after a valid server result, and shows one plain retry result on failure.
13. Confirm account, service, or page changes make an older browser completion inert.
14. Confirm this state creates no membership, payment, discount, member role, or admin authority.
15. Record source changed, tests passed, merged, Firebase Functions deployed, website published, `runmprc.com` revision verified, Strava configured, production data changed, and live behavior verified as separate results.

**Expected result:** source permits one matching, unexpired challenge to reach the existing exchange path, which is mocked in source tests. Every invalid or repeated attempt receives one fixed failure before provider or connection work. A later start invalidates the earlier challenge. The raw challenge is returned through the server/browser/provider handoff and is never persisted server-side. This is source behavior only until both Functions and the website are released backend-first and separately verified.

**Stop conditions:** any real account, Strava account, callback, code, state, token, browser-history capture, developer-tools capture, production record, provider call, or secret; a raw challenge in storage or logs; more than one provider call for simultaneous use; website publication before both Functions are verified; missing App Check/Auth checks; or a claim that source, tests, merge, preview, or green CI proves live protection.

**Success proof:** for source completion, record issue #441, the reviewed pull request, exact commit, intended old-source failure, green begin/consume/replay/race/browser/callback tests, relevant full checks, and independent security/privacy/officer reviews. For a future staged release, separately record the protected Firebase deployment and readback, matching website publication, exact `runmprc.com` revision, approved non-production Strava configuration, and a made-up callback rehearsal. None of those results alone proves production live behavior. Do not use production data or a real member.

**Undo:** before publication, use one reviewed revert or safe roll-forward. After a future approved release, restore the previous compatible Functions and website revisions together through the protected backend-first rollback, then verify both surfaces separately. Never undo by copying, recreating, or replaying a callback value or editing a member secret record.

**Escalation:** contact the platform/security and privacy owners. Add the membership lead if a member cannot reconnect. Use the private incident path if a callback value, token, or account detail may have appeared outside the protected flow; do not copy it into an issue, message, screenshot, email, or AI tool.

## Strava connection record pairing — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep the server-only Strava token record and its matching non-secret connection record together. A database failure must save both records or neither record.

**Approver:** membership lead plus platform/security owner. Add the privacy owner if an earlier record may already be mismatched.

**Prerequisites:** issue [#329](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/329) must be merged for source review. Use only a made-up website account, made-up athlete, mocked Strava response, and mocked database. Calling this protection live also requires an approved Firebase Functions deployment and a dated deployment readback. This source change does not contact Strava, inspect or repair production records, change provider settings, or prove live behavior.

```mermaid
flowchart LR
    A["Validated made-up Strava exchange"] --> B["One Firestore batch"]
    B -- "Commit is confirmed" --> C["Server-only token and matching connection metadata appear together"]
    B -- "Confirmed before commit" --> D["Neither record changes; fixed failure result"]
    B -- "Commit result is unavailable" --> F["Both or neither may be present; stop and verify safely"]
    E["Strava provider exchange happened first"] -. "Not part of the Firestore batch" .-> B
```

Text alternative: after a made-up Strava response is validated, one Firestore batch saves the hidden token record and matching connection metadata together. A confirmed failure before commit changes neither record. If the commit result is unavailable, both records may be present or neither may be present; one record must never appear alone. Stop and use the normal safe connection check. The earlier Strava provider exchange is outside that local batch.

Officer review steps after the source merge:

1. Keep this protection marked **NOT AVAILABLE YET**.
2. Ask the platform owner for issue #329, the reviewed pull request, the merged commit, and synthetic test results.
3. Confirm every test uses only made-up values and mocked Strava and database results.
4. Confirm a successful mock creates one batch with exactly two paired record writes.
5. Confirm a mocked failure before commit changes neither record.
6. Confirm the same failure preserves an earlier matched pair without replacing only one side.
7. Confirm a mocked lost commit result can leave both records together, never only one.
8. Confirm every persistence failure gives only `Strava authorization could not be completed.`
9. Confirm no token, athlete detail, database path, rejected value, or technical error appears in the result or logs.
10. Confirm an unknown commit result says to stop and use the normal safe connection check. Do not repeat the old code.
11. Confirm the browser never receives or edits the token record.
12. Record source, tests, review, merge, Firebase deployment, provider configuration, production-data action, repair, and live behavior as separate results.

**Expected result:** reviewed source uses one database batch for the two records, so Firestore applies both or neither. A confirmed failure before commit changes neither record. A lost or rejected commit result can leave the caller unsure whether both records changed or neither changed. It must never be described as proof of no change. Every returned persistence failure uses one fixed sentence. The officer stops and asks the platform owner to verify through the normal safe connection surface before any fresh connection start.

This source slice does not make the provider exchange and Firestore one transaction. It does not make a repeated authorization code safe, decide which concurrent connection wins, verify one athlete per website account, approve scopes, repair an earlier mismatch, revoke access, add a durable audit, configure the provider, deploy Firebase, or prove live behavior. Those items remain under issue #88 and the private inventory in #113.

**Stop conditions:** any real member, Strava account, athlete, token, authorization code, provider response, database record, or production data; a request to inspect or repair Firestore manually; a real provider call; a Firebase or Strava setting change; a raw detail in a result or log; an attempt to repeat a failed code; a claim that an unknown commit result proves no change; or a claim that source, tests, merge, preview, or green CI proves this protection is live.

**Success proof:** for source completion, record issue #329, the exact reviewed pull request and merge, the old-source partial-write failure, green synthetic atomicity tests, relevant full checks, and independent security, test, and officer reviews. For live availability, separately record an approved Firebase Functions deployment and a dated exact-revision readback. Record website publication, `runmprc.com`, Strava/provider configuration, production-data access, migration, repair, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before deployment, use one reviewed Functions-and-guide revert or safe replacement. After any later approved deployment, use the protected Firebase rollback path and verify the replacement revision. Never undo by editing, deleting, copying, or recreating a token or connection record.

**Escalation:** membership lead plus platform/security owner. Add the privacy owner and use the private incident path if a token, athlete detail, provider response, database path, or mismatched record may have appeared. Do not copy that detail into an issue, screenshot, message, email, or AI tool.

## Strava activity failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give a signed-in member one plain next step when My Account cannot load Strava activity, without showing a provider or technical error.

**Approver:** membership lead plus platform/security owner.

**Prerequisites:** issue [#250](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/250) must be merged for source review. Calling the sentence live also requires a protected website publication and an exact revision check on `runmprc.com`. This source change does not deploy Firebase, contact Strava, change provider settings, use production data, or prove live behavior.

Officer review steps after the source merge:

1. Keep the activity-failure sentence marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #250 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up connection, made-up activity, and mocked service results.
4. Confirm a made-up stats rejection shows `We could not load your Strava activity right now. Please try again later.`
5. Confirm the connected athlete remains visible and the loading sentence stops.
6. Confirm no made-up provider detail appears on the page or in browser console output.
7. Confirm a hostile rejected value is not inspected.
8. Confirm a successful made-up result still shows the existing activity and totals.
9. Record website publication, `runmprc.com`, Firebase, Strava, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed retry-later sentence for a stats-load rejection. It does not inspect, display, or log the rejected value. Existing connection display and successful activity projection stay in place. Disconnect failures are separate work and are not made safe by this source slice.

**Stop conditions:** any real member or Strava account; a request for a token, provider error, private account detail, or screenshot containing private values; a real provider call; a production Firebase or Strava change; a raw detail on the page or in the console; or a claim that source, tests, merge, or a green workflow proves the sentence is live.

**Success proof:** for source completion, record the exact #250 issue, reviewed pull request, merged commit, intended old-source failure, green synthetic tests, relevant full checks, and independent privacy review. For live availability, separately record the approved website publication, published revision, and a dated `runmprc.com` check using no real account. Record Firebase deployment, Strava/provider configuration, and production-data actions as **not performed** for this frontend-only change.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com`. Do not undo by changing a member account, Firebase record, or Strava setting.

**Escalation:** membership lead plus platform/security owner. Add the privacy owner and use the private incident path if any provider or technical detail appeared. Do not copy the detail into an issue, message, screenshot, or AI tool.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Strava disconnect failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give a signed-in member one safe next step when My Account cannot confirm a Strava disconnect, without showing a provider or technical error or guessing whether the disconnect completed.

**Approver:** membership lead plus platform/security owner.

**Prerequisites:** issues [#252](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/252) and [#610](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/610) must be merged for the current source review. Calling the sentence live also requires a protected website publication and an exact revision check on `runmprc.com`. These source changes do not deploy Firebase, contact Strava, change provider settings, revoke access, use production data, or prove live behavior.

Officer review steps after the source merge:

1. Keep the disconnect-failure sentence marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #252 and #610 issues, pull requests, merged commits, and synthetic frontend test results.
3. Confirm the tests use only a made-up connection, made-up activity, a mocked browser question, and mocked rejected, confirmed, or unconfirmed disconnect results.
4. Confirm cancelling the browser question sends no disconnect request and shows no failure.
5. Confirm a made-up rejected request, or a fulfilled result that does not present exactly one field named `ok` set to `true`, shows `We could not confirm the Strava disconnect. Please refresh this page before trying again.`
6. Confirm the connected athlete and activity remain visible because the actual result is not known.
7. Confirm the Disconnect button becomes available again, but the instructions say to refresh before another attempt.
8. Confirm a later activity-load failure cannot replace the disconnect refresh instruction.
9. Confirm no made-up provider detail appears on the page or in browser console output.
10. Confirm a hostile rejected value is not inspected.
11. Confirm only a made-up result that presents exactly one field named `ok` set to `true` changes the page to `Connect Strava` and clears the old activity view.
12. Record website publication, `runmprc.com`, Firebase, Strava, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed refresh-before-retry sentence for a rejected disconnect request or a fulfilled result that does not present the exact confirmation fields. It does not keep or return the received result, invoke an `ok` field that performs code when read, display or log a rejected value, or let a later activity-load failure replace that higher-priority instruction. If reading the outer result or checking its structure fails, the source uses the same fixed result. It checks what the result presents, not how the object was created, and copies only the approved confirmation. It keeps the current connected view because the result is unknown, ends the busy state, and preserves the existing successful transition only for the exact confirmation. This source does not prove that Strava access was revoked or that a retry is safe.

**Stop conditions:** any real member or Strava account; a request for a token, provider error, private account detail, or screenshot containing private values; a real disconnect or provider call; a production Firebase or Strava change; a raw detail on the page or in the console; an immediate retry without first refreshing; or a claim that source, tests, merge, or a green workflow proves the sentence or disconnect behavior is live.

**Success proof:** for source completion, record the exact #252 and #610 issues, reviewed pull requests, merged commits, intended old-source failures, green synthetic tests, relevant full checks, and independent privacy review. For live availability, separately record the approved website publication, published revision, and a dated `runmprc.com` check using no real account. Record Firebase deployment, Strava/provider configuration, revoke actions, and production-data actions as **not performed** for these frontend-only changes.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com`. Do not undo by disconnecting an account, changing a member record, editing Firebase, or changing a Strava setting.

**Escalation:** membership lead plus platform/security owner. Add the privacy owner and use the private incident path if any provider or technical detail appeared. If a disconnect result is unclear after refresh, stop and escalate; do not repeat the request. Do not copy private detail into an issue, message, screenshot, or AI tool.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Strava current-account privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep one signed-in member from seeing a previous account's Strava name, activity, or totals when the website account or website service setup changes.

**Approver:** membership lead plus platform/security and privacy owners.

**Prerequisites:** issue [#323](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/323) must be merged for source review. Use only made-up accounts, made-up Strava activity, and made-up automated results from the website's data service and Strava. Calling the protection live also requires an approved website publication and an exact revision check on `runmprc.com`. This slice does not deploy Firebase, contact Strava, change provider settings, read or repair production records, or prove live behavior.

```mermaid
flowchart LR
    A["Current made-up website account and website service setup"] --> B["Start made-up connection check"]
    B --> C{"Does the result still belong to this attempt?"}
    C -- "No" --> D["Ignore it and show no earlier Strava data"]
    C -- "Yes, connected" --> E["Show this account and start made-up activity check"]
    C -- "Yes, no connection" --> F["Show Connect Strava"]
    C -- "Yes, check failed" --> G["Show one unavailable message and no Connect button"]
    E --> H{"Does activity still belong to this attempt?"}
    H -- "No" --> D
    H -- "Yes" --> I["Show only this account's activity"]
```

Text alternative: the page may show Strava identity or activity only when a made-up result still belongs to the current website account and current service check. An older result is ignored. A confirmed missing connection shows **Connect Strava**; an unknown connection shows one unavailable message instead.

Officer review steps after the source merge:

1. Keep this protection marked **NOT AVAILABLE YET**.
2. Ask the platform owner for issue #323, the reviewed pull request, the merged commit, and made-up automated website test results.
3. Confirm every test uses made-up account names, made-up activity, and made-up service results.
4. Confirm switching from made-up account A to B removes A's Strava name and activity in the first display for B.
5. Confirm the same immediate clearing happens when the website service setup, data connection, or ready/not-ready state changes.
6. Confirm a late result from A cannot replace B's name, activity, totals, loading state, or failure state.
7. Confirm changing A to B to A starts a new A check; it must not restore the first A result.
8. Confirm a failed current connection check shows `We could not check your Strava connection right now. Please refresh this page and try again.`
9. Confirm that failure shows neither an earlier account nor **Connect Strava**. A failed check does not prove that no Strava connection exists.
10. Confirm **Connect Strava** appears only after the current made-up check returns no connection.
11. Confirm a late disconnect result from A cannot clear B or show an A warning in B.
12. Confirm closing the page and the automated check that runs twice both leave late results unused.
13. Confirm current made-up connection, activity, fixed activity failure, and fixed disconnect failure behavior still works.
14. Confirm no made-up account, activity, outside-service detail, private web address, token-shaped value, or made-up private marker appears in the wrong page state or browser console.
15. Record source, tests, merge, website publication, `runmprc.com`, Firebase, Strava/provider, production-data, and live-behavior evidence as separate results.

**Expected result:** reviewed source gives each website account and website service setup a fresh Strava check. It immediately hides an earlier account, accepts only current connection, activity, and disconnect results, shows one fixed connection-unavailable alert for a failed current check, and shows **Connect Strava** only after a current check confirms no connection. Existing current-account success and fixed activity/disconnect failures remain available.

**Stop conditions:** any real member or Strava account; a request for a name, activity, token, provider error, private account detail, or screenshot containing private values; a production Firebase or Strava call or change; earlier-account data in a later-account display; **Connect Strava** after an unknown check; a raw detail in the page or console; or a claim that source, tests, merge, or a green workflow proves the protection is live.

**Success proof:** for source completion, record issue #323, the exact reviewed pull request and merge, the ten intended old-source failures, green made-up account-switch tests, relevant full checks, and independent privacy and officer reviews. For live availability, separately record the approved website publication, the published revision, and a dated `runmprc.com` check that uses approved test accounts and no private Strava data. Record Firebase deployment, Strava/provider configuration, production-data access, migration, and repair as **not performed** for this website-page change.

**Undo:** before publication, use one reviewed website-and-guide revert or safe replacement. After any later approved publication, use the protected website release path and verify the replacement revision on `runmprc.com`. Never undo by changing a member account, Strava connection, Firebase record, permission, or provider setting.

**Escalation:** membership lead plus platform/security owner. Add the privacy owner and use the private incident path if one account's Strava identity or activity appeared for another account. Do not copy the name, activity, account detail, screenshot, token, or provider error into an issue, message, email, or AI tool.

No full-system map changes are required because services, permissions, and publication paths are unchanged. The diagram above shows which account may appear and when an older result must stop.

## Public Shop catalog database-load path — RETIRED BY #466

**Status:** **NOT AVAILABLE YET**. Issue
[#466](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/466) removes this
path from target source. An older published revision may still contain it until
the exact #466 revision is published and verified.

**Purpose:** prevent an officer from following the old database-catalog failure
procedure after `/shop` becomes a static pickup catalog.

**Approver:** communications lead plus shop lead and platform/security owner.

**Prerequisites:** the platform owner supplies the named release record, exact
website revision, #466 merge/publication state, and named green focused test
result. No production failure is forced.

Officer steps:

1. Obtain the named release record, exact revision, and green focused test
   result from the platform owner. Do not use a terminal or browser developer
   tools.
2. Check whether the exact #466 website revision is published.
3. If it is not published, report the old `/shop` behavior as unapproved and
   stop. Do not force a database failure or start checkout.
4. If it is published, use **In-person Shop catalog — SOURCE ONLY, NOT LIVE**
   above.
5. Visually confirm the page has no loading, empty-catalog, database-error, or
   checkout control.
6. Confirm the named focused test proves the page makes no catalog or provider
   request.
7. Record the actual website, Firebase, provider, and production-data results
   separately.

**Expected result:** the #466 catalog has no loading, empty, or database-error
state because it reads no product list. Direct legacy product routes remain a
separate unapproved prototype.

**Stop conditions:** an unknown revision, real customer/order/product data, a
forced production error, a checkout attempt, a database/provider change, or a
claim that a merge or green workflow proves the new catalog is published.

**Success proof:** exact #466 merge and website revision; green test proving no
catalog/provider request; dated `runmprc.com/shop` verification; and separate
actual results for Firebase deployment, provider configuration, and
production-data actions. Issue #466 requires none of those actions. If a
release reports one, stop and investigate.

**Undo:** use one reviewed frontend revert or safe roll-forward through the
approved website release path. Do not restore or repair the old path by editing
Firebase, a product, an order, an account, or a provider.

**Escalation:** communications lead plus shop lead and platform/security owner.
Add the privacy owner and use the private incident path if any customer,
account, database, provider, or payment detail appears.

The updated catalog data flow is shown near the top of this guide and in
[Simple System Maps](./SYSTEM_MAPS.md).

## Public product-detail load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give any public Shop visitor one plain next step when a product page cannot load, without showing a database, provider, account, or technical error.

**Approver:** communications lead plus platform/security owner.

**Prerequisites:** issue [#256](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/256) must be merged for source review. Calling the sentence live also requires a protected website publication and an exact revision check on `runmprc.com/shop`. This source change does not deploy Firebase, change database permissions, contact an outside provider, start checkout, use production data, or prove live behavior.

Officer review steps after the source merge:

1. Keep the public product-page failure sentence marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #256 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up product path, made-up product, and mocked database result.
4. Confirm a made-up product lookup rejection shows `We could not load this product right now. Please try again later.`
5. Confirm the loading sentence stops and the **Back to shop** link remains available.
6. Confirm no made-up database, provider, account, endpoint, or technical detail appears on the page or in browser console output.
7. Confirm a hostile rejected value is not inspected.
8. Confirm a missing made-up product still shows the existing not-found result.
9. Confirm a successful made-up product still shows its title, price, and form without starting checkout.
10. Record website publication, `runmprc.com/shop`, Firebase, provider, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed retry-later sentence for a rejected product lookup. It does not inspect, display, or log the rejected value. The failure is announced as an alert, the Back to shop link remains, and missing or successful product results stay distinct.

**Stop conditions:** any real member, customer, order, or private product data; a request for a database or provider error, account detail, private endpoint, or screenshot containing private values; a checkout attempt; a production Firebase or provider change; a raw detail on the page or in the console; an attempt to force a production failure; or a claim that source, tests, merge, or a green workflow proves the sentence is live.

**Success proof:** for source completion, record the exact #256 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic tests, relevant full checks, and independent privacy review. For live availability, separately record the approved website publication, published revision, and a dated `runmprc.com/shop` revision check without forcing an error or starting checkout. Record Firebase deployment, database-permission changes, provider configuration, and production-data actions as **not performed** for this frontend-only change. The failure path remains synthetic-test evidence unless an approved isolated staging check proves it.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com/shop`. Do not undo by changing a product, order, member account, database record, permission, or provider setting.

**Escalation:** communications lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, provider, account, endpoint, or technical detail appeared. Do not copy the detail into an issue, message, screenshot, email, or AI tool.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Public Shop checkout-start failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give a public Shop visitor one plain instruction when the website cannot confirm that checkout started, without adding any failure-supplied contact value, database, Firebase, Stripe, provider, endpoint, or technical error to the page.

**Approver:** communications lead plus platform/security owner. Add the treasurer before any live-commerce review.

**Prerequisites:** issue [#272](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/272) must be merged for source review. Use only a made-up product, made-up buyer, and mocked rejected checkout request. Calling the sentence live also requires a protected website publication and an exact revision check on `runmprc.com/shop` without submitting a form or starting checkout. This source change does not prove whether a rejected request reached Firebase or Stripe, make a repeat safe, contact a provider, deploy Firebase, use production data, or prove live behavior.

```mermaid
flowchart LR
    A["Made-up Shop form"] --> B["Mocked checkout-start request"]
    B -- "Rejected or paid result has no usable URL" --> C["Fixed do-not-retry alert; product and form remain; button stays disabled"]
    B -- "Paid result has a usable URL" --> D["Existing redirect behavior"]
```

In words: a mocked rejection or ambiguous paid result keeps the made-up product and form on the page, shows one fixed do-not-retry alert, and disables another same-page request. A valid paid result keeps the existing redirect path.

Officer review steps after the source merge:

1. Keep the checkout-start failure sentence marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #272 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the test uses only a made-up active product, made-up buyer fields, and a mocked checkout Function rejection.
4. Confirm a rejected request or resolved result without a usable URL shows exactly `We could not confirm checkout. Do not try again. Contact MPRC for help.`
5. Confirm the complete sentence is announced as one urgent screen-reader alert.
6. Confirm the made-up product and form values remain visible, no redirect occurs, the existing busy state ends, and the checkout button remains disabled for the rest of that page visit.
7. Confirm no contact value supplied only by the rejection, database, Firebase, Stripe, provider, endpoint, token-shaped, or technical detail appears on the page, in five browser console methods, or in analytics. The made-up buyer values remain only in their existing form inputs.
8. Confirm a hostile rejected value is not inspected and its throwing `message` property is never touched.
9. Confirm the mocked request still receives the same made-up product slug, buyer fields, optional size/color values, and Firebase app exactly once.
10. Confirm a second direct click or handler call on the same page makes no second service call.
11. Confirm a usable paid checkout URL still redirects once, while a resolved missing or malformed URL becomes the same terminal unknown outcome.
12. Record website publication, `runmprc.com/shop`, Firebase, Stripe/provider, checkout, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source discards the complete rejected value and uses one fixed terminal instruction that does not claim checkout definitely failed. The product and entered values remain visible, the busy state ends, and the button stays disabled for that page visit. A resolved paid result without a usable URL is handled the same way. A valid redirect remains unchanged. #357 supersedes #272's earlier retry-enabled display, but it still does not make a reload, another tab/device, or a scripted retry safe.

**Stop conditions:** any real member, customer, order, product, name, email, phone, address, payment, Session, or provider data; a real form submission or checkout attempt; a request for a raw error, private endpoint, token, provider ID, or screenshot containing private values; an attempt to force a production failure; a Firebase, Stripe, or provider change; any repeat service call after the terminal outcome; a reload/tab/device/script retry; or a claim that source, tests, merge, preview, or a green workflow proves the sentence is live or a repeat is safe.

**Success proof:** preserve the #272 source evidence, then add the exact #357 issue, reviewed pull request, merge commit, terminal repeat/missing-URL synthetic tests, relevant full checks, and independent privacy/accessibility review. For live availability, separately record the approved website publication, published revision, and a dated read-only `runmprc.com/shop` revision check without submitting a form or forcing an error. Record Firebase deployment, Stripe/provider configuration or calls, production-data actions, orders, payments, and checkout attempts as **not performed** unless separately approved and proven.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com/shop`. Do not undo by changing a product, order, member account, database record, payment, permission, Firebase setting, or Stripe/provider setting.

**Escalation:** communications lead plus platform/security owner. Add the treasurer and use the private incident path if a live request may have reached checkout. Add the privacy owner if any failure-supplied contact value or any provider, endpoint, token-shaped, or technical detail appeared outside the retained made-up form inputs. Do not copy the detail into an issue, message, screenshot, email, or AI tool.

## Public Events-list load failure privacy — LIVE FRONTEND CONTAINMENT

**Status: LIVE. EVENT RECORDS REMAIN UNAVAILABLE.** Exact deploy `6a6dc9ea588b0c0008036312` was checked on 2026-08-01. Firebase and event records were unchanged.

**Purpose:** give any public Events visitor one plain next step when the event list cannot load, without showing a database, provider, account, endpoint, or technical error.

**Approver:** events lead plus platform/security owner.

**Prerequisites:** issue [#258](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/258) must be merged for source review. Calling the sentence live also requires a protected website publication and an exact revision check on `runmprc.com/events`. This source change does not choose the canonical event source, deploy Firebase, change database permissions, contact an outside provider, change event records, use production data, or prove live behavior.

Officer review steps after the source merge:

1. Confirm the platform owner names deploy `6a6dc9ea588b0c0008036312` before using this procedure.
2. Ask the platform owner for the exact #258 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up event, mocked event subscription, and mocked database reference.
4. Confirm a made-up subscription rejection announces `Error: We could not load events right now. Please try again later.` as an alert.
5. Confirm the loading sentence stops and the genuine empty-events sentence does not appear for that failure.
6. Confirm no made-up database, provider, account, endpoint, or technical detail appears on the page or in browser console output.
7. Confirm a hostile rejected value is not inspected.
8. Confirm a genuinely empty made-up event list and a successful made-up public event still use their existing displays, and that the anonymous page does not select the member event list.
9. Record website publication, `runmprc.com/events`, Firebase, provider, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed retry-later sentence for an Events-list subscription rejection. It announces that result as an alert and does not inspect, display, or log the rejected value. Loading ends, while successful and genuinely empty public event results remain unchanged. This source slice does not approve an event source, schema, importer, or publication workflow; those owner decisions remain under #121.

**Stop conditions:** any real member, registration, event record, private location, discount, payment, waiver, or contact data; a request for a database or provider error, account detail, private endpoint, or screenshot containing private values; a production Firebase or provider change; a raw detail on the page or in the console; an attempt to force a production failure; or a claim that source, tests, merge, preview, or a green workflow proves the sentence is live.

**Success proof:** for source completion, record the exact #258 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic tests, relevant full checks, and independent privacy review. For live availability, record deploy `6a6dc9ea588b0c0008036312` and the dated signed-out `runmprc.com/events` check. The fixed alert appeared naturally because event records remain unavailable; no failure was forced and no private event data was opened. Synthetic tests remain the proof that a hostile rejected value is never inspected. Record Firebase deployment, database-permission changes, provider configuration, event-record changes, and production-data actions as **not performed** for this frontend-only change.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com/events`. Do not undo by changing an event, member account, registration, database record, permission, source document, or provider setting.

**Escalation:** events lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, provider, account, endpoint, or technical detail appeared. Do not copy the detail into an issue, message, screenshot, email, or AI tool.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Public Events-calendar load failure privacy — LIVE FRONTEND CONTAINMENT

**Status: LIVE. EVENT RECORDS REMAIN UNAVAILABLE.** Exact deploy `6a6dc9ea588b0c0008036312` was checked on 2026-08-01. Firebase and event records were unchanged.

**Purpose:** give a visitor to the public Events calendar one plain next step when calendar data cannot load, without showing a database, provider, account, endpoint, or technical error.

**Approver:** events lead plus platform/security owner.

**Prerequisites:** issue [#260](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/260) must be merged for source review. Calling the sentence live also requires a protected website publication and an exact revision check on `runmprc.com/events/calendar`. This source change does not choose the canonical event source, schema, importer, or publication workflow reserved to #121; deploy Firebase; change database permissions; contact an outside provider; change event records; use production data; or prove live behavior. It also leaves the separate commerce-result work in #249 unchanged.

Officer review steps after the source merge:

1. Confirm the platform owner names deploy `6a6dc9ea588b0c0008036312` before using this procedure.
2. Ask the platform owner for the exact #260 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up event, mocked event subscription, and mocked database reference.
4. Confirm a made-up subscription rejection shows exactly `We could not load events right now. Please try again later.` in one alert that assistive technology reads immediately as a complete sentence.
5. Confirm the failed state replaces the loading sentence without displaying the calendar grid.
6. Confirm no made-up database, provider, account, endpoint, or technical detail appears on the page or in browser console output.
7. Confirm a hostile rejected value is not inspected.
8. Confirm a genuinely empty made-up subscription still displays the normal empty calendar grid and controls.
9. Confirm a successful made-up public event still appears in the calendar.
10. Confirm the anonymous route selects only the public event list.
11. Confirm the subscription's existing cleanup function is still returned.
12. Record website publication, `runmprc.com/events/calendar`, Firebase, provider, event-record, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed retry-later sentence for an Events-calendar subscription rejection. It announces the complete sentence immediately as one alert and does not inspect, display, or log the rejected value. Loading ends and the failure does not display the calendar grid, while successful and genuinely empty subscriptions keep their existing displays. Public/member list selection and subscription cleanup remain unchanged. This source slice does not approve an event source, schema, importer, or publication workflow; those owner decisions remain under #121. It does not change the separate #249 commerce-result work.

**Stop conditions:** any real member, registration, event record, private location, discount, payment, waiver, or contact data; a request for a database or provider error, account detail, private endpoint, or screenshot containing private values; a production Firebase or provider change; a raw detail on the page or in the console; an attempt to force a production failure; an attempt to decide #121's canonical event-source work or edit #249's commerce-result work in this slice; or a claim that source, tests, merge, preview, or a green workflow proves the sentence is live.

**Success proof:** for source completion, record the exact #260 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic tests, relevant full checks, and independent privacy review. For live availability, record deploy `6a6dc9ea588b0c0008036312` and the dated signed-out `runmprc.com/events/calendar` check. The fixed alert appeared naturally because event records remain unavailable; no failure was forced and no private event data was opened. Synthetic tests remain the proof that a hostile rejected value is never inspected. Record Firebase deployment, database-permission changes, provider configuration, event-record changes, and production-data actions as **not performed** for this frontend-only change.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on `runmprc.com/events/calendar`. Do not undo by changing an event, member account, registration, database record, permission, source document, or provider setting.

**Escalation:** events lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, provider, account, endpoint, or technical detail appeared. Do not copy the detail into an issue, message, screenshot, email, or AI tool.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Public event-detail load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give a visitor to one public event page a plain next step when that event cannot load, without showing a database, provider, account, endpoint, or technical error.

**Approver:** events lead plus platform/security owner.

**Prerequisites:** issue [#262](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/262) must be merged for source review. Calling the sentence live also requires a protected website publication and an exact revision check on the affected `runmprc.com/events/...` page. This source change does not choose the canonical event source, schema, importer, or publication workflow reserved to #121; repair the separate stale or out-of-order event lookup lifecycle; deploy Firebase; change database permissions; contact an outside provider; change event records; use production data; or prove live behavior. It also leaves the separate commerce-result work in #249 unchanged.

Officer review steps after the source merge:

1. Keep the public event-detail failure sentence marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #262 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up event, mocked event lookup, and mocked database reference.
4. Confirm a made-up lookup rejection shows exactly `We could not load this event right now. Please try again later.` in one alert that assistive technology reads immediately as a complete sentence.
5. Confirm the loading sentence stops and the **Back to events** link remains available.
6. Confirm no made-up database, provider, account, endpoint, or technical detail appears on the page or in browser console output.
7. Confirm a hostile rejected value is not inspected.
8. Confirm a genuinely missing made-up event still shows the existing not-found result.
9. Confirm a successful made-up event still shows its existing public details and registration link.
10. Record website publication, the exact `runmprc.com` event page, Firebase, provider, event-record, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed retry-later sentence for a rejected event lookup. It announces the complete sentence immediately as one alert and does not inspect, display, or log the rejected value. Loading ends and the Back to events link remains, while missing and successful event results keep their existing displays. This source slice does not approve an event source, schema, importer, or publication workflow; those owner decisions remain under #121. It does not repair stale or out-of-order lookups or change the separate #249 commerce-result work.

**Stop conditions:** any real member, registration, event record, private location, discount, payment, waiver, or contact data; a request for a database or provider error, account detail, private endpoint, or screenshot containing private values; a production Firebase or provider change; a raw detail on the page or in the console; an attempt to force a production failure; an attempt to decide #121 work, repair the separate lookup-lifecycle defect, or edit #249 work in this slice; or a claim that source, tests, merge, preview, or a green workflow proves the sentence is live.

**Success proof:** for source completion, record the exact #262 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic tests, relevant full checks, and independent privacy review. For live availability, separately record the approved website publication, published revision, and a dated check of the affected `runmprc.com` event page without forcing an error, starting registration, or opening private event data. Record Firebase deployment, database-permission changes, provider configuration, event-record changes, and production-data actions as **not performed** for this frontend-only change. The failure path remains synthetic-test evidence unless an approved isolated staging check proves it.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on the affected `runmprc.com` event page. Do not undo by changing an event, member account, registration, database record, permission, source document, or provider setting.

**Escalation:** events lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, provider, account, endpoint, or technical detail appeared. Do not copy the detail into an issue, message, screenshot, email, or AI tool. A specialist still owns any stale or out-of-order lookup repair.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Public event-detail lookup lifecycle — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep a public event page tied to the event named in its current address when a visitor moves between event pages, even if an older lookup finishes later.

**Approver:** events lead plus platform/security owner.

**Prerequisites:** issue [#264](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/264) must be merged for source review. Calling the repair live also requires a protected website publication and an exact revision check on the affected `runmprc.com/events/...` pages. This source change does not choose the canonical event source, schema, importer, or publication workflow reserved to #121; deploy Firebase; change database permissions; contact an outside provider; change event records; use production data; or prove live behavior. It leaves the separate commerce-result work in #249 unchanged.

Officer review steps after the source merge:

1. Keep the public event-detail lifecycle repair marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #264 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only made-up event names, mocked event lookups, and a mocked database reference.
4. Confirm moving from a failed made-up event to a successful one clears the old alert and shows the current event.
5. Confirm moving from a missing made-up event to a successful one clears the old not-found result and shows the current event.
6. Confirm an older rejection that finishes after the current event cannot replace that event with an alert.
7. Confirm an older success that finishes after the current event cannot replace its title, registration link, or event-view measurement.
8. Confirm the current event keeps its own title, registration link, and one event-view measurement.
9. Confirm the fixed failure sentence and missing-event result from #262 still work for the current event.
10. Record source change, tests, merge, preview, website publication, the exact `runmprc.com` event pages, Firebase, provider, event-record, production-data, and live-behavior evidence as separate results.

**Expected result:** each changed event address starts a fresh loading state, clears the preceding event and alert, and accepts a result only from its own active lookup. A completed older lookup cannot replace the current event, registration link, alert, or measurement. The current event retains the existing success, missing-event, and fixed failure displays. This source slice does not approve #121 event-source decisions or change #249 commerce-result work.

**Stop conditions:** any real member, registration, event record, private location, discount, payment, waiver, or contact data; a request to force a production race between lookups; a production Firebase or provider change; a stale title, registration link, alert, or event-view measurement after the address changes; an attempt to decide #121 work or edit #249 work in this slice; or a claim that source, tests, merge, preview, or a green workflow proves the repair is live.

**Success proof:** for source completion, record the exact #264 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic lifecycle tests, relevant full checks, and independent integrity review. For live availability, separately record the approved website publication, published revision, and a dated check that navigation between two approved public `runmprc.com` event pages keeps the address, title, and registration link aligned. Record Firebase deployment, database-permission changes, provider configuration, event-record changes, and production-data actions as **not performed** for this frontend-only change. A synthetic timing test proves source behavior; it does not prove production behavior.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on the affected `runmprc.com` event pages. Do not undo by changing an event, member account, registration, database record, permission, source document, or provider setting.

**Escalation:** events lead plus platform/security owner. Add the privacy owner and use the private incident path if a stale page exposed a wrong event, private detail, registration destination, or measurement. Do not copy private details into an issue, message, screenshot, email, or AI tool.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Event sign-in return path — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** let an anonymous visitor who chooses the member-price **Sign in** link on Event details or Race registration return to that same website address after a successful sign-in, without treating the address or sign-in provider as membership, price, discount, payment, registration, or officer authority.

**Approver:** events lead plus membership lead and platform/security owner.

**Prerequisites:** issue [#96](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/96) must remain the one check that accepts a return address only when it stays on this website. Issue [#469](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/469) must have a reviewed pull request, exact commit, and green tests of the real website pages using made-up data. Calling the navigation live also requires an approved protected website publication and exact-revision evidence. Use no real account, member, event, offer, discount, registration, waiver, payment, or provider data. Google sign-in and provider configuration remain separate work under [#109](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/109).

```mermaid
flowchart LR
    Event["Made-up Event details or Race registration address"] --> Link["Anonymous member-price Sign in"]
    Link --> Login["Login carries the complete website address during the current browser visit"]
    Login --> Safe{"Existing website-address check accepts return?"}
    Safe -- "Yes, after successful sign-in" --> Event
    Safe -- "Missing or unsafe" --> Account["Account fallback"]
    Login -. "Does not preserve" .-> Form["Registration answers or waiver choice"]
    Safe -. "Does not grant" .-> Authority["Membership, offer, price, payment, registration, or admin authority"]
```

Text alternative: the source-only member-price links carry a made-up Event details or Race registration address, including text after `?` or `#`, through Login during the current browser visit; after successful sign-in the existing website-address check returns to that accepted address or uses Account when it is missing or unsafe, while form answers and club or financial authority never travel with it.

Officer review steps after the source merge:

1. Keep the event sign-in return path marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #469 issue, reviewed pull request, commit, and made-up-data test results.
3. Confirm the tests of the real website pages use only made-up event names, made-up text after `?` or `#`, simulated event lookups, and simulated account services.
4. Confirm the Event details member-price link carries its exact current address, including text after `?` or `#`, to Login.
5. Confirm the Race registration member-price link carries its exact current address, including text after `?` or `#`, to Login.
6. Confirm the existing #96 tests accept only returns that stay on this website, keep safe text after `?` or `#`, and use `/account` for missing or malformed addresses, outside addresses, addresses beginning with two slashes, backslashes, or hidden nonprinting characters.
7. Confirm signed-in made-up members keep the existing event details, registration link, and member-price display without another sign-in prompt.
8. Confirm no return address is written to Firestore, a custom claim, analytics, a log, or an outside provider. The address exists only during the current browser visit for this source flow.
9. Confirm no real or protected value appears in a test address. A discount code, private location, contact detail, waiver answer, token, or payment value never belongs after `?` or `#` in an address.
10. Confirm only the address returns. Registration form answers, waiver choice, and an in-progress submission do not survive leaving the page.
11. Confirm account creation remains unchanged. The tested success path is the existing email/password sign-in; Google sign-in, collision-safe linking, membership authority, and provider setup remain unavailable.
12. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Google provider, account, event, registration, payment, and live return behavior as separate results.

**Expected result:** the reviewed source sends the current Event details or Race registration address, including text after `?` or `#`, through the current browser visit when the anonymous visitor chooses the member-price Sign in link. Login continues to apply the one existing website-address check immediately before returning after a successful sign-in. A missing or unsafe address keeps the `/account` fallback. Signed-in member-price behavior stays unchanged. Only the address returns; no form or waiver state is restored. This source slice neither adds Google sign-in nor protects event or offer content.

**Stop conditions:** any real account, member, event, offer, code, private location, registration, runner, contact, waiver, payment, provider, endpoint, credential, or production data; a request to place a protected value in a website address; a test against production authentication; a return target outside the same website; a second website-address check; a return address in analytics, logs, Firestore, claims, or provider traffic; an assertion that registration answers or waiver state survive; or a claim that source, tests, merge, preview, or a green workflow proves the return flow, Google sign-in, membership, or protected Events are live.

**Success proof:** for source completion, record the exact #469 issue, reviewed pull request and commit, two intended old-source failures, the green Event detail and Race registration return tests, the unchanged signed-in tests, the complete #96 website-address safety tests, relevant full checks, and independent security and officer-continuity reviews. A signed-out public read-only check after an approved website publication may prove that each member-price link reaches Login, but end-to-end production return remains unverified until an approved isolated made-up-account sign-in check proves it on the exact revision. Record Firebase deployment, Google provider configuration, production account use, event or registration changes, payments, and live protected content as **not performed** unless separate evidence proves them.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After an approved publication, use the protected website release path and verify the replacement revision. Do not undo by changing an account, membership, event, offer, registration, waiver, payment, database record, permission, source document, or provider setting.

**Escalation:** events lead plus membership lead and platform/security owner. Add the privacy owner if a protected value appeared in an address, browser history, analytics, log, screenshot, issue, email, or AI tool. Add the treasurer if registration or payment state might have changed. Do not copy the protected value into the escalation record.

## Public event-registration page load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give a visitor a plain next step when the public event-registration page cannot load its event, without showing a database, provider, account, endpoint, token-shaped, or technical error.

**Approver:** events lead plus platform/security owner.

**Prerequisites:** issue [#266](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/266) must be merged for source review. Calling the sentence live also requires a protected website publication and an exact revision check on the affected `runmprc.com/events/.../register` page without entering or submitting runner data. This source change does not choose the canonical event source, schema, importer, or publication workflow reserved to #121; repair stale or out-of-order registration-page lookups; change registration, waiver, price, analytics, or checkout behavior; deploy Firebase; change database permissions; contact Stripe or another provider; change event records; use production data; or prove live behavior. It leaves the separate commerce-result work in #249 unchanged.

Officer review steps after the source merge:

1. Keep the public event-registration load-failure sentence marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #266 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up event, mocked event lookup, mocked database reference, and an empty form.
4. Confirm a made-up lookup rejection shows exactly `We could not load this event right now. Please try again later.` in one alert that assistive technology reads immediately as a complete sentence.
5. Confirm the loading sentence stops and the **Back to events** link remains available.
6. Confirm no made-up database, provider, account, endpoint, token-shaped, or technical detail appears on the page or in browser console output.
7. Confirm a hostile rejected value is not inspected.
8. Confirm a genuinely missing made-up event still shows the existing not-found result.
9. Confirm a successful made-up event still shows the existing registration form and public price without entering data, accepting a waiver, submitting, or starting checkout.
10. Record source change, tests, merge, preview, website publication, the exact `runmprc.com` registration page, Firebase, provider, event-record, production-data, registration/payment, and live-behavior evidence as separate results.

**Expected result:** the reviewed source uses one fixed retry-later sentence for a rejected event lookup on the registration page. It announces the complete sentence immediately as one alert and does not inspect, display, log, or send the rejected value to analytics. Loading ends and the Back to events link remains, while missing and successful event results keep their existing displays. This slice does not submit a registration, accept a waiver, start checkout, repair stale lookups, approve #121 event-source decisions, or change #249 commerce-result work.

**Stop conditions:** any real member, runner, registration, event record, private location, discount, payment, waiver, emergency contact, birth date, phone, or email data; entry or submission of a form; acceptance of a waiver; a request to force a production failure; a Firebase or provider change; a raw detail on the page or in the console; an attempt to repair stale lookups, change submission/analytics/checkout, decide #121 work, or edit #249 work in this slice; or a claim that source, tests, merge, preview, or a green workflow proves the sentence is live.

**Success proof:** for source completion, record the exact #266 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic tests, relevant full checks, and independent privacy review. For live availability, separately record the approved website publication, published revision, and a dated read-only check of the affected `runmprc.com` registration page without entering data, accepting a waiver, submitting, or forcing an error. Record Firebase deployment, database-permission changes, provider configuration, event-record changes, production-data actions, registrations, and payments as **not performed** for this frontend-only change. The failure path remains synthetic-test evidence unless an approved isolated staging check proves it.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on the affected `runmprc.com` registration page. Do not undo by changing an event, member account, registration, database record, permission, source document, provider setting, waiver, or payment.

**Escalation:** events lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, provider, account, endpoint, runner, waiver, registration, or technical detail appeared. Do not copy the detail into an issue, message, screenshot, email, or AI tool. A specialist still owns any stale or out-of-order lookup repair.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Public event-registration lookup lifecycle — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep a public event-registration page tied to the event named in its current address when a visitor moves between registration pages, even if an older event lookup finishes later.

**Approver:** events lead plus platform/security owner.

**Prerequisites:** issue [#268](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/268) must be merged for source review. Calling the repair live also requires a protected website publication and an exact revision check on the affected `runmprc.com/events/.../register` pages without entering runner data, accepting a waiver, submitting, or starting checkout. This source change preserves #266 error privacy; it does not choose the canonical event source, schema, importer, or publication workflow reserved to #121; reset runner answers, custom answers, signup type, or waiver state when the address changes; bind a pending submission to its starting address; change registration, price, analytics, or checkout behavior; deploy Firebase; change database permissions; contact Stripe or another provider; change event records; use production data; or prove live behavior. It leaves the separate commerce-result work in #249 unchanged.

Officer review steps after the source merge:

1. Keep the public event-registration lookup-lifecycle repair marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #268 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only made-up event names, mocked event lookups, a mocked database reference, and empty forms.
4. Confirm moving from a failed made-up registration page to a successful one clears the old alert and shows the current event form and **Back to event** link.
5. Confirm moving from a missing made-up event to a successful one clears the old not-found result and shows the current event form.
6. Confirm an older rejection that finishes after the current registration event cannot replace that event with an alert.
7. Confirm an older success that finishes after the current registration event cannot replace its heading, price, waiver text, form, or **Back to event** link.
8. Confirm the fixed failure sentence and missing-event result from #266 still work for the current address.
9. Confirm the review enters no runner, contact, birth-date, emergency-contact, waiver, registration, payment, or real event data and makes no form submission or checkout call.
10. Record source change, tests, merge, preview, website publication, the exact `runmprc.com` registration pages, Firebase, provider, event-record, production-data, registration/payment, and live-behavior evidence as separate results.

**Expected result:** each changed registration address starts a fresh loading state, clears the preceding event and load error, and accepts an event result only from its own active lookup. A completed older lookup cannot replace the current heading, price, waiver text, form, link, not-found result, or fixed failure alert. Current success, missing-event, and #266 failure displays remain unchanged. This source slice does not enter or reset form values, accept a waiver, submit a registration, start checkout, approve #121 event-source decisions, or change #249 commerce-result work.

**Stop conditions:** any real member, runner, registration, event record, private location, discount, payment, waiver, emergency contact, birth date, phone, or email data; entry or submission of a form; acceptance of a waiver; a request to force a production race between lookups; a production Firebase or provider change; a stale heading, price, waiver, form, link, not-found result, or alert after the address changes; an attempt to expand into route-scoped form/waiver/submission state, decide #121 work, or edit #249 work in this slice; or a claim that source, tests, merge, preview, or a green workflow proves the repair is live.

**Success proof:** for source completion, record the exact #268 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic lifecycle tests, relevant full checks, and independent integrity/privacy review. For live availability, separately record the approved website publication, published revision, and a dated read-only check that navigation between two approved public `runmprc.com` registration addresses keeps the address, event heading, and **Back to event** link aligned without entering data, accepting a waiver, submitting, or starting checkout. Record Firebase deployment, database-permission changes, provider configuration, event-record changes, production-data actions, registrations, and payments as **not performed** for this frontend-only change. A synthetic timing test proves source behavior; it does not prove production behavior.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on the affected `runmprc.com` registration pages. Do not undo by changing an event, member account, registration, database record, permission, source document, provider setting, waiver, or payment.

**Escalation:** events lead plus platform/security owner. Add the privacy owner and use the private incident path if a stale registration page exposed the wrong event, price, waiver, form, destination, runner detail, or technical detail. Do not copy private details into an issue, message, screenshot, email, or AI tool. Route-scoped form/waiver state and pending submission settlement remain separate specialist work.

No system diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged.

## Public event-registration submission failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give a public event-registration visitor one plain instruction when the website cannot confirm a submission, without adding any failure-supplied runner, contact, Firebase, Stripe, provider, endpoint, token-shaped, or technical detail to the page or analytics.

**Approver:** events lead plus platform/security owner. Add the treasurer before any live paid-registration review.

**Prerequisites:** issue [#274](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/274) must be merged for source review. Use only a made-up event, made-up runner and contact values, a made-up waiver, and a mocked rejected submission. Calling the sentence live also requires a protected website publication and an exact revision check on the affected `runmprc.com/events/.../register` page without entering data, accepting a waiver, submitting, or starting checkout. This source change does not prove whether a rejected request reached Firebase or Stripe, make a repeat safe, contact a provider, deploy Firebase, use production data, or prove live behavior.

```mermaid
flowchart LR
    A["Made-up registration form"] --> B["Mocked submission request"]
    B -- "Rejected or paid result has no usable URL" --> C["Fixed do-not-retry alert; event and form remain; button stays disabled"]
    B -- "Resolved free or paid result is usable" --> D["Existing success path"]
```

In words: a mocked rejection or ambiguous paid result keeps the made-up event, form, answers, and waiver selection on the page, shows one fixed do-not-retry alert, and disables another same-page submission. Successful free registration and a valid paid checkout link keep their existing paths.

Officer review steps after the source merge:

1. Keep the submission-failure sentence marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #274 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up public event, made-up runner and emergency-contact fields, a made-up waiver, and a mocked checkout Function rejection.
4. Confirm a rejected submission or resolved paid result without a usable URL shows exactly `We could not confirm your registration. Do not try again. Contact MPRC for help.`
5. Confirm the complete sentence is announced as one urgent screen-reader alert.
6. Confirm the made-up event, route, form values, and waiver selection remain visible, no navigation or redirect occurs, the busy state ends, and the submit button remains disabled for that page visit.
7. Confirm no contact value supplied only by the rejection, Firebase, Stripe, provider, endpoint, token-shaped, or technical detail appears on the page, in five browser console methods, or in analytics. The made-up runner and contact values remain only in their existing form inputs and mocked request.
8. Confirm a hostile rejected value is not inspected and its throwing `message` property is never touched.
9. Confirm the mocked request still receives the same Firebase app and made-up event, runner, custom-field, signup-type, waiver, and price-tier projection exactly once.
10. Confirm the existing submit-attempt analytics marker remains and the registration-error marker contains only the made-up public event slug, with no rejected value or property.
11. Confirm a second direct submit or handler call on the same page makes no second service call.
12. Confirm free registration still navigates once, a usable paid URL still redirects once, and a resolved missing or malformed paid URL becomes the same terminal unknown outcome.
13. Record source change, tests, merge, preview, website publication, the exact `runmprc.com` registration page, Firebase, Stripe/provider, registration/checkout, production-data, and live-behavior evidence as separate results.

**Expected result:** the reviewed source discards the complete rejected value and uses one fixed terminal instruction that does not claim registration definitely failed. The event and entered values remain visible, the busy state ends, and the button stays disabled for that page visit. A resolved paid result without a usable URL is handled the same way. Successful free navigation and a valid paid redirect remain unchanged. #357 supersedes #274's earlier retry-enabled display, but it does not make a reload, another tab/device, or a scripted retry safe.

**Stop conditions:** any real member, runner, registration, private event record, name, email, phone, birth date, emergency contact, waiver, payment, Session, or provider data used to exercise the synthetic failure review; entry or submission of a real form; acceptance of a real waiver; a real registration or checkout attempt; a request for a raw error, private endpoint, token, provider ID, or screenshot containing private values; an attempt to force a production failure; a Firebase, Stripe, provider, event-record, or analytics change; any repeat service call after the terminal outcome; a reload/tab/device/script retry; or a claim that source, tests, merge, preview, or a green workflow proves the sentence is live or a repeat is safe. A later approved revision check may open the already-public event page read-only but must not enter data, accept a waiver, submit, start checkout, or force a failure.

**Success proof:** preserve the #274 source evidence, then add the exact #357 issue, reviewed pull request, merge commit, terminal repeat/missing-URL synthetic tests, relevant full checks, and independent privacy/accessibility review. For live availability, separately record the approved website publication, published revision, and a dated read-only `runmprc.com` registration-page revision check without entering data, accepting a waiver, submitting, or forcing an error. Record Firebase deployment, Stripe/provider configuration or calls, event-record and production-data actions, registrations, payments, and checkout attempts as **not performed** unless separately approved and proven.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision on the affected `runmprc.com` registration page. Do not undo by changing an event, registration, member account, database record, payment, waiver, permission, Firebase setting, analytics setting, or Stripe/provider setting.

**Escalation:** events lead plus platform/security owner. Add the treasurer and use the private incident path if a live request may have reached registration or checkout. Add the privacy owner if any failure-supplied runner/contact value or any Firebase, Stripe, provider, endpoint, token-shaped, or technical detail appeared outside the retained made-up form inputs and mocked request. Do not copy the detail into an issue, message, screenshot, email, or AI tool.

No system-topology diagram changes for this source slice; the state-flow diagram above records the page's failure-display change, while data movement, permissions, account ownership, and deployment topology remain unchanged.

## Registration confirmation route privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep one runner's confirmation details tied to the private confirmation address that requested them. Moving to another address must hide the earlier name, email, registration ID, and confirmation result at once.

**Approver:** events lead plus platform/security and privacy owners. Add the treasurer before any future live review involving a paid registration.

**Prerequisites:** issue [#319](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/319) must be merged for source review. Use only made-up events, runners, registration IDs, tokens, and mocked services. Do not open, copy, request, or test a real confirmation address. A later claim that the source was published requires a protected website publication and an exact `runmprc.com` revision check. Neither check authorizes a real confirmation-address test or proves the private route works in production.

```mermaid
flowchart TD
    A["Made-up confirmation address A"] --> B["Mocked lookup A starts"]
    B --> C["Move to made-up address B"]
    C --> D["Hide A details at once; clear A timer"]
    D --> E{"Which mocked result finishes?"}
    E -- "Old A" --> F["Ignore it; no display or analytics-wrapper call"]
    E -- "Current B is pending" --> G["Keep waiting; show no runner details"]
    E -- "Current B is paid or complimentary (comp)" --> H["Show B confirmation; call disabled wrapper once"]
```

Text alternative: changing from made-up confirmation address A to B immediately hides A; only B may keep waiting or show its own current paid or complimentary (`comp`) result and call the disabled analytics wrapper once, while every late A result and timer does nothing and no analytics event is sent or stored.

Officer source-review steps:

1. Keep the confirmation-route repair marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #319 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm every test uses made-up runner details, made-up route values, and a mocked lookup.
4. Confirm no test opens a real confirmation address or contacts a real Firebase, Stripe, analytics, or other outside service.
5. Confirm moving from made-up address A to unresolved address B hides A's name, email, registration ID, and confirmed heading before B finishes.
6. Confirm a pending B result keeps the waiting page and shows no runner details.
7. Confirm a late A success cannot replace B or call the analytics wrapper.
8. Confirm a late A failure is ignored without reading its private or hostile detail.
9. Confirm A's old timer is cleared and cannot start another lookup after the move to B.
10. Confirm a readiness, Firebase app, service, route, or page-close change makes the older work inactive and clears its timer.
11. Confirm returning from A to B and back to A starts fresh work instead of reusing the first A result.
12. Confirm only the current paid or comp result calls the disabled, provider-free analytics wrapper once.
13. Confirm the wrapper sends and stores no analytics event.
14. Confirm current pending, timeout, denied, error, not-ready, and missing-address results keep their existing plain displays.
15. Record source, tests, merge, website publication, `runmprc.com` revision, Firebase deployment, provider configuration, production-data action, and live behavior as separate results.

**Expected result:** only the current made-up address may decide what the page shows. An address or service change hides the preceding result immediately. Current pending work shows no runner details. Old results, failures, and timers do nothing. The current paid or comp result keeps the existing first name, email, and registration ID. Its source calls the disabled, provider-free analytics wrapper once. No analytics event is sent or stored. This changes reviewed source and tests only.

**Stop conditions:** any real runner, event, registration, email, token, payment, confirmation address, screenshot, provider value, or production record; a request to paste a private address or detail into GitHub, email, chat, or an AI tool; a production Firebase, Stripe, analytics, or other provider action; an attempt to force a live failure or timing race; an old result appearing under a new address; a claim that the disabled wrapper sent or stored an event; or a claim that source, tests, merge, preview, or a green workflow proves the change is live.

**Success proof:** for source completion, record the exact #319 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic route and timer tests, relevant full checks, and independent privacy, lifecycle, and officer reviews. The synthetic analytics mock may prove one current wrapper call, while source review proves the wrapper is disabled and provider-free; neither result is an analytics event or provider receipt. For release evidence, separately record the protected website publication and exact `runmprc.com` revision without opening a real confirmation address. Record Firebase deployment, Stripe or other provider configuration, analytics transmission or storage, real registration access, production-data action, and live route behavior as **not performed** unless a later approved non-production plan proves them safely.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision without opening a real confirmation address. Do not change or delete a registration, payment, account, database record, token, permission, Firebase setting, analytics setting, or Stripe setting.

**Escalation:** events lead plus platform/security and privacy owners. Add the treasurer if a paid registration may be affected. Use the private incident path if one runner's details may have appeared under another address. Do not copy the address, token, runner details, screenshot, or provider value into an issue, message, email, or AI tool.

This source slice does **not** make the current confirmation address safe. DATA-001A still owns replacing the private value in the address, storing that value safely, making it expire, preventing reuse, removing it from browser history, keeping it out of monitoring and links to other sites, verifying the Stripe Session or signed-in account, and reducing the server response. Firebase request checking (App Check) for this lookup remains deferred. The server may still return more runner data than the page needs. The current page still shows a current runner's first name, email, and registration ID. The current analytics wrapper remains disabled and provider-free; its source call sends and stores nothing. Data purpose, access, retention, deletion, and any future analytics approval remain open. Payment authority, Stripe behavior, confirmation email, Firebase and provider settings, deployment, production data, and live behavior are unchanged.

No system-topology diagram changes for this source slice; the state-flow diagram above records the page's current-route display and timer boundary, while data movement, permissions, account ownership, and deployment topology remain unchanged.

## Shop purchase confirmation route privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep one buyer's purchase details tied to the private confirmation address that requested them. Moving to another address must hide the earlier name, email, item, total, order ID, and confirmation result at once.

**Approver:** merchandise lead, treasurer, platform/security owner, and privacy owner.

**Prerequisites:** issue [#321](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/321) must be merged for source review. Issue [#319](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/319) is the separate registration-route source boundary; it does not cover shop purchases and is not live. Use only made-up buyers, orders, products, amounts, route values, and mocked services. Do not open, copy, request, or test a real purchase confirmation address. A later publication claim requires a protected website publication and a separate exact `runmprc.com` revision check without opening a real confirmation address. Neither result proves that the private route works in production.

```mermaid
flowchart TD
    A["Made-up purchase address A"] --> B["Mocked order lookup A starts"]
    B --> C["Move to made-up address B"]
    C --> D["Hide A details at once; clear A timer"]
    D --> E{"Which mocked result finishes?"}
    E -- "Old A" --> F["Ignore it; show nothing from A"]
    E -- "Current B is pending" --> G["Keep waiting; show no buyer or order details"]
    E -- "Current B is paid or fulfilled" --> H["Show only B purchase details"]
```

Text alternative: changing from made-up purchase address A to B immediately hides A and clears its timer; every late A result does nothing, while only current B may keep waiting or show its own paid or fulfilled purchase details.

Officer source-review steps:

1. Keep the shop purchase route marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #321 issue, pull request, merged commit, and synthetic frontend test result.
3. Confirm every test uses made-up buyers, orders, products, amounts, route values, and a mocked order lookup.
4. Confirm no test opens a real confirmation address or contacts real Firebase, Stripe, analytics, or another outside service.
5. Confirm moving from made-up address A to unresolved address B hides A's name, email, item, size, color, total, order ID, and confirmed heading before B finishes.
6. Confirm a pending B result keeps the waiting page and shows no buyer or order details.
7. Confirm a late A success cannot replace B or show any A detail.
8. Confirm a late A failure is ignored without reading its private or hostile detail.
9. Confirm A's old timer is cleared and cannot start another lookup after the move to B.
10. Confirm a readiness, Firebase app, service, route, or page-close change makes the older work inactive and clears its timer.
11. Confirm returning from A to B and back to A starts fresh work instead of reusing the first A result.
12. Confirm only the current paid or fulfilled result shows the existing made-up buyer and order details.
13. Confirm current pending, timeout, denied, error, not-ready, and missing-address results keep their existing plain displays.
14. Record these as separate results: source changed, tests passed, code merged, website published, exact `runmprc.com` revision verified, Firebase deployed, Stripe or another provider configured, production data changed, and live route behavior verified.

**Expected result:** only the current made-up address may decide what the page shows. An address or service change hides the preceding result immediately. Current pending work shows no buyer or order details. Old results, failures, and timers do nothing. The current paid or fulfilled result keeps the existing made-up name, email, item, total, and order ID. This changes reviewed source, tests, and this guide only.

**Stop conditions:** any real buyer, order, email, item, amount, payment, Stripe payment session, confirmation address, token, screenshot, provider value, or production record; a request to paste a private address or detail into GitHub, email, chat, or an AI tool; a production Firebase, Stripe, analytics, or other provider action; an attempt to force a live failure or timing race; an old result appearing under a new address; or a claim that source, tests, merge, preview, or a green workflow proves the change is published or live.

**Success proof:** for source completion, record the exact #321 issue, reviewed pull request, merged commit, intended old-source failures, green synthetic route and timer tests, relevant full checks, and independent privacy, lifecycle, and officer reviews. Record #319 as separate registration-route source evidence only. The intended #321 completion states are: source changed, tests passed, and code merged. Website publication, `runmprc.com` verification, Firebase deployment, Stripe or other provider configuration or calls, real order or payment access, production-data action, and live route behavior remain **not performed**. A later release must record its protected website publication and exact `runmprc.com` revision separately without opening a real confirmation address.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After publication, use the same protected website release path and verify the replacement revision without opening a real confirmation address. Do not change or delete an order, payment, account, database record, token, permission, Firebase setting, analytics setting, or Stripe/provider setting.

**Escalation:** merchandise lead, treasurer, platform/security owner, and privacy owner. Use the private incident path if one buyer's details may have appeared under another address. Do not copy the address, token, buyer or order details, screenshot, payment value, or provider value into an issue, message, email, or AI tool.

This #321 source slice does **not** make the current purchase confirmation address safe. The separate #319 registration source boundary does not cover this route and is still not live.

The remaining DATA-001A work still owns replacing private values in confirmation addresses with a verified Stripe payment session or signed-in account handoff. For visitors who are not signed in, it must store the private value safely, make it expire, and prevent reuse. It must also remove the value from browser history, keep it out of monitoring and links to other sites, and reduce the server response to the minimum approved fields.

Firebase request checking (App Check) for the shop lookup (`lookupOrder`) remains deferred until that safe handoff and its matching safety tests are complete. The server may still return more buyer and order data than the page needs. The current page still shows the current buyer's name, email, item, total, and order ID. Data purpose, access, retention, deletion, payment authority, Stripe behavior, confirmation email, Firebase and provider settings, deployment, production data, and live behavior remain open or unchanged.

No system-topology diagram changes for this source slice; the state-flow diagram above records only the shop page's current-route display and timer boundary, while data movement, permissions, account ownership, and deployment topology remain unchanged.

## Refund amount and returned-result guards — SOURCE ONLY, NOT LIVE

**Purpose:** make an invalid partial amount stop, and record a refund complete only when Stripe returns a matching final success.

**Approver:** treasurer plus platform/security owner.

**Prerequisites:** the pull requests for issues [#200](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/200) and [#204](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/204) are merged, a protected staging Firebase project, both exact refund Functions are deployed and read back there, Stripe test mode, made-up order and race records, and an approved refund policy. The broader safe refund procedure is still **NOT AVAILABLE YET**.

```mermaid
flowchart TD
    Ask["Request a partial refund"] --> Stored{"Stored payment, usd currency, and original cents are valid?"}
    Stored -- "No" --> Stop["Stop before Stripe and before a record change"]
    Stored -- "Yes" --> Check{"Requested amount is positive whole cents and lower?"}
    Check -- "No" --> Stop["Stop before Stripe and before a record change"]
    Check -- "Yes" --> Partial["Send the exact partial amount"]
    Partial --> Result{"Succeeded result matches payment, currency, and amount rule?"}
    Result -- "No or unclear" --> Unknown["Do not attempt a local success write\nDo not retry; escalate"]
    Result -- "Yes" --> Save["Try to save validated refund ID and actual cents"]
    Save --> Saved{"Local save response confirmed?"}
    Saved -- "Yes" --> Returned["Return success\nLater reconciliation still required"]
    Saved -- "No or lost" --> LocalUnknown["Local record state is unknown\nDo not retry; reconcile"]
    Full["Explicit full-refund request"] --> Omit["Only path allowed to omit the amount"]
    Omit --> Result
```

In words: a missing or malformed stored payment, currency, or original amount stops before Stripe. An invalid, equal, or over-limit partial amount also stops. A Stripe result that is not a matching final success causes no local success write attempt. A partial must match the requested cents. A full request uses the actual remaining cents Stripe returned. If the later local save reports an error or loses its response, the record may or may not have changed. In either unclear case, the officer must not retry and reconciliation is required.

Officer review steps after every prerequisite has proof:

1. Keep all live website refunds unavailable.
2. Ask the platform specialist to show the fixed synthetic test report for both race and shop refunds.
3. Confirm a missing or malformed stored payment ID, `usd` currency, or original whole-cent amount stops before any Stripe refund call or record change.
4. Confirm the report rejects missing, non-number, fraction, zero, negative, equal, over-limit, and non-finite partial amounts.
5. Confirm every rejected caller or stored-record case shows no Stripe refund call and no order or registration change.
6. Confirm the smallest valid amount and one cent below the stored original send the exact test-mode amount and stay partial.
7. Confirm only a final succeeded result for the same payment, currency, and permitted amount can change the made-up record.
8. Confirm malformed, mismatched, pending, action-required, failed, cancelled, and unknown Stripe results do not attempt a local success write and say: do not retry; escalate to the treasurer and platform owner.
9. Confirm a local-save error after a valid Stripe success returns no success response, treats the local record as unknown, and gives the same do-not-retry instruction.
10. Confirm a full test refund records the actual returned remaining cents, not the original amount guessed from the local record.
11. Stop after this review. Do not approve a production refund until the remaining PAY-005 safety work and provider/deployment proof are complete.

**Expected result:** a malformed stored target or rejected partial amount causes one fixed preflight error and no provider or record change. An admitted partial request always carries its exact amount. Only the explicit full action can omit it. A rejected Stripe result causes no local success write attempt. The Function returns success only after a matching final result is saved with its actual cents. If the Stripe result or local save cannot be confirmed, the page says not to retry and to escalate; it does not claim that Stripe failed or whether the local record changed.

**Stop conditions:** any real order, registration, member, card, Stripe payment record, refund, production Firebase project, Stripe live mode, missing deployment/readback, request to edit Firestore by hand, or retry after an unconfirmed result.

**Success proof:** exact #200 and #204 pull requests and merge commits; red proof showing the old unsafe amount and returned-result cases; green focused and full tests; readback of both Functions in staging; made-up Stripe test-mode results for every listed final/non-final outcome; and a dated treasurer/platform review. A green source workflow alone is not deployment or provider proof.

**Undo:** use one reviewed two-Function revert or safe roll-forward through the protected backend release. Never undo by issuing another refund or changing a payment record.

**Escalation:** treasurer plus platform/security owner. Use the private incident path if any unexpected refund or real record was involved.

## Optional profile photo and officer people finder — INERT FRONTEND PREVIEW; BACKEND NOT LIVE

**Purpose:** let officers review the future profile-photo, independent finder-choice, and People finder layouts without connecting the private backend. The #621 frontend default is an inert preview: every related control is disabled; it reads no saved photo or setting, accepts or uploads no photo, searches no name, and saves nothing. #623 published only that inert interface as bounded Netlify deploy `6a7e072f8f346b0008510d29`. Signed-out route, guard, and no-directory-request checks passed, and the temporary authority is inactive. After a later approved connection, a signed-in person could choose one private profile thumbnail and, separately, choose whether the People finder may show their display name and thumbnail. A properly authorized officer could search by name and compare voluntary thumbnails visually. The system will not search a photo or recognize a face.

**Approver:** membership lead, privacy owner, and platform/security owner. The privacy owner must approve the final notice and backup/removal wording before connected publication.

**Prerequisites:** parent [#504](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/504), account source child [#505](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/505), search source child [#506](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/506), and frontend-preview child [#621](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/621) are reviewed. #623 has a separately reviewed completed release record. Review the protected disabled layouts only through synthetic local artifacts. Inspect production only while signed out, and only for its public revision and normal guards. Use only made-up accounts, made-up names, and generated non-face images for the preserved connected-source tests. Protected release [#507](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/507), the approved #110 privacy entry, scoped authorization, #133 protected release authority, and isolated staging are still required before any backend connection or live use.

```mermaid
flowchart TD
    Synthetic["Synthetic local protected-layout proof"] --> Person["Signed-in person's My Account preview"]
    Synthetic --> Guard["Existing administrator guard"]
    Person --> Account["Photo and separate finder-choice controls disabled"]
    Guard --> Officer["People finder preview"]
    Officer --> Search["Name field and Search button disabled"]
    Account --> None["No directory name or photo read, upload, remove, search, or save"]
    Search --> None
    Release["#623 exact inert artifact published"] --> Public["Completed signed-out revision and guard readback only"]
    Public -. "does not prove protected layout" .-> Synthetic
    Hardening["#627 connected-interface hardening — SOURCE ONLY"] --> Preserved["Accessible Account and People finder branches preserved behind false availability"]
    Preserved -. "NOT LIVE; cannot be mounted until reviewed connection" .-> Later
    Later["Later #507 reviewed source flip"] --> Gates["Privacy, scoped authorization, staging, and backend-first readback"]
    Gates --> Connected["Future optional name search with voluntary thumbnails"]
    Connected -. "never photo search or proof" .-> Official["Membership, role, payment, or official records"]
```

Text alternative: synthetic local artifacts prove the signed-in Account preview and administrator-guarded People finder with every directory control disabled. #623 published the exact inert artifact. Completed signed-out public checks prove only its exact revision, normal guards, and absence of a directory request, not the protected layouts. #627 preserves accessible connected Account and People finder branches only in source behind the unchanged false availability value, so that hardened structure is not live or mounted. Only a later #507 source flip after privacy, authorization, staging, and backend-first readback could connect the optional name search and voluntary thumbnails. It will not search a photo, and a result will not prove or change an official record.

Officer review steps for the #621 frontend preview:

1. Keep the profile photo and People finder backend marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #621 source pull request, commit, and frontend test record.
3. Confirm the source-controlled availability boundary defaults unavailable.
4. Confirm the default My Account path mounts no connected profile component.
5. Ask the platform owner for dated synthetic local screenshots of both protected layouts at desktop and 320-pixel widths.
6. Confirm those screenshots contain only a made-up local account and no real name or photo.
7. Confirm the local My Account layout shows a visible interface-preview notice.
8. Confirm its thumbnail placeholder, file control, and finder choice are disabled.
9. Confirm the preview says no directory photo or finder setting is read, uploaded, searched, or saved.
10. Confirm the default account test creates no request number and calls no directory service.
11. Confirm the People finder route still requires the administrator guard and normal account/role check.
12. Confirm the local People finder layout shows a visible interface-preview notice.
13. Confirm its name field and Search button are disabled.
14. Confirm the preview accepts no finder name and loads no directory profile, sample, or result card.
15. Confirm the default officer test creates no request number and calls no directory search service.
16. Confirm both synthetic layouts remain readable at 320 pixels without horizontal overflow.
17. Confirm keyboard focus does not offer an enabled directory action.
18. Confirm the visible notices programmatically describe the disabled controls.
19. Confirm the copy says a future upload will not opt a person in.
20. Confirm the copy says a future result will not prove membership.
21. Confirm the copy says there is no photo query or facial recognition.
22. Confirm synthetic tests still cover the preserved connected branches through an explicit test seam.
23. Ask the platform owner for the completed #623 publication record.
24. Confirm it names release ID `WEB-002C-MEMBER-DIRECTORY-PREVIEW-2026-08-13`, merge `9d5cc8612b4321172370bd949d307e7e4ac0ec7d`, and deploy `6a7e072f8f346b0008510d29` published on 2026-08-13.
25. Confirm its marker names source `c2d87d1f69f15e128a0bc9b1b9f915b7c8417aec`, tree `411aa6ec9a9459f5d923030533ffc7c007fe6908`, previous source `39ab8649df411262c8109a3c81a57bc38f1e168b`, rollback deploy `6a6dc9ea588b0c0008036312`, 62 files, and digest `d837272a1e5efc1575809e87f532276b38d1a63f1dd79ec1aef0533f6da8afb1`.
26. Confirm the release record says no Firebase, provider, account, sign-in, or production-data action occurred.
27. Ask the platform owner for the matching signed-out public revision readback.
28. While signed out, open `/account` and confirm the normal sign-in boundary remains.
29. While signed out, open `/admin/member-directory` and confirm the administrator boundary remains.
30. Ask the platform owner for the anonymous public network record.
31. Confirm that record contains no member-directory callable request.
32. Confirm the manifest was re-paused and its attempt did not replace the verified deploy.
33. Stop. Do not sign in to production, choose a file, enter a name, call Firebase directly, or use production member data.

Officer review steps for the preserved #505 connected source only:

1. Keep the complete photo and people-finder feature marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #505 pull request, commit, and synthetic test record.
3. Confirm the test uses generated colored pixels, not a real person's photo.
4. Confirm a missing choice is off.
5. Confirm uploading or replacing the generated image does not turn the choice on.
6. Confirm clearing the made-up account's display name leaves opt-out available but makes the account ineligible for a result until a valid name is restored.
7. Confirm the server keeps only a small 256-pixel WebP thumbnail and no submitted original, filename, or location metadata.
8. Confirm turning the choice off does not delete or change an official account, role, membership, registration, or payment record.
9. Confirm removing the photo is a separate action and deletes the active thumbnail.
10. Confirm an uncertain change hides further controls until the person deliberately reloads the settings; a fixed server rejection instead refetches current settings and leaves controls available.
11. Stop the #505 review. Do not enable the production Account controls, upload a real photo, or edit Firebase.

Officer review steps for the preserved #506 connected source only:

1. Keep the complete feature marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #506 pull request, commit, and synthetic test record.
3. Confirm the separate page is named **People finder** at `/admin/member-directory`.
4. Confirm **Website accounts** says its broad name/email filter is for website-role work.
5. Confirm **Website accounts** says that filter does not honor People finder choices and is not the official membership roster.
6. Type a made-up name prefix in the isolated test.
7. Confirm typing alone sends nothing.
8. Select **Search**.
9. Confirm browser autocomplete is off.
10. Confirm the server accepts only safely normalized names from 2 through 80 characters.
11. Confirm the made-up verified admin can search under the current temporary access boundary.
12. Repeat the denial check with a made-up member role.
13. Repeat the denial check with an unverified admin-shaped account.
14. Repeat the denial check with a malformed admin role.
15. Repeat the denial check without App Check proof.
16. Repeat the denial check while signed out.
17. Search a made-up name prefix that returns cards.
18. Confirm no more than 24 cards appear.
19. Confirm each card shows only one current display name and either one current 256-pixel thumbnail or a clear no-photo fallback.
20. Confirm no card shows email, phone, role, account ID, membership, payment, registration, or provider data.
21. Run the prepared search/opt-out race.
22. Confirm a search transaction ordered after completed opt-out retries and returns no card.
23. Confirm the notice says an earlier-committed search cannot be recalled and its response may arrive later.
24. Change the made-up display name.
25. Confirm later results use only the current display name.
26. Replace the generated thumbnail.
27. Confirm later results use only the replacement thumbnail.
28. Remove the generated thumbnail.
29. Confirm later results show the no-photo fallback.
30. Clear or invalidate the made-up display name.
31. Confirm the account stays hidden from later results.
32. Reuse the same made-up request number.
33. Confirm the reused number returns one fixed failure without replaying prior personal results.
34. Confirm the reused number creates no second search audit.
35. Confirm the private audit records only the officer account ID, fixed purpose/action, request number, query-length group, result count, fixed outcome, and time.
36. Confirm the audit contains no typed name, returned name, entry reference, photo, source row, or raw error.
37. Confirm direct browser access cannot list the private search entries, preferences, photos, audits, or rate counters.
38. Set the source page to a 320-pixel width with only synthetic data.
39. Confirm loading, no-result, fixed-error, and missing-photo states remain readable.
40. Stop. Do not enable connected production Account or Admin controls, search a real name, inspect a real profile, or edit Firebase.

Officer review steps for MEMBERS-DIRECTORY-001E [#627] connected source only:

The section purpose, approvers, stop conditions, undo path, and escalation roles remain unchanged. This review checks source and generated test evidence only.

1. Keep the complete profile-photo and People-finder feature marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #627 reviewed pull request, merge commit, and generated-only frontend test record.
3. Confirm the source-controlled availability value remains byte-for-byte `false`.
4. Confirm production deploy `6a7e072f8f346b0008510d29` remains the unchanged inert #623 preview.
5. Confirm the tests use only made-up names and generated non-face images.
6. Confirm My Account supplies the current full display name to the preserved connected profile controls.
7. Confirm new opt-in uses the same bounded Unicode display-name eligibility as the private projection.
8. Confirm an ineligible current name cannot turn on a new finder choice.
9. Confirm an existing finder choice can still be turned off after the current name becomes ineligible.
10. Confirm a current-name update immediately changes the connected controls' eligibility message and state.
11. Confirm every no-photo placeholder is announced as an image with a clear no-photo label.
12. Confirm a photo-selection or photo-change error describes the file control.
13. Confirm a photo-removal error describes the remove button.
14. Confirm a finder-setting error describes the finder checkbox.
15. Confirm those fixed errors expose no provider, account, endpoint, or raw failure detail.
16. Confirm an invalid finder query marks the name field invalid.
17. Confirm the invalid-query instruction describes the name field.
18. Confirm a fixed search failure describes the name field without marking the name invalid.
19. Confirm a successful non-empty search announces `Search complete. Matching result cards are available below.`
20. Confirm the completion announcement exposes no result count.
21. Confirm the connected result view exposes no total, cursor, or pagination.
22. Confirm the native checkbox, name field, and buttons remain keyboard-operable.
23. Confirm the interactive controls retain at least a 44-pixel height.
24. Confirm the form, input, action, messages, fallback, and result cards use explicit readable foreground and background colors.
25. Confirm the search action stacks within the 320-pixel synthetic view.
26. Confirm a deferred file read cannot submit after the application or made-up account changes.
27. Confirm a deferred file read cannot render an older error or result after that context changes.
28. Confirm the default Account and administrator-guarded branches still accept no file or name.
29. Confirm the default branches still create no request number or directory service context.
30. Confirm #627 changes no Function, Rule, index, service contract, package, workflow, release control, provider setting, account, sign-in state, or production data.
31. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, provider configuration, account/sign-in change, production data, and connected behavior as separate results.

**#627 expected result:** the reviewed source applies the projection's exact name-eligibility boundary to new opt-in, preserves turn-off after a name becomes ineligible, improves control and placeholder semantics, announces a non-empty search without a count, uses scoped readable colors, contains native controls at 320 pixels, and makes an older file read inert after its Account context changes. The availability value remains `false`. The default branch remains inert, and the live #623 preview remains unchanged. Neither makes a directory request. The backend and connected behavior remain **NOT AVAILABLE YET**. A merge is not website publication.

**#627 success proof:** record the exact issue, reviewed pull request and merge commit, green focused and full frontend checks, type-checking, diagnostic production build, unchanged lint baseline, independent privacy/security, frontend/accessibility, and backup-officer GO reviews, and exact-main CI. Record the unchanged `false` availability value and the unchanged #623 deploy separately. Record website publication, `runmprc.com` revision change, Firebase deployment, Rules or index change, provider configuration, account/sign-in change, production-data action, and connected behavior as **not performed**. Final connection and live proof remain #507 work.

**Expected result:** production deploy `6a7e072f8f346b0008510d29` defaults to a visibly disabled preview that makes zero directory calls, accepts no file or name, and shows no person. Separate synthetic tests prove the protected disabled layouts and preserved connected source. Completed signed-out public readback proves only the exact revision, normal guards, and absence of a member-directory request. The backend and connected behavior remain unavailable. There is no public directory, official roster, public photo URL, Firebase Storage object, photo-as-query path, face recognition, similarity score, embedding, biometric template, export, result total, or pagination.

**Stop conditions:** an enabled preview control; a preview that reads saved directory state, accepts a file or finder name, creates a directory request number, calls a directory service, or shows a sample or result card; a real person, name, photo, member record, production sign-in, direct production Firebase access, production data change, or member-directory callable request; a public/permanent photo URL; an upload that silently opts in; a result from a search transaction ordered after completed opt-out; a notice that fails to explain that an earlier-committed response may still arrive; raw image, name, query, result identity, or provider detail in a log, issue, screenshot, message, email, or AI tool; a request for photo search, face recognition, similarity matching, or biometric processing; missing privacy approval for connected publication; an unreviewed availability flip; or a claim that source, tests, merge, frontend publication, or preview means the backend feature is live.

**Success proof:** record the exact #505, #506, and #621 pull requests and merge commits; green focused and full checks; dependency review; independent privacy/security and backup-officer reviews; and explicit statements that Firebase, providers, accounts/sign-in, and production data were unchanged. For #623, record preview deploy `6a7e05febf8fde00084cf9e0`, preview head `1fdb31f71fcaf01c33b5e57a4cd28fc473a4a737`, PR CI `31728469418`, release merge `9d5cc8612b4321172370bd949d307e7e4ac0ec7d`, exact-main CI `31728908486`, production deploy `6a7e072f8f346b0008510d29`, exact public marker, signed-out guards, anonymous no-connected-symbol/request result, repause head `d401daa409176dce0906c245adf3f20310cb513b`, repause PR CI `31728977578`, repause merge `c8678c623afdd9becf77d596b71f36f26f04b746`, repause exact-main CI `31729248865`, unpublished attempt `6a7e081e73fdd60009f7ba57`, and retained-deploy readback. Record that the manifest is inactive, release source is absent, and rollback ref remains. Synthetic artifacts and tests prove only the disabled protected layouts and default zero-directory-call branches. Publication and anonymous readback prove only the exact revision, signed-out guards, and absence of a public member-directory request. Record separately that the privacy notice, Firebase/backend deployment, provider configuration, account/sign-in change, production-data action, connected behavior, and live directory were not performed. Final connected live proof belongs to #507.

**Undo:** before or after frontend-preview publication, use one reviewed frontend revert or safe roll-forward and read back the exact disabled state. The #621 preview changes no Firebase record to undo. After a future approved backend release, use the documented backend-first release path and verify opt-out/removal with a made-up account. Never undo by deleting or editing a real account or Firebase record manually.

**Escalation:** membership lead plus privacy and platform/security owners. Use the private incident path if a real photo/name appeared, a visibility choice was wrong, or deletion could not be confirmed.

## Admin screens — NOT AVAILABLE YET

Admin event and product editors exist in source, but their live permissions, backup, preview, and rollback behavior have not been approved. Saving can write directly to production Firestore. Officers must not use these screens as a continuity procedure yet.

### Source protection in #100 — NOT LIVE YET

Issue [#100](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/100) narrows the source rules for these screens. It does not prove that Firebase received those rules.

After that source change merges:

- A browser can create only an inactive event or product draft with no live price, capacity, sale, registration, waiver, volunteer, or custom-field setup.
- A browser can edit ordinary display text and approved HTTPS image/result links.
- A browser cannot change event price, capacity, registration state, member visibility, waiver setup, volunteer setup, or collected registration fields.
- A browser cannot change product price, sale status, sizes, colors, inventory, orders, or payment state.
- A browser admin cannot directly change a member role or read stored connection secrets.

Those protected changes need a small, reviewed server action. That action is **NOT AVAILABLE YET**. Until it exists and is tested, use [Request a change](./REQUEST_A_CHANGE.md).

```mermaid
flowchart LR
    A["Officer browser"] --> B["Display-only draft details"]
    B --> C["Firestore rules"]
    C --> D["Event or product draft"]
    A -. "blocked" .-> E["Price, capacity, access, waiver, sale, or payment state"]
    F["Scoped server action — NOT AVAILABLE YET"] -. "future approved path" .-> E
```

Text alternative: the officer browser may send display-only draft details through Firestore rules. Operational, access, legal, and money fields stay blocked until a future approved server action exists.

**Proof state:** source and emulator tests may pass in #100. Firebase deployment, the live rule version, the Admin screens, and production behavior remain unproven until #105 records each state separately.

Before an officer click guide may be added, a claimed issue must prove all of the following with made-up data in an isolated staging project:

1. Only the intended officer role can open and save each screen.
2. A draft stays private to ordinary visitors.
3. A second officer can preview without changing production.
4. Backup and restore are tested.
5. Every field has an approved owner and validation rule.
6. Publishing requires a separate, explicit approval.
7. Closing an event or product has a documented effect on existing Checkout Sessions.
8. A real no-code checkout kill switch is implemented and tested.
9. Audit records show who changed what and when.
10. The rollback procedure is tested before production access is granted.

Until that issue closes, request event/product changes through [Request a change](./REQUEST_A_CHANGE.md). Use a reviewed pull request or a specialist-run, test-only demonstration; do not enter real members, registrations, products, prices, or payment details.

### Admin product-list load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give an officer one plain instruction when the Admin Products list cannot load, without showing a Firebase, database, provider, account, endpoint, token-shaped, or technical detail, without falsely saying that the catalog is empty, and without showing a result left over from an earlier database or readiness state.

**Approver:** shop lead plus platform/security and privacy owners. Add the treasurer before any future live commerce-admin review.

**Prerequisites:** issues [#277](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/277) and [#498](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/498) must be merged for source review. Use only a mocked admin identity, mocked database references, made-up products, mocked readiness changes, and mocked fulfilled or rejected list lookups. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply: these slices do not approve the screen, role, permissions, backup, preview, rollback, product editing, publication, checkout, or production use. They do not deploy Firebase, change database permissions or product records, contact Stripe or another provider, use production data, or prove live behavior.

```mermaid
flowchart LR
    A["Made-up Admin Products route"] --> B["Current mocked database lookup"]
    B -- "Fulfilled empty" --> C["Existing No products yet state"]
    B -- "Fulfilled with products" --> D["Existing product table"]
    B -- "Rejected" --> E["Fixed alert; no empty state or table"]
    F["Database or readiness changes"] --> G["Immediate loading state; old results hidden"]
    G --> B
    H["Older result or result received after leaving"] -. "Ignored" .-> I["No page change; current result stays or page stays closed"]
```

In words: only a successful lookup for the current mocked database may show the existing empty catalog or product table. A mocked rejection shows one fixed alert while keeping the Products heading and navigation; it does not turn an unknown result into an empty catalog. A database or readiness change hides the earlier result immediately, and an older result or a result received after leaving the page cannot settle the page.

Officer review steps after the source merge:

1. Keep the Admin product-list failure sentence and the complete Admin Products screen marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #277 and #498 issues, reviewed pull requests, merged commits, and synthetic frontend test results.
3. Confirm the tests use only a made-up admin identity, mocked database references, made-up products, mocked readiness changes, and mocked lookups. Do not use a real officer account or product record.
4. Confirm a mocked rejection shows exactly `We could not load products right now. Please try again later.`
5. Confirm assistive technology receives the complete sentence immediately as one alert.
6. Confirm no made-up rejection-only email, database, Firebase, provider, account, endpoint, token-shaped, or technical detail appears on the page, in analytics, or in five browser console methods.
7. Confirm a hostile rejected value is not inspected and its throwing `message` property is never touched.
8. Confirm the rejected lookup ends loading and shows neither **No products yet** nor a product table.
9. Confirm the **Products** heading and existing **Orders** and **New product** links remain available without following either link.
10. Confirm each current mocked lookup receives its matching mocked database reference exactly once.
11. Confirm a successful mocked empty list still shows **No products yet**, and a successful made-up product still shows its existing title, price, status, and edit link.
12. Confirm giving the page the same ready mocked database again does not start another lookup when only its surrounding test setup object is replaced.
13. Confirm a not-ready page with a mocked database and a ready page without a mocked database both stay in loading and start no lookup.
14. Confirm a changed database hides the earlier empty result, product table, or failure immediately.
15. Confirm loss of readiness hides the earlier empty result, product table, or failure immediately.
16. Confirm readiness recovery starts one new lookup for the current database and never briefly shows the earlier result, including when the exact same database returns.
17. Confirm an older success or hostile rejection cannot replace a newer result.
18. Confirm a success or hostile rejection received after leaving the page causes no page change and is not inspected.
19. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, provider, product-record, production-data, admin-screen approval, and live-behavior evidence as separate results.

**Expected result:** the reviewed source discards the complete rejected value without binding or inspecting it and shows one fixed accessible retry-later sentence. A failure is not treated as an empty or populated catalog. Only the current ready database may supply the displayed result; database and readiness changes hide older results immediately, and an older result or a result received after leaving the page causes no change. Replacing only the surrounding test setup object does not repeat a lookup for the same ready database. The Products heading and navigation remain, while genuine successful empty and populated results keep their existing displays. This does not authorize an officer to open or use the Admin Products screen live.

**Stop conditions:** any real officer, member, product, price, inventory, order, checkout, payment, Firebase, Stripe, provider, endpoint, credential, or production record used to exercise the failure; a request to force a production error; a raw detail on the page, in analytics, or in the console; the false empty state or a product table after rejection; an earlier catalog result visible after the database or readiness changes; an obsolete result settling the page; an attempted product/admin write; a Firebase, Rules, provider, or permission change; or a claim that source, tests, merge, preview, or a green workflow proves the sentence or Admin screen is live.

**Success proof:** for source completion, record the exact #277 and #498 issues, reviewed pull requests, merged commits, intended old-source failures, green synthetic actual-route tests, relevant full checks, and independent privacy, accessibility, lifecycle, and officer-continuity reviews. The safe review path stops at source and synthetic tests because the Admin screen is not approved for officer use. Live availability requires a later separately approved Admin-screen release and dated exact-revision verification after every prerequisite above is complete. Record website publication, `runmprc.com`, Firebase deployment, database-permission changes, provider configuration, product-record changes, production-data actions, and live behavior as **not performed** for these frontend-only slices unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend revert or safe roll-forward. After any later approved publication, use the same protected website release path and verify the replacement revision. Do not undo by changing or deleting a product, order, payment, officer account, permission, database record, source document, or provider setting.

**Escalation:** shop lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, Firebase, provider, account, product, order, payment, endpoint, token-shaped, or technical detail appeared. Add the treasurer if a commerce or payment state might be involved. Do not copy private details into an issue, message, screenshot, email, or AI tool.

No system-topology diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only the corrected failure display and current mocked lookup lifecycle.

### Admin Product editor load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give an officer one plain instruction when the Admin Product editor cannot load the named product, without showing a Firebase, database, provider, account, endpoint, token-shaped, or technical detail and without leaving an editable form available for an unknown product state.

**Approver:** shop lead plus platform/security and privacy owners. Add the treasurer before any future live commerce-admin review.

**Prerequisites:** issue [#296](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/296) must be merged for source review. Use only a mocked admin identity, mocked database references, made-up products, and mocked lookup results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply: this slice does not approve the editor, role, permissions, backup, preview, rollback, product saving, publication, checkout, or production use. It does not change create/update behavior, deploy Firebase, change Rules, permissions, or product records, contact Stripe or another provider, use production data, or prove live behavior.

```mermaid
flowchart LR
    A["Made-up Admin Product edit route"] --> B["Mocked current product lookup"]
    B -- "Resolved product" --> C["Existing populated edit form"]
    B -- "Resolved missing" --> D["Existing Product not found result"]
    B -- "Rejected or unknown" --> E["Fixed alert; no form or Save action"]
    F["Older route or service result"] -. "Ignored" .-> C
```

Text alternative: only the current mocked lookup may settle the editor. A current product keeps the existing form, a current missing result keeps the existing not-found result, and a rejected or unknown result shows one fixed alert with no editable form; an older result cannot replace the current page.

Officer review steps after the source merge:

1. Keep this failure sentence and the complete Admin Product editor marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #296 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, made-up products, and mocked lookups.
4. Confirm a mocked rejection shows exactly `We could not load this product right now. Please try again later.`
5. Confirm assistive technology receives the complete sentence immediately as one alert.
6. Confirm no rejection-only database, Firebase, provider, account, endpoint, token-shaped, or technical detail appears on the page, in analytics, or in five browser console methods.
7. Confirm a hostile rejected value is not inspected and its throwing `message` property is never touched.
8. Confirm a rejected lookup ends loading and shows no product form or **Save changes** action.
9. Confirm the generic **Edit product** heading and **All products** link remain without following the link.
10. Confirm an older route or service rejection cannot replace a later current product, and a later current success can recover from an earlier failure.
11. Confirm a current missing made-up product keeps the existing `Product not found` result and a current successful made-up product keeps its existing fields and disabled slug.
12. Confirm the mocked lookup receives only the current mocked database reference and route slug. Do not submit or save the form.
13. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, provider, product-record, production-data, Admin-screen approval, and live behavior as separate results.

**Expected result:** the reviewed source discards the complete rejected value without binding, inspecting, logging, measuring, storing, or rendering it. A rejection shows one fixed accessible retry-later sentence and no editable form. Only the current route and database lookup may settle the page; older results are inert, and a later current success recovers. Existing current missing-product and successful-product displays remain distinct. Issue [#496](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/496) separately contains the save rejection and immediate repeat-click boundary. Its local validation, create/update request shapes, and current successful navigation remain unchanged. Neither slice authorizes an officer to open, edit, or save an Admin Product screen live.

**Stop conditions:** any real officer, member, product, price, inventory, order, checkout, payment, Firebase, Stripe, provider, endpoint, credential, or production record used to exercise the failure; a request to force a production error; a raw detail on the page, in analytics, or in the console; a product form or Save action after an unknown result; a stale product after the route or database changes; an attempted product/admin write; a Firebase, Rules, provider, or permission change; or a claim that source, tests, merge, preview, or a green workflow proves the sentence or editor is live.

**Success proof:** for source completion, record the exact #296 issue, reviewed pull request, merged commit, intended old-source failure, nine green synthetic actual-route tests, relevant full checks, and independent privacy, accessibility, lifecycle, and officer-continuity reviews. The safe review path stops at source and synthetic tests because the Admin screen is not approved for officer use. Live availability requires a later separately approved Admin-screen release and dated exact-revision verification after every prerequisite above is complete. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, product-record changes, production-data actions, saves, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After any later approved publication, use the same protected website release path and verify the replacement revision. Do not undo by changing or deleting a product, order, payment, officer account, permission, database record, source document, or provider setting.

**Escalation:** shop lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, Firebase, provider, account, product, order, payment, endpoint, token-shaped, or technical detail appeared. Add the treasurer if a commerce or payment state might be involved. Do not copy private details into an issue, message, screenshot, email, or AI tool.

No system-topology diagram changes for this source slice because data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only the editor's load-result display and current-request lifecycle.

### Admin Product save unknown result — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop one open Admin Product editor page from starting a second save after the first result becomes unknown. A pending or unknown save must show no product detail, form, save button, cancel action, database detail, or provider detail.

**Approver:** shop lead, treasurer, and platform/security and privacy owners.

**Prerequisites:** issue [#296](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/296) and issue [#496](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/496) must be merged for source review. Use only a made-up admin identity, mocked database references, made-up products, and mocked save results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. This slice does not approve the editor, save a product, add server idempotency, reconcile an unknown write, deploy Firebase, change Rules or permissions, use production data, or prove live behavior.

Before #496, the page could inspect and show a rejected provider message, accept two immediate save requests, fall back to the text `admin` when no current account ID existed, and enable Save again after a rejected request that might already have written the product. An older request could also send the officer to the product list after the route, database connection, account, ready state, or page had changed.

```mermaid
flowchart LR
    A["Current made-up product form"] --> B["Local validation"]
    B -- "Invalid" --> C["Fixed local correction; no save attempt"]
    B -- "Valid" --> D["One browser-page save attempt"]
    D --> E["Fixed polite pending status; no form or action"]
    E -- "Current mocked success" --> F["Existing Admin Products navigation"]
    E -- "Current mocked rejection" --> G["Fixed unknown alert; no form, action, reload, or repeat"]
    H["Older or closed-page result"] -. "Ignored" .-> I["No navigation or display change"]
    J["Reload, another tab, device, or script"] -. "Not protected by this browser guard" .-> K["Stop; private reconciliation is still required"]
```

Text alternative: local validation errors remain correctable without a save. One valid form may start one mocked save on the current page. Pending work hides the form and actions. A current mocked success keeps the existing navigation. A current rejection shows one fixed stop alert and no retry. An older or closed-page result changes nothing. Reloading or using another tab, device, or script is outside this browser guard and never makes a repeat safe.

Officer review steps after the source merge:

1. Keep the complete Admin Product editor marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #496 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, made-up products, and mocked create or update requests.
4. Confirm a local form error starts no save, appears as one accessible alert, and remains correctable.
5. Confirm one valid made-up edit sends the existing database reference, product path, and product input exactly once.
6. Confirm one valid made-up create sends the existing database reference, product input, and exact current made-up admin ID exactly once.
7. Confirm no create starts when the current database reference or admin ID is missing, and no edit starts when the current product lookup is missing.
8. Confirm two immediate submissions still start only one request.
9. Confirm a pending request shows exactly `Product save in progress. Do not start another save.`
10. Confirm assistive technology receives the whole pending sentence politely as one status.
11. Confirm pending work shows no product title, field, form, **Create product**, **Save changes**, **Cancel**, or **All products** action.
12. Confirm an ordinary or hostile mocked rejection shows exactly `We could not confirm that product save. Do not repeat it. Stop and contact the shop lead, treasurer, and platform owner.`
13. Confirm assistive technology receives the whole unknown-result sentence immediately as one alert.
14. Confirm the rejected value is not inspected, coerced, logged, measured, stored, sent to analytics, or displayed.
15. Confirm the unknown result shows no product title, field, form, create, save, cancel, navigation, reload, or retry action.
16. Confirm changing the route, database reference, ready state, or made-up admin ID makes the older mocked success or rejection inert.
17. Confirm a result received after the page closes is inert.
18. Confirm an internal page update with the same effective route, database reference, and made-up admin ID does not clear an unknown lock.
19. Confirm a current mocked success keeps the existing one-time navigation to the Admin Products list.
20. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Rules or permissions, provider configuration, product records, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** one mounted page admits at most one valid mocked save for its current route, database reference, and made-up admin ID. Pending work shows one fixed polite status and no product detail or action. A current rejection is discarded without inspection and becomes one fixed terminal alert. An older or closed-page result is inert. A current success preserves the existing request and navigation. A missing admin ID or database reference starts no save.

This is only an immediate browser-page guard. Leaving or reloading the page resets it. Another tab, device, account, or script can repeat a write. The current create service still checks then writes without one durable command ID. The current update service has no version fence. A rejected database promise might already have committed. Do not use refresh, navigation, a new tab, a new device, another account, or direct database inspection as a reconciliation method or a reason to repeat the save.

**Stop conditions:** any real officer, member, product, price, inventory, order, checkout, payment, Firebase, Stripe, provider, endpoint, credential, or production record used to exercise a save; a request to force a production failure; a private or technical detail on the page, in analytics, in the console, or in a review record; more than one mocked request; any form or action visible during pending or unknown state; any older result that navigates or changes the page; a reload, navigation, new tab, device, account, script, manual database inspection, or repeated save offered as recovery; a Firebase, Rules, permission, or product-record change; or a claim that source, tests, merge, preview, or a green workflow proves the result or editor is live.

**Success proof:** for source completion, record the exact #496 issue, reviewed pull request, merged commit, old-source failures, green synthetic actual-route tests, relevant full checks, and independent privacy/security, lifecycle/compatibility, accessibility, and officer-continuity reviews. The safe officer review stops at source and mocked tests because the Admin screen is not approved for officer use. A future live process still needs server-authoritative idempotency, durable audit, private readback and reconciliation, authorization, backup, rollback, approved deployment, and exact-revision verification. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, product changes, production-data actions, saves, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by refreshing, leaving the page, repeating a save, or creating, changing, deleting, or manually repairing a product, order, payment, officer account, permission, database record, source document, or provider setting.

**Escalation:** stop and contact the shop lead, treasurer, and platform/security owner. Add the privacy owner if any private or technical detail appeared. Use the private incident path if a save might have completed, another request was attempted, or the page navigated after its context changed. Do not copy product details, provider details, database records, or account details into an issue, screenshot, email, message, or AI tool.

No system-topology diagram changes are required because this source slice changes no server authority, data movement, permissions, account ownership, or deployment topology. The state-flow diagram above records only the current browser page's save display and immediate repeat guard.

### Admin event-list load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep an older Admin Events list hidden when the page's ready database setup is removed or replaced, and give an officer one plain message when the current mocked list cannot load.

**Approver:** events lead plus platform/security and privacy owners. Add the treasurer before any future live commerce-admin review.

**Prerequisites:** issues [#290](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/290) and [#565](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/565) must be merged for source review. Use only a mocked admin identity, plain made-up database references, made-up events, and controlled mocked lookups. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. This work does not approve the screen, role, permissions, backup, preview, rollback, event editing, publication, registration, payment, or production use. It does not choose the event source reserved to #121. It does not deploy Firebase, change Rules, permissions, or event records, contact Stripe or another provider, use production data, or prove live behavior.

```mermaid
flowchart LR
    A["Made-up Admin Events route"] --> B{"Ready database reference?"}
    B -- "No" --> C["Loading; no old rows or row actions"]
    B -- "Yes" --> D["One current mocked lookup"]
    D -- "Fulfilled empty" --> E["Existing No events yet state"]
    D -- "Fulfilled with events" --> F["Existing current events table"]
    D -- "Rejected" --> G["Fixed alert; no empty state or table"]
    H["Readiness or services removed"] --> C
    I["Ready database replaced"] --> K["Hide old rows; show loading"]
    K --> D
    L["Same database repeated"] -. "No second lookup" .-> J["No display change"]
    M["Older or closed-page result"] -. "Ignored" .-> J
```

In words: without one ready mocked database reference, the page shows loading and no old event rows. A changed database hides the earlier table before one current lookup starts. Only that current lookup may show the existing empty state, current table, or fixed alert. Repeating the same made-up database setup does not reload. An older or closed-page result changes nothing.

Officer review steps after the source merge:

1. Keep this failure sentence and the complete Admin Events screen marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #290 and #565 issues, reviewed pull requests, merged commits, and synthetic test results.
3. Confirm the tests use only a made-up admin identity, made-up database references, made-up events, and controlled mocked results.
4. Confirm a missing ready database shows **Loading...**.
5. Confirm that missing ready database starts no event-list lookup.
6. Confirm that missing ready database shows no old event row or row action.
7. Confirm losing readiness immediately hides an earlier made-up table.
8. Confirm losing services immediately hides an earlier made-up table.
9. Confirm losing the database reference immediately hides an earlier made-up table.
10. Confirm changing database A to database B hides every A row before the B result arrives.
11. Confirm database B starts exactly one current mocked lookup.
12. Confirm repeating the same made-up database setup starts no second lookup.
13. Confirm an older success cannot replace the current empty state or table.
14. Confirm an older failed result is ignored without reading or revealing any private detail.
15. Confirm a result received after the page closes is ignored without reading it.
16. Confirm a current mocked rejection shows exactly `We could not load events right now. Please try again later.`
17. Confirm assistive technology receives the complete failure sentence immediately as one alert.
18. Confirm the current failure shows neither **No events yet.** nor an events table.
19. Confirm the **Events** heading and **+ New event** link remain without following the link.
20. Confirm a current mocked empty list keeps **No events yet.**
21. Confirm a current made-up event keeps the existing table display and row links.
22. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, provider, event records, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** no result appears until one ready mocked database completes its current lookup. A missing or changed database context immediately hides earlier rows and actions. Older and closed-page results are inert. A current failure is discarded without inspection and becomes one fixed accessible sentence. A current successful empty or populated result keeps the existing display. The Events heading and New event navigation remain. This does not authorize an officer to open or use the Admin Events screen live.

**Stop conditions:** any real officer, member, event, registration, location, discount, waiver, price, capacity, payment, Firebase, Stripe, provider, endpoint, credential, or production record used in a check; any request to force a production error; any raw detail on the page, in analytics, or in the console; any old row or action visible after readiness, services, or database identity changes; any lookup made without a database; any older result changing the page; any extra lookup caused only by repeating the same made-up database setup; any false empty state or table after rejection; any event or admin write; any Firebase, Rules, provider, permission, or event-source change; any attempt to decide #121 work; or any claim that source, tests, merge, preview, or a green workflow proves this behavior is live.

**Success proof:** for source completion, record the exact #290 and #565 issues, reviewed pull requests, merged commits, intended old-source failures, green synthetic current-context tests, relevant full checks, and independent privacy, lifecycle, compatibility, accessibility, and officer-continuity reviews. The safe review stops at source and synthetic tests because the Admin screen is not approved for officer use. Live availability still needs a separately approved Admin-screen release and dated exact-revision verification. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, event-record changes, production-data actions, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by changing or deleting an event, registration, payment, officer account, permission, database record, source document, or provider setting.

**Escalation:** stop and contact the events lead plus platform/security owner. Add the privacy owner if any old or private detail appeared. Add the treasurer if commerce or payment state might be involved. Use the private incident path if stale data appeared under another account or database context. Do not copy private details into an issue, message, screenshot, email, or AI tool.

No system-topology diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only the corrected list lifecycle and display.

### Admin dashboard summary load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give an officer one plain result when the Admin dashboard cannot load a complete summary. The page must not show a private technical detail, a false zero, a partial money total, or figures from an older request.

**Approver:** events lead plus platform/security and privacy owners. The treasurer must also approve any future live review of registration or gross-payment figures.

**Prerequisites:** issue [#297](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/297) must be merged for source review. Use only a made-up admin identity, mocked database references, made-up events and registrations, and mocked lookup results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. This slice does not approve the dashboard, role, permissions, backup, preview, rollback, event source, publication, registration, payment, or production use. It does not deploy Firebase, change Rules or records, contact Stripe or another provider, use production data, or prove live behavior.

```mermaid
flowchart LR
    A["Made-up Admin dashboard"] --> B["Mocked event-list lookup"]
    B -- "Rejected" --> F["Fixed alert; no summary"]
    B -- "Fulfilled; no next event" --> C["Complete overall totals"]
    B -- "Fulfilled; next event" --> D["Mocked registration lookup"]
    D -- "Rejected" --> F
    D -- "Fulfilled" --> E["Complete overall and next-event summary"]
    G["Obsolete result"] -. "Ignored" .-> H["No display change"]
```

Text alternative: only the active event lookup and, when needed, its registration lookup may show complete figures. Either rejection shows the same fixed alert with no summary. An obsolete result changes nothing.

Officer review steps after the source merge:

1. Keep this failure sentence and the complete Admin dashboard marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #297 issue, reviewed pull request, merge commit, and synthetic test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, made-up events and registrations, and mocked results.
4. Confirm a mocked event-list or registration rejection shows exactly `We could not load the admin summary right now. Please try again later.`
5. Confirm assistive technology receives the whole sentence immediately as one alert.
6. Confirm the complete rejected value is not inspected, logged, measured, stored, sent to analytics, or displayed.
7. Confirm loading and failure show no **Next event**, **Overall**, **Total events**, **Upcoming**, **Drafts**, registration counts, gross amount, or capacity figure.
8. Confirm an older event or registration result cannot replace the current dashboard after its database reference changes or the page closes.
9. Confirm a successful empty event list shows the existing complete zero totals and starts no registration lookup.
10. Confirm a complete made-up success keeps the earliest eligible event, existing counts, gross amount, capacity calculation, date, location, and signup links.
11. Confirm the **Admin** heading and **Manage** navigation remain during loading and failure. Do not follow the links.
12. Confirm the mocked lookups receive only the active mocked database reference and selected made-up event ID.
13. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, provider, event or registration records, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** the reviewed source commits a summary only after every lookup needed for that summary succeeds. Loading and either lookup failure show no summary figures. A failure uses one fixed accessible sentence and no rejected detail. Older results are inert. Successful empty and complete made-up results keep the existing selection, counts, gross amount, capacity, date, location, and navigation. These mocked figures prove only the display calculation; they do not prove a registration, payment, refund, provider record, or live total. This does not authorize an officer to open or use the Admin dashboard live.

**Stop conditions:** any real officer, member, event, registration, runner, contact detail, waiver, price, gross amount, payment, Firebase, Stripe, provider, endpoint, credential, or production record used to exercise the failure; a request to force a production error; a raw detail on the page, in analytics, or in the console; a zero, partial, or stale summary during loading or failure; an attempted Admin action; a Firebase, Rules, provider, permission, source, or record change; or a claim that source, tests, merge, preview, or a green workflow proves the sentence or dashboard is live.

**Success proof:** for source completion, record the exact #297 issue, reviewed pull request, merged commit, eight intended old-source failures, eleven green synthetic dashboard tests, relevant full checks, and independent privacy, accessibility, lifecycle, money-display, and officer-continuity reviews. The safe review stops at source and mocked tests because the Admin dashboard is not approved for officer use. Live availability requires a later separately approved Admin-screen release and dated exact-revision verification after every prerequisite above is complete. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, event or registration changes, production-data actions, payments, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After any later approved publication, use the same protected website release path and verify the replacement revision. Do not undo by changing or deleting an event, registration, payment, officer account, permission, database record, source document, or provider setting.

**Escalation:** events lead plus platform/security owner. Add the privacy owner and use the private incident path if any database, Firebase, provider, account, event, registration, runner, endpoint, token-shaped, or technical detail appeared. Add the treasurer if a count, gross amount, refund, registration, or payment state might be wrong. Do not copy private details into an issue, message, screenshot, email, or AI tool.

No system-topology diagram changes for this source slice because page structure, data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only complete-summary display and current-request behavior.

### Admin order-list load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give an officer one safe instruction when the Admin Orders list is unknown. The page must not show a private technical detail, false zero totals, old buyer or shipping details, or order actions from an earlier request.

**Approver:** treasurer plus shop lead, platform/security owner, and privacy owner. All four roles must approve any future live review because this screen can display personal details and start money or fulfillment actions.

**Prerequisites:** issue [#303](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/303) must be merged for source review. Use only a made-up admin identity, mocked database references, made-up orders, and mocked list results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. This slice does not approve the screen, permissions, backup, rollback, refund, cancellation, fulfillment, shipping, reconciliation, or production use. It does not deploy Firebase, contact Stripe, change an order, use production data, or prove live behavior.

Before #303, the source could show raw load errors, false zero totals, or old order details after an unknown read. A merged source fix and green tests do not publish the website. A website publication does not prove Firebase, Stripe, permissions, order records, or action safety.

```mermaid
flowchart LR
    A["Made-up Admin Orders route"] --> B["Current mocked order-list lookup"]
    B -- "Pending" --> C["Loading; no order details, totals, or actions"]
    B -- "Rejected" --> D["Fixed stop alert; no order details, totals, or actions"]
    B -- "Fulfilled empty" --> E["Existing zero totals and No orders"]
    B -- "Fulfilled with orders" --> F["Existing totals, filters, table, and actions"]
    G["Obsolete result"] -. "Ignored" .-> H["No display change"]
```

Text alternative: only the current successful mocked order lookup may show totals, order details, or action buttons. Loading and rejection show no order-derived content. An obsolete result changes nothing.

Officer review steps after the source merge:

1. Keep the complete Admin Orders screen marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #303 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, and made-up orders.
4. Confirm no test clicks **Fulfill**, **Refund**, or **Cancel**.
5. Confirm a pending lookup shows **Loading...** and no totals, filters, table, buyer details, or action buttons.
6. Confirm a mocked rejection shows exactly `We could not load orders right now. Stop and contact the treasurer and platform owner before taking any order action.`
7. Confirm assistive technology receives the whole sentence immediately as one alert.
8. Confirm the rejected value is not inspected, logged, measured, stored, sent to analytics, or displayed.
9. Confirm an older success or failure cannot replace the current result after the database reference changes or the page closes.
10. Confirm a successful mocked empty list keeps the existing empty-result display: **Paid 0**, **Gross revenue $0.00**, and **No orders**.
11. Confirm a successful made-up list keeps the existing totals, filters, date and money formatting, table, and action buttons without using those buttons.
12. Confirm the **Orders** heading and **Products** link remain during loading and failure. Do not follow the link.
13. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Stripe, permissions, order records, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** the reviewed source shows order-derived content only after the current mocked list read succeeds. Loading shows no order-derived content. A rejection shows one fixed accessible stop sentence and no rejected detail, false zero, old row, or action button. Older results are inert. Successful empty and made-up populated results keep their existing displays. The fixed sentence tells the officer to stop because a failed refresh can follow an action that may already have completed.

The existing Fulfill, Refund, and Cancel requests, prompts, and action responses remain unfinished work. Issue [#333](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/333) contains only rejected-value privacy and a current-page repeat-click guard. Repeat safety, record comparison, audit, and live action safety remain open. Neither slice makes Admin Orders safe for officer use.

**Stop conditions:** any real officer, buyer, address, phone, email, order, tracking number, product, payment, refund, Firebase, Stripe, provider, endpoint, credential, or production record used to exercise the failure; a request to force a production error; a raw detail on the page, in analytics, or in the console; a zero, stale row, buyer detail, or action button during loading or failure; an attempted order action; a Firebase, Rules, provider, permission, or record change; or a claim that source, tests, merge, preview, or a green workflow proves the sentence or screen is live.

**Success proof:** for source completion, record the exact #303 issue, reviewed pull request, merged commit, ten intended old-source failures, eleven green synthetic tests, relevant full checks, and independent privacy, lifecycle, and officer-continuity reviews. The safe review stops at source and mocked tests because Admin Orders is not approved for officer use. Live availability requires a later separately approved release and dated exact-revision verification after authorization, action safety, idempotency, audit, backup, rollback, and provider evidence are complete. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, Stripe configuration, order changes, production-data actions, refunds, cancellations, fulfillment, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Do not undo by repeating an order action or changing or deleting an order, payment, refund, shipment, officer account, permission, database record, or provider setting.

**Escalation:** treasurer plus platform/security owner. Add the shop lead and privacy owner. Use the private incident path if any personal, order, payment, provider, endpoint, token-shaped, or technical detail appeared, or if an action might have completed without a current readback. Do not copy private details into an issue, message, screenshot, email, or AI tool.

No system-topology diagram changes for this source slice because page hierarchy, data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only the corrected list-result display and current-request behavior.

### Admin order-action unknown result — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give an officer one safe instruction after a Fulfill, Refund, or Cancel request has an unknown result. The page must not show a private technical detail or invite another action that could duplicate money or fulfillment work.

**Approver:** treasurer plus shop lead, platform/security owner, and privacy owner. All four roles must approve any future live review. This source slice does not provide that approval.

**Prerequisites:** issues [#303](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/303) and [#333](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/333) must be merged for source review. Use only a made-up admin identity, mocked database reference, made-up orders, mocked prompts, and a mocked action request. Do not open the Admin screen or test an action on the production website. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply.

```mermaid
flowchart LR
    A["Made-up known order row"] --> B["One mocked action request"]
    B -- "Resolved" --> C["Existing mocked list reload"]
    B -- "Rejected" --> D["Fixed unknown-result alert"]
    D --> E["All order-action buttons disabled on this page"]
    E --> F["Stop; contact treasurer and platform owner"]
    G["Complete rejected value"] -. "Discarded" .-> H["No page, analytics, or console detail"]
```

Text alternative: a successful mocked action keeps the existing one-time list reload. A rejected action discards the complete rejected value, shows one fixed alert, disables every order-action button on the current page, and tells the officer to stop.

Officer review steps after the source merge:

1. Keep the complete Admin Orders screen marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #333 issue, reviewed pull request, merged commit, and synthetic test result.
3. Confirm the review used only a made-up admin identity, made-up orders, mocked prompts, and a mocked action request.
4. Confirm the old-source test recorded eight intended failures and one successful-action compatibility result.
5. Confirm the green tests cover Fulfill, full Refund, partial Refund, and Cancel with their existing made-up request shapes.
6. Confirm every mocked rejection shows exactly `We could not confirm that order action. Do not repeat it. Stop and contact the treasurer and platform owner.`
7. Confirm assistive technology receives the complete sentence immediately as one alert.
8. Confirm the complete rejected value is not inspected, coerced, logged, stored, sent to analytics, or displayed.
9. Confirm a mocked rejection starts no automatic retry or list reload and leaves the last known made-up row visible.
10. Confirm every visible Fulfill, Refund, and Cancel button is disabled after the unknown result, including buttons on other rows.
11. Confirm another click on that page cannot start a second mocked request.
12. Confirm one successful mocked action still performs exactly one existing list reload and shows no alert.
13. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Stripe, permissions, order records, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** a rejected mocked action shows one fixed accessible instruction with no rejected detail. The current made-up order list stays visible, every order-action button is disabled for that open page, and no automatic retry or reload runs. A resolved mocked action keeps the existing single reload. The alert says the result is unknown; it does not claim the action failed.

Refreshing, closing, or reopening the page can restore the action buttons. It does not prove what happened and never makes a repeat safe. Stop and contact the treasurer and platform owner instead.

**Stop conditions:** any real officer, buyer, address, phone, email, order, tracking number, product, payment, refund, Firebase, Stripe, provider, endpoint, credential, or production record used; an attempt to force a production failure; a raw detail in the page, analytics, console, screenshot, issue, email, or AI tool; an automatic retry or reload after rejection; an enabled order-action button after the alert; a repeated action; or a claim that a browser button lock, source change, test, merge, preview, or green workflow proves financial safety or live behavior.

**Success proof:** for source completion, record the exact #333 issue, reviewed pull request, merged commit, eight intended old-source failures, ten green focused tests, relevant full checks, and independent privacy/security, compatibility, and officer-continuity reviews. The safe officer review stops at those records. A later live process still needs authorization, repeat safety, durable audit, record comparison, backup, rollback, provider, deployment, and exact-revision evidence.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Do not undo by refreshing the page, repeating an order action, or changing or deleting an order, payment, refund, shipment, account, permission, database record, or provider setting.

**Escalation:** stop and contact the treasurer plus platform/security owner. Add the shop lead and privacy owner. Use the private incident path if an action might have completed, any private or technical detail appeared, or another request was attempted. Do not copy private details into an issue, message, screenshot, email, or AI tool.

No system-topology diagram changes for this source slice because page hierarchy, data movement, permissions, account ownership, and deployment topology are unchanged. The diagram above records only the current page's action-result display and repeat-click guard.

### Admin website-account role-list load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep an unknown website-account role list private and fail closed. The page must not show a raw technical detail, false zero role counts, old names or email addresses, or role-change controls from an earlier request. A website role is not proof of annual paid membership.

**Approver:** membership lead plus identity/platform security and privacy owners. Add the treasurer before any future work that displays annual membership, dues, pricing, or discount eligibility.

**Prerequisites:** issue [#307](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/307) must be merged for source review. Use only a made-up admin identity, mocked database references, made-up website accounts, and mocked list results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. Issue [#116](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/116) remains the separate future owner of the authoritative current-membership roster and CSV export. This slice does not approve the screen or role changes, implement a roster or export, deploy Firebase, change an account or membership, use production data, or prove live behavior.

Before #307, the source could show raw load errors, false zero counts, old account details, and broad labels that could be mistaken for membership. A merged source fix and green tests do not publish the website. A website publication does not prove Firebase, permissions, account records, annual membership, dues, pricing, discounts, or role-action safety.

```mermaid
flowchart LR
    A["Made-up Admin website-account route"] --> B["Current mocked account-role lookup"]
    B -- "Pending" --> C["Loading; no role counts, account details, or role buttons"]
    B -- "Rejected" --> D["Fixed stop alert; no role counts, account details, or role buttons"]
    B -- "Fulfilled empty" --> E["Zero website-account role counts"]
    B -- "Fulfilled with accounts" --> F["Website-account roles and access controls"]
    F -. "Not membership proof" .-> G["Annual paid-membership roster — #116 NOT AVAILABLE YET"]
    H["Obsolete result"] -. "Ignored" .-> I["No display change"]
```

Text alternative: only the current successful mocked lookup may show website-account roles. Loading, rejection, and obsolete results show no account-derived content. Website roles, account dates, and email verification never prove annual paid membership; the future #116 roster is separate.

Officer review steps after the source merge:

1. Keep the Admin website-account screen and the #116 membership roster marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #307 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, and made-up website accounts.
4. Confirm no test clicks a role-change button or calls the role-change service.
5. Confirm loading and failure show no role counts, filters, names, email addresses, dates, verification state, rows, or role buttons.
6. Confirm a mocked rejection shows exactly `We could not load website accounts right now. Stop and contact the membership lead and platform owner before changing website access.`
7. Confirm assistive technology receives the whole sentence immediately as one alert.
8. Confirm the rejected value is not inspected, logged, measured, stored, sent to analytics, or displayed.
9. Confirm an older success or failure cannot replace the current result after the database reference changes or the page closes.
10. Confirm a successful mocked empty list shows only zero website-account role counts and no matching website accounts.
11. Confirm a successful made-up list uses `Website accounts`, `Website role`, and `Account created` labels while preserving the existing account-access display.
12. Confirm the `member` website role is never described as current, paid, or annual club membership.
13. Confirm account creation and email verification are never described as membership or dues evidence.
14. Confirm the #116 roster view and CSV export remain unavailable and no roster file is created.
15. Confirm the page heading and **Admin home** link remain during loading and failure. Do not follow the link.
16. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, permissions, account records, membership records, provider configuration, Admin-screen approval, and live behavior as separate results.

**Expected result:** only a current successful mocked lookup shows website-account roles. Loading and rejection show one private fail-closed state with no false zero, stale account information, or role button. Successful results describe website access and account creation only. They do not display or infer annual membership, dues, eligibility, member pricing, discounts, or roster status. This does not authorize an officer to open the screen or change a role live.

Issue [#361](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/361) contains only the source-level browser guard for an unknown role-change result. Server authority, command identity and repeat safety, reconciliation, durable audit, token revocation and propagation, account recovery, approved deployment, and live proof remain unfinished. This slice does not make the Admin website-account screen or its role actions safe. Issue #116 remains responsible for the future server-authoritative membership roster and export.

**Stop conditions:** any real account, member, name, email address, payment, dues record, membership record, provider record, credential, or production data; an attempted role change; a request to infer membership from a role, account date, or email verification; a Firebase, permission, provider, account, or membership-record change; or a claim that source, tests, merge, preview, or a green workflow proves the screen or roster is live.

**Success proof:** for source completion, record the exact #307 issue, reviewed pull request, merged commit, recorded old-source failures, green synthetic tests, relevant full checks, and independent privacy, identity, membership-truth, lifecycle, and officer-continuity reviews. The safe review stops at source and mocked tests because the Admin screen is not approved for officer use. Live availability requires a separate approved release and exact-revision verification after authorization, role-action safety, audit, backup, rollback, and Firebase evidence are complete. The #116 roster additionally requires its own policy, server authority, scoped capability, field approval, deployment, audit, export, and backup-officer proof. Record website publication, `runmprc.com`, Firebase deployment, permission changes, provider configuration, account or membership changes, roster/export activity, production-data actions, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by changing a website role, membership, dues record, account, permission, database record, or provider setting.

**Escalation:** membership lead plus identity/platform security owner. Add the privacy owner if account details appeared. Add the treasurer if anyone inferred paid membership, dues, pricing, or discount eligibility. Use the private incident path if an access change might have completed without a current readback. Do not copy personal details into an issue, screenshot, email, message, or AI tool.

No system-topology diagram changes are required because data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only the website-account list display and the boundary separating website roles from the future authoritative membership roster.

### Admin website-role change unknown result — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** tell an officer to stop when a website-role change has an unknown result. The page must not show a private error, account details, or another role-change action after the request rejects.

**Approver:** membership lead plus identity/platform owner. Add the privacy owner if any account detail appeared. This source slice does not provide approval for live use.

**Prerequisites:** issues [#307](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/307) and [#361](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/361) must be merged for source review. Use only a made-up admin identity, mocked database references, made-up website accounts, and a mocked role-change request. Keep the Admin website-account screen marked **NOT AVAILABLE YET**. Do not open the production Admin screen, change a real role, use production data, or test Firebase.

```mermaid
flowchart LR
    A["Current made-up website-account list"] --> B["One mocked role-change request"]
    B --> C["Pending; every role button disabled"]
    C -- "Resolved" --> D["One existing mocked list reload"]
    C -- "Rejected" --> E["Fixed unknown-result alert"]
    E --> F["Account details and role controls hidden"]
    F --> G["Stop; contact membership lead and platform owner"]
    H["Complete rejected value"] -. "Discarded" .-> I["No page, analytics, console, or stored detail"]
    J["Account context changes or page closes"] -. "Old result ignored" .-> K["No display or request change"]
```

Text alternative: one mocked role request may start from a current made-up account list. Every role button is disabled while it is pending. A current success keeps the existing single list reload. A rejection discards the complete rejected value, shows one fixed stop message, hides account details and controls, and permits no repeat action on that page. Results from an older account context or a closed page do nothing.

Officer review steps after the source merge:

1. Keep the Admin website-account screen marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #361 issue.
3. Ask the platform owner for the reviewed pull request.
4. Ask the platform owner for the merged commit.
5. Ask the platform owner for the synthetic frontend test result.
6. Confirm the review used only a made-up admin identity.
7. Confirm the review used only mocked database references.
8. Confirm the review used only made-up website accounts.
9. Confirm the review used only a mocked role-change request.
10. Confirm one click starts exactly one mocked request with the existing made-up payload.
11. Confirm every role button is disabled while that request is pending.
12. Confirm a rapid click on the same row starts no second request.
13. Confirm a click on another row starts no second request.
14. Confirm a mocked success performs exactly one existing list reload.
15. Confirm a mocked rejection shows exactly `We could not confirm that website access change. Do not repeat it. Stop and contact the membership lead and platform owner.`
16. Confirm assistive technology receives the whole sentence immediately as one alert.
17. Confirm the rejected value is not inspected, logged, measured, stored, sent to analytics, or displayed.
18. Confirm the rejection starts no retry or list reload.
19. Confirm the page keeps only its generic Admin heading, home link, and fixed alert after rejection.
20. Confirm no role counts, filters, names, email addresses, dates, verification state, rows, or role buttons remain after rejection.
21. Confirm another role request cannot start on that open page.
22. Confirm an old success or failure cannot change the page after the Firebase app, database reference, admin account, or page changes.
23. Confirm no test describes a website role as annual paid membership.
24. Record source change, tests, merge, website publication, exact `runmprc.com` revision, Firebase deployment, permissions, account records, role changes, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** a rejected mocked role request shows one fixed accessible instruction and no rejected detail. The page hides every account-derived value and role control. It sends no automatic retry or list reload. A successful mocked request keeps its existing payload and exactly one list reload. The fixed alert says the result is unknown; it does not claim that the role stayed the same.

Reloading, closing, or reopening the page may make the controls appear again. It does not prove what happened and never makes a repeat safe. Stop and escalate instead.

**Stop conditions:** any real officer, account, member, name, email address, role, payment, dues record, membership record, provider record, credential, or production data; an attempted production role change; a request to force a production failure; a private or technical detail on the page, in analytics, in the console, or in a review record; an automatic retry or list reload after rejection; a visible account detail or role button after the unknown-result alert; a repeated action; a Firebase, permission, account, or membership-record change; or a claim that source, tests, merge, preview, or a green workflow proves the role result or live safety.

**Success proof:** for source completion, record the exact #361 issue, reviewed pull request, merged commit, old-source failure evidence, green synthetic tests, relevant full checks, and independent privacy/security, lifecycle/compatibility, and officer-continuity reviews. The safe officer review stops at those records. A future live process still needs server authority, repeat safety, reconciliation, durable audit, token revocation and propagation, recovery, backup, rollback, approved deployment, exact-revision verification, and live readback. Record website publication, `runmprc.com`, Firebase deployment, permission or role changes, provider configuration, account or membership changes, production-data actions, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by refreshing the page, repeating a role action, or changing an account, role, membership, permission, database record, or provider setting.

**Escalation:** stop and contact the membership lead plus identity/platform security owner. Add the privacy owner if any account detail appeared. Use the private incident path if a role change might have completed, a private or technical detail appeared, or another request was attempted. Do not copy account details into an issue, screenshot, email, message, or AI tool.

No system-topology diagram changes are required because this source slice changes no server authority, data movement, permissions, account ownership, or deployment topology. The diagram above records only the current page's role-request display and repeat-click guard.

### Admin Event editor load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give an officer one plain result when the Admin Event editor cannot safely identify the event being edited. An unknown event must not show a database or provider detail, an earlier event, a blank edit form, or a **Save changes** action.

**Approver:** event lead plus platform/security and privacy owners. Add the treasurer before any future live review of prices, capacity, registration, payment, or refund settings.

**Prerequisites:** issue [#311](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/311) must be merged for source review. Use only a made-up admin identity, mocked database references, made-up events, and mocked lookup results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. Issue [#121](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/121) still owns the approved event source. This slice does not approve the editor, save an event, choose a source, deploy Firebase, change Rules or permissions, use production data, or prove live behavior.

Before #311, a rejected lookup could show technical provider text and leave a blank editable event form. A missing event could also leave that form available. A merged source fix and green tests do not publish the website or make the editor safe to use.

```mermaid
flowchart LR
    A["Made-up Admin Event edit route and service readiness"] --> B["Fresh editor boundary for each edit route or edit-route readiness change"]
    B --> I["Latest mocked lookup for current route and database"]
    I -- "Pending" --> C["Loading; no event form or Save action"]
    I -- "Rejected" --> D["Fixed alert; no event form or Save action"]
    I -- "Resolved missing" --> E["Event not found; no event form or Save action"]
    I -- "Resolved event" --> F["Existing populated edit form"]
    B -- "New event route" --> J["Blank create draft"]
    G["Older or unmounted result"] -. "Ignored" .-> H["No display change"]
```

Text alternative: each edit route or edit-route service-readiness change starts a fresh editor boundary. Only the latest current mocked lookup may settle an edit route. Pending, rejected, and missing results show no edit form or save action. A current event keeps the existing populated form. A new-event route starts a blank draft and keeps it across service-readiness changes. An older or unmounted result changes nothing.

Officer review steps after the source merge:

1. Keep the complete Admin Event editor marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #311 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, made-up events, and mocked lookups.
4. Confirm no test clicks **Create event** or **Save changes** and no event write is attempted.
5. Confirm a pending edit lookup shows **Loading...** and no event form or **Save changes** action.
6. Confirm a mocked rejection shows exactly `We could not load this event right now. Please try again later.`
7. Confirm assistive technology receives the whole rejection sentence immediately as one alert.
8. Confirm the rejected value is not inspected, logged, measured, stored, sent to analytics, or displayed.
9. Confirm a missing made-up event shows **Event not found** and no event form or **Save changes** action.
10. Confirm a current made-up event keeps the existing populated form and disabled URL path. Do not change a field.
11. Confirm a fresh **New event** route keeps its existing blank create form without starting an edit lookup. Do not submit it.
12. Confirm an earlier event disappears while a new route or database lookup is pending.
13. Confirm a loaded edit form stays hidden when services become unavailable and then become ready again, until the new current lookup resolves.
14. Confirm moving from a loaded edit route to **New event** starts a blank draft.
15. Confirm the synthetic test shows that service-readiness changes and an internal page update with the same database connection preserve a current new-event draft and do not start an edit lookup.
16. Confirm an older or unmounted result cannot replace the current route.
17. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Rules or permissions, provider configuration, event records, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** pending, rejected, and missing edit lookups show no editable event form. A rejection uses one fixed accessible sentence and no rejected detail. A missing event stays separate from a provider failure. Only the terminal result of the latest lookup attempt for the current mocked route and database may settle the page, and only a fulfilled current event may populate the form. Older and unmounted results are inert. A changed edit route or edit-route service-readiness state starts a clean editor boundary before any new lookup. A later current lookup can recover without briefly restoring an earlier form. Moving from edit to new starts a blank draft. Service-readiness changes and an internal page update with the same database connection do not start an edit lookup or erase that new-event draft. Existing successful edit projection remains unchanged.

The existing form validation, create/update request shapes, and current successful navigation remain unchanged. Issue [#378](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/378) separately contains the browser page's raw save rejection and immediate repeat-click behavior. Server idempotency, durable audit, reconciliation, event-source choice, pricing, capacity, registration, waiver, payment, and refund behavior remain unfinished. Neither slice makes the Admin Event editor safe for officer use.

**Stop conditions:** any real officer, member, event, route, price, capacity, registration, waiver, payment, Firebase, provider, endpoint, credential, or production record used to exercise the failure; a request to force a production error; a raw detail on the page, in analytics, or in the console; a blank, old, or editable event form after an unknown lookup; an attempted create or save; a Firebase, Rules, provider, permission, source, or event-record change; or a claim that source, tests, merge, preview, or a green workflow proves the result or editor is live.

**Success proof:** for source completion, record the exact #311 issue, reviewed pull request, merged commit, recorded old-source failures, reviewer-driven route and readiness regressions, green synthetic actual-route tests, relevant full checks, and independent privacy, lifecycle, accessibility, and officer-continuity reviews. The safe review stops at source and mocked tests because the Admin screen is not approved for officer use. Live availability requires a later separately approved release and dated exact-revision verification after authorization, source, save safety, audit, backup, rollback, and Firebase evidence are complete. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, event changes, production-data actions, saves, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by creating, changing, or deleting an event, registration, payment, officer account, permission, database record, source document, or provider setting.

**Escalation:** event lead plus platform/security owner. Add the privacy owner if any private or technical detail appeared. Add the treasurer if price, capacity, registration, payment, or refund state might be affected. Use the private incident path if an event write might have occurred without a current readback. Do not copy private details into an issue, screenshot, email, message, or AI tool.

No system-topology diagram changes are required because data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only the editor's current-lookup display behavior.

### Admin Event save unknown result — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** stop one open Admin Event editor page from starting a second save after the first result becomes unknown. A pending or unknown save must show no event detail, form, save button, cancel action, database detail, or provider detail.

**Approver:** event lead, treasurer, and platform/security and privacy owners.

**Prerequisites:** issue [#311](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/311) and issue [#378](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/378) must be merged for source review. Use only a made-up admin identity, mocked database references, made-up events, and mocked save results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. Issue [#121](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/121) still owns the approved event source. This slice does not approve the editor, save an event, add server idempotency, reconcile an unknown write, deploy Firebase, change Rules or permissions, use production data, or prove live behavior.

Before #378, the page could show a rejected provider message, accept two immediate save requests, and enable Save again after a rejected request that might already have written the event. An older request could also send the officer to the event list after the route, database connection, account, ready state, or page had changed.

```mermaid
flowchart LR
    A["Current made-up event form"] --> B["Local validation"]
    B -- "Invalid" --> C["Fixed local correction; no save attempt"]
    B -- "Valid" --> D["One browser-page save attempt"]
    D --> E["Fixed polite pending status; no form or action"]
    E -- "Current mocked success" --> F["Existing Admin Events navigation"]
    E -- "Current mocked rejection" --> G["Fixed unknown alert; no form, action, reload, or repeat"]
    H["Older or closed-page result"] -. "Ignored" .-> I["No navigation or display change"]
    J["Reload, another tab, device, or script"] -. "Not protected by this browser guard" .-> K["Stop; private reconciliation is still required"]
```

Text alternative: local validation errors remain correctable without a save. One valid form may start one mocked save on the current page. Pending work hides the form and actions. A current mocked success keeps the existing navigation. A current rejection shows one fixed stop alert and no retry. An older or closed-page result changes nothing. Reloading or using another tab, device, or script is outside this browser guard and never makes a repeat safe.

Officer review steps after the source merge:

1. Keep the complete Admin Event editor marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #378 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, made-up events, and mocked create or update requests.
4. Confirm a local form error starts no save and remains correctable.
5. Confirm one valid made-up edit sends the existing database reference, event path, and event input exactly once.
6. Confirm one valid made-up create sends the existing database reference, event input, and exact current made-up admin ID exactly once.
7. Confirm two immediate submissions still start only one request.
8. Confirm a pending request shows exactly `Event save in progress. Do not start another save.`
9. Confirm assistive technology receives the whole pending sentence politely as one status.
10. Confirm pending work shows no event title, field, form, **Create event**, **Save changes**, **Cancel**, or **All events** action.
11. Confirm an ordinary or hostile mocked rejection shows exactly `We could not confirm that event save. Do not repeat it. Stop and contact the event lead, treasurer, and platform owner.`
12. Confirm assistive technology receives the whole unknown-result sentence immediately as one alert.
13. Confirm the rejected value is not inspected, coerced, logged, measured, stored, sent to analytics, or displayed.
14. Confirm the unknown result shows no event title, field, form, create, save, cancel, navigation, reload, or retry action.
15. Confirm changing the route, database reference, ready state, or made-up admin ID makes the older mocked success or rejection inert.
16. Confirm a result received after the page closes is inert.
17. Confirm an internal page update with the same effective route, database reference, and made-up admin ID does not clear a pending or unknown lock.
18. Confirm a current mocked success keeps the existing one-time navigation to the Admin Events list.
19. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Rules or permissions, provider configuration, event records, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** one mounted page admits at most one valid mocked save for its current route, database reference, and made-up admin ID. Pending work shows one fixed polite status and no event detail or action. A current rejection is discarded without inspection and becomes one fixed terminal alert. An older or closed-page result is inert. A current success preserves the existing request and navigation. A missing admin ID or database reference starts no save.

This is only an immediate browser-page guard. Leaving or reloading the page resets it. Another tab, device, or script can repeat a write. The current create service still checks then writes without one durable command ID. The current update service has no version fence. A rejected database promise might already have committed. Do not use refresh, navigation, a new tab, a new device, or another account as a reconciliation method or a reason to repeat the save.

**Stop conditions:** any real officer, event, route, price, capacity, registration, waiver, payment, Firebase, provider, endpoint, credential, or production record used to exercise a save; a request to force a production failure; a private or technical detail on the page, in analytics, in the console, or in a review record; more than one mocked request; any form or action visible during pending or unknown state; any older result that navigates or changes the page; a reload, navigation, new tab, device, script, manual database inspection, or repeated save offered as recovery; a Firebase, Rules, permission, source, or event-record change; or a claim that source, tests, merge, preview, or a green workflow proves the result or editor is live.

**Success proof:** for source completion, record the exact #378 issue, reviewed pull request, merged commit, old-source failures, green synthetic actual-route tests, relevant full checks, and independent privacy/security, lifecycle/compatibility, accessibility, and officer-continuity reviews. The safe officer review stops at source and mocked tests because the Admin screen is not approved for officer use. A future live process still needs server-authoritative idempotency, durable audit, private readback and reconciliation, authorization, backup, rollback, approved deployment, and exact-revision verification. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, event changes, production-data actions, saves, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by refreshing, leaving the page, repeating a save, or creating, changing, deleting, or manually repairing an event, registration, payment, officer account, permission, database record, source document, or provider setting.

**Escalation:** stop and contact the event lead, treasurer, and platform/security owner. Add the privacy owner if any private or technical detail appeared. Use the private incident path if a save might have completed, another request was attempted, or the page navigated after its context changed. Do not copy event details, provider details, database records, or account details into an issue, screenshot, email, message, or AI tool.

No system-topology diagram changes are required because this source slice changes no server authority, data movement, permissions, account ownership, or deployment topology. The state-flow diagram above records only the current browser page's save display and immediate repeat guard.

### Admin Event registrations load failure privacy — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** give an officer one clear stop instruction when the Admin Event registrations page cannot load one complete, current result. Loading, missing, failed, older, or closed-page requests must show no runner details, money totals, filters, table, export button, registration-action button, or open action window.

**Approver:** event lead, treasurer, and platform/security and privacy owners.

**Prerequisites:** issue [#315](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/315) must be merged for source review. Use only a made-up admin identity, mocked database references, a made-up event, made-up registrations, and mocked lookup results. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. Issue [#121](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/121) still owns the approved event source. Issue [#116](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/116) still owns the future approved roster/export purpose and fields. This slice does not approve the screen, export, late add, comp, refund, substitute, cancel, note, role, permission, event source, backup, rollback, production data, or live use.

```mermaid
flowchart LR
    A["Current made-up route, database, and ready state"] --> B["Mocked current event lookup"]
    B -- "Pending" --> C["Loading; no registration result or action"]
    B -- "Missing" --> D["Event not found; no registration lookup"]
    B -- "Rejected" --> E["Fixed stop alert; no registration result or action"]
    B -- "Resolved event" --> F["Mocked current registrations lookup"]
    F -- "Pending" --> C
    F -- "Rejected" --> E
    F -- "Resolved empty or populated" --> G["Existing complete result and controls"]
    H["Older or closed-page result"] -. "Ignored" .-> I["No display change"]
```

Text alternative: the current made-up event must resolve before the registration lookup starts. Only a complete current registration result may show the existing page. Pending work shows loading, a missing event shows **Event not found**, either rejection shows one fixed stop alert, and an older or closed-page result changes nothing.

Officer review steps after the source merge:

1. Keep the complete Admin Event registrations page marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #315 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the tests use only a made-up admin identity, mocked database references, a made-up event, and made-up registrations.
4. Confirm no test clicks **Export CSV** or submits a registration action.
5. Confirm an event lookup starts first and a registration lookup starts only after that current event is found.
6. Confirm loading shows no event detail, runner detail, money total, filter, table, export button, registration-action button, or action window.
7. Confirm either mocked lookup rejection shows exactly `We could not load registrations right now. Stop and contact the event lead, treasurer, and platform owner before taking any registration action.`
8. Confirm assistive technology receives the whole sentence immediately as one alert.
9. Confirm the complete rejected value is not inspected, logged, measured, stored, sent to analytics, or displayed.
10. Confirm a missing made-up event shows **Event not found**, starts no registration lookup, and shows no orphaned registration.
11. Confirm a changed route, database connection, or ready state immediately removes the earlier runner details, filters, table, controls, and open action window.
12. Confirm an older success or rejection and a result received after the page closes are ignored without inspecting their event, runner, or error fields.
13. Confirm a later complete made-up result recovers with blank filters and only its own event and registration rows.
14. Confirm a successful empty result keeps **No registrations** and exact zero totals, while a successful populated result keeps the existing totals, filtering, rows, and action entry points. Do not use those action entry points.
15. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Rules or permission changes, provider configuration, event or registration records, export or action activity, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** only the fully resolved current mocked event-and-registration result can show event or runner details, money totals, filters, the table, export, registration actions, or action windows. Loading and either rejection show no old or partial result. A missing event stays separate and starts no registration lookup. The fixed rejection sentence contains no private or technical detail. Older and closed-page values are inert. Successful empty and populated made-up results keep their existing display behavior.

Issue [#383](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/383) adds a source-only browser guard around the existing CSV request and download. It does not approve the export or its file contents. Approved purpose and columns, server authorization, stronger authentication, audit, request bounds, retention, reconciliation, and live verification remain unfinished under [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) and [#116](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/116). Late-add, comp, refund, substitute, cancel, note, prompts, action responses, server repeat safety, and durable audit are also separate unfinished work. This slice does not make the Admin Event registrations page, export, or actions safe for officer use.

**Stop conditions:** any real officer, runner, name, email address, phone, emergency contact, event, registration, waiver, price, gross amount, payment, refund, Firebase, Stripe, provider, endpoint, credential, or production record used to exercise the failure; a request to force a production error; a raw detail on the page, in analytics, or in the console; a stale, partial, orphaned, or false-empty result; a visible export or action control during loading or failure; an export or registration action; a Firebase, Rules, permission, provider, source, event, or registration-record change; or a claim that source, tests, merge, preview, or a green workflow proves the page is live.

**Success proof:** for source completion, record the exact #315 issue, reviewed pull request, merged commit, intended old-source failures, 23 green synthetic boundary tests, relevant full checks, and independent privacy, accessibility, lifecycle, and officer-continuity reviews. The safe review stops at source and mocked tests because the Admin screen is not approved for officer use. Live availability requires a separate approved release and dated exact-revision verification after authorization, export and action safety, idempotency, audit, backup, rollback, Firebase, and provider evidence are complete. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, event or registration changes, production-data actions, exports, payments, refunds, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend and guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by exporting, repeating an action, or changing or deleting an event, registration, payment, refund, officer account, permission, database record, source document, or provider setting.

**Escalation:** event lead, treasurer, and platform/security owner. Add the privacy owner and use the private incident path if any runner, payment, provider, endpoint, token-shaped, or technical detail appeared, or if an export or registration action might have completed without a current readback. Do not copy private details into an issue, screenshot, email, message, or AI tool.

No system-topology diagram changes are required because data movement, permissions, account ownership, and deployment topology are unchanged. The state-flow diagram above records only the current two-stage load result and display boundary.

### Admin registration action unknown result — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** tell an officer to stop after a refund or registration action has an unknown result. The page must not show a private error, runner or money details, or another action that could repeat a change.

**Approver:** event lead, treasurer, platform/security owner, and privacy owner. All four roles must approve any future live review. This source slice does not provide that approval.

**Prerequisites:** issues [#315](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/315), [#331](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/331), [#359](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/359), and [#363](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/363) must be merged for source review. Use only a made-up admin identity, mocked database references, a made-up event, made-up registrations, and a mocked action request. Do not open the Admin screen, export a file, contact Firebase or Stripe, or test an action on the production website. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply.

```mermaid
flowchart LR
    A["Made-up complete registration list"] --> B["One mocked registration action"]
    B -- "Pending" --> C["All registration actions and export are blocked"]
    B -- "Resolved" --> D["One existing mocked list reload"]
    B -- "Rejected" --> E["Fixed unknown-result alert"]
    E --> F["Runner, registration, money, actions, and export hidden"]
    F --> G["Stop; contact event lead, treasurer, and platform owner"]
    H["Complete rejected value"] -. "Discarded" .-> I["No page, analytics, or console detail"]
    J["Older page-context result"] -. "Ignored" .-> K["No display change"]
```

Text alternative: one mocked action blocks every other registration action and export while it is pending. A resolved request keeps one existing list reload. A rejected request discards the complete rejected value, hides the registration and money result, shows one fixed stop instruction, and cannot be repeated on that open page. An older result changes nothing.

Officer review steps after the source merge:

1. Keep the complete Admin Event registrations page marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #363 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the review used only a made-up admin identity, made-up event and registrations, mocked database references, and a mocked action request.
4. Confirm no test contacts Firebase, Stripe, a provider, a real registration, or a real payment.
5. Confirm the made-up cases cover full refund, partial refund, cancel, substitute runner, add note, and create comp with their existing request shapes.
6. Confirm one pending mocked request disables every row action, **+ Late registration — $0 only**, **+ Comp registration**, and **Export CSV**.
7. Confirm a rapid or different-row click cannot start a second mocked request.
8. Confirm one current resolved request closes its action window and performs exactly one existing list reload.
9. Confirm every current mocked rejection shows exactly `We could not confirm that registration action. Do not repeat it. Stop and contact the event lead, treasurer, and platform owner.`
10. Confirm assistive technology receives the whole sentence immediately as one alert.
11. Confirm the complete rejected value is not inspected, coerced, logged, stored, sent to analytics, or displayed.
12. Confirm a mocked rejection starts no automatic retry or list reload.
13. Confirm the unknown-result page keeps only the generic Admin registrations shell and fixed alert. Runner names, email addresses, registration details, totals, amounts, filters, table, action windows, action buttons, and export must be absent.
14. Confirm a same-page rerender cannot restore those details or start another request.
15. Confirm an older result after the app, database connection, event route, action attempt, or page lifecycle changes is ignored.
16. Confirm the separate exact-zero late-registration containment remains unchanged. Paid late registration remains **NOT AVAILABLE YET**.
17. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Stripe, permissions, event or registration records, export or action activity, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** a pending mocked non-late action blocks every registration mutation and export entry point. A current resolved request keeps the existing one-time list reload. A current rejected request shows one fixed accessible instruction, no rejected detail, no runner or money result, and no action or export control. It cannot be repeated on that open page. Older results are inert. The alert says the result is unknown; it does not claim that Firebase or Stripe made no change.

The reverse guard is also required by issue [#383](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/383): a pending CSV export blocks every registration action, and an uncertain CSV result hides both action and export controls. This changes only the browser-page guard. It does not change a mutation, server idempotency, reconciliation, audit, or provider behavior.

Refreshing, closing, or reopening the page can recreate the controls. That does not prove what happened and never makes a repeat safe. Stop and contact the named owners instead. A browser guard does not provide server idempotency, reconciliation, durable audit, Stripe readback, authorization, backup, rollback, deployment, or live proof.

**Stop conditions:** any real officer, runner, name, email address, phone, emergency contact, event, registration, price, payment, refund, Firebase, Stripe, provider, endpoint, credential, export, or production record used; an attempt to force a production failure; a raw detail in the page, analytics, console, screenshot, issue, email, message, or AI tool; an automatic retry or reload after rejection; runner, registration, money, action, or export content after the alert; a repeated action; a manual Firebase or Stripe repair; or a claim that a browser lock, source change, test, merge, preview, or green workflow proves financial safety or live behavior.

**Success proof:** for source completion, record the exact #363 issue, reviewed pull request and merge commit, recorded old-source failures, green focused and compatibility tests, relevant full checks, and independent privacy/security, lifecycle, and officer-continuity reviews. The safe officer review stops at those records. A later live process still needs authorization, server repeat safety, reconciliation, durable audit, provider readback, backup, rollback, protected deployment, and dated exact-revision evidence. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, Stripe configuration, event or registration changes, exports, payments, refunds, production-data actions, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by refreshing the page, repeating an action, exporting private data, or changing or deleting an event, registration, payment, refund, officer account, permission, database record, or provider setting.

**Escalation:** stop and contact the event lead, treasurer, and platform/security owner. Add the privacy owner. Use the private incident path if an action might have completed, any personal, payment, provider, endpoint, token-shaped, or technical detail appeared, or another request was attempted. Do not copy private details into an issue, screenshot, email, message, or AI tool.

No system-topology diagram changes are required because this source slice changes no server authority, data movement, permissions, account ownership, or deployment topology. The diagram above records only the current page's action-result display and repeat-click guard.

### Admin registration CSV export result — SOURCE ONLY, NOT LIVE

**Status: NOT AVAILABLE YET**

**Purpose:** keep one mocked registration CSV download private and tied to the exact open Admin page. A pending export must block every registration action. An uncertain export must show one fixed stop instruction, hide private results and controls, and offer no same-page retry.

**Approver:** event lead, treasurer, platform/security owner, and privacy owner. All four roles must approve any future live review. This source slice does not provide that approval.

**Prerequisites:** issues [#315](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/315), [#359](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/359), [#363](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/363), and [#383](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/383) must be merged for source review. Use only a made-up admin identity, mocked app and database references, a made-up event, made-up registrations, and a mocked CSV response. Do not open the Admin screen, contact Firebase, or download production data. The **Admin screens — NOT AVAILABLE YET** restrictions above still apply. Issues [#110](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/110) and [#116](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/116) still own approved export purpose and columns, stronger authentication, server authorization, bounds, audit, retention, and live verification.

```mermaid
flowchart LR
    A["Exact current made-up Admin page"] --> B["One mocked CSV export"]
    B -- "Pending" --> C["Fixed polite status; export and registration actions blocked"]
    B -- "Current success" --> D["One mocked file download"]
    D --> E["Temporary browser file and link cleaned up"]
    B -- "Rejected or cleanup failed" --> F["Fixed unknown-result alert"]
    F --> G["Private result, actions, and export hidden; no retry"]
    H["Route, account, app, database, ready state, newer attempt, or page closes"] --> I["Old request aborted or made inert"]
    I --> J["No old file download"]
    K["Complete rejected value"] -. "Discarded" .-> L["No page, analytics, storage, or console detail"]
```

Text alternative: the exact current made-up Admin page may start one mocked export. Pending work blocks export and registration actions. Current success downloads one file and cleans up its temporary browser link and file URL. Rejection or cleanup failure discards all details, hides private results and controls, and shows one fixed stop alert with no retry. A route, account, app, database, readiness, attempt, or page-lifecycle change makes the older request unable to download.

Officer review steps after the source merge:

1. Keep the complete Admin Event registrations page and CSV export marked **NOT AVAILABLE YET**.
2. Ask the platform owner for the exact #383 issue, reviewed pull request, merged commit, and synthetic frontend test result.
3. Confirm the review used only a made-up admin identity, made-up event and registrations, mocked app and database references, and a mocked CSV response.
4. Confirm no test contacts Firebase, opens the production Admin screen, or downloads a file containing real data.
5. Confirm one click sends the existing mocked endpoint and current made-up identity token only once.
6. Confirm a second same-moment export, registration action, or late-registration action starts no request.
7. Confirm pending work shows exactly `Registration export in progress. Do not start another registration action or export.`
8. Confirm assistive technology receives the whole pending sentence politely as one status.
9. Confirm a pending export closes an open action window and disables every registration action and export entry point.
10. Confirm a current mocked success clicks one temporary download link, uses the existing filename, and removes both the temporary link and browser file URL.
11. Confirm token, endpoint, network, response, file-read, link-create, link-attach, click, link-remove, and browser-file cleanup failures all show exactly `We could not confirm that registration export. Do not try again on this page. Stop and contact the event lead, privacy lead, treasurer, and platform owner.`
12. Confirm assistive technology receives the whole unknown-result sentence immediately as one alert.
13. Confirm the complete rejected value is not inspected, coerced, logged, measured, stored, sent to analytics, or displayed.
14. Confirm the unknown result hides runner details, money totals, filters, the registration table, action windows, registration actions, and export. Confirm it offers no reload or retry.
15. Confirm changing the route, made-up page user, Firebase user, app, database, services, or ready state aborts or makes the older mocked response inert before its body or private fields are inspected.
16. Confirm leaving and returning to the same route starts a newer page generation, so an older response cannot download after a later deliberate current export.
17. Confirm a mocked response received after the page closes is inert and no temporary link or browser file URL remains.
18. Confirm one later deliberate click may start one new request only after a confirmed success and cleanup.
19. Confirm an unknown result never offers or admits another export request.
20. Record source change, tests, merge, preview, website publication, exact `runmprc.com` revision, Firebase, Rules or permission changes, provider configuration, event or registration records, export activity, production data, Admin-screen approval, and live behavior as separate results.

**Expected result:** one click admits at most one mocked CSV export for the exact current services, app, database, route, ready state, made-up page user, Firebase user, attempt, and lifecycle. Pending work shows one fixed polite status and blocks every export and registration action. Current success preserves one existing request and download, followed by browser cleanup. After that confirmed cleanup, one later deliberate click may start one new request. A current rejection or cleanup failure shows one fixed accessible stop instruction, no rejected detail, no private result or control, and no same-page retry. Older and closed-page results cannot download.

This is only a browser-page privacy and repeat-click guard. It does not approve the CSV purpose or columns. It does not add stronger authentication, server authorization, export bounds, durable audit, retention, reconciliation, provider readback, backup, rollback, deployment, or live proof. Refreshing, reopening, using another tab, device, account, script, or direct endpoint can start another request. Never use those actions to reconcile or repeat an uncertain export.

**Stop conditions:** any real officer, runner, name, email address, phone, emergency contact, event, registration, waiver, payment, Firebase, provider, endpoint, credential, token, or production record used; a production export or forced production failure; private or technical detail on the page, in analytics, storage, the console, screenshot, issue, email, message, or AI tool; more than one mocked request from one click, any request while another is pending, or any request after an unknown result; any registration action during pending export; any private result or control after the unknown alert; an older or closed-page download; temporary browser file or link cleanup that is not confirmed; a retry, reload, navigation, new tab, device, account, script, direct endpoint, or manual database inspection offered as recovery; or a claim that source, tests, merge, preview, or a green workflow proves the export is approved or live.

**Success proof:** for source completion, record the exact #383 issue, reviewed pull request and merge commit, recorded old-source failures, green focused and compatibility tests, relevant full checks, and independent privacy/security, lifecycle, test-quality, and officer-continuity reviews. The safe officer review stops at source and mocked tests. A future live process still needs #110 and #116 decisions and evidence, server authorization and bounds, stronger authentication, durable audit, retention, backup, rollback, protected deployment, and dated exact-revision verification. Record website publication, `runmprc.com`, Firebase deployment, Rules or permission changes, provider configuration, event or registration changes, exports, production-data actions, and live behavior as **not performed** unless separate evidence proves otherwise.

**Undo:** before publication, use one reviewed frontend-and-guide revert or safe roll-forward. After any later approved publication, use the protected website release path and verify the replacement revision. Never undo by retrying an export, refreshing, reopening the page, using another tab, device, account, script, or endpoint, or changing or deleting an event, registration, payment, officer account, permission, database record, downloaded file, or provider setting.

**Escalation:** stop and contact the event lead, privacy lead, treasurer, and platform/security owner. Use the private incident path if an export might have completed, another request was attempted, cleanup failed, or any personal, payment, provider, endpoint, token-shaped, or technical detail appeared. Do not copy private details into an issue, screenshot, email, message, or AI tool.

No system-topology map changes are required because this source slice changes no server authority, data movement, permissions, account ownership, or deployment topology. The state-flow diagram above records only the current browser page's export display, exact-context boundary, cleanup, and immediate repeat guard.

## Stop conditions

Stop if staging is not isolated, the owner/policy is missing, a test uses real people or money, Firebase deployment skipped, rollback is untested, or the requested action directly edits payment/member state.

## Undo

Because this guide authorizes no production write, the safe undo is to close or revise the issue before release. If production data changed unexpectedly, stop and use [Emergency and recovery](./EMERGENCY_AND_RECOVERY.md); do not delete or overwrite the record.

## Escalation

- Event/capacity: event lead plus platform owner.
- Member/admin access: membership lead plus identity/security owner.
- Price/order/refund/Stripe: treasurer plus platform owner.
- Waiver/Terms/Privacy/retention: club officer plus approved legal/privacy owner.
