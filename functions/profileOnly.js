// Staging-only deployment entry point. Never load the prototype endpoint index.
const admin = require('firebase-admin');

admin.initializeApp();

exports.createMemberOnSignUp = require('./signup').onSignUp;
exports.ensureMemberProfile = require('./ensureMemberProfile').ensureMemberProfile;
