const {
  resolveVerifiedCallerRole,
  isVerifiedAdmin,
} = require('./verifiedRolePolicy');

describe('verified caller role policy', () => {
  test.each([
    ['member', 'member'],
    ['admin', 'admin'],
  ])('accepts exact verified %s claims', (role, expected) => {
    const claims = Object.freeze({
      uid: 'synthetic-user',
      email_verified: true,
      role,
      unrelated: 'preserved',
    });

    expect(resolveVerifiedCallerRole(claims)).toBe(expected);
    expect(claims.unrelated).toBe('preserved');
  });

  test.each([
    ['missing', undefined],
    ['false', false],
    ['null', null],
    ['string true', 'true'],
    ['one', 1],
    ['array', [true]],
    ['object', { value: true }],
  ])('rejects %s email verification', (_name, emailVerified) => {
    const claims = { role: 'admin' };
    if (emailVerified !== undefined) claims.email_verified = emailVerified;

    expect(resolveVerifiedCallerRole(claims)).toBeNull();
    expect(isVerifiedAdmin(claims)).toBe(false);
  });

  test('rejects a profile-style verification field', () => {
    expect(resolveVerifiedCallerRole({
      role: 'admin',
      emailVerified: true,
    })).toBeNull();
  });

  test.each([
    ['missing', undefined],
    ['null', null],
    ['unknown', 'officer'],
    ['case changed', 'Admin'],
    ['empty', ''],
    ['number', 1],
    ['array', ['admin']],
  ])('rejects %s role claims', (_name, role) => {
    const claims = { email_verified: true };
    if (role !== undefined) claims.role = role;

    expect(resolveVerifiedCallerRole(claims)).toBeNull();
  });

  test('rejects inherited role or verification claims', () => {
    expect(resolveVerifiedCallerRole(Object.create({
      email_verified: true,
      role: 'admin',
    }))).toBeNull();

    const inheritedRole = Object.create({ role: 'admin' });
    inheritedRole.email_verified = true;
    expect(resolveVerifiedCallerRole(inheritedRole)).toBeNull();
  });

  test('rejects accessor-backed verification without invoking it', () => {
    const emailGetter = jest.fn(() => true);
    const claims = { role: 'admin' };
    Object.defineProperty(claims, 'email_verified', {
      enumerable: true,
      get: emailGetter,
    });

    expect(resolveVerifiedCallerRole(claims)).toBeNull();
    expect(emailGetter).not.toHaveBeenCalled();
  });

  test('rejects an accessor-backed role without invoking it', () => {
    const roleGetter = jest.fn(() => 'admin');
    const claims = { email_verified: true };
    Object.defineProperty(claims, 'role', {
      enumerable: true,
      get: roleGetter,
    });

    expect(resolveVerifiedCallerRole(claims)).toBeNull();
    expect(roleGetter).not.toHaveBeenCalled();
  });

  test('rejects both accessor-backed claims without invoking either', () => {
    const emailGetter = jest.fn(() => true);
    const roleGetter = jest.fn(() => 'admin');
    const claims = {};
    Object.defineProperties(claims, {
      email_verified: { enumerable: true, get: emailGetter },
      role: { enumerable: true, get: roleGetter },
    });

    expect(resolveVerifiedCallerRole(claims)).toBeNull();
    expect(emailGetter).not.toHaveBeenCalled();
    expect(roleGetter).not.toHaveBeenCalled();
  });

  test('rejects transparent and throwing proxies', () => {
    const target = { email_verified: true, role: 'admin' };
    const transparent = new Proxy(target, {});
    const throwing = new Proxy(target, {
      getOwnPropertyDescriptor() {
        throw new Error('hostile canary must remain private');
      },
    });

    expect(resolveVerifiedCallerRole(transparent)).toBeNull();
    expect(resolveVerifiedCallerRole(throwing)).toBeNull();
  });

  test.each([null, undefined, true, 'admin', 1, Symbol('claims')])(
    'rejects non-record claims %#',
    (claims) => {
      expect(resolveVerifiedCallerRole(claims)).toBeNull();
      expect(isVerifiedAdmin(claims)).toBe(false);
    },
  );

  test('admin helper never treats a verified member as admin', () => {
    expect(isVerifiedAdmin({ email_verified: true, role: 'member' })).toBe(false);
    expect(isVerifiedAdmin({ email_verified: true, role: 'admin' })).toBe(true);
  });
});
