# Access Continuity

**Purpose:** ensure at least two named officers can reach every important service if the usual owner is unavailable.
**Status:** setup is **INCOMPLETE** until the entry document is in a board-owned Drive and two backup officers complete a sign-in drill.
**Approver:** club president plus the officer responsible for the service.

## Entry document and private locator

A private Google Doc titled **MPRC Website — Officer Start Here** has been created and connector-readback verified. Its private link is intentionally absent from this public repository. Metadata currently reports owner-only access, so backup-officer sharing is not complete. It contains no passwords or member/payment data.

Owner action still required:

1. Create a board-owned Google Drive folder named **Website Continuity**.
2. Move the entry document into that folder.
3. Share the folder with at least two current officers.
4. Confirm both officers can open the document using their own accounts.
5. Add the approved password-manager vault name to the private document.
6. Do not add a password, recovery code, API key, or private member/payment record.

Until those six steps are recorded, this guide does not claim incapacitation coverage is complete.

## Before you start

- Select two individual officers; do not share Dave's login.
- Select the club-approved password manager.
- Require two-person approval for owner, billing, recovery, or security changes.

## Systems to cover

| System | Why it matters | Minimum backup |
| --- | --- | --- |
| GitHub `Run-MPRC` organization | Source, issues, reviews, workflows | Two individual organization owners with secure two-factor authentication |
| Netlify | Current live website host | Two team owners; site and branch recorded |
| Domain registrar and DNS | Controls `runmprc.com` | Two owners; renewal and recovery email verified |
| Firebase / Google Cloud | Login, database, Functions, rules | Two limited-access administrators |
| Stripe | Payments, refunds, disputes, payouts | Treasurer plus finance backup; strong two-factor authentication |
| Google Workspace / Drive / Forms | Club documents and forms | Two Workspace/Drive owners |
| Club email provider | Notices and password recovery | Communications owner plus backup |
| Social/community accounts | Public communication and member groups | Named owner plus backup |

## Release access to record privately

Record these facts without copying a credential or private provider identifier:

1. Dave Liu is the current primary production release approver.
2. Name the backup/security reviewer who can approve when Dave is unavailable.
3. Name two reviewers for the protected `staging` environment.
4. Name two reviewers for the protected `production` environment.
5. Record that `Protected release` is the approved GitHub workflow.
6. Record the fixed environment-to-Firebase-project map.
7. Record the fixed release plans and named resources.
8. Record the owner of the short-lived cloud identity and its revocation procedure.
9. Record the latest missing-authority failure drill.
10. Record the latest backend-first rollback or safe roll-forward drill.
11. Record the Netlify team owner, live site, protected trigger, and rollback location.

The repository stores none of the cloud identity value, provider path, access token, password, or recovery code. The protected release is **NOT AVAILABLE YET** until #133 completes these records and tests the environment approvals.

## Private service record

For each system, record only:

- Public sign-in URL.
- Primary officer role.
- Backup officer role.
- Club-owned account email.
- Password-manager vault name.
- Last successful sign-in date.
- Billing or renewal owner.
- Approved removal/recovery procedure location.
- Two-factor method type: passkey, authenticator, or hardware key.

## Quarterly check

1. Ask the primary owner to sign in.
2. Ask the backup owner to sign in.
3. Record the date of both successful checks.
4. Confirm recovery information is stored in the password manager.
5. Confirm billing and renewal notices reach a club-owned address.
6. List former officers, unused integrations, and old tokens for review.
7. Have two owners approve any removal.
8. Test the service-specific recovery or rollback procedure before removing access.
9. Confirm GitHub, Netlify, DNS, and Firebase agree on the intended production path.
10. Confirm a normal merge does not start the GitHub release.
11. Confirm missing release authority becomes a red failure before backend installation, cloud authentication, deployment, or website publication. A public website artifact may be prepared without cloud authority.
12. Confirm Firebase verification must finish before the GitHub Pages publication job can start.
13. Confirm Netlify Git-triggered production builds remain paused until a protected live-host path exists.
14. Confirm reviewers reject release requests older than 24 hours and request the current `main` commit again.
15. **NOT AVAILABLE YET:** complete the synthetic role-boundary drill below after the reviewed database, Function, and website revisions are safely available in protected staging.

### Synthetic role-boundary drill — NOT AVAILABLE YET

**Purpose:** prove that the staged website, database permissions, and current server Functions all require both verified email and the already-approved role.

**Approver:** platform/security owner plus one backup reviewer.

**Prerequisites:** #196 database-permission source, #209 Function source, and #213 website source are merged; protected staging has read back all three exact revisions after a backend-first release; the platform/security owner has prepared synthetic accounts and synthetic records only; reviewed backend and website rollback or safe-roll-forward plans are ready. If any prerequisite is missing, do not start.

1. Ask the platform/security owner to record the exact staged database-permission revision.
2. Ask the platform/security owner to record the exact staged Function revision.
3. Ask the platform/security owner to record the exact staged website revision.
4. Confirm the staging records contain no real member, registration, payment, or contact information.
5. Ask the platform/security owner to run the four identity combinations in the table below.
6. Observe whether the website shows member/admin controls for each combination.
7. Observe one private database read for each combination.
8. Observe one member-only checkout check for each combination.
9. Observe one member-price check for each combination.
10. Observe one admin action for each combination.
11. Observe one registration-export authorization check for each combination.
12. Record only the date, two approvers, exact revisions, surface name, and fixed show/hide or allow/deny result.
13. Do not copy a token, email address, member record, registration row, or CSV content.

| Made-up account | Website member/admin controls | Private member read | Member-only checkout / price | Admin action / registration export |
| --- | --- | --- | --- | --- |
| Verified + approved member role | Show only existing member controls | Allow only the existing member read | Allow the existing member behavior | Deny |
| Verified + approved admin role | Show existing member/admin controls | Allow only the existing admin/member read | Allow the existing admin/member behavior | Allow only the existing admin behavior |
| Unverified + member or admin role | Hide member/admin controls | Deny | Deny member treatment | Deny |
| Verified or unverified + no approved role | Hide member/admin controls | Deny role-based read | Deny member treatment | Deny |

**Expected result:** every observed result matches the table. Verification never creates a role. A member role never becomes admin access.

**Success proof:** the private drill record names the exact database, Function, and website revisions, both approvers, the check date, and one fixed result for every table cell. It contains no identity, token, member data, registration content, or exported file.

**Stop conditions:** stop immediately on an unexpected allow, an unexpected deny for the verified matching role, a missing or different revision, any real data, or any request to repair the result in Firebase Console. Do not continue to production or `runmprc.com` publication.

**Undo and recovery:** ask the platform/security owner to use the reviewed backend and website rollback or safe-roll-forward plans. Keep the website unpublished outside protected staging. Repeat the complete matrix only after all three exact revisions are read back again. Do not change a real account or production record.

**Escalation:** platform/security owner plus backup. Add the privacy lead if any real or exported data was exposed. Add the club president if neither technical owner is reachable.

## Expected result and success proof

- Two current officers can open the private entry document.
- Two current officers can sign in to every system with their own accounts.
- The password manager, billing owner, and recovery procedure are named without exposing their contents.
- The drill date and approving officers are recorded privately.

## Stop conditions

Stop if a service has only one owner, uses Dave's personal recovery channel, has no tested rollback, or asks for a password/code in a shared document. Also stop if a merge can publish unexpectedly, a server credential reaches a website job, a project/scope can be typed freely, a green backend skip is possible, or a website can publish before backend verification. Do not remove an account, token, integration, fork, or billing method until two owners complete a dependency check.

Also stop if a role-bearing Firebase account can see member/admin website controls, open private member/admin data, call an admin Function, receive member checkout treatment, or export registrations before its email is verified. Do not work around that result by editing a profile, changing a role, or using Firebase Console. Record only the fixed test result and exact tested revision, then escalate to the platform/security owner.

## Undo and recovery

If an access change blocks a valid officer, stop further removals. Use the service's approved recovery procedure with two owners. Restore only the minimum former access, record why, and schedule a new least-access review.

## Escalation

- GitHub, Netlify, Firebase, DNS, or security: platform owner plus backup.
- Stripe, billing, refunds, or payouts: treasurer plus finance backup.
- Google Drive or club email: Workspace/communications owner plus backup.
- No reachable owner: club president initiates provider account recovery; do not create an unofficial shared login.

## Special GitHub note

`Run-MPRC` is the club organization, and `main` is now the canonical default branch. `runmprc` is a separate personal user and stale fork owner. Do not retire it from this guide alone. First open a claimed cleanup issue, inventory outside dependencies, prepare rollback, and obtain two-owner approval.

## Annual tabletop exercise

Ask a backup officer who did not write these guides to request one harmless text change without Dave's help. Record every confusing step and update the guides before the exercise is closed.
