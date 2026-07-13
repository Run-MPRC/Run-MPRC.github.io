/* eslint-env jest */

import {
  doc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  ensureMyProfile,
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

  test('writes only normalized name, phone, and a server timestamp', async () => {
    await updateMyProfile(firestore, 'synthetic-user', {
      fullName: '  Synthetic Member  ',
      phoneNumber: '  555-0100  ',
    });

    expect(doc).toHaveBeenCalledWith(firestore, 'members', 'synthetic-user');
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'members/synthetic-user' },
      {
        fullName: 'Synthetic Member',
        phoneNumber: '555-0100',
        updatedAt: { __serverTimestamp: true },
      },
    );
    expect(serverTimestamp).toHaveBeenCalledTimes(1);
  });

  test('accepts the exact 200 and 40 unit boundaries, including emoji', async () => {
    const fullName = '🏃'.repeat(100);
    const phoneNumber = '📞'.repeat(20);

    expect(validateMemberProfileFields({ fullName, phoneNumber })).toEqual({
      valid: true,
      fields: { fullName, phoneNumber },
    });
    await expect(updateMyProfile(
      firestore,
      'synthetic-user',
      { fullName, phoneNumber },
    )).resolves.toBeUndefined();
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['an ASCII name', { fullName: 'n'.repeat(201), phoneNumber: '' }, 'Full name'],
    ['an emoji name', { fullName: '🏃'.repeat(101), phoneNumber: '' }, 'Full name'],
    ['an ASCII phone', { fullName: '', phoneNumber: '1'.repeat(41) }, 'Phone'],
    ['an emoji phone', { fullName: '', phoneNumber: '📞'.repeat(21) }, 'Phone'],
  ])('rejects %s over the Rules limit before Firestore', async (_label, fields, field) => {
    await expect(updateMyProfile(firestore, 'synthetic-user', fields))
      .rejects.toThrow(`${field} must be`);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(serverTimestamp).not.toHaveBeenCalled();
  });
});
