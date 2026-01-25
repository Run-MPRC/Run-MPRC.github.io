# Architecture Overview

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, React Router 6 |
| Styling | Tailwind CSS + Custom CSS |
| Backend | Firebase (BaaS) |
| Database | Cloud Firestore |
| Auth | Firebase Authentication |
| Functions | Firebase Cloud Functions (Node.js 20) |
| Hosting | GitHub Pages / Netlify |
| Analytics | Firebase Analytics |

## Application Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         React Application                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Pages     │  │ Components  │  │      Services           │  │
│  │             │  │             │  │                         │  │
│  │ - Home      │  │ - Navbar    │  │ - ServiceLocator        │  │
│  │ - About     │  │ - Footer    │  │ - IdentityService       │  │
│  │ - JoinUs    │  │ - Header    │  │ - FirebaseResources     │  │
│  │ - Events    │  │ - SEO       │  │ - useAuth hook          │  │
│  │ - Committee │  │ - Card      │  │                         │  │
│  │ - Contact   │  │ - Officer   │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    ServiceLocatorProvider                        │
│                  (Dependency Injection Context)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Firebase                                 │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  Firestore      │  Auth           │  Cloud Functions            │
│                 │                 │                             │
│  - events       │  - Email/Pass   │  - createMemberOnSignUp     │
│  - members      │  - Custom Claims│  - updateMemberRole         │
│  - members_only │                 │                             │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

## Service Layer

### ServiceLocatorProvider

Central dependency injection container that initializes and provides services:

```typescript
// Usage in components
const { services, isReady } = useServiceLocator();
const { identityService, firebaseResources } = services;
```

### FirebaseResources (Singleton)

Manages Firebase SDK initialization:
- `auth` - Firebase Auth instance
- `firestore` - Firestore database instance
- `analytics` - Firebase Analytics (optional)

### IdentityService

Handles authentication and authorization:
- `signIn(email, password)` - Sign in user
- `signOut()` - Sign out user
- `register(email, password)` - Register new user
- `checkMembership()` - Check if user is member/admin
- `checkAdmin()` - Check if user is admin
- `onAuthStateChanged(callback)` - Listen to auth changes

### useAuth Hook

Simplified auth state for components:

```typescript
const { user, isLoading, isMember, isAdmin, signIn, signOut } = useAuth();
```

## Data Flow

### Authentication Flow

```
User → LoginForm → IdentityService → Firebase Auth
                                          │
                                          ▼
                              Cloud Function (onCreate)
                                          │
                                          ▼
                              Create member doc + set claims
```

### Member Verification Flow

```
User Signs In → Get ID Token → Check Custom Claims → isMember/isAdmin
```

### Events Data Flow

```
Events Page → Firestore Query → Filter by member_only → Display Events
                  │
                  └─ If member: show all events
                  └─ If not: show public events only
```

## Firestore Data Model

### Collections

**members**
```javascript
{
  uid: string,           // Firebase Auth UID
  email: string,
  fullName: string | null,
  phoneNumber: string,
  role: 'unverified' | 'member' | 'admin',
  createdAt: Timestamp,
  lastLogin: Timestamp,
  emailVerified: boolean,
  provider: string
}
```

**events**
```javascript
{
  id: number,
  title: string,
  member_only: boolean,
  // ... other event fields
}
```

**members_only**
```javascript
{
  // Key-value pairs of members-only content
  dataKey: string  // HTML content
}
```

## Security

### Firestore Rules

- Public: Read-only access to public events
- Members: Read access to members_only collection
- Admin: Full read/write access to all collections

### Custom Claims

User roles are stored as Firebase Auth custom claims:
- `role: 'unverified'` - New user, awaiting verification
- `role: 'member'` - Verified club member
- `role: 'admin'` - Administrator

### API Security

Cloud Functions use Firebase config for API keys:
```bash
firebase functions:config:set api.key="secret"
```

## Component Patterns

### Page Structure

```jsx
function PageName() {
  return (
    <>
      <SEO {...seoProps} />
      <Header title="Page Title" image={HeaderImage} />
      <section className="page-name">
        {/* Page content */}
      </section>
    </>
  );
}
```

### Service Usage

```jsx
function Component() {
  const { services, isReady } = useServiceLocator();

  useEffect(() => {
    if (!isReady) return;
    // Use services
  }, [isReady, services]);
}
```

## SEO Architecture

### Per-Page SEO

Each page uses the `<SEO>` component with:
- Title and description
- Keywords
- Canonical URL
- Structured data (JSON-LD)

### Structured Data Utilities

Centralized in `src/services/seo/`:
- `createOrganizationSchema()`
- `createPageSchema()`
- `createJoinUsPageSchema()`
- `ORGANIZATION_INFO` - Base organization data

## Build & Deploy

### Build Process

```
src/ → Webpack/Babel → build/ → GitHub Pages
```

### Environment Detection

```javascript
if (process.env.NODE_ENV === 'development') {
  // Connect to Firebase emulators
}
```
