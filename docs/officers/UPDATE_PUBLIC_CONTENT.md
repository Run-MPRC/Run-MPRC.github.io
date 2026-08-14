# Update Public Text, Links, Photos, or Officers

**Use this when:** the change is public information and does not affect money, private data, access, legal wording, or security.
**Approver:** communications lead or the officer who owns the page.

**Before you start:** have exact approved wording, a public link, or an approved photo; know the page and intended date.
**Expected result:** one reviewed public-content change with no account, data, payment, policy, or security effect.

## Text

1. Copy the current sentence from the live page.
2. Write the replacement sentence.
3. Name the page and heading where it appears.
4. Ask AI to update every matching public description, including search text when relevant.
5. Review the preview on a phone-sized view.
6. Review the preview on a normal computer view.
7. Confirm no price, date, address, or policy changed by accident.

Helpful request:

> On the MPRC **[page]**, replace **[old text]** with **[approved new text]**. Keep the rest of the page unchanged and show me the page preview before publishing.

## Public links and Google Forms

1. Open the new link in a private/incognito window.
2. Confirm it is a public viewing or submission link.
3. Never send an edit link, owner link, or link containing a private token.
4. Give AI the old public link and the new public link.
5. Ask AI to find every visible place using the old link.
6. Test each changed button from the preview.

## Suggestions page no-form preview — SOURCE ONLY, NOT LIVE

**Purpose:** confirm that the Suggestions source shows only approved public
information and opens the existing Contact page without adding an intake form.
This procedure checks display of approved wording. It does not approve or change
privacy or security policy.

**Approver:** communications lead and privacy/security owner.

**Before you start:** have the exact #618 pull request and preview link, plus the
approved Suggestions wording. Stay signed out. Use phone and computer widths.
Use no real suggestion, security evidence, or private information. Do not
activate the email control on Contact.

1. Open the exact `/suggestions` preview while signed out at a phone-sized width.
2. Confirm that the address ends in `/suggestions`.
3. Confirm that the page has one **Suggestions** heading.
4. Confirm that the browser title identifies Suggestions.
5. Compare the safety wording with the approved text.
6. Confirm that the page says it has no suggestion form and submits no idea.
7. Confirm that the email-retention disclosure identifies Contact as a separate existing channel.
8. Confirm that the page promises no anonymity, confidentiality, reply, or implementation.
9. Confirm that there is no textbox, upload, submit button, vote, or public idea list.
10. Use Tab to reach **Go to Contact**.
11. Confirm that focus is visible.
12. Press Enter.
13. Confirm that `/contact` opens.
14. Do not activate the email control on Contact.
15. Open the same preview at a normal computer width.
16. Use the footer **Suggestions** link.
17. Confirm that `/suggestions` opens.
18. Confirm that no content is clipped or hidden.

**Expected result:** the source preview shows fixed public information and one
internal Contact action only. It creates no suggestion intake. This check does
not prove that the mailbox is monitored, that an email is delivered or retained
for a defined period, that a reply occurs, or that the page is live.

**Stop conditions:** stop if the Suggestions page adds a form, external intake,
or direct email link; makes an anonymity, confidentiality, reply, or
implementation promise; requests private information or security evidence;
diverges from the current `SECURITY.md` first-contact direction; requires
sign-in; performs a provider action; opens the wrong route; hides keyboard
focus; clips content; or changes the public website unexpectedly.

**Success proof:** record the exact reviewed head, preview URL, check date,
phone and computer widths, route, heading, title, no-form checklist, keyboard
result, and pass or fail. Use redacted screenshots only.

**Undo:** reject the pull request before merge, or ask the platform maintainer
for one revert pull request after merge. No provider action or data cleanup is
needed for this source-only page.

**Escalation:** communications lead for wording; privacy/security owner for
safety language; platform owner and accessibility reviewer for route, focus, or
layout failures.

Source, tests, merge, website publication, `runmprc.com` verification,
Firebase deployment, outside-provider configuration, and production behavior
are separate states. This procedure describes #618 source and preview behavior
only. It is **NOT LIVE** until an approved exact website release is published
and the same checks pass on `runmprc.com`.

## Photos

1. Get permission to publish the photo.
2. Confirm the correct name and role of each person shown.
3. Use a clear JPG or PNG; a square photo works best for officers.
4. Remove private location or device information when possible.
5. Tell AI where the photo should appear. Provide a short description for screen readers unless the photo is only decorative.
6. Review the crop on phone and computer views.
7. Confirm the page title and first line of content begin below the blue navigation bar.

Do not publish photos of minors, private events, name badges, addresses, license plates, or private screens without specific approval.

## Officer list

1. Obtain the approved officer name, title, display order, and photo permission.
2. State the date the change should take effect.
3. Ask AI to update the visible list and search-engine description together.
4. Check spelling, title, photo, order, and old-officer removal.
5. Ask AI to confirm no account permissions changed. Website display and GitHub/Firebase access are separate.

## Phone navigation check — #659 LIVE AND VERIFIED 2026-08-14

**Purpose:** confirm that the small-screen menu is predictable before a website release.

**Approver:** communications lead or platform owner.

**Before you start:** stay signed out and use no private information. WEB-002D [#659](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/659) completed one exact-artifact release of the reviewed #490 phone-menu behavior with the related visible-focus and route-focus source. Production deploy `6a7ece87c5ca4d0007c1a3fc` passed the signed-out phone menu and route-focus check. #623 deploy `6a7e072f8f346b0008510d29` is the rollback target.

1. Open the preview at a phone-sized width.
2. Select the MPRC logo while the menu is closed.
3. Confirm Home opens and the menu stays closed.
4. Open the menu with its button.
5. Select one public page and confirm the menu closes.
6. Reopen the menu and select Sign in.
7. Confirm the Sign in page opens and the menu closes.
8. Use Tab and Enter to repeat the open, close, and public-page check.
9. Open the preview at a normal computer width.
10. Confirm the navigation links remain visible and work normally.

**Expected result:** only the menu button opens the menu; the logo or any destination closes it after opening the correct page.

**Stop conditions:** stop if a destination is wrong, the logo opens the menu, the menu stays open after a choice, keyboard use fails, or computer navigation changes.

**Success proof:** record the preview link, check date, phone and computer widths, tested destination, keyboard result, and pass or fail. Keep accounts and private information out of screenshots.

**Undo:** ask the platform maintainer for one revert pull request. Do not publish a second fix at the same time.

**Escalation:** platform owner first; accessibility reviewer second.

The completed #659 signed-out live check used safe public destinations only. At phone width, the menu exposed truthful open disclosure state; choosing `/events` closed it, moved focus to main content at the top, and caused no horizontal overflow. Exact served source, CSS, and mutation-sensitive tests preserve the bounded visible-focus cue; this audit does not claim a saved screenshot or a separate live keyboard `:focus-visible` observation. On production, do not choose Sign in, enter data, open a private page, or submit a form. Repause attempt `6a7ed0ddb00a46000818878d` published nothing and retained deploy `6a7ece87c5ca4d0007c1a3fc`. Follow the full no-terminal record in [Review, merge, release, and check a change](./PUBLISH_AND_CHECK.md).

## Success check

- The exact change appears on `runmprc.com`.
- Every new link opens correctly without requiring editor access.
- Photos have correct names and descriptions, or are correctly marked decorative.
- Each intended page shows its header photo, and no page text is hidden behind the navigation bar.
- No unrelated page changed.
- The delivery report separates “merged” from “verified live.”

## Stop here instead

Use [Events, shop, members, and money](./EVENTS_SHOP_MEMBERS.md) if the change mentions a signup, price, waiver, member benefit, discount, race, product, order, refund, or private page.

## Undo

Ask the platform maintainer for one revert pull request. Do not edit `main`, delete content records, change DNS, or bundle a second change into the rollback.

## Escalation

- Wording, public link, or approved photo: communications lead.
- Officer name/title: club president or secretary plus communications lead.
- Unexpected layout, deployment, or live-site mismatch: platform owner plus backup.
- Any money, policy, access, privacy, or security effect: stop and use the specialist guide linked above.
