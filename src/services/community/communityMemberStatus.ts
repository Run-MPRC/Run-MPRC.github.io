import type { CommunityRequest, CommunityStatus } from './communityService';

const MESSAGE = 'Community status is unavailable. Refresh or sign in again.';
export const COMMUNITY_FRESHNESS_MS = 60_000;
const check = (value: unknown) => { if (!value) throw new Error(MESSAGE); };
const integer = (value: unknown, max = 8_640_000_000_000_000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const text = (value: unknown, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const oneOf = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value);
type Data = Record<string, unknown>;
function object(value: unknown, required: string[], optional: string[] = []): Data {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(required.every((key) => Object.prototype.hasOwnProperty.call(descriptors, key)));
  check(Reflect.ownKeys(descriptors).every((key) => typeof key === 'string'
    && [...required, ...optional].includes(key)
    && Object.prototype.hasOwnProperty.call(descriptors[key], 'value') && descriptors[key].enumerable));
  return Object.fromEntries(Object.keys(descriptors).map((key) => [key, descriptors[key].value]));
}
function eventsArray(value: unknown): unknown[] {
  check(Array.isArray(value));
  const fields = Object.getOwnPropertyDescriptors(value);
  const length = fields.length?.value;
  check(integer(length, 20) && Reflect.ownKeys(fields).length === length + 1);
  return Array.from({ length }, (_, index) => {
    const field = fields[String(index)];
    check(field && Object.prototype.hasOwnProperty.call(field, 'value') && field.enumerable);
    return field.value;
  });
}
function status(input: unknown): CommunityStatus {
  const value = object(input, ['schemaVersion', 'observedAtMs', 'membership', 'events']);
  check(value.schemaVersion === 1 && integer(value.observedAtMs));
  const now = Number(value.observedAtMs);
  const membership = object(value.membership, ['revision', 'applicationStatus', 'entitlement', 'accessThroughMs']);
  check(integer(membership.revision, 1_000_000)
    && oneOf(membership.applicationStatus, ['none', 'pending', 'approved', 'withdrawn', 'cancellation_requested'])
    && oneOf(membership.entitlement, ['current_member', 'not_entitled', 'decision_pending']));
  if (membership.entitlement === 'current_member') {
    check(oneOf(membership.applicationStatus, ['approved', 'cancellation_requested'])
      && integer(membership.accessThroughMs) && membership.accessThroughMs > now
      && Number(membership.revision) > 0);
  } else check(membership.accessThroughMs === null);
  const ids = new Set();
  const events = eventsArray(value.events).map((inputEvent) => {
    const event = object(inputEvent, ['id', 'schemaVersion', 'title', 'location', 'startAtMs', 'opensAtMs', 'closesAtMs', 'status', 'amountCents', 'capacity', 'confirmedCount', 'waiverVersion', 'waiverText', 'waiverHash', 'signupStatus', 'registration'], ['revision']);
    check(id(event.id) && !ids.has(event.id)); ids.add(event.id);
    check(event.schemaVersion === 1 && event.amountCents === 0
      && text(event.title) && text(event.location)
      && text(event.waiverVersion, 80) && text(event.waiverText, 2000)
      && typeof event.waiverHash === 'string' && /^[a-f0-9]{64}$/.test(event.waiverHash)
      && [event.startAtMs, event.opensAtMs, event.closesAtMs].every((time) => integer(time))
      && Number(event.opensAtMs) < Number(event.closesAtMs)
      && Number(event.closesAtMs) <= Number(event.startAtMs)
      && integer(event.capacity, 10000) && event.capacity > 0
      && integer(event.confirmedCount, event.capacity)
      && (event.revision === undefined || integer(event.revision, 1_000_000))
      && oneOf(event.status, ['open', 'closed', 'cancelled']));
    let expected = 'open';
    if (event.status === 'cancelled') expected = 'cancelled';
    else if (event.status === 'closed') expected = 'closed';
    else if (now < Number(event.opensAtMs)) expected = 'not_open_yet';
    else if (now >= Number(event.closesAtMs)) expected = 'ended';
    else if (event.confirmedCount === event.capacity) expected = 'full';
    check(event.signupStatus === expected);
    const registration = object(event.registration, ['revision', 'status']);
    check(integer(registration.revision, 1_000_000) && oneOf(registration.status, ['none', 'confirmed', 'cancelled'])
      && (registration.status === 'none' ? registration.revision === 0 : Number(registration.revision) > 0));
    return Object.freeze({ ...event, registration: Object.freeze(registration) });
  });
  return Object.freeze({
 schemaVersion: 1,
observedAtMs: now,
    membership: Object.freeze(membership),
events: Object.freeze(events)
}) as unknown as CommunityStatus;
}
export function parseCommunityStatus(input: unknown): CommunityStatus {
  try { return status(input); } catch { throw new Error(MESSAGE); }
}
export function parseCommunityResult(input: unknown, request: CommunityRequest) {
  try {
    check(request.action !== 'status' && integer(request.expectedRevision, 999999));
    const key = request.action.startsWith('membership_') ? 'membership' : 'registration';
    const result = object(input, [key]);
    const field = key === 'membership' ? 'applicationStatus' : 'status';
    const record = object(result[key], ['revision', field]);
    check(integer(record.revision, 1_000_000)
      && [request.expectedRevision, Number(request.expectedRevision) + 1]
        .includes(Number(record.revision)));
    const outcomes = {
      membership_join: ['pending'],
membership_cancel: ['withdrawn', 'cancellation_requested'],
      event_join: ['confirmed'],
event_cancel: ['cancelled']
    };
    const expected = outcomes[request.action as keyof typeof outcomes];
    check(expected);
    check(oneOf(record[field], expected));
  } catch { throw new Error(MESSAGE); }
}
// Subtract request duration from this budget at the screen. Server time, rather
// than the user's wall clock, determines known deadlines. No provider polling.
export function communityFreshFor(value: CommunityStatus) {
  const deadlines = [value.observedAtMs + COMMUNITY_FRESHNESS_MS];
  if (value.membership.accessThroughMs !== null) deadlines.push(value.membership.accessThroughMs);
  value.events.forEach((event) => {
    [event.opensAtMs, event.closesAtMs].forEach((time) => {
      if (time > value.observedAtMs) deadlines.push(time);
    });
  });
  return Math.max(0, Math.min(...deadlines) - value.observedAtMs);
}
