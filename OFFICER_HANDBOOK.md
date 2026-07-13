# MPRC Website Officer Handbook

**Purpose:** help a backup officer request, approve, verify, or undo a website change without learning to code.

Start with [OFFICER_START_HERE.md](./OFFICER_START_HERE.md) if you have less than five minutes.

The private Google Doc entry card titled **MPRC Website — Officer Start Here** is created and readback-verified but currently owner-only. Its private link is not stored in this public repository. Sharing to at least two backup officers remains a required board action.

## The whole process

```mermaid
flowchart TD
    Ask["Describe the result"] --> Track["One issue and pull request"]
    Track --> Preview["Preview and checks"]
    Preview --> Approve{"Approve merge?"}
    Approve -- "No" --> Track
    Approve -- "Yes" --> Merged["Merged to main — not released"]
    Merged --> Request["Request one exact-commit release"]
    Request --> Preflight["Check commit and tests; prepare public artifact"]
    Preflight --> Release{"Approve protected environment?"}
    Release -- "No" --> Merged
    Release -- "Yes" --> Gate["Check project, scope, and authority"]
    Gate --> Backend{"Firebase deployed and verified?"}
    Backend -- "No" --> Stop["Stop — website is not published"]
    Backend -- "Yes" --> Pages["Publish GitHub Pages copy"]
    Pages --> Verify["Check Pages, Netlify, runmprc.com, and providers separately"]
    Verify --> Record["Record proof and undo plan"]
```

In words: approve the merge first; request one exact release; approve its protected environment after the source checks; Firebase must finish before the Pages copy; then check every real service separately.

## One-line request for AI

> Please update the MPRC website so **[describe the result]** on **[page]** by **[date, if any]**. Read `OFFICER_START_HERE.md` and `AGENTS.md`, use one issue and one small pull request, show a preview and proof, update officer documentation, and do not publish, deploy, use secrets, or change real member/payment data until **[approver]** explicitly approves.

## Find the right procedure

| Need | Procedure | Current status |
| --- | --- | --- |
| Any website change | [Request a change](./docs/officers/REQUEST_A_CHANGE.md) | Available |
| Public words, links, photos, or officer list | [Update public content](./docs/officers/UPDATE_PUBLIC_CONTENT.md) | Available through an issue and reviewed pull request |
| Events, products, members, race signup, money, waiver, or privacy | [Events, shop, members, and money](./docs/officers/EVENTS_SHOP_MEMBERS.md) | Source exists; live behavior unverified; live commerce unavailable |
| Merge, publish, and prove the result is live | [Publish and check](./docs/officers/PUBLISH_AND_CHECK.md) | Requires a platform maintainer while hosting is split |
| Outage, wrong page, privacy/security concern, or unexpected payment | [Emergency and recovery](./docs/officers/EMERGENCY_AND_RECOVERY.md) | Available as an escalation and evidence guide |
| Backup access and officer transition | [Access continuity](./docs/officers/ACCESS_CONTINUITY.md) | Private owner action required |
| Pages, data, deployment, and emergency flow | [Simple system maps](./docs/officers/SYSTEM_MAPS.md) | Current as of 2026-07-12 |
| Unfamiliar word | [Plain-language glossary](./docs/officers/GLOSSARY.md) | Available |

## Current facts that prevent false confidence

- Use the canonical [`main` branch](https://github.com/Run-MPRC/Run-MPRC.github.io/tree/main).
- `runmprc.com` is currently served by Netlify.
- GitHub also publishes a separate Pages copy.
- A `main` merge runs checks but does not start the protected GitHub release.
- The protected release is **NOT AVAILABLE YET** until #133 configures its short-lived cloud identity and named approvers.
- The release fails when authority or required configuration is missing. It cannot report a green backend skip.
- Firebase must be verified before the Pages publication job can start.
- Git-triggered Netlify production builds are paused by repository configuration.
- Independent officer publishing to the live Netlify host is **NOT AVAILABLE YET**.
- Netlify build hooks and provider settings remain unverified. The GitHub release does not claim to publish `runmprc.com`.
- Live race registration, merchandise payments, and refunds are not approved.
- There is no proven no-code switch that safely stops every new Stripe payment.

## Never share

- Passwords, login codes, recovery codes, private keys, or service secrets.
- Full member lists or private member details.
- Card, bank, payout, refund, health, or emergency-contact information.
- Private edit links, owner links, or screenshots showing private screens.

Use the club's approved password manager for access. Use public links, redacted screenshots, and made-up test data when asking for help.

## Approval rules

| Change | Minimum approval |
| --- | --- |
| Ordinary public wording, link, or approved photo | Content-owning officer |
| Event date, registration window, capacity, member access, or admin duty | Business owner + platform owner |
| Price, discount, tax, order, refund, payout, or Stripe | Treasurer + platform owner |
| Waiver, Terms, Privacy, insurance, or data retention | Club officer + approved legal/privacy owner |
| Domain, Netlify, Firebase, GitHub ownership, secret, or security rule | Service owner + backup/security reviewer |

## Before anyone says “done”

Record separate answers:

1. What source changed?
2. What tests passed?
3. What pull request merged?
4. Which exact commit and environment were approved for release?
5. Did Firebase deploy and pass verification first?
6. Was the GitHub Pages copy published afterward?
7. Did Netlify identify the intended commit, or is that still unknown?
8. Was the exact result seen on `runmprc.com`?
9. Was each affected outside provider configured and checked directly?
10. Who approved and checked the result?
11. How can the change be undone safely through the same gate?

The expanded handbook and task index is [docs/officers/README.md](./docs/officers/README.md).
