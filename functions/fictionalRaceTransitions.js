'use strict';

// Pure fictional transition helpers for the isolated staging service.
// This models fictional credits, never payment/refund/provider evidence.
// The trusted service supplies native identity/time, disposable markers,
// capabilities and atomic record + immutable command-receipt persistence.
const { parseStrictObject } = require('./requestValidation');
const { createHash } = require('node:crypto');
const POLICY = 'fictional-race-v1-not-money';
const WAIVER = 'fictional-race-waiver-v1';
const ID = /^stage_race_[A-Za-z0-9_-]{1,64}$/;
const MESSAGE = 'Fictional race transition unavailable.';
const check = value => { if (!value) throw new Error(MESSAGE); };
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const time = value => integer(value, 8640000000000000);
const id = value => typeof value === 'string' && ID.test(value);
const strict = (value, keys) => parseStrictObject(value, { requiredKeys: keys, optionalKeys: [] });

function waiver(value, uid, now) {
  const parsed = strict(value, ['uid', 'version', 'acceptedAtMs']);
  check(parsed.uid === uid && parsed.version === WAIVER && time(parsed.acceptedAtMs) && parsed.acceptedAtMs <= now);
  return parsed;
}

function readFictionalEvent(input) {
  const event = strict(input, ['schemaVersion', 'simulationOnly', 'policyVersion', 'eventId',
    'revision', 'startAtMs', 'status', 'capacity', 'confirmedCount']);
  check(event.schemaVersion === 1 && event.simulationOnly === true && event.policyVersion === POLICY
    && id(event.eventId) && integer(event.revision, 999999) && event.revision > 0
    && time(event.startAtMs) && ['open', 'cancelled'].includes(event.status)
    && integer(event.capacity, 10000) && event.capacity > 0 && integer(event.confirmedCount, event.capacity));
  return event;
}

function readFictionalPolicy(input, event) {
  const policy = strict(input, ['schemaVersion', 'simulationOnly', 'policyVersion', 'eventId',
    'revision', 'fictionalAmountCents', 'currency', 'waiverVersion', 'opensAtMs', 'closesAtMs']);
  check(policy.schemaVersion === 1 && policy.simulationOnly === true && policy.policyVersion === POLICY
    && policy.eventId === event.eventId && integer(policy.revision, 999999) && policy.revision > 0
    && integer(policy.fictionalAmountCents, 10000) && policy.fictionalAmountCents > 0
    && policy.currency === 'USD' && policy.waiverVersion === WAIVER
    && time(policy.opensAtMs) && time(policy.closesAtMs) && policy.opensAtMs < policy.closesAtMs
    && policy.closesAtMs - policy.opensAtMs <= 86400000 && policy.closesAtMs <= event.startAtMs);
  return policy;
}

function records(eventInput, entryInput, now) {
  check(time(now));
  const event = readFictionalEvent(eventInput);
  const entry = strict(entryInput, ['schemaVersion', 'simulationOnly', 'policyVersion', 'eventId',
    'entryId', 'revision', 'bibId', 'runnerUid', 'creditOwnerUid', 'fictionalAmountCents',
    'fictionalReturnedCents', 'currency', 'status', 'transferCount', 'originalWaiver', 'recipientWaiver', 'offer']);
  for (const record of [event, entry]) {
    check(record.schemaVersion === 1 && record.simulationOnly === true && record.policyVersion === POLICY
      && id(record.eventId) && integer(record.revision, 999999) && record.revision > 0);
  }
  check(entry.eventId === event.eventId && time(event.startAtMs)
    && ['open', 'cancelled'].includes(event.status)
    && integer(event.capacity, 10000) && event.capacity > 0
    && integer(event.confirmedCount, event.capacity));
  check(id(entry.entryId) && id(entry.bibId) && id(entry.runnerUid) && id(entry.creditOwnerUid)
    && integer(entry.fictionalAmountCents, 10000) && entry.fictionalAmountCents > 0
    && entry.currency === 'USD' && integer(entry.transferCount, 1)
    && ['confirmed', 'cancelled'].includes(entry.status)
    && entry.fictionalReturnedCents === (entry.status === 'cancelled' ? entry.fictionalAmountCents : 0));
  waiver(entry.originalWaiver, entry.creditOwnerUid, now);
  if (entry.transferCount === 0) check(entry.runnerUid === entry.creditOwnerUid && entry.recipientWaiver === null);
  else {
    check(entry.runnerUid !== entry.creditOwnerUid && entry.offer === null);
    const accepted = waiver(entry.recipientWaiver, entry.runnerUid, now);
    check(accepted.acceptedAtMs >= entry.originalWaiver.acceptedAtMs);
  }
  if (entry.offer !== null) {
    const pending = strict(entry.offer, ['recipientUid', 'expiresAtMs']);
    check(entry.status === 'confirmed' && entry.transferCount === 0 && id(pending.recipientUid)
      && pending.recipientUid !== entry.runnerUid && time(pending.expiresAtMs)
      && pending.expiresAtMs <= event.startAtMs);
  }
  return { event, entry };
}

function request(input) {
  // First safely clone the discriminant; never read getters/proxies directly.
  const parsed = parseStrictObject(input, { requiredKeys: ['action', 'eventId', 'entryId',
    'expectedEventRevision', 'expectedEntryRevision'], optionalKeys: ['recipientUid', 'expiresAtMs', 'waiverVersion'] });
  const additions = parsed.action === 'offer_transfer' ? ['recipientUid', 'expiresAtMs']
    : parsed.action === 'accept_transfer' ? ['waiverVersion'] : [];
  strict(parsed, ['action', 'eventId', 'entryId', 'expectedEventRevision', 'expectedEntryRevision', ...additions]);
  check(['simulate_refund', 'offer_transfer', 'accept_transfer', 'revoke_transfer'].includes(parsed.action)
    && id(parsed.eventId) && id(parsed.entryId)
    && integer(parsed.expectedEventRevision, 999999) && parsed.expectedEventRevision > 0
    && integer(parsed.expectedEntryRevision, 999999) && parsed.expectedEntryRevision > 0);
  return parsed;
}

function reduceFictionalRace(eventInput, entryInput, commandInput, callerUid, now) {
  try {
    const { event, entry } = records(eventInput, entryInput, now);
    const command = request(commandInput);
    check(id(callerUid) && command.eventId === event.eventId && command.entryId === entry.entryId
      && command.expectedEventRevision === event.revision && command.expectedEntryRevision === entry.revision
      && entry.status === 'confirmed' && event.confirmedCount > 0 && now < event.startAtMs);
    const nextEntry = { ...entry, revision: entry.revision + 1 };
    let nextEvent = event;
    if (command.action === 'accept_transfer') {
      check(event.status === 'open' && entry.offer !== null && callerUid === entry.offer.recipientUid
        && now < entry.offer.expiresAtMs && command.waiverVersion === WAIVER);
      nextEntry.runnerUid = callerUid;
      nextEntry.transferCount = 1;
      nextEntry.recipientWaiver = Object.freeze({ uid: callerUid, version: WAIVER, acceptedAtMs: now });
      nextEntry.offer = null;
    } else {
      check(callerUid === entry.runnerUid);
      if (command.action === 'simulate_refund') {
        check(entry.offer === null);
        nextEntry.status = 'cancelled';
        nextEntry.fictionalReturnedCents = entry.fictionalAmountCents;
        nextEvent = { ...event, revision: event.revision + 1, confirmedCount: event.confirmedCount - 1 };
      } else if (command.action === 'offer_transfer') {
        check(event.status === 'open' && entry.transferCount === 0 && entry.offer === null
          && id(command.recipientUid) && command.recipientUid !== callerUid
          && time(command.expiresAtMs) && now < command.expiresAtMs
          && command.expiresAtMs <= event.startAtMs && command.expiresAtMs - now <= 300000);
        nextEntry.offer = Object.freeze({ recipientUid: command.recipientUid, expiresAtMs: command.expiresAtMs });
      } else {
        check(entry.offer !== null);
        nextEntry.offer = null;
      }
    }
    // Keep next records representable by this same schema, including revision
    // ceilings. No transition may produce a record that a subsequent read rejects.
    records(nextEvent, nextEntry, now);
    return Object.freeze({ simulationOnly: true, event: Object.freeze(nextEvent), entry: Object.freeze(nextEntry) });
  } catch { throw new Error(MESSAGE); }
}

function readFictionalRaceRecords(event, entry, now) {
  try { return records(event, entry, now); } catch { throw new Error(MESSAGE); }
}

function raceEnrollmentId(eventId, uid) {
  check(id(eventId) && id(uid));
  return `stage_race_${createHash('sha256').update(JSON.stringify([eventId, uid])).digest('hex')}`;
}

function createFictionalEntry(eventInput, policyInput, uid, waiverVersion, now) {
  try {
    const configuredEvent = readFictionalEvent(eventInput);
    const policy = readFictionalPolicy(policyInput, configuredEvent);
    check(id(uid) && waiverVersion === WAIVER && time(now) && policy.opensAtMs <= now && now < policy.closesAtMs);
    const entryId = raceEnrollmentId(policy.eventId, uid);
    const entry = { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventId: policy.eventId,
      entryId, revision: 1, bibId: `stage_race_${createHash('sha256').update(`bib:${entryId}`).digest('hex')}`,
      runnerUid: uid, creditOwnerUid: uid, fictionalAmountCents: policy.fictionalAmountCents,
      fictionalReturnedCents: 0, currency: policy.currency, status: 'confirmed', transferCount: 0,
      originalWaiver: { uid, version: WAIVER, acceptedAtMs: now }, recipientWaiver: null, offer: null };
    const { event } = records(eventInput, entry, now);
    check(event.status === 'open' && event.confirmedCount < event.capacity && policy.closesAtMs <= event.startAtMs);
    const nextEvent = { ...event, revision: event.revision + 1, confirmedCount: event.confirmedCount + 1 };
    return Object.freeze({ simulationOnly: true, ...readFictionalRaceRecords(nextEvent, entry, now) });
  } catch { throw new Error(MESSAGE); }
}

module.exports = { POLICY, WAIVER, reduceFictionalRace, readFictionalRaceRecords, readFictionalEvent,
  readFictionalPolicy, raceEnrollmentId, createFictionalEntry };
