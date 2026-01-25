# LLM Context Guide

This document provides comprehensive context for AI assistants working with the MPRC website codebase.

## Project Overview

**Project**: Mid-Peninsula Running Club (MPRC) Website
**Type**: React Single Page Application with Firebase Backend
**Purpose**: Club website with member authentication, events, and content management
**Live URL**: https://runmprc.com
**Dev URL**: https://dev.runmprc.com
**Repository**: https://github.com/Run-MPRC/Run-MPRC.github.io

## Tech Stack Summary

- **Frontend**: React 18.2.0, React Router 6.21.3, TypeScript (partial)
- **Styling**: Tailwind CSS + Custom CSS (index.css)
- **Backend**: Firebase 10.7.1 (Auth, Firestore, Analytics, Cloud Functions)
- **Build**: Create React App (react-scripts 5.0.1)
- **Linting**: ESLint with Airbnb config
- **Deployment**: GitHub Pages, Netlify (alternative)

## Directory Structure

```
src/
├── components/          # Reusable UI components (18 files)
│   ├── index.ts        # Barrel export for all components
│   ├── Navbar.jsx      # Navigation bar
│   ├── Footer.jsx      # Site footer
│   ├── Header.jsx      # Page headers with background image
│   ├── SEO.jsx         # Meta tags and structured data
│   ├── Card.jsx        # Content card wrapper
│   ├── Officer.jsx     # Officer profile card
│   └── ...
│
├── pages/              # Route-level page components
│   ├── home/Home.jsx
│   ├── about/About.jsx
│   ├── activities/Activities.jsx
│   ├── events/Events.tsx          # TypeScript, uses Firestore
│   ├── joinUs/
│   │   ├── JoinUs.jsx             # Main join page
│   │   ├── JoinUsConditionalRoute.jsx  # Waiver gate
│   │   ├── Waiver.jsx             # Embedded Google Form waiver
│   │   └── Route.jsx              # Leaflet map component
│   ├── officers/Committee.jsx     # Officer listing
│   ├── contact/Contact.jsx
│   ├── login/LoginForm.jsx
│   ├── admin/Admin.jsx            # Placeholder admin panel
│   └── notFound/NotFound.jsx
│
├── services/           # Business logic and integrations
│   ├── index.ts                   # Barrel export
│   ├── ServiceLocatorContext.ts   # DI context with hooks
│   ├── ServiceLocatorProvider.tsx # DI provider
│   ├── firebase/
│   │   └── FirebaseResources.ts   # Firebase SDK singleton
│   ├── identity/
│   │   └── Identity.ts            # Auth service
│   ├── hooks/
│   │   ├── index.ts
│   │   └── useAuth.ts             # Auth state hook
│   └── seo/
│       ├── index.ts
│       └── structuredData.ts      # SEO schema builders
│
├── text/               # Centralized text content
│   ├── index.ts                   # Barrel export
│   ├── Home.js
│   ├── JoinUs.js                  # Membership info, benefits
│   ├── Activities.js
│   ├── Committee.js
│   ├── ContactUs.js
│   ├── Footer.js
│   └── externalLinks.js           # URLs for forms, social media
│
├── images/             # Image assets by section
│   ├── home/
│   ├── about/
│   ├── activities/
│   ├── committee/      # Officer photos
│   ├── contact/
│   ├── joinus/
│   └── navbar/
│
├── App.jsx             # Root component with routing
├── index.js            # Entry point
└── index.css           # Global styles and CSS variables

functions/              # Firebase Cloud Functions
├── index.js            # Function exports
├── signup.js           # Create member on auth signup
├── updatemembers.js    # Batch update member roles
└── package.json
```

## Key Patterns

### Service Locator Pattern

Services are initialized once and provided via React Context:

```typescript
// Access services in components
const { services, isReady } = useServiceLocator();
if (!isReady) return <Loading />;
const { identityService, firebaseResources } = services;
```

### Available Hooks

```typescript
import { useServiceLocator } from '../services/ServiceLocatorContext';
import { useAuth } from '../services/hooks/useAuth';

// useServiceLocator - raw service access
const { services, isReady } = useServiceLocator();

// useAuth - simplified auth state
const { user, isLoading, isMember, isAdmin, signIn, signOut, register } = useAuth();
```

### Text Content Pattern

All user-facing text is in `src/text/` for easy updates:

```javascript
// src/text/JoinUs.js
export const MEMBERSHIP_STANDARD_INDIVIDUAL = 'Individual membership: $25';

// Usage in component
import { MEMBERSHIP_STANDARD_INDIVIDUAL } from '../../text/JoinUs';
```

### SEO Pattern

Every page includes SEO component with structured data:

```jsx
<SEO
  title="Page Title"
  description="Description"
  keywords="keywords, here"
  url="https://run-mprc.github.io/page"
  structuredData={structuredData}
/>
```

## Authentication & Authorization

### User Roles (Custom Claims)

- `unverified` - New user, not yet verified
- `member` - Verified club member
- `admin` - Full administrative access

### Role Check Methods

```typescript
// IdentityService methods
await identityService.checkMembership(); // true if member or admin
await identityService.checkAdmin();      // true if admin only
```

### Protected Content

Members-only content is:
1. Stored in Firestore `members_only` collection
2. Filtered by `member_only` flag on events
3. Gated by `MembersOnly` component

## Firestore Collections

| Collection | Purpose | Access |
|------------|---------|--------|
| `members` | User profiles | Admin only |
| `events` | Club events | Public (filtered) |
| `members_only` | Private content | Members only |

## Cloud Functions

### createMemberOnSignUp

Triggered on Firebase Auth user creation:
- Creates member document in Firestore
- Sets `role: 'unverified'` custom claim

### updateMemberRole

HTTP endpoint to batch update member roles:
- Requires API key (from Firebase config)
- Updates custom claims and Firestore docs

## Common Tasks

### Adding a New Page

1. Create `src/pages/newpage/NewPage.jsx`
2. Add route in `src/App.jsx`
3. Add text in `src/text/NewPage.js`
4. Add to navigation in `src/data.jsx`

### Updating Officers

1. Add photo to `src/images/committee/`
2. Update `src/pages/officers/Committee.jsx`:
   - Add require() for image
   - Update officers array
   - Update structuredData

### Updating Membership Fees

Edit `src/text/JoinUs.js`:
- `MEMBERSHIP_EARLY_BIRD_*` constants
- `MEMBERSHIP_STANDARD_*` constants
- `LI_AFFORDABLE_MEMBERSHIP_FEES`

### Changing External Links

Edit `src/text/externalLinks.js`:
- Form links, social media URLs, etc.

## File Naming Conventions

- **Components**: PascalCase (`Navbar.jsx`, `SEO.jsx`)
- **Pages**: PascalCase in directories (`Home.jsx`)
- **Services**: PascalCase (`Identity.ts`)
- **Text files**: PascalCase (`JoinUs.js`)
- **CSS**: lowercase (`navbar.css`, `joinUs.css`)
- **Images**: lowercase with underscores (`header_bg_1.jpg`)

## Import Conventions

```javascript
// Use barrel exports where available
import { useAuth } from '../services';
import { SEO, Header, Card } from '../components';
import { GOOGLE_FORM_LINK, ARM_URI } from '../text';

// Direct imports when needed
import FirebaseResources from '../services/firebase/FirebaseResources';
```

## Testing Locally

```bash
npm start                    # Start dev server (port 3000)
firebase emulators:start     # Start Firebase emulators
npm run build               # Test production build
npm run lint:fix            # Fix linting issues
```

## Deployment

- Push to `dev` branch → deploys to dev.runmprc.com
- Push to `main` branch → deploys to runmprc.com
- Manual: `npm run deploy` for GitHub Pages

## Known Considerations

1. **Mixed JS/TS**: Codebase uses both JavaScript and TypeScript
2. **Firebase Config**: API keys are in code (Firebase keys are safe to expose)
3. **CSS Approach**: Mix of Tailwind utilities and custom CSS
4. **Image Optimization**: Images are not automatically optimized
5. **Waiver Flow**: Uses localStorage to track waiver acknowledgment

## Quick Reference

| Task | File(s) to Edit |
|------|-----------------|
| Update text content | `src/text/*.js` |
| Update officers | `src/pages/officers/Committee.jsx` |
| Update external links | `src/text/externalLinks.js` |
| Add new route | `src/App.jsx` |
| Modify auth logic | `src/services/identity/Identity.ts` |
| Update waiver form | `src/text/externalLinks.js` (WAIVER_FORM_LINK) |
| Modify Firebase functions | `functions/*.js` |
| Update global styles | `src/index.css` |
