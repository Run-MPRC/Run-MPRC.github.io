# Review, Merge, and Check a Change

**Use this when:** a preview is approved and someone asks whether the change is live.
**Approver:** content owner for ordinary content; specialist owners listed in [Events, shop, members, and money](./EVENTS_SHOP_MEMBERS.md) for higher-risk work.

**Independent officer publication status:** **NOT AVAILABLE YET.** A platform maintainer must own the merge and live verification until the Netlify repository, branch, owner, build, preview, and rollback path are recorded and tested.

## Current deployment truth

As of **2026-07-12**:

- Merging to `main` starts GitHub workflows.
- Merging therefore also authorizes an automatic GitHub Pages publication; there is no separate Pages approval today.
- The GitHub repository currently opens stale, unprotected `dev` by default; use the explicit `main` branch and do not merge `dev` into `main` as a shortcut.
- GitHub Pages builds a copy of the website.
- `runmprc.com` is currently served by Netlify, not that Pages copy.
- The Firebase step can say success while skipping deployment when its service-account secret is absent.
- Therefore, a green workflow does not prove the public site or backend changed.

## Before merge

1. Open the pull request and confirm its destination says `main`.
2. Confirm it names one issue and one outcome.
3. Confirm another person or review agent approved it.
4. Confirm required tests are green without “ignored” failures.
5. Confirm the officer guide was updated when needed.
6. Read the rollback note.
7. Confirm you understand that a merge automatically publishes the GitHub Pages copy.
8. Ask the platform maintainer whether any outside automation may also publish from the merge.
9. Do not merge if either automatic publication is unacceptable or unknown.

## Netlify publication — NOT AVAILABLE YET

Before a backup officer can publish independently, a claimed hosting issue must record and test:

1. The exact Netlify team and site name.
2. The two officer accounts that own it.
3. The connected GitHub repository and branch.
4. The event that starts a production deploy.
5. The build command and public configuration names.
6. A safe preview URL for the intended commit.
7. Where Netlify displays the deployed commit.
8. How to restore the previous known-good deploy.
9. Which DNS records point `runmprc.com` to Netlify.
10. A dated drill proving the procedure without changing member or payment data.

## After merge

1. Record the pull request number and merged commit.
2. Wait for the GitHub workflow to finish.
3. Read the job details, not only the green summary.
4. Look for “skipping Firebase deploy.” If present, mark the backend **not deployed**.
5. Ask the platform maintainer which commit Netlify says it deployed.
6. Open [runmprc.com](https://runmprc.com) in a private/incognito window.
7. Visit the exact changed page directly.
8. Check the requested text, link, image, or behavior.
9. Check one phone-sized view.
10. Check one normal computer view.
11. If Firebase or an outside service changed, ask its owner for separate dated proof.
12. Record the result using the checklist below.

## Delivery record

```text
Issue:
Pull request:
Merged commit:
Tests passed:
GitHub Pages published: yes / no / not relevant
Netlify intended commit verified: yes / no / unknown
runmprc.com verified: yes / no
Firebase deployed: yes / no / not relevant
Outside provider configured: yes / no / not relevant
Outside provider verified: yes / no / not relevant
Production behavior verified: yes / no
Checked by:
Checked at (date and time):
Known remaining problem:
```

## If the change is not on the live site

1. Do not repeatedly merge or redeploy.
2. Save the live URL, time, and a redacted screenshot.
3. Ask AI to compare the merged version, GitHub Pages copy, and Netlify copy.
4. Treat the problem as a hosting/deployment issue.
5. Do not change DNS until the Netlify site, owner, branch, environment, and rollback are confirmed.

## Undo

Ask for a revert pull request. Do not force-push, reset shared branches, delete data, or make a second unrelated change while the first problem is being investigated.

**Escalation:** platform owner and backup for website hosting; Firebase owner for backend changes; treasurer plus platform owner for commerce.
