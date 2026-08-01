import { FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { createMemberDirectoryRequestId } from './memberDirectoryService';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENTRY_REF_PATTERN = /^entry_[0-9a-f]{64}$/;
const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]/u;
const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;
const DIRECTORY_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
const MAX_RESULTS = 24;
const MAX_DISPLAY_NAME_CODE_UNITS = 200;
const MAX_PHOTO_BYTES = 64 * 1024;
const MAX_QUERY_RAW_CODE_UNITS = 512;
const MIN_QUERY_CODE_UNITS = 2;
const MAX_QUERY_CODE_UNITS = 80;

export interface MemberDirectorySearchPhoto {
  contentType: 'image/webp';
  base64Data: string;
  width: 256;
  height: 256;
  version: string;
}

export interface MemberDirectorySearchResult {
  entryRef: string;
  displayName: string;
  photo: MemberDirectorySearchPhoto | null;
}

export interface MemberDirectorySearchResponse {
  schemaVersion: 1;
  results: readonly MemberDirectorySearchResult[];
}

export interface MemberDirectorySearchRequest {
  requestId: string;
  query: string;
}

function invalidRequest(): Error {
  return new Error('Invalid member directory search request.');
}

function invalidResponse(): Error {
  return new Error('Invalid member directory search response.');
}

function readExactPlainObject(
  value: unknown,
  expectedKeys: readonly string[],
  failure: () => Error,
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw failure();
    if (Object.getPrototypeOf(value) !== Object.prototype) throw failure();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) throw failure();

    const result = Object.create(null) as Record<string, unknown>;
    expectedKeys.forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) throw failure();
      result[key] = descriptor.value;
    });
    return result;
  } catch {
    throw failure();
  }
}

function readExactArray(value: unknown): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw invalidResponse();
    }
    const keys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined
      || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > MAX_RESULTS
      || keys.length !== lengthDescriptor.value + 1
      || !keys.includes('length')
    ) {
      throw invalidResponse();
    }
    const result: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const key = String(index);
      if (!keys.includes(key)) throw invalidResponse();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) throw invalidResponse();
      result.push(descriptor.value);
    }
    return result;
  } catch {
    throw invalidResponse();
  }
}

function hasUnsafeCodeUnits(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x1f || first === 0x7f) return true;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) return true;
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return true;
    }
  }
  return CONTROL_OR_FORMAT_PATTERN.test(value);
}

function canonicalDirectoryText(value: string): string | null {
  try {
    const tokens = value.normalize('NFKC').toLowerCase().match(DIRECTORY_TOKEN_PATTERN);
    return tokens && tokens.length > 0 ? tokens.join(' ') : null;
  } catch {
    return null;
  }
}

export function normalizeMemberDirectorySearchQuery(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_QUERY_RAW_CODE_UNITS
    || hasUnsafeCodeUnits(value)
  ) return null;
  try {
    const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    const canonical = canonicalDirectoryText(normalized);
    if (
      normalized.length === 0
      || normalized.length > MAX_QUERY_RAW_CODE_UNITS
      || hasUnsafeCodeUnits(normalized)
      || canonical === null
      || canonical.length < MIN_QUERY_CODE_UNITS
      || canonical.length > MAX_QUERY_CODE_UNITS
    ) return null;
    return normalized;
  } catch {
    return null;
  }
}

function canonicalBase64(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4
    || value.length % 4 !== 0
    || !CANONICAL_BASE64_PATTERN.test(value)
  ) return null;

  try {
    const decoded = atob(value);
    if (
      decoded.length === 0
      || decoded.length > MAX_PHOTO_BYTES
      || btoa(decoded) !== value
      || decoded.length < 12
      || decoded.slice(0, 4) !== 'RIFF'
      || decoded.slice(8, 12) !== 'WEBP'
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function readPhoto(value: unknown): MemberDirectorySearchPhoto {
  const data = readExactPlainObject(value, [
    'contentType',
    'base64Data',
    'width',
    'height',
    'version',
  ], invalidResponse);
  const base64Data = canonicalBase64(data.base64Data);
  if (
    data.contentType !== 'image/webp'
    || base64Data === null
    || data.width !== 256
    || data.height !== 256
    || typeof data.version !== 'string'
    || !UUID_V4_PATTERN.test(data.version)
  ) throw invalidResponse();

  return Object.freeze({
    contentType: 'image/webp',
    base64Data,
    width: 256,
    height: 256,
    version: data.version,
  });
}

function readResult(value: unknown): MemberDirectorySearchResult {
  const data = readExactPlainObject(value, [
    'entryRef',
    'displayName',
    'photo',
  ], invalidResponse);
  if (typeof data.displayName !== 'string') throw invalidResponse();
  const canonicalDisplayName = canonicalDirectoryText(data.displayName);
  if (
    typeof data.entryRef !== 'string'
    || !ENTRY_REF_PATTERN.test(data.entryRef)
    || data.displayName.length === 0
    || data.displayName.length > MAX_DISPLAY_NAME_CODE_UNITS
    || data.displayName.trim() !== data.displayName
    || hasUnsafeCodeUnits(data.displayName)
    || !LETTER_OR_NUMBER_PATTERN.test(data.displayName)
    || canonicalDisplayName === null
    || canonicalDisplayName.length < MIN_QUERY_CODE_UNITS
    || canonicalDisplayName.length > MAX_DISPLAY_NAME_CODE_UNITS
  ) throw invalidResponse();

  return Object.freeze({
    entryRef: data.entryRef,
    displayName: data.displayName,
    photo: data.photo === null ? null : readPhoto(data.photo),
  });
}

function readResponse(value: unknown): MemberDirectorySearchResponse {
  const data = readExactPlainObject(value, ['schemaVersion', 'results'], invalidResponse);
  if (data.schemaVersion !== 1) throw invalidResponse();
  const results = readExactArray(data.results).map(readResult);
  const entryRefs = new Set(results.map((result) => result.entryRef));
  if (entryRefs.size !== results.length) throw invalidResponse();
  return Object.freeze({ schemaVersion: 1, results: Object.freeze(results) });
}

function readRequest(value: unknown): MemberDirectorySearchRequest {
  const data = readExactPlainObject(value, ['requestId', 'query'], invalidRequest);
  const query = normalizeMemberDirectorySearchQuery(data.query);
  if (
    typeof data.requestId !== 'string'
    || !UUID_V4_PATTERN.test(data.requestId)
    || query === null
  ) throw invalidRequest();
  return Object.freeze({ requestId: data.requestId, query });
}

export function createMemberDirectorySearchRequestId(): string {
  return createMemberDirectoryRequestId();
}

export async function searchMemberDirectory(
  app: FirebaseApp,
  requestValue: MemberDirectorySearchRequest,
): Promise<MemberDirectorySearchResponse> {
  const request = readRequest(requestValue);
  const callable = httpsCallable<MemberDirectorySearchRequest, unknown>(
    getFunctions(app),
    'searchMemberDirectory',
  );
  const response = await callable(request);
  return readResponse(response.data);
}
