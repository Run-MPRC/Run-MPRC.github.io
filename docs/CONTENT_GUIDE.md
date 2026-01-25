# Content Management Guide

This guide explains how to update content on the MPRC website.

## Updating Text Content

All text content is centralized in the `src/text/` directory for easy updates.

### File Locations

| File | Content |
|------|---------|
| `Home.js` | Home page text |
| `JoinUs.js` | Join Us page, membership info, benefits |
| `Activities.js` | Activities page content |
| `Committee.js` | Committee page intro text |
| `ContactUs.js` | Contact page content |
| `Footer.js` | Footer text and copyright |
| `externalLinks.js` | External URLs (forms, social media) |

### Example: Update Membership Fees

Edit `src/text/JoinUs.js`:

```javascript
export const MEMBERSHIP_STANDARD_INDIVIDUAL = 'Individual membership: $25';
export const MEMBERSHIP_STANDARD_HOUSEHOLD = 'Household membership: $30';
```

## Updating Officers

### 1. Add Officer Photos

Place photos in `src/images/committee/`:
- Recommended size: 400x400px or similar square ratio
- Formats: .jpg, .jpeg, .png
- Naming: lowercase, no spaces (e.g., `john_doe.jpg`)

### 2. Update Committee.jsx

Edit `src/pages/officers/Committee.jsx`:

```javascript
// Add import for new photo
const OfficerNewPerson = require('../../images/committee/new_person.jpg');

// Add to officers array
const officers = [
  {
    id: 1,
    image: OfficerNewPerson,
    name: 'New Person',
    job: 'President',
  },
  // ... other officers
];
```

### 3. Update Structured Data

Also update the `structuredData` object in the same file for SEO.

## Updating External Links

Edit `src/text/externalLinks.js`:

```javascript
export const GOOGLE_FORM_LINK = 'https://docs.google.com/forms/...';
export const RENEWAL_FORM_2026_LINK = 'https://docs.google.com/forms/...';
export const WAIVER_FORM_LINK = 'https://docs.google.com/forms/.../viewform?embedded=true';
```

**Note**: For embedded forms (like the waiver), add `?embedded=true` to the URL.

## Updating Images

### Image Locations

| Directory | Purpose |
|-----------|---------|
| `src/images/home/` | Home page images |
| `src/images/about/` | About page images |
| `src/images/activities/` | Activities page images |
| `src/images/committee/` | Officer photos |
| `src/images/contact/` | Contact page images |
| `src/images/joinus/` | Join Us page images |

### Adding New Images

1. Add image file to appropriate directory
2. Import in the component:
   ```javascript
   import NewImage from '../../images/section/new_image.jpg';
   ```
3. Use in JSX:
   ```jsx
   <img src={NewImage} alt="Description" />
   ```

## Updating the Waiver Form

The waiver uses an embedded Google Form. To change:

1. Create/update your Google Form
2. Get the embed URL (Send > Embed icon > copy `src` URL)
3. Update in `src/text/externalLinks.js`:
   ```javascript
   export const WAIVER_FORM_LINK = 'https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform?embedded=true';
   ```

## Adding New Pages

1. Create page component in `src/pages/newpage/NewPage.jsx`
2. Add route in `src/App.jsx`:
   ```jsx
   <Route path="newpage" element={<NewPage />} />
   ```
3. Add navigation link in `src/data.jsx`
4. Create text file `src/text/NewPage.js` for content

## SEO Updates

Each page has SEO configuration via the `<SEO>` component:

```jsx
<SEO
  title="Page Title"
  description="Page description for search engines"
  keywords="keyword1, keyword2, keyword3"
  url="https://run-mprc.github.io/page"
  canonicalUrl="https://run-mprc.github.io/page"
  structuredData={structuredData}
/>
```

Update structured data for rich search results (Google knowledge panels, etc.).

## Testing Changes

1. Run `npm start` to test locally
2. Check all affected pages
3. Test on mobile viewport (responsive design)
4. Run `npm run build` to verify production build works
