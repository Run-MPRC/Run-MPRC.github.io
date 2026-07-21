'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./membersContentAccess');
const {
  membersContentSchemaVersion,
  AuthState,
  MembershipStatus,
  DiscountStatus,
  AccessDecision,
  AccessGrantReason,
  AccessDenialReason,
  MEMBER_VISIBLE_FIELDS,
  projectMemberDiscounts,
} = mod;

// ---- fixtures ------------------------------------------------------------

const NOW = '2026-07-21T12:00:00Z';
const FUTURE = '2026-12-31T23:59:59Z';
const PAST = '2026-01-01T00:00:00Z';
const JUST_AFTER = '2026-07-21T12:00:01Z';

function member(overrides = {}) {
  return {
    membersContentSchemaVersion: 1,
    authState: 'signed_in',
    emailVerified: true,
    membershipStatus: 'active',
    membershipExpiresAt: FUTURE,
    contentAdmin: false,
    asOf: NOW,
    ...overrides,
  };
}

function admin(overrides = {}) {
  return member({ membershipStatus: 'none', membershipExpiresAt: null, contentAdmin: true, ...overrides });
}

function discount(overrides = {}) {
  return {
    discountId: 'disc.gym.001',
    status: 'published',
    title: '20% off running shoes',
    terms: 'One redemption per member per month',
    redemption: 'Show your member card at checkout',
    expiresAt: FUTURE,
    sourceOwner: 'ops-owner-internal',
    lastReviewedAt: PAST,
    ...overrides,
  };
}

function catalog(rows) {
  return { membersContentSchemaVersion: 1, rows };
}

const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const rawSource = fs.readFileSync(path.join(__dirname, 'membersContentAccess.js'), 'utf8');
const sourceCode = codeOnly(rawSource);

// ---- 1. frozen surface & enums ------------------------------------------

describe('frozen surface & enums', () => {
  test('schema version is 1', () => {
    expect(membersContentSchemaVersion).toBe(1);
  });

  test('module is frozen', () => {
    expect(Object.isFrozen(mod)).toBe(true);
  });

  test('projectMemberDiscounts is a function', () => {
    expect(typeof projectMemberDiscounts).toBe('function');
  });

  test('AuthState is complete and frozen', () => {
    expect(Object.isFrozen(AuthState)).toBe(true);
    expect(new Set(Object.values(AuthState))).toEqual(new Set(['anonymous', 'signed_in']));
  });

  test('MembershipStatus is complete and frozen', () => {
    expect(Object.isFrozen(MembershipStatus)).toBe(true);
    expect(new Set(Object.values(MembershipStatus)))
      .toEqual(new Set(['none', 'pending', 'active', 'expired', 'revoked']));
  });

  test('DiscountStatus is complete and frozen', () => {
    expect(Object.isFrozen(DiscountStatus)).toBe(true);
    expect(new Set(Object.values(DiscountStatus))).toEqual(new Set(['draft', 'published', 'archived']));
  });

  test('AccessDecision is complete and frozen', () => {
    expect(Object.isFrozen(AccessDecision)).toBe(true);
    expect(new Set(Object.values(AccessDecision))).toEqual(new Set(['granted', 'denied']));
  });

  test('grant and denial reason vocabularies are complete and frozen', () => {
    expect(Object.isFrozen(AccessGrantReason)).toBe(true);
    expect(new Set(Object.values(AccessGrantReason))).toEqual(new Set(['member', 'content_admin']));
    expect(Object.isFrozen(AccessDenialReason)).toBe(true);
    expect(new Set(Object.values(AccessDenialReason))).toEqual(new Set([
      'malformed_principal', 'malformed_catalog', 'not_signed_in',
      'not_verified', 'membership_inactive', 'membership_expired',
    ]));
  });

  test('MEMBER_VISIBLE_FIELDS is the exact allowlist, frozen, and omits internal fields', () => {
    expect(Object.isFrozen(MEMBER_VISIBLE_FIELDS)).toBe(true);
    expect(MEMBER_VISIBLE_FIELDS).toEqual(['discountId', 'title', 'terms', 'redemption', 'expiresAt']);
    expect(MEMBER_VISIBLE_FIELDS).not.toContain('status');
    expect(MEMBER_VISIBLE_FIELDS).not.toContain('sourceOwner');
    expect(MEMBER_VISIBLE_FIELDS).not.toContain('lastReviewedAt');
  });
});

// ---- 2. happy-path grants -----------------------------------------------

describe('happy-path grants', () => {
  test('a verified, active, unexpired member is granted with reason member', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount()]));
    expect(verdict.decision).toBe('granted');
    expect(verdict.reason).toBe('member');
    expect(verdict.asOf).toBe(NOW);
    expect(verdict.discountCount).toBe(1);
    expect(verdict.discounts).toHaveLength(1);
  });

  test('a granted discount carries exactly the member-visible fields', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount()]));
    const row = verdict.discounts[0];
    expect(Object.keys(row).sort()).toEqual([...MEMBER_VISIBLE_FIELDS].sort());
    expect(row).toEqual({
      discountId: 'disc.gym.001',
      title: '20% off running shoes',
      terms: 'One redemption per member per month',
      redemption: 'Show your member card at checkout',
      expiresAt: FUTURE,
    });
  });

  test('internal fields (status, sourceOwner, lastReviewedAt) are absent from the projection', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount()]));
    const row = verdict.discounts[0];
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('sourceOwner');
    expect(row).not.toHaveProperty('lastReviewedAt');
  });

  test('an evergreen (null-expiry) active membership is granted', () => {
    const verdict = projectMemberDiscounts(member({ membershipExpiresAt: null }), catalog([discount()]));
    expect(verdict.decision).toBe('granted');
    expect(verdict.reason).toBe('member');
  });

  test('a content admin with no membership is granted with reason content_admin', () => {
    const verdict = projectMemberDiscounts(admin(), catalog([discount()]));
    expect(verdict.decision).toBe('granted');
    expect(verdict.reason).toBe('content_admin');
    expect(verdict.discountCount).toBe(1);
  });

  test('a principal who is both an active member and an admin is labelled member', () => {
    const verdict = projectMemberDiscounts(member({ contentAdmin: true }), catalog([discount()]));
    expect(verdict.reason).toBe('member');
  });

  test('an empty catalog grants an empty view', () => {
    const verdict = projectMemberDiscounts(member(), catalog([]));
    expect(verdict.decision).toBe('granted');
    expect(verdict.discountCount).toBe(0);
    expect(verdict.discounts).toEqual([]);
  });

  test('multiple published rows are projected in input order', () => {
    const rows = [
      discount({ discountId: 'a' }),
      discount({ discountId: 'b' }),
      discount({ discountId: 'c' }),
    ];
    const verdict = projectMemberDiscounts(member(), catalog(rows));
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['a', 'b', 'c']);
  });

  test('the granted verdict, its discounts array, and each row are frozen', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount()]));
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.discounts)).toBe(true);
    expect(Object.isFrozen(verdict.discounts[0])).toBe(true);
  });

  test('mutating a returned row is a no-op under a fresh call', () => {
    const first = projectMemberDiscounts(member(), catalog([discount()]));
    try { first.discounts[0].title = 'tampered'; } catch (_e) { /* frozen */ }
    const second = projectMemberDiscounts(member(), catalog([discount()]));
    expect(second.discounts[0].title).toBe('20% off running shoes');
  });
});

// ---- 3. row filtering in the projection ---------------------------------

describe('row filtering', () => {
  test.each([
    ['draft', 'draft'],
    ['archived', 'archived'],
  ])('a %s row is excluded from the view', (_label, status) => {
    const verdict = projectMemberDiscounts(member(), catalog([discount({ status })]));
    expect(verdict.discountCount).toBe(0);
  });

  test('an expired discount (expiresAt at/before asOf) is excluded', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount({ expiresAt: PAST })]));
    expect(verdict.discountCount).toBe(0);
  });

  test('a discount expiring exactly at asOf is excluded (exclusive boundary)', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount({ expiresAt: NOW })]));
    expect(verdict.discountCount).toBe(0);
  });

  test('a discount expiring one second after asOf is included', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount({ expiresAt: JUST_AFTER })]));
    expect(verdict.discountCount).toBe(1);
  });

  test('an evergreen (null-expiry) published discount is included', () => {
    const verdict = projectMemberDiscounts(member(), catalog([discount({ expiresAt: null })]));
    expect(verdict.discountCount).toBe(1);
    expect(verdict.discounts[0].expiresAt).toBeNull();
  });

  test('a mixed catalog yields only published, unexpired rows in order', () => {
    const rows = [
      discount({ discountId: 'keep1' }),
      discount({ discountId: 'draft', status: 'draft' }),
      discount({ discountId: 'archived', status: 'archived' }),
      discount({ discountId: 'expired', expiresAt: PAST }),
      discount({ discountId: 'keep2', expiresAt: null }),
    ];
    const verdict = projectMemberDiscounts(member(), catalog(rows));
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['keep1', 'keep2']);
  });

  test('a distinctive internal source-owner value never appears in the granted output', () => {
    const marker = 'SOURCE-OWNER-LEAK-9999';
    const verdict = projectMemberDiscounts(member(), catalog([discount({ sourceOwner: marker })]));
    expect(JSON.stringify(verdict)).not.toContain(marker);
  });
});

// ---- 4. access denials (withhold-by-default) ----------------------------

describe('access denials', () => {
  test('an anonymous principal is denied not_signed_in even with member-shaped fields', () => {
    const verdict = projectMemberDiscounts(member({ authState: 'anonymous' }), catalog([discount()]));
    expect(verdict).toEqual({ decision: 'denied', reason: 'not_signed_in' });
  });

  test('a signed-in but unverified principal is denied not_verified', () => {
    const verdict = projectMemberDiscounts(member({ emailVerified: false }), catalog([discount()]));
    expect(verdict.reason).toBe('not_verified');
  });

  test.each(['none', 'pending', 'expired', 'revoked'])(
    'a verified principal with membershipStatus %s (non-admin) is denied membership_inactive',
    (membershipStatus) => {
      const verdict = projectMemberDiscounts(
        member({ membershipStatus, membershipExpiresAt: membershipStatus === 'none' ? null : FUTURE }),
        catalog([discount()]),
      );
      expect(verdict.reason).toBe('membership_inactive');
    },
  );

  test('an active membership past its expiry is denied membership_expired', () => {
    const verdict = projectMemberDiscounts(member({ membershipExpiresAt: PAST }), catalog([discount()]));
    expect(verdict.reason).toBe('membership_expired');
  });

  test('an active membership expiring exactly at asOf is denied membership_expired (boundary)', () => {
    const verdict = projectMemberDiscounts(member({ membershipExpiresAt: NOW }), catalog([discount()]));
    expect(verdict.reason).toBe('membership_expired');
  });

  test('an active membership expiring one second after asOf is granted (boundary)', () => {
    const verdict = projectMemberDiscounts(member({ membershipExpiresAt: JUST_AFTER }), catalog([discount()]));
    expect(verdict.decision).toBe('granted');
  });

  test.each(['none', 'pending', 'expired', 'revoked'])(
    'a content admin overrides membershipStatus %s and is granted',
    (membershipStatus) => {
      const verdict = projectMemberDiscounts(
        admin({ membershipStatus, membershipExpiresAt: null }),
        catalog([discount()]),
      );
      expect(verdict.decision).toBe('granted');
      expect(verdict.reason).toBe('content_admin');
    },
  );

  test('a content admin overrides a date-expired membership', () => {
    const verdict = projectMemberDiscounts(
      member({ contentAdmin: true, membershipExpiresAt: PAST }),
      catalog([discount()]),
    );
    expect(verdict.decision).toBe('granted');
    expect(verdict.reason).toBe('content_admin');
  });

  test('every denial carries exactly a decision and a reason, and no content', () => {
    const verdict = projectMemberDiscounts(member({ authState: 'anonymous' }), catalog([discount()]));
    expect(Object.keys(verdict).sort()).toEqual(['decision', 'reason']);
    expect(verdict).not.toHaveProperty('discounts');
  });

  test('a denial to a principal facing a rich catalog leaks no discount content', () => {
    const marker = 'TITLE-LEAK-MARKER-7777';
    const verdict = projectMemberDiscounts(
      member({ membershipStatus: 'revoked', membershipExpiresAt: FUTURE }),
      catalog([discount({ title: marker }), discount({ terms: marker })]),
    );
    expect(verdict.decision).toBe('denied');
    expect(JSON.stringify(verdict)).not.toContain(marker);
  });
});

// ---- 5. precedence: access decided before catalog -----------------------

describe('access decided before catalog', () => {
  test.each([
    ['anonymous principal', member({ authState: 'anonymous' }), 'not_signed_in'],
    ['unverified principal', member({ emailVerified: false }), 'not_verified'],
    ['inactive member', member({ membershipStatus: 'revoked' }), 'membership_inactive'],
  ])('%s with a malformed catalog is denied on access, not on catalog', (_label, principal, reason) => {
    const verdict = projectMemberDiscounts(principal, { rubbish: true });
    expect(verdict.reason).toBe(reason);
  });
});

// ---- 6. malformed principal ---------------------------------------------

describe('malformed principal is denied malformed_principal', () => {
  const cat = catalog([discount()]);

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'signed_in'],
    ['an array', [1, 2, 3]],
    ['a boolean', true],
  ])('%s', (_label, value) => {
    expect(projectMemberDiscounts(value, cat)).toEqual({ decision: 'denied', reason: 'malformed_principal' });
  });

  test('a Proxy over a valid principal', () => {
    const proxied = new Proxy(member(), {});
    expect(projectMemberDiscounts(proxied, cat).reason).toBe('malformed_principal');
  });

  test('a foreign-prototype principal', () => {
    const base = member();
    const foreign = Object.assign(Object.create({ inherited: 1 }), base);
    expect(projectMemberDiscounts(foreign, cat).reason).toBe('malformed_principal');
  });

  test('a null-prototype principal', () => {
    const nullProto = Object.assign(Object.create(null), member());
    expect(projectMemberDiscounts(nullProto, cat).reason).toBe('malformed_principal');
  });

  test('a principal missing a required key', () => {
    const p = member();
    delete p.asOf;
    expect(projectMemberDiscounts(p, cat).reason).toBe('malformed_principal');
  });

  test('a principal with an extra key', () => {
    expect(projectMemberDiscounts(member({ extra: 1 }), cat).reason).toBe('malformed_principal');
  });

  test('a principal with a symbol key', () => {
    const p = member();
    p[Symbol('x')] = 1;
    expect(projectMemberDiscounts(p, cat).reason).toBe('malformed_principal');
  });

  test('a principal whose field is a getter — the getter is never invoked', () => {
    let invoked = false;
    const p = member();
    delete p.contentAdmin;
    Object.defineProperty(p, 'contentAdmin', { enumerable: true, configurable: true, get() { invoked = true; return true; } });
    expect(projectMemberDiscounts(p, cat).reason).toBe('malformed_principal');
    expect(invoked).toBe(false);
  });

  test('a principal with a non-enumerable field', () => {
    const p = member();
    delete p.emailVerified;
    Object.defineProperty(p, 'emailVerified', { enumerable: false, value: true });
    expect(projectMemberDiscounts(p, cat).reason).toBe('malformed_principal');
  });

  test.each([
    ['wrong schema version 0', { membersContentSchemaVersion: 0 }],
    ['wrong schema version 2', { membersContentSchemaVersion: 2 }],
    ['string schema version', { membersContentSchemaVersion: '1' }],
    ['authState off-enum', { authState: 'guest' }],
    ['authState non-string', { authState: 1 }],
    ['emailVerified truthy non-boolean', { emailVerified: 1 }],
    ['emailVerified string', { emailVerified: 'true' }],
    ['membershipStatus off-enum', { membershipStatus: 'gold' }],
    ['membershipExpiresAt malformed', { membershipExpiresAt: '2026-13-01T00:00:00Z' }],
    ['membershipExpiresAt number', { membershipExpiresAt: 1 }],
    ['membershipExpiresAt non-UTC string', { membershipExpiresAt: 'soon' }],
    ['contentAdmin non-boolean', { contentAdmin: 'yes' }],
    ['asOf null', { asOf: null }],
    ['asOf malformed', { asOf: '2026-07-21 12:00:00' }],
    ['asOf out-of-range hour', { asOf: '2026-07-21T24:00:00Z' }],
  ])('%s', (_label, overrides) => {
    expect(projectMemberDiscounts(member(overrides), cat).reason).toBe('malformed_principal');
  });
});

// ---- 7. malformed catalog (entitled principal) --------------------------

describe('malformed catalog (entitled principal) is denied malformed_catalog', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['an array as the catalog', [discount()]],
  ])('%s', (_label, value) => {
    expect(projectMemberDiscounts(member(), value)).toEqual({ decision: 'denied', reason: 'malformed_catalog' });
  });

  test('a Proxy over a valid catalog', () => {
    const proxied = new Proxy(catalog([discount()]), {});
    expect(projectMemberDiscounts(member(), proxied).reason).toBe('malformed_catalog');
  });

  test('a foreign-prototype catalog', () => {
    const foreign = Object.assign(Object.create({ inherited: 1 }), catalog([]));
    expect(projectMemberDiscounts(member(), foreign).reason).toBe('malformed_catalog');
  });

  test('wrong schema version', () => {
    expect(projectMemberDiscounts(member(), { membersContentSchemaVersion: 2, rows: [] }).reason)
      .toBe('malformed_catalog');
  });

  test.each([
    ['rows is an object', {}],
    ['rows is null', null],
    ['rows is a string', 'x'],
    ['rows is a number', 3],
  ])('%s', (_label, rows) => {
    expect(projectMemberDiscounts(member(), { membersContentSchemaVersion: 1, rows }).reason)
      .toBe('malformed_catalog');
  });

  test('an extra key on the catalog', () => {
    const c = catalog([]);
    c.extra = 1;
    expect(projectMemberDiscounts(member(), c).reason).toBe('malformed_catalog');
  });

  test('a missing key on the catalog', () => {
    expect(projectMemberDiscounts(member(), { rows: [] }).reason).toBe('malformed_catalog');
  });

  test('a symbol key on the catalog', () => {
    const c = catalog([]);
    c[Symbol('x')] = 1;
    expect(projectMemberDiscounts(member(), c).reason).toBe('malformed_catalog');
  });

  test('a catalog whose rows field is a getter — the getter is never invoked', () => {
    let invoked = false;
    const c = { membersContentSchemaVersion: 1 };
    Object.defineProperty(c, 'rows', { enumerable: true, configurable: true, get() { invoked = true; return []; } });
    expect(projectMemberDiscounts(member(), c).reason).toBe('malformed_catalog');
    expect(invoked).toBe(false);
  });

  test('more rows than the row limit', () => {
    const rows = new Array(4097).fill(0).map((_v, i) => discount({ discountId: `d${i}` }));
    expect(projectMemberDiscounts(member(), catalog(rows)).reason).toBe('malformed_catalog');
  });
});

// ---- 8. malformed rows are withheld, not leaked or fatal -----------------

describe('malformed rows are silently withheld from the view', () => {
  function countWith(badRow) {
    const rows = [discount({ discountId: 'good1' }), badRow, discount({ discountId: 'good2' })];
    const verdict = projectMemberDiscounts(member(), catalog(rows));
    expect(verdict.decision).toBe('granted');
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['good1', 'good2']);
    return verdict;
  }

  test.each([
    ['null row', null],
    ['undefined row', undefined],
    ['a number row', 5],
    ['an array row', []],
    ['a proxy row', new Proxy(discount(), {})],
    ['a foreign-prototype row', Object.assign(Object.create({ z: 1 }), discount())],
    ['a missing-key row', (() => { const d = discount(); delete d.terms; return d; })()],
    ['an extra-key row', discount({ surprise: 1 })],
    ['a bad discountId (empty)', discount({ discountId: '' })],
    ['a bad discountId (spaces)', discount({ discountId: 'has spaces' })],
    ['a non-string discountId', discount({ discountId: 5 })],
    ['a bad status enum', discount({ status: 'live' })],
    ['a non-string title', discount({ title: 5 })],
    ['an empty title', discount({ title: '' })],
    ['a control char in title', discount({ title: 'ok\u0001bad' })],
    ['a line separator in terms', discount({ terms: 'a\u2028b' })],
    ['an over-long redemption', discount({ redemption: 'x'.repeat(4097) })],
    ['a bad expiresAt shape', discount({ expiresAt: 'whenever' })],
    ['a non-UTC lastReviewedAt', discount({ lastReviewedAt: 'yesterday' })],
    ['a missing sourceOwner', (() => { const d = discount(); delete d.sourceOwner; d.other = 1; return d; })()],
  ])('%s is dropped while good rows survive', (_label, badRow) => {
    countWith(badRow);
  });

  test('a hole in the rows array is skipped', () => {
    const rows = [discount({ discountId: 'good1' })];
    rows[2] = discount({ discountId: 'good2' }); // index 1 is a hole
    const verdict = projectMemberDiscounts(member(), catalog(rows));
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['good1', 'good2']);
  });

  test('a row whose field is a getter is dropped without invoking the getter', () => {
    let invoked = false;
    const bad = discount();
    delete bad.title;
    Object.defineProperty(bad, 'title', { enumerable: true, configurable: true, get() { invoked = true; return 'x'; } });
    const verdict = projectMemberDiscounts(member(), catalog([discount({ discountId: 'good' }), bad]));
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['good']);
    expect(invoked).toBe(false);
  });

  test('an all-malformed catalog grants an empty view rather than throwing', () => {
    const verdict = projectMemberDiscounts(member(), catalog([null, 5, discount({ status: 'draft' })]));
    expect(verdict.decision).toBe('granted');
    expect(verdict.discountCount).toBe(0);
  });
});

// ---- 9. determinism, sharing, non-echo ----------------------------------

describe('determinism, sharing, non-echo', () => {
  test('identical inputs yield deep-equal verdicts', () => {
    const a = projectMemberDiscounts(member(), catalog([discount()]));
    const b = projectMemberDiscounts(member(), catalog([discount()]));
    expect(a).toEqual(b);
  });

  test('denial verdicts are shared frozen singletons across calls', () => {
    const a = projectMemberDiscounts(member({ authState: 'anonymous' }), catalog([]));
    const b = projectMemberDiscounts(member({ authState: 'anonymous' }), catalog([]));
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('distinct denial reasons are distinct singletons', () => {
    const notSignedIn = projectMemberDiscounts(member({ authState: 'anonymous' }), catalog([]));
    const notVerified = projectMemberDiscounts(member({ emailVerified: false }), catalog([]));
    expect(notSignedIn).not.toBe(notVerified);
  });
});

// ---- 9b. adversarial-review regressions: total & getter-free on hostile inputs ----

describe('hostile proxy / accessor inputs never throw and never invoke getters', () => {
  test('a revoked proxy principal is denied malformed_principal without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = projectMemberDiscounts(proxy, catalog([discount()])); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_principal' });
  });

  test('a revoked proxy catalog is denied malformed_catalog without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = projectMemberDiscounts(member(), proxy); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_catalog' });
  });

  test('a revoked proxy rows container is denied malformed_catalog without throwing', () => {
    const { proxy, revoke } = Proxy.revocable([discount()], {});
    revoke();
    let verdict;
    expect(() => { verdict = projectMemberDiscounts(member(), catalog(proxy)); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_catalog' });
  });

  test('a live proxy rows container is denied malformed_catalog without firing any trap', () => {
    const trap = () => { throw new Error('rows-container trap must never fire'); };
    const rowsProxy = new Proxy([discount()], { get: trap, has: trap, ownKeys: trap });
    const verdict = projectMemberDiscounts(member(), catalog(rowsProxy));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_catalog' });
  });

  test('a revoked proxy row element is withheld while valid rows are still granted', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => {
      verdict = projectMemberDiscounts(member(), catalog([proxy, discount({ discountId: 'disc.valid.002' })]));
    }).not.toThrow();
    expect(verdict.decision).toBe('granted');
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['disc.valid.002']);
  });

  test('an accessor property at a rows index is skipped without invoking its getter', () => {
    let fired = false;
    const rows = [discount({ discountId: 'disc.valid.001' })];
    Object.defineProperty(rows, 1, {
      get() { fired = true; return discount({ discountId: 'disc.trap.001' }); },
      enumerable: true,
      configurable: true,
    });
    const verdict = projectMemberDiscounts(member(), catalog(rows));
    expect(fired).toBe(false);
    expect(verdict.decision).toBe('granted');
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['disc.valid.001']);
  });

  test('a throwing accessor at a rows index never throws out of the resolver', () => {
    const rows = [discount({ discountId: 'disc.valid.003' })];
    Object.defineProperty(rows, 1, {
      get() { throw new Error('row-index getter must never be invoked'); },
      enumerable: true,
      configurable: true,
    });
    let verdict;
    expect(() => { verdict = projectMemberDiscounts(member(), catalog(rows)); }).not.toThrow();
    expect(verdict.discounts.map((d) => d.discountId)).toEqual(['disc.valid.003']);
  });
});

// ---- 10. source boundary (comment-stripped) -----------------------------

describe('source boundary', () => {
  test.each([
    ['process.env', /process\.env/],
    ['Date.now', /Date\.now/],
    ['new Date', /new Date/],
    ['Math.random', /Math\.random/],
    ['console.', /console\./],
    ['fetch(', /fetch\(/],
    ['url scheme', /https?:/],
    ['firebase', /firebase/i],
    ['firestore', /firestore/i],
    ['stripe', /stripe/i],
  ])('code contains no %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test.each([
    ['phone', /phone/i],
    ['address', /address/i],
    ['dob', /\bdob\b/i],
    ['ssn', /\bssn\b/i],
    ['secret', /secret/i],
    ['token', /\btoken\b/i],
    ['password', /password/i],
    ['bearer', /bearer/i],
    ['api key', /api[_-]?key/i],
    ['invite', /invite/i],
    ['roster', /roster/i],
  ])('code names no %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test.each([
    ['innerHTML', /innerHTML/i],
    ['dangerouslySet', /dangerouslySet/i],
  ])('code has no HTML sink %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test('module requires only node:util', () => {
    expect(rawSource.match(/require\(([^)]*)\)/g)).toEqual(["require('node:util')"]);
  });

  test('header names the issue code', () => {
    expect(rawSource).toContain('MEMBERS-CONTENT-001A');
  });

  test('functions/index.js does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membersContentAccess');
  });
});
