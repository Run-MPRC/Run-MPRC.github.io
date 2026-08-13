/* eslint-env jest */

import React from 'react';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import MemberDirectoryProfile from '../../pages/account/MemberDirectoryProfile';
import {
  createMemberDirectoryRequestId,
  getMyMemberDirectoryProfile,
  isDefinitiveMemberDirectoryRejection,
  removeMyMemberDirectoryPhoto,
  setMyMemberDirectoryPhoto,
  setMyMemberDirectoryVisibility,
} from './memberDirectoryService';

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({ name: 'synthetic-functions' })),
  httpsCallable: jest.fn(),
}));

const app = { name: 'synthetic-app' } as any;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECOND_REQUEST_ID = '123e4567-e89b-42d3-b456-426614174001';

function webPEnvelope(byteLength: number): string {
  return btoa(`RIFF${'\0'.repeat(4)}WEBP${'\0'.repeat(byteLength - 12)}`);
}

const PHOTO_BYTES = webPEnvelope(32);
const PHOTO = {
  contentType: 'image/webp',
  base64Data: PHOTO_BYTES,
  width: 256,
  height: 256,
  version: REQUEST_ID,
};
const PROFILE = {
  schemaVersion: 1,
  revision: 2,
  searchableByOfficers: false,
  hasPhoto: true,
  photo: PHOTO,
};
const MUTATION_STATE = {
  schemaVersion: 1,
  revision: 3,
  searchableByOfficers: true,
  hasPhoto: true,
};

function profileWithPhoto(base64Data: string) {
  return {
    ...PROFILE,
    photo: { ...PHOTO, base64Data },
  };
}

describe('member directory callable service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getFunctions as jest.Mock).mockReturnValue({ name: 'synthetic-functions' });
  });

  test('gets the caller-only profile with an exact empty request', async () => {
    const callable = jest.fn().mockResolvedValue({ data: PROFILE });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(getMyMemberDirectoryProfile(app)).resolves.toEqual(PROFILE);

    expect(getFunctions).toHaveBeenCalledWith(app);
    expect(httpsCallable).toHaveBeenCalledWith(
      { name: 'synthetic-functions' },
      'getMyMemberDirectoryProfile',
    );
    expect(callable).toHaveBeenCalledWith({});
  });

  test('sends exact revision-bound visibility, upload, and removal requests', async () => {
    const callable = jest.fn().mockResolvedValue({ data: MUTATION_STATE });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const visibilityRequest = {
      requestId: REQUEST_ID,
      expectedRevision: 2,
      searchableByOfficers: true,
    } as const;
    const uploadRequest = {
      requestId: SECOND_REQUEST_ID,
      expectedRevision: 3,
      contentType: 'image/png' as const,
      base64Data: btoa('synthetic upload'),
    };
    const removeRequest = {
      requestId: REQUEST_ID,
      expectedRevision: 4,
    };

    await expect(setMyMemberDirectoryVisibility(app, visibilityRequest))
      .resolves.toEqual(MUTATION_STATE);
    await expect(setMyMemberDirectoryPhoto(app, uploadRequest))
      .resolves.toEqual(MUTATION_STATE);
    await expect(removeMyMemberDirectoryPhoto(app, removeRequest))
      .resolves.toEqual(MUTATION_STATE);

    expect(httpsCallable).toHaveBeenNthCalledWith(
      1,
      { name: 'synthetic-functions' },
      'setMyMemberDirectoryVisibility',
    );
    expect(httpsCallable).toHaveBeenNthCalledWith(
      2,
      { name: 'synthetic-functions' },
      'setMyMemberDirectoryPhoto',
    );
    expect(httpsCallable).toHaveBeenNthCalledWith(
      3,
      { name: 'synthetic-functions' },
      'removeMyMemberDirectoryPhoto',
    );
    expect(callable).toHaveBeenNthCalledWith(1, visibilityRequest);
    expect(callable).toHaveBeenNthCalledWith(2, uploadRequest);
    expect(callable).toHaveBeenNthCalledWith(3, removeRequest);
  });

  test.each([
    ['an extra top-level key', { ...PROFILE, email: 'not-allowed@example.test' }],
    ['a missing schema version', {
      revision: 2,
      searchableByOfficers: false,
      hasPhoto: true,
      photo: PHOTO,
    }],
    ['a future schema version', { ...PROFILE, schemaVersion: 2 }],
    ['a negative revision', { ...PROFILE, revision: -1 }],
    ['a negative-zero revision', { ...PROFILE, revision: -0 }],
    ['a mismatched photo flag', { ...PROFILE, hasPhoto: false }],
    ['a non-WebP returned photo', {
      ...PROFILE,
      photo: { ...PHOTO, contentType: 'image/png' },
    }],
    ['non-canonical base64 padding bits', {
      ...PROFILE,
      photo: { ...PHOTO, base64Data: 'Zh==' },
    }],
    ['an uppercase photo version', {
      ...PROFILE,
      photo: { ...PHOTO, version: REQUEST_ID.toUpperCase() },
    }],
    ['an oversized returned photo', {
      ...PROFILE,
      photo: { ...PHOTO, base64Data: btoa('a'.repeat((64 * 1024) + 1)) },
    }],
  ])('rejects %s as an invalid provider response', async (_label, response) => {
    const callable = jest.fn().mockResolvedValue({ data: response });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
  });

  test('rejects accessors, non-enumerable fields, and hostile proxy failures generically', async () => {
    const accessorResponse = { ...PROFILE } as Record<string, unknown>;
    Object.defineProperty(accessorResponse, 'revision', {
      enumerable: true,
      get: () => 2,
    });
    const nonEnumerableResponse = { ...PROFILE } as Record<string, unknown>;
    Object.defineProperty(nonEnumerableResponse, 'revision', {
      enumerable: false,
      value: 2,
    });
    const hostileResponse = new Proxy({}, {
      ownKeys() {
        throw new Error('synthetic-provider-canary');
      },
    });
    const callable = jest.fn()
      .mockResolvedValueOnce({ data: accessorResponse })
      .mockResolvedValueOnce({ data: nonEnumerableResponse })
      .mockResolvedValueOnce({ data: hostileResponse });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
  });

  test('rejects malformed outbound commands before a callable is created', async () => {
    await expect(setMyMemberDirectoryVisibility(app, {
      requestId: 'not-a-uuid',
      expectedRevision: 0,
      searchableByOfficers: false,
    })).rejects.toThrow('Invalid member directory request.');
    await expect(setMyMemberDirectoryPhoto(app, {
      requestId: REQUEST_ID,
      expectedRevision: 0,
      contentType: 'image/png',
      base64Data: 'Zh==',
    })).rejects.toThrow('Invalid member directory request.');
    await expect(removeMyMemberDirectoryPhoto(app, {
      requestId: REQUEST_ID,
      expectedRevision: -1,
    })).rejects.toThrow('Invalid member directory request.');
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  test('creates a lowercase version-4 UUID for idempotent commands', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.fill(0xab);
          return bytes;
        },
      },
    });
    try {
      expect(createMemberDirectoryRequestId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      if (originalCrypto) {
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
      } else {
        delete (globalThis as { crypto?: Crypto }).crypto;
      }
    }
  });

  test('fails closed without Web Crypto and never substitutes Math.random', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const random = jest.spyOn(Math, 'random');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    try {
      expect(() => createMemberDirectoryRequestId())
        .toThrow('Secure member directory requests are unavailable.');
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      if (originalCrypto) {
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
      } else {
        delete (globalThis as { crypto?: Crypto }).crypto;
      }
    }
  });

  test.each([
    'functions/aborted',
    'functions/data-loss',
    'functions/failed-precondition',
    'functions/invalid-argument',
    'functions/permission-denied',
    'functions/resource-exhausted',
    'functions/unauthenticated',
  ])('recognizes fixed non-mutating rejection %s', (code) => {
    expect(isDefinitiveMemberDirectoryRejection({ code })).toBe(true);
  });

  test('treats transport, malformed, accessor, and hostile failures as unknown', () => {
    const accessor = {};
    Object.defineProperty(accessor, 'code', {
      enumerable: true,
      get: () => 'functions/invalid-argument',
    });
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error('synthetic-provider-canary');
      },
    });

    expect(isDefinitiveMemberDirectoryRejection({ code: 'functions/unavailable' }))
      .toBe(false);
    expect(isDefinitiveMemberDirectoryRejection(new Error('synthetic failure')))
      .toBe(false);
    expect(isDefinitiveMemberDirectoryRejection(accessor)).toBe(false);
    expect(isDefinitiveMemberDirectoryRejection(hostile)).toBe(false);
  });
});

describe('MEMBERS-DIRECTORY-001K saved WebP response boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getFunctions as jest.Mock).mockReturnValue({ name: 'synthetic-functions' });
  });

  test.each([
    ['the exact 12-byte structural envelope', webPEnvelope(12)],
    ['the exact 65,536-byte response limit', webPEnvelope(64 * 1024)],
  ])('accepts %s', async (_label, base64Data) => {
    const response = profileWithPhoto(base64Data);
    const callable = jest.fn().mockResolvedValue({ data: response });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(getMyMemberDirectoryProfile(app)).resolves.toEqual(response);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['empty bytes', ''],
    ['a truncated 11-byte envelope', btoa(`RIFF${'\0'.repeat(4)}WEB`)],
    ['the wrong RIFF marker', btoa(`NOPE${'\0'.repeat(4)}WEBP`)],
    ['the wrong WEBP marker', btoa(`RIFF${'\0'.repeat(4)}NOPE`)],
    ['non-canonical base64', 'Zh=='],
    ['a 65,537-byte response', webPEnvelope((64 * 1024) + 1)],
  ])('rejects %s with the fixed response error', async (_label, base64Data) => {
    const callable = jest.fn().mockResolvedValue({
      data: profileWithPhoto(base64Data),
    });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
  });

  test.each([
    ['the wrong returned MIME type', { ...PHOTO, contentType: 'image/png' }],
    ['the wrong width', { ...PHOTO, width: 255 }],
    ['the wrong height', { ...PHOTO, height: 255 }],
    ['an uppercase version', { ...PHOTO, version: REQUEST_ID.toUpperCase() }],
    ['an extra field', { ...PHOTO, providerDetail: 'not allowed' }],
  ])('preserves exact photo validation for %s', async (_label, photo) => {
    const callable = jest.fn().mockResolvedValue({
      data: { ...PROFILE, photo },
    });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
  });

  test('rejects returned photo prototypes, accessors, and hostile objects generically', async () => {
    const prototypePhoto = Object.assign(Object.create(null), PHOTO);
    const accessorPhoto = { ...PHOTO } as Record<string, unknown>;
    Object.defineProperty(accessorPhoto, 'base64Data', {
      enumerable: true,
      get: () => PHOTO_BYTES,
    });
    const hostilePhoto = new Proxy({}, {
      ownKeys() {
        throw new Error('synthetic-provider-canary');
      },
    });
    const callable = jest.fn()
      .mockResolvedValueOnce({ data: { ...PROFILE, photo: prototypePhoto } })
      .mockResolvedValueOnce({ data: { ...PROFILE, photo: accessorPhoto } })
      .mockResolvedValueOnce({ data: { ...PROFILE, photo: hostilePhoto } });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
    await expect(getMyMemberDirectoryProfile(app))
      .rejects.toThrow('Invalid member directory response.');
  });

  test('preserves canonical non-RIFF outbound WebP upload bytes unchanged', async () => {
    const base64Data = btoa('canonical outbound WebP bytes without a RIFF marker');
    const request = {
      requestId: REQUEST_ID,
      expectedRevision: 2,
      contentType: 'image/webp' as const,
      base64Data,
    };
    const callable = jest.fn().mockResolvedValue({ data: MUTATION_STATE });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(setMyMemberDirectoryPhoto(app, request))
      .resolves.toEqual(MUTATION_STATE);
    expect(callable).toHaveBeenCalledWith(request);
  });

  test('keeps mislabeled saved bytes out of the actual Account photo DOM', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: profileWithPhoto(btoa(`NOPE${'\0'.repeat(4)}WEBP`)),
    });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    render(React.createElement(MemberDirectoryProfile, {
      app,
      uid: 'synthetic-member',
      displayName: 'Synthetic Member',
      backendAvailable: true,
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not load your profile photo and officer finder settings.',
    );
    expect(screen.queryByRole('img', {
      name: 'Your current profile thumbnail',
    })).not.toBeInTheDocument();
    expect(document.querySelector('img[src^="data:image/webp;base64,"]'))
      .not.toBeInTheDocument();
    expect(httpsCallable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  test('keeps the byte-free fallback and Remove after browser decode failure', async () => {
    const base64Data = webPEnvelope(12);
    const callable = jest.fn().mockResolvedValue({
      data: profileWithPhoto(base64Data),
    });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    render(React.createElement(MemberDirectoryProfile, {
      app,
      uid: 'synthetic-member',
      displayName: 'Synthetic Member',
      backendAvailable: true,
    }));

    const image = await screen.findByRole('img', {
      name: 'Your current profile thumbnail',
    });
    expect(image).toHaveAttribute(
      'src',
      `data:image/webp;base64,${base64Data}`,
    );

    fireEvent.error(image);

    await waitFor(() => expect(screen.getByRole('img', {
      name: 'Saved profile photo could not be displayed',
    })).toHaveTextContent('Photo unavailable'));
    expect(document.querySelector('img[src^="data:image/webp;base64,"]'))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Remove current saved photo',
    })).toBeEnabled();
    expect(httpsCallable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  test('keeps the default unavailable preview free of context, IDs, and calls', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const randomUUID = jest.fn(() => REQUEST_ID);
    const getRandomValues = jest.fn((bytes: Uint8Array) => bytes);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues, randomUUID },
    });
    try {
      render(React.createElement(MemberDirectoryProfile, {
        app: null as any,
        uid: '',
        displayName: null,
      }));

      expect(screen.getByText('Interface preview — not connected yet.'))
        .toBeInTheDocument();
      expect(randomUUID).not.toHaveBeenCalled();
      expect(getRandomValues).not.toHaveBeenCalled();
      expect(getFunctions).not.toHaveBeenCalled();
      expect(httpsCallable).not.toHaveBeenCalled();
    } finally {
      if (originalCrypto) {
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
      } else {
        delete (globalThis as { crypto?: Crypto }).crypto;
      }
    }
  });
});
