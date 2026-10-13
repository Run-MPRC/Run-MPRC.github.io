import { Auth } from 'firebase/auth';
import { Functions, httpsCallable } from 'firebase/functions';
import { COMMUNITY_ENABLED } from './communityService';

export const RACE_POLICY = 'fictional-race-v1-not-money';
export const RACE_WAIVER = 'fictional-race-waiver-v1';
export const raceId = (value: unknown): value is string => typeof value === 'string' && /^stage_race_[A-Za-z0-9_-]{1,64}$/.test(value);
const MESSAGE = 'Fictional race status is unavailable. Refresh or sign in again.';
const check = (value: unknown) => {
  if (!value) throw new Error(MESSAGE);
};
const integer = (value: unknown, max = 8640000000000000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const revision = (value: unknown) => integer(value, 999999) && value > 0;
type RecordValue = Record<string, unknown>;
function object(value: unknown, keys: string[]): RecordValue {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  check(prototype === null || prototype === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).length === keys.length);
  check(keys.every((key) => Object.prototype.hasOwnProperty.call(descriptors, key)));
  check(keys.every((key) => Object.prototype.hasOwnProperty.call(descriptors[key], 'value') && descriptors[key].enumerable));
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}
function array(value: unknown): unknown[] {
  check(Array.isArray(value));
  const fields = Object.getOwnPropertyDescriptors(value);
  const length = fields.length?.value;
  check(integer(length, 20));
  check(Reflect.ownKeys(fields).length === length + 1);
  return Array.from({
    length
  }, (_, n) => {
    const field = fields[String(n)];
    check(field && Object.prototype.hasOwnProperty.call(field, 'value') && field.enumerable);
    return field.value;
  });
}
export interface RaceEntry {
  entryId: string;
  revision: number;
  bibId: string;
  status: 'confirmed' | 'cancelled';
  fictionalAmountCents: number;
  fictionalReturnedCents: number;
  isCurrentRunner: boolean;
  isOriginalCreditOwner: boolean;
  transferCount: 0 | 1;
  offerExpiresAtMs: number | null;
  canCancel: boolean;
  canOffer: boolean;
  canRevoke: boolean;
}
export interface RaceEvent {
  eventId: string;
  revision: number;
  startAtMs: number;
  opensAtMs: number;
  closesAtMs: number;
  signupStatus: 'open' | 'not_open_yet' | 'ended' | 'full' | 'cancelled';
  fictionalAmountCents: number;
  currency: 'USD';
  waiverVersion: string;
  joinEntryId: string | null;
  canJoin: boolean;
  enrollment: {
    status: 'confirmed' | 'cancelled' | 'transferred';
    revision: number;
  } | null;
  entry: RaceEntry | null;
}
export interface RaceStatus {
  schemaVersion: 1;
  simulationOnly: true;
  policyVersion: typeof RACE_POLICY;
  observedAtMs: number;
  accessExpiresAtMs: number;
  events: RaceEvent[];
  incoming: (RaceEntry & {
    eventId: string;
    eventRevision: number;
    canAccept: true;
  }) | null;
}
export interface RaceCommand {
  action: 'race_join' | 'race_cancel' | 'race_offer' | 'race_accept' | 'race_revoke';
  accountUid: string;
  requestId: string;
  eventId: string;
  entryId: string;
  expectedEventRevision: number;
  expectedEntryRevision: number;
  recipientUid?: string;
  waiverAccepted?: true;
  waiverVersion?: string;
}
const mapping = {
  race_join: 'join_simulation',
  race_cancel: 'simulate_refund',
  race_offer: 'offer_transfer',
  race_accept: 'accept_transfer',
  race_revoke: 'revoke_transfer'
} as const;
export function parseRaceCommand(input: unknown): RaceCommand {
  try {
    // Safely obtain the discriminator without invoking request accessors.
    const descriptor = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'action') : null;
    const action = descriptor?.value;
    check(typeof action === 'string' && Object.prototype.hasOwnProperty.call(mapping, action));
    let extra: string[] = [];
    if (action === 'race_offer') extra = ['recipientUid']; else if (action === 'race_join' || action === 'race_accept') extra = ['waiverAccepted', 'waiverVersion'];
    const request = object(input, ['action', 'accountUid', 'requestId', 'eventId', 'entryId', 'expectedEventRevision', 'expectedEntryRevision', ...extra]);
    check(raceId(request.accountUid) && raceId(request.eventId) && raceId(request.entryId)
      && typeof request.requestId === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(request.requestId)
      && revision(request.expectedEventRevision) && integer(request.expectedEntryRevision, 999999)
      && (action === 'race_join'
        ? request.expectedEntryRevision === 0 : request.expectedEntryRevision > 0)
      && (!extra.includes('recipientUid')
        || (raceId(request.recipientUid) && request.recipientUid !== request.accountUid))
      && (!extra.includes('waiverAccepted')
        || (request.waiverAccepted === true && request.waiverVersion === RACE_WAIVER)));
    return request as unknown as RaceCommand;
  } catch {
    throw new Error(MESSAGE);
  }
}
const entryKeys = ['entryId', 'revision', 'bibId', 'status', 'fictionalAmountCents', 'fictionalReturnedCents', 'isCurrentRunner', 'isOriginalCreditOwner', 'transferCount', 'offerExpiresAtMs', 'canCancel', 'canOffer', 'canRevoke'];
function entry(value: unknown, event: RecordValue, now: number, incoming = false): RaceEntry {
  const data = object(value, [...entryKeys, ...(incoming ? ['eventId', 'eventRevision', 'canAccept'] : [])]);
  check(raceId(data.entryId) && raceId(data.bibId) && revision(data.revision)
    && typeof data.status === 'string' && ['confirmed', 'cancelled'].includes(data.status)
    && integer(data.fictionalAmountCents, 10000) && data.fictionalAmountCents > 0
    && data.fictionalReturnedCents === (data.status === 'cancelled' ? data.fictionalAmountCents : 0)
    && (data.transferCount === 0 || data.transferCount === 1)
    && ['isCurrentRunner', 'isOriginalCreditOwner', 'canCancel', 'canOffer', 'canRevoke']
      .every((key) => typeof data[key] === 'boolean')
    && (data.offerExpiresAtMs === null
      || (integer(data.offerExpiresAtMs) && data.offerExpiresAtMs <= Number(event.startAtMs)))
    && (data.status !== 'cancelled'
      || (data.offerExpiresAtMs === null && !data.canCancel && !data.canOffer && !data.canRevoke))
    && (data.transferCount !== 1 || data.offerExpiresAtMs === null));
  const beforeStart = now < Number(event.startAtMs);
  const confirmed = data.status === 'confirmed';
  if (!incoming) {
    check(data.transferCount === 0
      ? data.isCurrentRunner === true && data.isOriginalCreditOwner === true
      : data.isCurrentRunner !== data.isOriginalCreditOwner);
  }
  check(data.canCancel === (data.isCurrentRunner && confirmed && data.offerExpiresAtMs === null && beforeStart) && data.canOffer === (data.isCurrentRunner && confirmed && data.offerExpiresAtMs === null && data.transferCount === 0 && event.signupStatus !== 'cancelled' && beforeStart) && data.canRevoke === (data.isCurrentRunner && data.offerExpiresAtMs !== null && beforeStart));
  if (incoming) {
    check(data.eventId === event.eventId && data.eventRevision === event.revision && data.canAccept === true && !data.isCurrentRunner && !data.isOriginalCreditOwner && data.transferCount === 0 && confirmed && integer(data.offerExpiresAtMs) && data.offerExpiresAtMs > now && beforeStart && event.signupStatus !== 'cancelled');
  }
  return data as unknown as RaceEntry;
}
export function parseRaceStatus(input: unknown, incomingEntryId: string | null): RaceStatus {
  try {
    const data = object(input, ['schemaVersion', 'simulationOnly', 'policyVersion', 'observedAtMs', 'accessExpiresAtMs', 'events', 'incoming']);
    check(data.schemaVersion === 1 && data.simulationOnly === true
      && data.policyVersion === RACE_POLICY
      && integer(data.observedAtMs) && integer(data.accessExpiresAtMs)
      && data.accessExpiresAtMs > data.observedAtMs
      && data.accessExpiresAtMs - data.observedAtMs <= 86400000);
    const now = Number(data.observedAtMs);
    const events = array(data.events).map((raw) => {
      const event = object(raw, ['eventId', 'revision', 'startAtMs', 'opensAtMs', 'closesAtMs', 'signupStatus', 'fictionalAmountCents', 'currency', 'waiverVersion', 'joinEntryId', 'canJoin', 'enrollment', 'entry']);
      check(raceId(event.eventId) && revision(event.revision) && [event.startAtMs, event.opensAtMs, event.closesAtMs].every((value) => integer(value)) && Number(event.opensAtMs) < Number(event.closesAtMs) && Number(event.closesAtMs) <= Number(event.startAtMs) && Number(event.closesAtMs) - Number(event.opensAtMs) <= 86400000 && typeof event.signupStatus === 'string' && ['open', 'not_open_yet', 'ended', 'full', 'cancelled'].includes(event.signupStatus) && integer(event.fictionalAmountCents, 10000) && event.fictionalAmountCents > 0 && event.currency === 'USD' && event.waiverVersion === RACE_WAIVER && typeof event.canJoin === 'boolean');
      if (event.signupStatus !== 'cancelled') {
        if (now >= Number(event.closesAtMs)) check(event.signupStatus === 'ended'); else if (now < Number(event.opensAtMs)) {
          check(event.signupStatus === 'not_open_yet');
        } else check(event.signupStatus === 'open' || event.signupStatus === 'full');
      }
      const enrollment = event.enrollment === null ? null : object(event.enrollment, ['status', 'revision']);
      if (enrollment) {
        check(typeof enrollment.status === 'string' && ['confirmed', 'cancelled', 'transferred'].includes(enrollment.status) && revision(enrollment.revision));
      }
      check(event.canJoin === (enrollment === null && event.signupStatus === 'open') && (enrollment === null ? raceId(event.joinEntryId) && event.entry === null : event.joinEntryId === null && event.entry !== null));
      const parsedEntry = event.entry === null ? null : entry(event.entry, event, now);
      if (parsedEntry && enrollment) {
        check(enrollment.status === 'transferred' ? !parsedEntry.isCurrentRunner && parsedEntry.isOriginalCreditOwner && parsedEntry.transferCount === 1 : parsedEntry.isCurrentRunner && parsedEntry.status === enrollment.status);
      }
      return Object.freeze({
        ...event,
        enrollment,
        entry: parsedEntry
      }) as unknown as RaceEvent;
    });
    check(new Set(events.map((event) => event.eventId)).size === events.length);
    let incoming = null;
    if (incomingEntryId !== null) {
      check(raceId(incomingEntryId));
      const named = object(data.incoming, [...entryKeys, 'eventId', 'eventRevision', 'canAccept']);
      const event = events.find((value) => value.eventId === named.eventId);
      check(event && event.enrollment === null);
      incoming = entry(named, event as unknown as RecordValue, now, true);
      check(incoming.entryId === incomingEntryId);
    } else check(data.incoming === null);
    return Object.freeze({
      ...data,
      events: Object.freeze(events),
      incoming
    }) as unknown as RaceStatus;
  } catch {
    throw new Error(MESSAGE);
  }
}
export function parseRaceResult(input: unknown, request: RaceCommand) {
  try {
    const command = parseRaceCommand(request);
    const data = object(input, ['schemaVersion', 'simulationOnly', 'action', 'eventId', 'entryId', 'entryRevision', 'eventRevision', 'offerExpiresAtMs']);
    check(data.schemaVersion === 1 && data.simulationOnly === true && data.action === mapping[command.action] && data.eventId === command.eventId && data.entryId === command.entryId && revision(data.entryRevision) && data.entryRevision === command.expectedEntryRevision + 1 && revision(data.eventRevision) && data.eventRevision === command.expectedEventRevision + (['race_join', 'race_cancel'].includes(command.action) ? 1 : 0) && (command.action === 'race_offer' ? integer(data.offerExpiresAtMs) : data.offerExpiresAtMs === null));
    return data;
  } catch {
    throw new Error(MESSAGE);
  }
}
async function invoke(functions: Functions, auth: Auth, request: RecordValue) {
  try {
    const session = auth.currentUser;
    const {
      app
    } = functions;
    const current = () => COMMUNITY_ENABLED && app.options.projectId === 'run-mprc-staging'
      && functions.app === app && auth.app === app && auth.tenantId === null
      && session !== null && auth.currentUser === session && session.uid === request.accountUid
      && session.emailVerified === true;
    check(current() && raceId(request.accountUid));
    const response = await httpsCallable<RecordValue, unknown>(functions, 'communityActions')(request);
    check(current());
    return response.data;
  } catch {
    throw new Error(MESSAGE);
  }
}
export async function readFictionalStatus(
  functions: Functions,
  auth: Auth,
  accountUid: string,
  incomingEntryId: string | null = null
) {
  check(incomingEntryId === null || raceId(incomingEntryId));
  return parseRaceStatus(await invoke(functions, auth, {
    action: 'race_status',
    accountUid,
    incomingEntryId
  }), incomingEntryId);
}
export async function sendFictionalCommand(functions: Functions, auth: Auth, input: RaceCommand) {
  const request = parseRaceCommand(input);
  return parseRaceResult(await invoke(functions, auth, request as unknown as RecordValue), request);
}
