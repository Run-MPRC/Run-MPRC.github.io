const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
admin.initializeApp();

// Import and export cloud functions
const { onSignUp } = require('./signup');
const { updateMemberRole } = require('./updatemembers');

// Auth triggers
exports.createMemberOnSignUp = onSignUp;

// HTTP endpoints
exports.updateMemberRole = updateMemberRole;
