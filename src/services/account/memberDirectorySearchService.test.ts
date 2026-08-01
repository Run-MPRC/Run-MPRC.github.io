/* eslint-env jest */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { createMemberDirectoryRequestId } from './memberDirectoryService';
import {
  createMemberDirectorySearchRequestId,
  normalizeMemberDirectorySearchQuery,
  searchMemberDirectory,
} from './memberDirectorySearchService';

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({ name: 'synthetic-functions' })),
  httpsCallable: jest.fn(),
}));

jest.mock('./memberDirectoryService', () => ({
  createMemberDirectoryRequestId: jest.fn(),
}));

const app = { name: 'synthetic-app' } as any;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const ENTRY_REF = `entry_${'a'.repeat(64)}`;
const SECOND_ENTRY_REF = `entry_${'b'.repeat(64)}`;
const WEBP_BYTES = btoa('RIFF0000WEBPsynthetic-processed-pixels');
const PHOTO = Object.freeze({
  contentType: 'image/webp',
  base64Data: WEBP_BYTES,
  width: 256,
  height: 256,
  version: REQUEST_ID,
});
const RESULT = Object.freeze({
  entryRef: ENTRY_REF,
  displayName: 'Synthetic Runner',
  photo: PHOTO,
});
const RESPONSE = Object.freeze({
  schemaVersion: 1,
  results: [RESULT],
});

describe('member directory officer-search callable service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getFunctions as jest.Mock).mockReturnValue({ name: 'synthetic-functions' });
    (createMemberDirectoryRequestId as jest.Mock).mockReturnValue(REQUEST_ID);
  });

  test.each([
    ['NFKC and whitespace', '  Ｓynthetic\u00a0  Runner  ', 'Synthetic Runner'],
    ['apostrophe-separated tokens', "O'B", "O'B"],
    ['dash-separated tokens', 'A-B', 'A-B'],
    ['composed letters', 'Él', 'Él'],
    ['decomposed letters', 'E\u0301l', 'Él'],
    ['Turkish dotted capital I lowercase expansion', 'İ!', 'İ!'],
    ['sharp S with another letter', 'ßa', 'ßa'],
    ['canonical lower bound', 'ab', 'ab'],
    ['canonical upper bound', 'x'.repeat(80), 'x'.repeat(80)],
    [
      'punctuation outside a canonical upper-bound query',
      `!${'x'.repeat(80)}!`,
      `!${'x'.repeat(80)}!`,
    ],
    ['raw upper bound', `${'!'.repeat(510)}ab`, `${'!'.repeat(510)}ab`],
  ])('matches server token validity for %s', (_label, value, expected) => {
    expect(normalizeMemberDirectorySearchQuery(value)).toBe(expected);
  });

  test.each([
    ['non-string', null],
    ['empty', ''],
    ['one normalized code unit', ' a '],
    ['one token code unit after punctuation', 'A!'],
    ['one sharp-S code unit after lowercase', 'ẞ!'],
    ['over 80 normalized code units', 'x'.repeat(81)],
    ['over 512 raw code units', `${'!'.repeat(511)}ab`],
    ['C0 control', 'A\nB'],
    ['DEL control', 'A\u007fB'],
    ['Unicode C1 control', 'A\u0085B'],
    ['Unicode format control', 'A\u200dB'],
    ['unpaired high surrogate', 'A\ud800B'],
    ['unpaired low surrogate', 'A\udc00B'],
    ['punctuation only', '--'],
  ])('rejects %s before a query can be sent', (_label, value) => {
    expect(normalizeMemberDirectorySearchQuery(value)).toBeNull();
  });

  test('sends only the exact normalized request to the named callable', async () => {
    const callable = jest.fn().mockResolvedValue({ data: RESPONSE });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(searchMemberDirectory(app, {
      requestId: REQUEST_ID,
      query: '  Ｓynthetic   Runner ',
    })).resolves.toEqual(RESPONSE);

    expect(getFunctions).toHaveBeenCalledWith(app);
    expect(httpsCallable).toHaveBeenCalledWith(
      { name: 'synthetic-functions' },
      'searchMemberDirectory',
    );
    expect(callable).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      query: 'Synthetic Runner',
    });
    expect(callable.mock.calls[0][0]).not.toHaveProperty('uid');
    expect(callable.mock.calls[0][0]).not.toHaveProperty('role');
  });

  test('returns a frozen minimal result with an optional bounded WebP', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: {
        schemaVersion: 1,
        results: [
          RESULT,
          { entryRef: SECOND_ENTRY_REF, displayName: 'No Photo Runner', photo: null },
        ],
      },
    });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const response = await searchMemberDirectory(app, {
      requestId: REQUEST_ID,
      query: 'synthetic',
    });

    expect(response).toEqual({
      schemaVersion: 1,
      results: [
        RESULT,
        { entryRef: SECOND_ENTRY_REF, displayName: 'No Photo Runner', photo: null },
      ],
    });
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.results)).toBe(true);
    expect(Object.isFrozen(response.results[0])).toBe(true);
    expect(Object.isFrozen(response.results[0].photo!)).toBe(true);
    expect(Object.keys(response.results[0])).toEqual(['entryRef', 'displayName', 'photo']);
  });

  test.each([
    ['extra response field', { ...RESPONSE, query: 'private query' }],
    ['future schema', { ...RESPONSE, schemaVersion: 2 }],
    ['too many results', { ...RESPONSE, results: Array(25).fill(RESULT) }],
    ['bad entry reference', {
      ...RESPONSE,
      results: [{ ...RESULT, entryRef: `entry_${'A'.repeat(64)}` }],
    }],
    ['duplicate entry reference', { ...RESPONSE, results: [RESULT, RESULT] }],
    ['padded display name', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: ' Synthetic Runner ' }],
    }],
    ['empty display name', { ...RESPONSE, results: [{ ...RESULT, displayName: '' }] }],
    ['one-code-unit display name', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: 'A' }],
    }],
    ['oversized display name', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: 'x'.repeat(201) }],
    }],
    ['display-name normalization expansion over the canonical bound', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: '\ufdfa'.repeat(12) }],
    }],
    ['display-name control', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: 'Synthetic\u200dRunner' }],
    }],
    ['display-name C1 control', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: 'Synthetic\u0085Runner' }],
    }],
    ['unpaired display-name surrogate', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: 'Synthetic\ud800Runner' }],
    }],
    ['punctuation-only display name', {
      ...RESPONSE,
      results: [{ ...RESULT, displayName: '--' }],
    }],
    ['non-WebP media type', {
      ...RESPONSE,
      results: [{ ...RESULT, photo: { ...PHOTO, contentType: 'image/png' } }],
    }],
    ['non-WebP bytes', {
      ...RESPONSE,
      results: [{ ...RESULT, photo: { ...PHOTO, base64Data: btoa('not a webp') } }],
    }],
    ['non-canonical base64', {
      ...RESPONSE,
      results: [{ ...RESULT, photo: { ...PHOTO, base64Data: 'Zh==' } }],
    }],
    ['wrong photo dimensions', {
      ...RESPONSE,
      results: [{ ...RESULT, photo: { ...PHOTO, width: 128 } }],
    }],
    ['non-canonical photo version', {
      ...RESPONSE,
      results: [{ ...RESULT, photo: { ...PHOTO, version: REQUEST_ID.toUpperCase() } }],
    }],
  ])('rejects %s with one fixed response error', async (_label, response) => {
    const callable = jest.fn().mockResolvedValue({ data: response });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(searchMemberDirectory(app, {
      requestId: REQUEST_ID,
      query: 'synthetic',
    })).rejects.toThrow('Invalid member directory search response.');
  });

  test('rejects sparse, subclassed, accessor, and hostile response shapes generically', async () => {
    const sparse = [RESULT, RESULT];
    delete sparse[1];
    class ResultArray extends Array<typeof RESULT> {}
    const accessor = { ...RESPONSE } as Record<string, unknown>;
    Object.defineProperty(accessor, 'results', {
      enumerable: true,
      get: () => [RESULT],
    });
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error('synthetic-private-response-canary');
      },
    });
    const callable = jest.fn()
      .mockResolvedValueOnce({ data: { ...RESPONSE, results: sparse } })
      .mockResolvedValueOnce({ data: { ...RESPONSE, results: new ResultArray(RESULT) } })
      .mockResolvedValueOnce({ data: accessor })
      .mockResolvedValueOnce({ data: hostile });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await Promise.all(Array.from({ length: 4 }, () => (
      expect(searchMemberDirectory(app, {
        requestId: REQUEST_ID,
        query: 'synthetic',
      })).rejects.toThrow('Invalid member directory search response.')
    )));
  });

  test('clones validated array descriptors without rereading a wrapped response', async () => {
    const getTrap = jest.fn((_target, property) => {
      if (property === 'map' || property === '0') {
        throw new Error('synthetic-response-reread-canary');
      }
      return Reflect.get(_target, property);
    });
    const wrappedResults = new Proxy([RESULT], { get: getTrap });
    const callable = jest.fn().mockResolvedValue({
      data: { ...RESPONSE, results: wrappedResults },
    });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(searchMemberDirectory(app, {
      requestId: REQUEST_ID,
      query: 'synthetic',
    })).resolves.toEqual(RESPONSE);
    expect(getTrap).not.toHaveBeenCalled();
  });

  test.each([
    ['bad request ID', { requestId: 'not-a-uuid', query: 'synthetic' }],
    ['uppercase request ID', { requestId: REQUEST_ID.toUpperCase(), query: 'synthetic' }],
    ['short query', { requestId: REQUEST_ID, query: 'x' }],
    ['long query', { requestId: REQUEST_ID, query: 'x'.repeat(81) }],
    ['query control', { requestId: REQUEST_ID, query: 'A\u200dB' }],
    ['extra field', { requestId: REQUEST_ID, query: 'synthetic', uid: 'not-allowed' }],
  ])('rejects %s before creating a callable', async (_label, request) => {
    await expect(searchMemberDirectory(app, request as any))
      .rejects.toThrow('Invalid member directory search request.');
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  test('delegates request IDs to the existing fail-closed secure UUID generator', () => {
    const random = jest.spyOn(Math, 'random');

    expect(createMemberDirectorySearchRequestId()).toBe(REQUEST_ID);
    expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
    expect(random).not.toHaveBeenCalled();

    random.mockRestore();
  });
});
