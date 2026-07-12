# Website Content Source Map

**For club officers:** use [OFFICER_START_HERE.md](../OFFICER_START_HERE.md) and [Update public content](./officers/UPDATE_PUBLIC_CONTENT.md). Do not edit these files or run deployment commands yourself.

**For AI agents and maintainers:** this page identifies likely source locations. Inspect the current page before editing because not all text is centralized.

## Public page sources

| Public area | Main source locations | Important note |
| --- | --- | --- |
| Home | `src/text/Home.js`, `src/pages/home/Home.jsx`, `src/images/home/` | Most prose is centralized. |
| About | `src/pages/about/About.jsx`, `src/images/about/` | Inspect the component; not every word is in `src/text/`. |
| Join Us | `src/text/JoinUs.js`, `src/pages/joinUs/`, `src/text/externalLinks.js`, `src/images/joinus/` | Includes membership, waiver, form, map, and price-like wording. Requires owner review. |
| Activities | `src/text/Activities.js`, `src/pages/activities/Activities.jsx`, `src/images/activities/` | Significant text, videos, and layout are hardcoded in the component. |
| Events | Firestore event records plus `src/pages/events/` | Admin saves can affect production data immediately. Live behavior is not verified. |
| Shop | Firestore product records plus `src/pages/shop/` | Live commerce is not approved. |
| Committee | `src/text/Committee.js`, `src/pages/officers/Committee.jsx`, `src/images/committee/` | Names/titles and duplicate search metadata live in the component. |
| Contact | `src/text/ContactUs.js`, `src/pages/contact/Contact.jsx`, `src/images/contact/` | Some text and email parts are hardcoded. |
| Footer | `src/text/Footer.js`, footer components | Legal/privacy-style wording requires an approved source. |
| Forms, map, and social links | `src/text/externalLinks.js` | Use public view/submission links, never private edit links. |
| Terms and Privacy | `src/pages/legal/` | Do not ask AI to invent policy. Require approved owner text. |
| Navigation | `src/data.jsx`, `src/App.jsx` | Route changes require the page map and officer guide to change. |

## Safe maintainer workflow

1. Read the officer's one-line request and identify the approving role.
2. Inspect the live page and every likely source listed above.
3. Open or use one claimed issue and one focused branch.
4. Change the smallest possible source area.
5. Update search metadata, links, image descriptions, and duplicated visible text when applicable.
6. Run focused checks and a production build without exposing secrets or using production data.
7. Provide a preview or redacted screenshot.
8. Update the affected officer task guide and map.
9. Obtain approval before merge.
10. Follow [Publish and check](./officers/PUBLISH_AND_CHECK.md); do not call a green workflow “live.”

## Images

- Prefer JPG or PNG files sized for the page.
- Use lowercase names without spaces.
- Obtain permission before publishing a person's photo.
- Provide meaningful alternative text.
- Remove private metadata and avoid names, addresses, badges, plates, or private screens in the image.

## Stop conditions

Stop and escalate if the content changes a price, capacity, discount, waiver, Terms, Privacy, member benefit/access, payment, refund, tax, insurance, retention rule, or private data. Those require the owners and evidence in [Events, shop, members, and money](./officers/EVENTS_SHOP_MEMBERS.md).
