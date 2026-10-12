'use strict';

// Synthetic staging receipts only. No UID association, claim or provider call.
const functions = require('firebase-functions');
const { createHash } = require('node:crypto');
const { parseStrictObject } = require('./requestValidation');
const { createMembershipAuthority, applyMembershipAuthorityCommand, deriveMembershipEntitlement } = require('./membershipAuthority');
const { projectManualDuesEvidence } = require('./membershipManualEvidence');
const POLICY = 'fictional-external-dues-v1';
const fail = () => { throw new functions.https.HttpsError('failed-precondition', 'Fictional dues recording unavailable. Refresh the staging status.'); };
const check = (value) => { if (!value) fail(); };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const duesId = (confirmationId) => `stage_dues_${hash(confirmationId)}`;

function readDuesPolicy(value) {
  try {
    parseStrictObject(value, { requiredKeys: ['schemaVersion', 'syntheticOnly', 'policyVersion', 'revision', 'amountCents', 'currency', 'method', 'termId', 'startsAtMs', 'endsAtMs'], optionalKeys: [] });
    check(value.schemaVersion === 1 && value.syntheticOnly === true && value.policyVersion === POLICY
      && integer(value.revision, 1000000) && value.revision > 0
      && integer(value.amountCents, 10000) && value.amountCents > 0
      && value.currency === 'USD' && value.method === 'fictional_external'
      && typeof value.termId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.termId)
      && integer(value.startsAtMs, 8640000000000000) && integer(value.endsAtMs, 8640000000000000)
      && value.startsAtMs < value.endsAtMs && value.endsAtMs - value.startsAtMs <= 86400000);
    return value;
  } catch { fail(); }
}

function createDuesReceipt(actorUid, capability, token, request, input, now) {
  const policy = readDuesPolicy(input);
  check(policy.revision === request.policyRevision && policy.startsAtMs <= now && policy.endsAtMs > now);
  const membershipId = duesId(request.confirmationId);
  const evidenceRef = `evidence_${hash(request.confirmationId)}`;
  const authority = createMembershipAuthority({ membershipAuthoritySchemaVersion: 1, membershipId, commandId: `create_${request.requestId}` });
  const projection = projectManualDuesEvidence({
    membershipManualEvidenceSchemaVersion: 1, commandId: request.requestId,
    actorRef: `actor_${hash(actorUid)}`, capabilityRef: `cap_${hash(`${actorUid}:${capability.revision}`)}`,
    recentAuthRef: `auth_${hash(`${actorUid}:${token.auth_time}`)}`,
    membershipId, evidenceCategoryRef: 'fictional_external', evidenceRef,
    reasonRef: 'synthetic_staging_review', correlationRef: request.requestId,
    expectedRevision: 1, termRevision: 1, termId: policy.termId,
    startsAtMs: policy.startsAtMs, endsAtMs: policy.endsAtMs,
    planRef: 'fictional_dues_only', policyVersion: POLICY,
  });
  return {
    schemaVersion: 1, syntheticOnly: true, membershipId,
    confirmationHash: hash(request.confirmationId), policy,
    authority: applyMembershipAuthorityCommand(authority, projection.reducerCommand),
    audit: projection.auditRecord, createdAtMs: now,
  };
}

function duesView(value, id) {
  try {
    parseStrictObject(value, { requiredKeys: ['schemaVersion', 'syntheticOnly', 'membershipId', 'confirmationHash', 'policy', 'authority', 'audit', 'createdAtMs'], optionalKeys: [] });
    const policy = readDuesPolicy(value.policy);
    check(value.schemaVersion === 1 && value.syntheticOnly === true && value.membershipId === id
      && /^[a-f0-9]{64}$/.test(value.confirmationHash) && id === `stage_dues_${value.confirmationHash}`
      && integer(value.createdAtMs, 8640000000000000)
      && value.authority.membershipId === id && value.authority.association.state === 'unlinked'
      && value.authority.association.uid === null && value.authority.term.state === 'approved'
      && value.authority.term.termId === policy.termId && value.authority.term.startsAtMs === policy.startsAtMs
      && value.authority.term.endsAtMs === policy.endsAtMs && value.authority.term.policyVersion === POLICY
      && value.audit.provenance === 'manual_off_platform' && value.audit.membershipId === id
      && value.audit.evidenceRef === value.authority.term.evidenceRef);
    check(deriveMembershipEntitlement({ membershipAuthoritySchemaVersion: 1, record: value.authority, uid: 'staging_unlinked', asOfMs: value.createdAtMs }).entitlement === 'not_entitled');
    return { membershipId: id, amountCents: policy.amountCents, currency: policy.currency, method: policy.method,
      termId: policy.termId, startsAtMs: policy.startsAtMs, endsAtMs: policy.endsAtMs, linked: false };
  } catch { fail(); }
}
module.exports = { readDuesPolicy, createDuesReceipt, duesView, duesId };
