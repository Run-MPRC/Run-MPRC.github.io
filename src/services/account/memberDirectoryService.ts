import { FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_RETURNED_PHOTO_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const DEFINITIVE_REJECTION_CODES = new Set([
  'functions/aborted',
  'functions/data-loss',
  'functions/failed-precondition',
  'functions/invalid-argument',
  'functions/permission-denied',
  'functions/resource-exhausted',
  'functions/unauthenticated',
]);

export const MEMBER_DIRECTORY_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type MemberDirectoryUploadType = typeof MEMBER_DIRECTORY_UPLOAD_TYPES[number];

export interface MemberDirectoryPhoto {
  contentType: 'image/webp';
  base64Data: string;
  width: 256;
  height: 256;
  version: string;
}

export interface MemberDirectoryMutationState {
  schemaVersion: 1;
  revision: number;
  searchableByOfficers: boolean;
  hasPhoto: boolean;
}

export interface MemberDirectoryProfile extends MemberDirectoryMutationState {
  photo: MemberDirectoryPhoto | null;
}

export interface MemberDirectoryMutationRequest {
  requestId: string;
  expectedRevision: number;
}

export interface SetMemberDirectoryVisibilityRequest
  extends MemberDirectoryMutationRequest {
  searchableByOfficers: boolean;
}

export interface SetMemberDirectoryPhotoRequest
  extends MemberDirectoryMutationRequest {
  contentType: MemberDirectoryUploadType;
  base64Data: string;
}

function invalidResponse(): Error {
  return new Error('Invalid member directory response.');
}

export function isDefinitiveMemberDirectoryRejection(error: unknown): boolean {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined
      && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      && typeof descriptor.value === 'string'
      && DEFINITIVE_REJECTION_CODES.has(descriptor.value);
  } catch {
    return false;
  }
}

function readExactPlainObject(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw invalidResponse();
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw invalidResponse();
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      throw invalidResponse();
    }

    const result = Object.create(null) as Record<string, unknown>;
    expectedKeys.forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || descriptor.enumerable !== true
      ) {
        throw invalidResponse();
      }
      result[key] = descriptor.value;
    });
    return result;
  } catch {
    throw invalidResponse();
  }
}

function isValidRevision(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function canonicalBase64DecodedBytes(value: unknown, maximum: number): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > Math.ceil(maximum / 3) * 4
    || value.length % 4 !== 0
    || !CANONICAL_BASE64_PATTERN.test(value)
  ) return null;

  try {
    const decoded = atob(value);
    if (
      decoded.length <= 0
      || decoded.length > maximum
      || btoa(decoded) !== value
    ) return null;
    return decoded;
  } catch {
    return null;
  }
}

function hasWebPEnvelope(decodedBytes: string): boolean {
  return decodedBytes.length >= 12
    && decodedBytes.slice(0, 4) === 'RIFF'
    && decodedBytes.slice(8, 12) === 'WEBP';
}

function readMutationState(value: unknown): MemberDirectoryMutationState {
  const data = readExactPlainObject(value, [
    'schemaVersion',
    'revision',
    'searchableByOfficers',
    'hasPhoto',
  ]);
  if (
    data.schemaVersion !== 1
    || !isValidRevision(data.revision)
    || typeof data.searchableByOfficers !== 'boolean'
    || typeof data.hasPhoto !== 'boolean'
  ) throw invalidResponse();

  return Object.freeze({
    schemaVersion: 1,
    revision: data.revision,
    searchableByOfficers: data.searchableByOfficers,
    hasPhoto: data.hasPhoto,
  });
}

function readPhoto(value: unknown): MemberDirectoryPhoto {
  const data = readExactPlainObject(value, [
    'contentType',
    'base64Data',
    'width',
    'height',
    'version',
  ]);
  const decodedBytes = data.contentType === 'image/webp'
    ? canonicalBase64DecodedBytes(data.base64Data, MAX_RETURNED_PHOTO_BYTES)
    : null;
  if (
    data.contentType !== 'image/webp'
    || decodedBytes === null
    || !hasWebPEnvelope(decodedBytes)
    || data.width !== 256
    || data.height !== 256
    || typeof data.version !== 'string'
    || !UUID_V4_PATTERN.test(data.version)
  ) throw invalidResponse();

  return Object.freeze({
    contentType: 'image/webp',
    base64Data: data.base64Data as string,
    width: 256,
    height: 256,
    version: data.version,
  });
}

function readProfile(value: unknown): MemberDirectoryProfile {
  const data = readExactPlainObject(value, [
    'schemaVersion',
    'revision',
    'searchableByOfficers',
    'hasPhoto',
    'photo',
  ]);
  const state = readMutationState({
    schemaVersion: data.schemaVersion,
    revision: data.revision,
    searchableByOfficers: data.searchableByOfficers,
    hasPhoto: data.hasPhoto,
  });
  const photo = data.photo === null ? null : readPhoto(data.photo);
  if (state.hasPhoto !== (photo !== null)) throw invalidResponse();

  return Object.freeze({ ...state, photo });
}

function assertMutationRequest(request: MemberDirectoryMutationRequest): void {
  if (
    !UUID_V4_PATTERN.test(request.requestId)
    || !isValidRevision(request.expectedRevision)
  ) throw new Error('Invalid member directory request.');
}

export function createMemberDirectoryRequestId(): string {
  const cryptoProvider = typeof crypto === 'undefined' ? null : crypto;
  if (cryptoProvider && typeof cryptoProvider.randomUUID === 'function') {
    return cryptoProvider.randomUUID().toLowerCase();
  }

  const bytes = new Uint8Array(16);
  if (cryptoProvider && typeof cryptoProvider.getRandomValues === 'function') {
    cryptoProvider.getRandomValues(bytes);
  } else {
    throw new Error('Secure member directory requests are unavailable.');
  }
  bytes[6] = (bytes[6] % 16) + 64;
  bytes[8] = (bytes[8] % 64) + 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

export async function getMyMemberDirectoryProfile(
  app: FirebaseApp,
): Promise<MemberDirectoryProfile> {
  const callable = httpsCallable<Record<string, never>, unknown>(
    getFunctions(app),
    'getMyMemberDirectoryProfile',
  );
  const result = await callable({});
  return readProfile(result.data);
}

export async function setMyMemberDirectoryVisibility(
  app: FirebaseApp,
  request: SetMemberDirectoryVisibilityRequest,
): Promise<MemberDirectoryMutationState> {
  assertMutationRequest(request);
  if (typeof request.searchableByOfficers !== 'boolean') {
    throw new Error('Invalid member directory request.');
  }
  const callable = httpsCallable<SetMemberDirectoryVisibilityRequest, unknown>(
    getFunctions(app),
    'setMyMemberDirectoryVisibility',
  );
  const result = await callable(request);
  return readMutationState(result.data);
}

export async function setMyMemberDirectoryPhoto(
  app: FirebaseApp,
  request: SetMemberDirectoryPhotoRequest,
): Promise<MemberDirectoryMutationState> {
  assertMutationRequest(request);
  if (
    !MEMBER_DIRECTORY_UPLOAD_TYPES.includes(request.contentType)
    || canonicalBase64DecodedBytes(request.base64Data, MAX_UPLOAD_BYTES) === null
  ) throw new Error('Invalid member directory request.');

  const callable = httpsCallable<SetMemberDirectoryPhotoRequest, unknown>(
    getFunctions(app),
    'setMyMemberDirectoryPhoto',
  );
  const result = await callable(request);
  return readMutationState(result.data);
}

export async function removeMyMemberDirectoryPhoto(
  app: FirebaseApp,
  request: MemberDirectoryMutationRequest,
): Promise<MemberDirectoryMutationState> {
  assertMutationRequest(request);
  const callable = httpsCallable<MemberDirectoryMutationRequest, unknown>(
    getFunctions(app),
    'removeMyMemberDirectoryPhoto',
  );
  const result = await callable(request);
  return readMutationState(result.data);
}
