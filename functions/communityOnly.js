// Isolated staging entrypoint: never load the prototype commerce index.
const admin = require('firebase-admin');
const { assertCommunityEnvironment, communityActions } = require('./communityActions');
assertCommunityEnvironment();
admin.initializeApp();
exports.communityActions = communityActions;
