#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Build-time sitemap generator.
 *
 * Pulls public, non-draft events from Firestore and emits `public/sitemap.xml`
 * before the React build copies it into the output bundle.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/generate-sitemap.js
 *
 * If `GOOGLE_APPLICATION_CREDENTIALS` is not set, the script emits only the
 * static pages (useful in CI when Firestore creds aren't available — you just
 * lose fresh event URLs until the next deploy).
 */

const fs = require('fs');
const path = require('path');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://runmprc.com';
const OUTPUT = path.join(__dirname, '..', 'public', 'sitemap.xml');

const STATIC_PAGES = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/about', priority: '0.8', changefreq: 'monthly' },
  { loc: '/activities', priority: '0.8', changefreq: 'monthly' },
  { loc: '/events', priority: '0.9', changefreq: 'daily' },
  { loc: '/committee', priority: '0.7', changefreq: 'monthly' },
  { loc: '/joinus', priority: '0.8', changefreq: 'monthly' },
  { loc: '/contact', priority: '0.7', changefreq: 'monthly' },
  { loc: '/terms', priority: '0.3', changefreq: 'yearly' },
  { loc: '/privacy', priority: '0.3', changefreq: 'yearly' },
];

function urlEntry({ loc, priority, changefreq, lastmod }) {
  const lines = [
    '  <url>',
    `    <loc>${SITE_ORIGIN}${loc}</loc>`,
  ];
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) lines.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) lines.push(`    <priority>${priority}</priority>`);
  lines.push('  </url>');
  return lines.join('\n');
}

async function loadEventEntries() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS
    && !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('No Firestore credentials; skipping dynamic event URLs');
    return [];
  }
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(sa) });
      } else {
        admin.initializeApp();
      }
    }
    const snap = await admin.firestore()
      .collection('events')
      .where('visibility', '==', 'public')
      .where('status', 'in', ['open', 'closed'])
      .get();
    return snap.docs.map((d) => {
      const data = d.data();
      const updatedAt = data.updatedAt?.toDate?.()?.toISOString()?.slice(0, 10);
      return {
        loc: `/events/${data.slug || d.id}`,
        lastmod: updatedAt,
        changefreq: 'daily',
        priority: '0.9',
      };
    });
  } catch (err) {
    console.warn('Failed to load events for sitemap:', err.message);
    return [];
  }
}

async function main() {
  const eventEntries = await loadEventEntries();
  const today = new Date().toISOString().slice(0, 10);
  const allEntries = [
    ...STATIC_PAGES.map((p) => ({ ...p, lastmod: today })),
    ...eventEntries,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allEntries.map(urlEntry).join('\n')}
</urlset>
`;

  fs.writeFileSync(OUTPUT, xml, 'utf8');
  console.log(`Wrote sitemap with ${allEntries.length} URLs → ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
