# Review the Zeffy membership form

**Status:** [issue #750](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/750), source prepared October 18, 2026. Staging deployment and screen evidence will be recorded below. Production is **NOT AVAILABLE YET** for this change.

**Purpose:** review the embedded membership form on the Join Us page without creating a membership or payment.

**Approver:** Dave for this staging demonstration. The membership lead, treasurer and platform owner must approve a later production release.

**Prerequisites:** the specialist supplies the exact staging preview link and source revision. Stay signed out. The displayed Zeffy form is the club's real form, not a payment sandbox. Do not enter information, accept a waiver, submit or pay.

```mermaid
flowchart LR
    A["Staging Join Us page"] --> B["Zeffy embed loader"]
    B --> C["Club membership form on Zeffy"]
    A --> D["Direct link if the embed is unavailable"]
    D --> C
    B -- "Loader fails" --> E["Embedded iframe fallback"]
    E --> C
    C -. "No account activation or sync added" .-> F["Existing Firebase member system"]
```

In words: the Join Us page displays the club's form from Zeffy and retains a separate direct link; a failed loader uses an iframe, and this change adds no Firebase membership synchronization.

## Review without a terminal

1. Open the specialist's staging link while signed out.
2. Find **Become an MPRC Member** on Join Us.
3. Confirm the notice identifies a staging preview of the real Zeffy form.
4. Confirm the club's membership options or opening message appear inside the page.
5. Open **Open the membership form in a new tab**.
6. Confirm it points to the club's membership on `www.zeffy.com`.
7. Close the new tab without entering information.
8. Return to Home and then Join Us.
9. Confirm only one visible membership form appears.
10. Repeat at phone and computer widths.
11. Leave the separate **Sign Waiver Form** unchanged and unused.

**Expected result:** the form is readable within Join Us. A direct link remains usable if the embed fails. There is no duplicate Google membership signup link. Prices and renewal terms are supplied by Zeffy; this change does not settle the conflicting provider description and options noted October 18.

**Stop conditions:** wrong club/form, missing real-form notice, clipped controls, duplicate forms, missing direct link, unexpected account activation, or any request to test a payment or submit real details.

**Success proof:** exact source revision, staging URL and deployment ID, dated phone/computer screenshots, one-form navigation check, loader/fallback tests and served artifact hashes. Viewing a form proves display only. It does not prove payment, membership activation, provider configuration or production readiness.

**Undo:** ask the platform maintainer to expire the task's preview channel. For a later published change, use a reviewed revert and the normal protected release path. Do not edit Zeffy records, delete members or refund a payment to undo a website preview.

**Escalation:** platform owner for display or deployment; membership lead and treasurer for provider options/prices; privacy owner for collected data or policy. A specialist is still required for deployment.

## Deployment evidence

- Source: local implementation; not merged.
- Tests: 28 frontend suites / 1,531 tests pass under Node 20. The new files have no lint findings. The exact lint baseline retains the same 113 legacy errors and six legacy warnings; only two old Join Us findings move with the removed Google-link lines.
- Staging website: pending.
- `runmprc.com`: unchanged; no production release authorized.
- Firebase Functions, Rules, Auth, IAM and data: unchanged.
- Zeffy account/form configuration: unchanged; public form display only.
- Payments and membership submissions: not performed.
