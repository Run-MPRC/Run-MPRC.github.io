# Request a Website Change

**Use this when:** you know what should look or behave differently.
**Approver:** the officer responsible for that content; a second approver for money, legal, privacy, access, or security.

## Before you start

Have one of these ready:

- The exact new wording.
- A public link that should replace an old link.
- An approved photo and permission to publish it.
- A screenshot with private information covered.
- A plain description of what a visitor should be able to do.

## The one-line request

> Please update the MPRC website so **[desired result]** on **[page or area]** by **[date, if any]**. Read `OFFICER_START_HERE.md` and `AGENTS.md`, show a preview and proof, update officer documentation, and do not publish or use secrets or real member/payment data until **[approver]** approves.

## Steps

1. Open an AI assistant that can read the MPRC repository.
2. Paste the one-line request.
3. Attach only public or redacted source material.
4. Ask the AI to repeat the request in plain words.
5. Confirm what must change and what must stay the same.
6. Require one GitHub issue and one small pull request based on `main`.
7. Ask for the affected page link and a preview or clear before/after view.
8. Review spelling, dates, links, mobile layout, and unintended changes.
9. If the preview is correct, approve or reject the merge.
10. Record the merged commit as **not released**.
11. If publication is needed, use the separate protected-release checklist in [Publish and check](./PUBLISH_AND_CHECK.md).
12. Use [Publish and check](./PUBLISH_AND_CHECK.md) before calling the change live.

If you open GitHub yourself, use the [canonical repository on `main`](https://github.com/Run-MPRC/Run-MPRC.github.io/tree/main), then select **Issues**. `main` is now the repository default. Do not use the legacy `dev` branch as the source for a new request.

The GitHub release is manual. A `main` merge runs checks but does not publish the GitHub Pages copy or deploy Firebase. Ordinary Git-triggered Netlify production builds are paused by repository configuration. Issue #457 temporarily permits only its exact-parent, exact-artifact web release; Netlify provider settings remain separately unverified. Stop and escalate any other publication.

## If you cannot open an AI assistant

1. Sign in to GitHub with your own officer account, not Dave's account.
2. Open the [canonical repository on `main`](https://github.com/Run-MPRC/Run-MPRC.github.io/tree/main).
3. Select **Issues**.
4. Select **New issue**.
5. Choose **Officer website change request** if that choice appears.
6. Paste the one-line request.
7. Assign the issue to an approved maintainer or ask the platform backup to do so.

A screenshot guide for a chosen AI tool is **NOT AVAILABLE YET** because the board has not selected one supported tool/account path for backup officers. Do not share Dave's login as a workaround.

## What the AI must return

- A one-sentence result.
- A link to the issue and pull request.
- The pages or services affected.
- The checks that passed.
- The officer guide that changed, or a plain reason none changed.
- Separate answers for merged, website live, Firebase live, and outside-service verified.
- A safe undo plan.

## Stop and ask for a specialist if

- The request changes a price, payment, refund, payout, capacity, or inventory.
- The request changes a waiver, Terms, Privacy notice, tax, insurance, or retention rule.
- The request changes a member role, account owner, secret, domain, or security rule.
- The AI asks for a password, code, secret, private member record, or payment record.
- The AI proposes a direct production edit, force-push, broad merge, or skipped test.

## If the result is wrong

Do not keep making random edits. Ask:

> Prepare a small revert pull request for the last approved change. Do not force-push, delete records, change DNS, or deploy until an officer reviews the rollback.
