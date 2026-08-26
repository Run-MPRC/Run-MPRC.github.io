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
- **Hosted frontend tests passed:** Did the `Frontend lint + build` job show a green `Run frontend Jest tests` step? Jest is the automated frontend behavior test.
- **Hosted payment-safety test passed:** Did the `Commerce command journal emulator` job finish green? This check uses made-up records in a closed test database.
- **Hosted test-output safety check passed:** Did the `Test artifact scrubber` job finish green? It proves the deliberate made-up output scan ran. It does not prove that a report was uploaded or that a live service changed.
- **Other tests passed:** What else was checked for this change?
- **Code merged:** Which pull request was approved?
- **Release approved:** Which environment, exact commit, and named approver were recorded?
- **Backend live:** If Firebase changed, did the fixed backend deployment and verification finish before website publication?
- **Pages published:** Did GitHub Pages receive the same exact commit, and was its old `runmprc.com` claim cleared and verified?
- **Website live:** Did Netlify identify that commit, and was the exact change then seen on [runmprc.com](https://runmprc.com)?
- **Outside service verified:** If Stripe, Netlify, DNS, Google, or email changed, was that service checked separately?

As of **2026-08-13**, a merge runs checks but does not start the GitHub release. The protected release is **NOT AVAILABLE YET** until its short-lived cloud identity and named environment approvers are configured under issue #133. Ordinary Git-triggered Netlify production builds are paused. An overbroad #473 web artifact was published and immediately rolled back; its bounded replacement remains the recorded rollback. #623 then completed one separate, exact-artifact release of the inert member-directory interface. Netlify deploy `6a7e072f8f346b0008510d29` is live from source `c2d87d1f69f15e128a0bc9b1b9f915b7c8417aec`. Signed-out route and guard checks passed, no member-directory request was observed, and repause merge `c8678c623afdd9becf77d596b71f36f26f04b746` made the temporary manifest inactive without replacing that deploy. Shop remains the static in-person catalog, while Events and Calendar show a fixed retry-later notice instead of a raw provider error. Event records are still unavailable because no Firebase repair was deployed. This does not change sign-in, expose protected event offers, add officer editing, or make commerce safe. GitHub Pages still reports `runmprc.com` as its custom domain even though Netlify serves that name; source removal is not provider proof. A green test or workflow does **not** by itself prove that GitHub Pages, `runmprc.com`, Firebase, or that domain setting changed.

As of **2026-08-14**, [#659](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/659) completed one accessibility-only Netlify release. Deploy `6a7ece87c5ca4d0007c1a3fc` is live from frozen source `7496fe0881fb52908c4ff2f40f488df09c94c908`; its exact 62-file marker and signed-out desktop/phone route-focus and menu checks passed. Repause merge `3138a00c1c48e1d5d1dcda0b44722b09a2194ff7` made the manifest inactive. Its attempt `6a7ed0ddb00a46000818878d` published nothing and retained the verified deploy. #623 deploy `6a7e072f8f346b0008510d29` is the recorded rollback, not current production. #659 changed no Firebase, provider configuration, account, sign-in state, production data, payment, or connected directory behavior. Officers do not run commands, sign in, enter data, or approve this as a reusable release. Follow the completed record in [Review, merge, release, and check a change](./docs/officers/PUBLISH_AND_CHECK.md).

As of **2026-08-26**, WEB-001A1 [#663](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/663) is merged, and WEB-001A2 [#665](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/665) created the club-owned `run-mprc-staging` project and published exact source `a614c68d9a1a2be631a3be874a686d61e5d170a0` to [run-mprc-staging.web.app](https://run-mprc-staging.web.app). CI-001C1 [#667](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/667) adds a separate protected read-only identity check: Dave Liu or Jeff Chang reviews exact `main`, and a keyless five-minute identity may read only the staging project identity. It cannot deploy Firebase. This remains an **ENGINEERING STAGING SITE ONLY**. Desktop and phone public-route checks passed, but staging has no approved backend/provider test estate, App Check key, protected automatic release, release marker, tested predecessor rollback, security-header policy, custom domain, or officer publish control. Do not sign in or enter real information there. Netlify still answers `runmprc.com`; production Firebase Hosting remains empty, and no DNS, GitHub Pages, Netlify, backend, or production-data change occurred.

The optional profile-photo and officer People-finder functions are still **NOT AVAILABLE YET**. #621 makes the frontend default an inert preview: My Account shows the future photo and separate finder-choice controls disabled, while the People finder stays behind the administrator guard and shows its name field and Search button disabled. The preview reads no saved photo or setting, accepts or uploads no photo, searches no name, and saves nothing; it shows no people or sample results. #623 published exactly that disabled interface as deploy `6a7e072f8f346b0008510d29`. Officers inspect the protected layouts only in synthetic local artifacts. The completed signed-out production review proved only the exact revision, normal sign-in and administrator guards, and absence of a member-directory network request. Do not sign in to production, choose a real photo, enter a real name, or treat the preview as a directory. #623 changed no Firebase, provider configuration, account, sign-in, or production data. #507 must later prove the privacy, authorization, staging, backend-first deployment, and readback gates before a separate reviewed source change may connect it. Follow the preview and source-review procedure in [Events, shop, members, and money](./docs/officers/EVENTS_SHOP_MEMBERS.md).

For the concise handbook, see [OFFICER_HANDBOOK.md](./OFFICER_HANDBOOK.md). The expanded task index is [docs/officers/README.md](./docs/officers/README.md).
