'use strict';

// Isolated fictional staging only. Receipt evidence is immutable; the link is
// separate. No email matching, Auth mutation/claims, renewal or provider call.
const functions = require('firebase-functions');
const { parseStrictObject } = require('./requestValidation');
const { duesView } = require('./communityDues');
const { applyMembershipAuthorityCommand, deriveMembershipEntitlement } = require('./membershipAuthority');
const fail = () => { throw new functions.https.HttpsError('failed-precondition', 'Fictional membership linking unavailable. Refresh the staging status.'); };
const check = (value) => { if (!value) fail(); };
const integer = (value, max = 8640000000000000) => Number.isSafeInteger(value) && value >= 0 && value <= max;

function readDisposableTarget(value, uid, now) {
  try {
    parseStrictObject(value, { requiredKeys: ['schemaVersion', 'syntheticOnly', 'enabled', 'uid', 'revision', 'expiresAtMs'], optionalKeys: [] });
    check(value.schemaVersion === 1 && value.syntheticOnly === true && value.enabled === true
      && value.uid === uid && integer(value.revision, 1000000) && value.revision > 0
      && integer(value.expiresAtMs) && value.expiresAtMs > now && value.expiresAtMs - now <= 86400000);
    return value;
  } catch { fail(); }
}
function linkedReceipt(link, membershipId) {
  if (link === undefined) return false;
  try {
    parseStrictObject(link, { requiredKeys: ['schemaVersion', 'syntheticOnly', 'membershipId', 'uid', 'revision', 'linkedAtMs'], optionalKeys: [] });
    check(link.schemaVersion === 1 && link.syntheticOnly === true && link.membershipId === membershipId
      && typeof link.uid === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(link.uid)
      && link.revision === 1 && integer(link.linkedAtMs));
    return true;
  } catch { fail(); }
}
function associateReceipt(receipt, request, now) {
  const view = duesView(receipt, request.membershipId);
  check(view.startsAtMs <= now && now < view.endsAtMs);
  const authority = applyMembershipAuthorityCommand(receipt.authority, {
    membershipAuthoritySchemaVersion: 1, commandType: 'associate_account',
    commandId: request.requestId, expectedRevision: receipt.authority.revision, uid: request.targetUid,
  });
  check(deriveMembershipEntitlement({ membershipAuthoritySchemaVersion: 1, record: authority,
    uid: request.targetUid, asOfMs: now }).entitlement === 'current_member');
  return { authority, link: { schemaVersion: 1, syntheticOnly: true, membershipId: request.membershipId,
    uid: request.targetUid, revision: 1, linkedAtMs: now } };
}
module.exports = { readDisposableTarget, linkedReceipt, associateReceipt };
