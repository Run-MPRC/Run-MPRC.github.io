# Review, Merge, and Check a Change

**Purpose:** Review one approved change, merge it safely, and record what did or did not become live.
**Approver:** content owner for ordinary content; specialist owners listed in [Events, shop, members, and money](./EVENTS_SHOP_MEMBERS.md) for higher-risk work.
**Prerequisites:** an approved pull request aimed at `main`, its rollback note, access to its GitHub job details, and a platform maintainer available for merge and live verification.

**Independent officer publication status:** **NOT AVAILABLE YET.** A platform maintainer must own the merge and live verification until the Netlify repository, branch, owner, build, preview, and rollback path are recorded and tested.

## Current deployment truth

As of **2026-07-13**:

- Merging to `main` starts GitHub workflows.
- The `Frontend lint + build` job includes a job-failing step named `Run frontend Jest tests`. A failed step fails that job.
- Required branch protection is not proven. The Jest step does not by itself prevent someone with merge access from merging a failed change.
- The same job still has a lint command that can rewrite files and ignore failure. A green job is not proof that lint passed.
- Merging therefore also authorizes an automatic GitHub Pages publication; there is no separate Pages approval today.
- The GitHub repository currently opens stale, unprotected `dev` by default; use the explicit `main` branch and do not merge `dev` into `main` as a shortcut.
- GitHub Pages builds a copy of the website.
- `runmprc.com` is currently served by Netlify, not that Pages copy.
- Current previews are optimized production-mode builds and can point at production Firebase. They are safe only for public, read-only page review.
- The Firebase step can say success while skipping deployment when its service-account secret is absent.
- Therefore, a green workflow does not prove the public site or backend changed.

## Before merge

1. Open the pull request and confirm its destination says `main`.
2. Confirm it names one issue and one outcome.
3. Confirm another person or review agent approved it.
4. Open the `Frontend lint + build` job.
5. Confirm `Run frontend Jest tests` is present and green. Stop if it is missing, skipped, or failed.
6. Confirm the other required test steps are green.
7. If you open a preview, review only public pages. Do not sign in, open a private/admin page, submit a form, or test a signup, checkout, refund, email, or Strava action.
8. Ask the platform maintainer for separate non-mutating lint evidence when lint applies. Do not use the green job as lint proof.
9. Confirm the officer guide was updated when needed.
10. Read the rollback note.
11. Confirm you understand that a merge automatically publishes the GitHub Pages copy.
12. Ask the platform maintainer whether any outside automation may also publish from the merge.
13. Do not merge if either automatic publication is unacceptable or unknown.

## Netlify publication — NOT AVAILABLE YET

Before a backup officer can publish independently, a claimed hosting issue must record and test:

1. The exact Netlify team and site name.
2. The two officer accounts that own it.
3. The connected GitHub repository and branch.
4. The event that starts a production deploy.
5. The build command and public configuration names.
6. A safe preview URL for the intended commit, plus proof that private/Firebase actions use staging before anyone signs in.
7. Where Netlify displays the deployed commit.
8. How to restore the previous known-good deploy.
9. Which DNS records point `runmprc.com` to Netlify.
10. A dated drill proving the procedure without changing member or payment data.

## After merge

1. Record the pull request number and merged commit.
2. Wait for the GitHub workflow to finish.
3. Read the job details, not only the green summary.
4. Confirm the merged commit's `Run frontend Jest tests` step is green. Stop and escalate if it is missing, skipped, or failed.
5. Look for “skipping Firebase deploy.” If present, mark the backend **not deployed**.
6. Ask the platform maintainer which commit Netlify says it deployed.
7. Open [runmprc.com](https://runmprc.com) in a private/incognito window.
8. Visit the exact changed page directly.
9. Check the requested text, link, image, or behavior.
10. Check one phone-sized view.
11. Check one normal computer view.
12. If Firebase or an outside service changed, ask its owner for separate dated proof.
13. Record the result using the checklist below.

## Expected result

The named Jest step is green for both the pull-request commit and the merged commit. The delivery record separately says whether GitHub Pages, Netlify, `runmprc.com`, Firebase, and any outside provider were verified.

## Stop conditions

Stop and ask the platform maintainer if the pull request does not target `main`; approval or the rollback note is missing; the named Jest step is missing, skipped, or failed; a preview asks you to sign in or use private/Firebase behavior; publication is unexpected; the deployed commit is unknown; or any live surface disagrees with the merged change.

## Success proof

Keep the completed delivery record with links to the pull request, merged commit, and exact GitHub job details. Add dated, separately obtained proof for each live website, Firebase, or outside-provider surface that the change affected.

## Delivery record

```text
Issue:
Pull request:
Merged commit:
Hosted frontend Jest step: pass / fail / missing
Other tests passed:
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
