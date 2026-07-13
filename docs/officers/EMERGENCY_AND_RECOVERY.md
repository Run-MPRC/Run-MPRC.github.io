# Emergency and Recovery

**Purpose:** preserve evidence and reach the right owners when the site is down, wrong, unsafe, or exposing private information.
**Approver for production action:** platform owner plus one backup; add the privacy owner for private data and the treasurer for money.
**Expected first result:** the problem is recorded, no additional risky changes are made, and the correct owners are responding.

## Before you start

- Use your own officer account.
- Open the private continuity record if you can.
- Do not open or copy private records merely to investigate.

## First five minutes

1. Stop making changes.
2. Write down the time.
3. Copy the affected public URL.
4. Save one screenshot with names, emails, codes, and private details covered.
5. Describe the visitor action that exposed the problem.
6. Contact the platform owner.
7. Contact the platform backup.
8. Add the privacy owner or treasurer when the table below requires it.

## Choose the symptom

| Symptom | Safe first response |
| --- | --- |
| Wrong public text, image, or link | Ask the platform owner for one reviewed revert pull request. |
| Site unavailable or old after a merge | Ask the platform owner to check Netlify and GitHub Pages separately; do not change DNS. |
| Login or member access is wrong | Stop role requests and contact the identity/platform owners. |
| Account exists but verification email request failed | Ask the member to stop resending. Record only the time, public `/login` URL, and plain status. Do not ask for the email address, password, code, action link, mailbox access, or screenshot. |
| Profile Save says permission is missing | Ask the member to stop, sign out, and wait. Open a new redacted incident through [Request a change](./REQUEST_A_CHANGE.md). Do not edit the database, delete the login, recreate the account, or grant a role. |
| Private member information is visible | Contact platform and privacy owners immediately; they choose containment through an approved service procedure. Do not change permissions yourself. |
| Unexpected payment, refund, order, or signup | Contact treasurer and platform owners. There is no proven no-code payment kill switch. Do not test with real money. |
| Password, secret, or recovery code exposed | Contact the owning service's two approved owners. They revoke/rotate through the service-specific procedure and record evidence. Do not rotate it from this generic guide. |

Live commerce is not approved as of 2026-07-12. If the public site appears to accept a real payment, do not test it with a real card.

### Account created but verification request failed

**Status:** the truthful two-result screen in [#145](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/145) is **SOURCE ONLY, NOT LIVE** until its exact website revision is published and verified.

**Purpose:** preserve the new account and prevent repeated email requests or unsafe account repair.

**Approver:** membership lead plus identity/platform owner.

**Prerequisites:** the time, the public `/login` address, and the exact plain status with all private details omitted. My Account recovery is not proven until [#118](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/118) records the exact Rules, Functions, and profile page, and [#120](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/120) records a truthful resend result plus cooldown. Without both proofs, use only these stop-and-escalate steps.

1. Ask the member to stop clicking Create account or Resend.
2. Do not ask for their email address, password, code, action link, mailbox access, or screenshot.
3. Record only `account created; verification request did not finish`, the time, and the public `/login` URL.
4. Ask the member to keep the account. Do not delete or recreate it.
5. Open a redacted incident through [Request a change](./REQUEST_A_CHANGE.md).
6. Contact the identity/platform owner.
7. Add the communications owner if accepted messages land in Spam or never arrive.
8. Wait for separate website and provider evidence before saying the problem is fixed.

**Expected result:** no private data is copied, no duplicate account is created, and the owner can separate a website request failure from a provider-delivery problem.

**Stop conditions:** repeated resend attempts, real mailbox tests, direct Firebase Console changes, account deletion/recreation, role changes, or a request for private details.

**Success proof:** the exact website revision displays the correct generic status in an approved synthetic check. Sender branding, delivery, and Spam placement need separate private evidence under [#119](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/119).

**Undo:** ask for one reviewed frontend revert or safe roll-forward. Never undo this problem by deleting the login account.

**Escalation:** membership lead plus identity/platform owner; communications owner for delivery or Spam.

### Missing profile or profile permission error

**Status:** automatic repair is **NOT AVAILABLE YET**. These are current stop-and-escalate steps only.

**Purpose:** prevent a failed account repair from changing access or private data.

**Approver:** membership lead plus platform/security owner.

**Prerequisites:** the time, the public `/account` address, and a redacted description with no member details.

1. Ask the member to stop using Save.
2. Ask the member to sign out.
3. Open a new redacted incident by following [Request a change](./REQUEST_A_CHANGE.md).
4. Use [#118](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/118) only as engineering context. Do not add member incidents or private details to it.
5. Share only the time and the plain symptom.
6. Wait for a made-up account test and separate website, server Function, and database-permission proof.

**Expected result:** no manual account or database change occurs. The member retries only after the automated repair is proven live.

**Stop conditions:** stop if a step needs a real profile, private screenshot, direct database change, account deletion, account recreation, or role change.

**Success proof:** use the checklist in [Events, shop, members, and money](./EVENTS_SHOP_MEMBERS.md#profile-permission-error).

**Undo:** ask the platform owner to prepare, approve, publish, and verify a reviewed revert or safe roll-forward. Do not delete the account or profile.

**Escalation:** membership lead plus identity/security owner; add the privacy owner if private details were exposed.

## Safe AI message

> Investigate this MPRC incident without changing production: **[symptom]** at **[URL]** starting **[time]**. Preserve evidence, redact private data, identify the last known-good version, and propose the smallest revert or safe roll-forward. Do not force-push, delete records, refund money, rotate secrets, change DNS, or deploy until the named owners approve.

## Stop conditions

- Stop if anyone asks for a password, code, secret, private record, or payment record in chat.
- Stop if a proposed fix changes several services at once.
- Stop if rollback, backup, owner, or affected production surface is unknown.
- Stop if the only available action is a force-push, database deletion, direct payment-state edit, or unreviewed DNS change.

## Success proof

Record:

- What happened and when.
- Who approved each response action.
- The issue, pull request, commit, or provider change.
- What was checked on `runmprc.com`.
- Whether Netlify identified the intended commit.
- Whether Firebase actually deployed.
- Whether each outside provider was checked.
- What follow-up prevents the same problem.

## Undo and restoration

Do not undo containment merely because the page looks normal. The same two owners must verify the cause is removed, affected services agree, and monitoring is stable. Restore one surface at a time and record the result.

## Escalation

- Public website or deployment: platform owner plus backup.
- Private member information: platform owner plus privacy owner.
- Login, role, or admin access: identity owner plus platform/security backup.
- Payment, refund, order, payout, or dispute: treasurer plus platform owner.
- Secret or account takeover: owning service's two owners; use provider support if recovery fails.

After recovery, update the matching officer guide while the lesson is fresh.
