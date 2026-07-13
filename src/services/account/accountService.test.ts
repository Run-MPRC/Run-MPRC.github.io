/* eslint-env jest */

import {
  doc, getDoc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  ensureMyProfile,
  getMyProfile,
  updateMyProfile,
  validateMemberProfileFields,
} from './accountService';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({ path: 'members/synthetic-user' })),
  getDoc: jest.fn(),
  updateDoc: jest.fn(),
  serverTimestamp: jest.fn(() => ({ __serverTimestamp: true })),
}));

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({ name: 'synthetic-functions' })),
  httpsCallable: jest.fn(),
}));

const firestore = { name: 'synthetic-firestore' } as any;
const app = { name: 'synthetic-app' } as any;

describe('account profile service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (doc as jest.Mock).mockReturnValue({ path: 'members/synthetic-user' });
    (serverTimestamp as jest.Mock).mockReturnValue({ __serverTimestamp: true });
    (getFunctions as jest.Mock).mockReturnValue({ name: 'synthetic-functions' });
    (updateDoc as jest.Mock).mockResolvedValue(undefined);
  });

  test('calls the profile bootstrap with an empty request and returns uniform readiness', async () => {
    const callable = jest.fn().mockResolvedValue({ data: { ready: true } });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(ensureMyProfile(app)).resolves.toEqual({ ready: true });

    expect(getFunctions).toHaveBeenCalledWith(app);
    expect(httpsCallable).toHaveBeenCalledWith(
      { name: 'synthetic-functions' },
      'ensureMemberProfile',
    );
    expect(callable).toHaveBeenCalledWith({});
  });

  test('omits the stored phone value from the returned My Account projection', async () => {
    (getDoc as jest.Mock).mockResolvedValue({
      exists: () => true,
      data: () => ({
        email: 'member@example.test',
        fullName: 'Synthetic Member',
        role: 'unverified',
        phoneNumber: 'synthetic-phone-canary',
        emailVerified: true,
        provider: 'password',
        createdAt: null,
        lastLogin: null,
        updatedAt: null,
      }),
    });

    const profile = await getMyProfile(firestore, 'synthetic-user');

    expect(profile).toEqual({
      uid: 'synthetic-user',
      email: 'member@example.test',
      fullName: 'Synthetic Member',
      role: 'unverified',
      emailVerified: true,
      provider: 'password',
      createdAt: null,
      lastLogin: null,
      updatedAt: null,
    });
    expect(profile).not.toHaveProperty('phoneNumber');
    expect(JSON.stringify(profile)).not.toContain('synthetic-phone-canary');
  });

  test('writes only normalized name and a server timestamp even for a legacy caller', async () => {
    const legacyFields = {
      fullName: '  Synthetic Member  ',
      phoneNumber: 'synthetic-phone-canary',
    } as any;

    await updateMyProfile(firestore, 'synthetic-user', legacyFields);

    expect(doc).toHaveBeenCalledWith(firestore, 'members', 'synthetic-user');
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'members/synthetic-user' },
      {
        fullName: 'Synthetic Member',
        updatedAt: { __serverTimestamp: true },
      },
    );
    expect(serverTimestamp).toHaveBeenCalledTimes(1);
  });

  test('accepts the exact 200-unit name boundary without validating phone data', async () => {
    const fullName = '🏃'.repeat(100);

    expect(validateMemberProfileFields({
      fullName,
      phoneNumber: 'synthetic-phone-canary',
    } as any)).toEqual({
      valid: true,
      fields: { fullName },
    });
    await expect(updateMyProfile(
      firestore,
      'synthetic-user',
      { fullName, phoneNumber: 'synthetic-phone-canary' } as any,
    )).resolves.toBeUndefined();
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['an ASCII name', { fullName: 'n'.repeat(201) }],
    ['an emoji name', { fullName: '🏃'.repeat(101) }],
  ])('rejects %s over the Rules limit before Firestore', async (_label, fields) => {
    await expect(updateMyProfile(firestore, 'synthetic-user', fields))
      .rejects.toThrow('Full name must be');
    expect(updateDoc).not.toHaveBeenCalled();
    expect(serverTimestamp).not.toHaveBeenCalled();
  });
});
