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

## Phone navigation preview check — NOT LIVE YET

**Purpose:** confirm that the small-screen menu is predictable before a website release.

**Approver:** communications lead or platform owner.

**Before you start:** have the reviewed preview link. Stay signed out and use no private information.

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

This check describes #490 source and preview behavior only. It is **NOT LIVE YET** until an approved exact website release is published and the same checks pass on `runmprc.com`.

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
