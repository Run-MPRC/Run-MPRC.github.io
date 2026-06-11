const admin = require('firebase-admin');

admin.initializeApp();

const { onSignUp } = require('./signup');
const { updateMemberRole } = require('./updatemembers');
const { createCheckoutSession } = require('./createCheckoutSession');
const { stripeWebhook } = require('./stripeWebhook');
const { adminRegistrationAction } = require('./adminRegistrationAction');
const { exportRegistrationsCsv } = require('./exportRegistrationsCsv');
const { lookupRegistration } = require('./lookupRegistration');
const { listMyRegistrations } = require('./listMyRegistrations');
const { setMemberRole } = require('./setMemberRole');
const { pruneStaleRegistrations } = require('./pruneStaleRegistrations');
const { createMerchCheckout } = require('./createMerchCheckout');
const { lookupOrder } = require('./lookupOrder');
const { adminOrderAction } = require('./adminOrderAction');
const {
  stravaExchangeCode,
  stravaFetchStats,
  stravaDisconnect,
} = require('./strava');
const {
  sendConfirmationEmail,
  sendConfirmationEmailOnCreate,
} = require('./sendConfirmationEmail');

// Auth triggers
exports.createMemberOnSignUp = onSignUp;

// HTTP endpoints
exports.updateMemberRole = updateMemberRole;

// Registration / Stripe
exports.createCheckoutSession = createCheckoutSession;
exports.stripeWebhook = stripeWebhook;
exports.adminRegistrationAction = adminRegistrationAction;
exports.exportRegistrationsCsv = exportRegistrationsCsv;
exports.lookupRegistration = lookupRegistration;
exports.listMyRegistrations = listMyRegistrations;
exports.setMemberRole = setMemberRole;

// Scheduled
exports.pruneStaleRegistrations = pruneStaleRegistrations;

// Shop / merchandise
exports.createMerchCheckout = createMerchCheckout;
exports.lookupOrder = lookupOrder;
exports.adminOrderAction = adminOrderAction;

// Strava
exports.stravaExchangeCode = stravaExchangeCode;
exports.stravaFetchStats = stravaFetchStats;
exports.stravaDisconnect = stravaDisconnect;

// Firestore triggers
exports.sendConfirmationEmail = sendConfirmationEmail;
exports.sendConfirmationEmailOnCreate = sendConfirmationEmailOnCreate;
