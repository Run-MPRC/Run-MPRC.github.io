const admin = require('firebase-admin');
const onSignUp = require('./signup');
const updateMemberRole = require('./updatemembers');

admin.initializeApp();

exports.updateMemberRole = updateMemberRole;
exports.createMemberOnSignUp = onSignUp;
