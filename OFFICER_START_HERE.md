# MPRC Website: Officer Start Here

**Use this page if Dave or the usual code owner is unavailable.** You do not need to know how to code.

**Google Doc entry card:** a private native Google Doc titled **MPRC Website — Officer Start Here** has been connector-readback verified with the safe request and warnings. Its private edit link is intentionally not published here. It is currently owner-only; continuity is incomplete until the board moves it to the board-owned Drive and shares it with at least two backup officers.

## Copy this one sentence into an AI assistant

> Please update the MPRC website so **[describe the result in plain words]**. Read `OFFICER_START_HERE.md` and `AGENTS.md`, make the smallest safe change, show me a preview and proof, update the officer guide, and do not publish, deploy, use secrets, or change real member/payment data until an officer explicitly approves.

Attach the exact wording, public link, or approved photo when you have it. The AI should ask questions if anything is unclear.

## Choose the closest task

| What you need | Open this short guide |
| --- | --- |
| Ask for any website change | [Request a change](./docs/officers/REQUEST_A_CHANGE.md) |
| Change public text, a public link, a photo, or the officer list | [Update public content](./docs/officers/UPDATE_PUBLIC_CONTENT.md) |
| Change an event, member access, race signup, shop item, price, refund, waiver, or privacy wording | [Events, shop, members, and money](./docs/officers/EVENTS_SHOP_MEMBERS.md) |
| Approve a change and check whether it is really live | [Publish and check](./docs/officers/PUBLISH_AND_CHECK.md) |
| The site is wrong, down, unsafe, or showing private information | [Emergency and recovery](./docs/officers/EMERGENCY_AND_RECOVERY.md) |
| Prepare backup officers and account access | [Access continuity](./docs/officers/ACCESS_CONTINUITY.md) |
| Understand the pages and services | [Simple system maps](./docs/officers/SYSTEM_MAPS.md) |
| Understand an unfamiliar word | [Plain-language glossary](./docs/officers/GLOSSARY.md) |

## Never paste these into AI, GitHub, email, or screenshots

- Passwords, recovery codes, private keys, or login codes.
- Stripe, Firebase, GitHub, Netlify, domain, or email secrets.
- Full member lists or private member details.
- Payment card, bank, payout, refund, emergency-contact, or health information.

Use the club's approved password manager for access. Share only a public link or a made-up example when asking for help.

## A change is complete only when each line is answered

- **Code changed:** What changed?
- **Tests passed:** What was checked?
- **Code merged:** Which pull request was approved?
- **Website live:** Was the exact change seen on [runmprc.com](https://runmprc.com)?
- **Backend live:** If Firebase changed, did the log show a real Firebase deployment rather than “skipping” it?
- **Outside service verified:** If Stripe, Netlify, DNS, Google, or email changed, was that service checked separately?

As of **2026-07-12**, GitHub Pages builds and the live Netlify site are separate. A green GitHub check does **not** by itself prove that `runmprc.com` or Firebase changed.

For the concise handbook, see [OFFICER_HANDBOOK.md](./OFFICER_HANDBOOK.md). The expanded task index is [docs/officers/README.md](./docs/officers/README.md).
