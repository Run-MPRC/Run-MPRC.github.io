# Developer Guide

## Prerequisites

- Node.js v20+
- npm v9+
- Git
- Firebase CLI (`npm install -g firebase-tools`)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Run-MPRC/Run-MPRC.github.io.git
cd Run-MPRC.github.io
```

### 2. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install Cloud Functions dependencies
cd functions && npm install && cd ..
```

### 3. Start Development Server

```bash
npm start
```

The site will be available at http://localhost:3000

### 4. Start Firebase Emulators (Optional)

For testing Firebase Auth and Firestore locally:

```bash
firebase emulators:start
```

Emulator ports:
- Auth: http://localhost:9099
- Firestore: http://localhost:8080
- Functions: http://localhost:5001

## Project Structure

```
Run-MPRC.github.io/
├── src/
│   ├── components/     # Reusable UI components
│   ├── pages/          # Page-level components
│   ├── services/       # Firebase, auth, and utility services
│   ├── text/           # Text content (easy to update)
│   ├── images/         # Image assets organized by section
│   └── index.css       # Global styles
├── functions/          # Firebase Cloud Functions
├── public/             # Static files (index.html, sitemap, etc.)
└── docs/               # Documentation
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start development server |
| `npm run build` | Create production build |
| `npm run lint:fix` | Fix linting issues |
| `npm test` | Run tests |
| `npm run deploy` | Deploy to GitHub Pages |

## Git Workflow

### Branches

- `main` - Production branch (deploys to runmprc.com)
- `dev` - Development branch (deploys to dev.runmprc.com)

### Making Changes

1. Create feature branch from `dev`
2. Make changes and test locally
3. Commit with descriptive message
4. Push and create PR to `dev`
5. After testing on dev site, merge `dev` to `main`

## Deployment

### Automatic Deployment

- Pushing to `main` triggers deployment to production
- Pushing to `dev` triggers deployment to dev site

### Manual Deployment

```bash
# Deploy to GitHub Pages
npm run deploy

# Deploy Firebase Functions
cd functions && npm run deploy
```

## Firebase Configuration

### Setting API Keys (Cloud Functions)

```bash
firebase functions:config:set api.key="your-secret-key"
```

### Firestore Security Rules

Rules are defined in `firestore.rules` and deployed with:

```bash
firebase deploy --only firestore:rules
```

## Troubleshooting

### Port 3000 in use

```bash
lsof -i :3000
kill -9 <PID>
```

### Firebase emulator issues

```bash
firebase emulators:start --clear-data
```

### Build failures

```bash
rm -rf node_modules package-lock.json
npm install
```
