const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { isVerifiedAdmin } = require('./verifiedRolePolicy');

const COLUMNS = [
  'registrationId',
  'status',
  'signupType',
  'priceTier',
  'amountCents',
  'currency',
  'promoCode',
  'firstName',
  'lastName',
  'email',
  'phone',
  'dob',
  'shirtSize',
  'emergencyContactName',
  'emergencyContactPhone',
  'waiverAcceptedAt',
  'waiverVersion',
  'stripeSessionId',
  'stripePaymentIntentId',
  'stripeChargeId',
  'createdAt',
  'paidAt',
  'refundedAt',
  'cancelledAt',
];

// Characters that trigger formula execution in Excel/Google Sheets if they
// appear at the start of a cell. Prefix with a single quote to neutralize.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (FORMULA_PREFIX.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CORS_ALLOWLIST = new Set([
  'https://runmprc.com',
  'https://www.runmprc.com',
  'https://dev.runmprc.com',
  'https://run-mprc.github.io',
  'http://localhost:3000',
]);

function tsToIso(ts) {
  if (!ts) return '';
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  return String(ts);
}

async function verifyAdmin(request) {
  const authHeader = request.get('Authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return null;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return isVerifiedAdmin(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function setCors(response, origin) {
  if (origin && CORS_ALLOWLIST.has(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
  }
  response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.set('Access-Control-Max-Age', '3600');
  response.set('Vary', 'Origin');
}

exports.exportRegistrationsCsv = functions.https.onRequest(async (request, response) => {
  const origin = request.get('origin');
  setCors(response, origin);

  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }
  if (request.method !== 'GET') {
    response.status(405).send('Method not allowed');
    return;
  }
  const admin_ = await verifyAdmin(request);
  if (!admin_) {
    response.status(403).send('Admin auth required');
    return;
  }

  const eventId = request.query.eventId;
  if (!eventId || typeof eventId !== 'string') {
    response.status(400).send('eventId required');
    return;
  }

  const snap = await admin.firestore()
    .collection('events').doc(eventId)
    .collection('registrations')
    .orderBy('createdAt', 'desc')
    .get();

  const rows = [COLUMNS.join(',')];
  snap.forEach((doc) => {
    const r = doc.data();
    const runner = r.runner || {};
    const row = [
      doc.id,
      r.status,
      r.signupType || 'participant',
      r.priceTier,
      r.amountCents,
      r.currency,
      r.promoCode,
      runner.firstName,
      runner.lastName,
      runner.email,
      runner.phone,
      runner.dob,
      runner.shirtSize,
      runner.emergencyContactName,
      runner.emergencyContactPhone,
      tsToIso(r.waiverAcceptedAt),
      r.waiverVersion,
      r.stripeSessionId,
      r.stripePaymentIntentId,
      r.stripeChargeId,
      tsToIso(r.createdAt),
      tsToIso(r.paidAt),
      tsToIso(r.refundedAt),
      tsToIso(r.cancelledAt),
    ].map(csvEscape);
    rows.push(row.join(','));
  });

  const filename = `registrations-${eventId}-${new Date().toISOString().slice(0, 10)}.csv`;
  response.set('Content-Type', 'text/csv; charset=utf-8');
  response.set('Content-Disposition', `attachment; filename="${filename}"`);
  response.send(rows.join('\n'));
});
