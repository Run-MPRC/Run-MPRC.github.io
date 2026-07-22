'use strict';

// Tests for §8.0h MEMBERS-DUES-001F `projectMemberAccountStatus` — the
// member-facing account/status DISPLAY projection (item 6 of #114). The module
// is SOURCE ONLY and imported by nothing; these tests exercise it directly.
//
// The centerpiece is the CONSISTENCY SEAM: every fixture's projected entitlement
// is proven equal to what the REAL shipped authority §8.0a
// `deriveMembershipEntitlement` derives from the same record — the by-construction
// proof that display never over-states authorization.

const fs = require('fs');
const path = require('path');

const {
  projectMemberAccountStatus,
  membershipAccountStatusSchemaVersion,
} = require('./membershipAccountStatusProjection');
// The real authority — composed here to prove the cross-module invariant, exactly
// as the membership-dues siblings feed their emitted command to the real reducer.
const {
  deriveMembershipEntitlement,
  membershipAuthoritySchemaVersion,
} = require('./membershipAuthority');

const V = membershipAccountStatusSchemaVersion; // 1
const AUTH_V = membershipAuthoritySchemaVersion; // 1

const UID = 'uid_member_001';
const OTHER_UID = 'uid_member_999';

const DAY = 86_400_000;
const STARTS = 1_700_000_000_000;
const ENDS = STARTS + 365 * DAY;
const WINDOW = 30 * DAY; // owner-configured "expiring soon" lead time

// ---- §8.0a record fixtures (revision-consistent so the real authority accepts) --
const linkedAssoc = Object.freeze({ state: 'linked', uid: UID, revision: 1 });
const otherAssoc = Object.freeze({ state: 'linked', uid: OTHER_UID, revision: 1 });
const unlinkedAssoc = Object.freeze({ state: 'unlinked', uid: null, revision: 0 });

const pendingTerm = Object.freeze({
  state: 'decision_pending',
  termId: null,
  startsAtMs: null,
  endsAtMs: null,
  planRef: null,
  evidenceRef: null,
  policyVersion: null,
  revision: 0,
});

function decidedTerm(state, startsAtMs, endsAtMs) {
  return {
    state,
    termId: 'term_0001',
    startsAtMs,
    endsAtMs,
    planRef: 'plan_annual',
    evidenceRef: 'ev_0001',
    policyVersion: 'policy_v1',
    revision: 1,
  };
}

function makeRecord({ association, term, revision, commandType, commandId }) {
  return {
    membershipAuthoritySchemaVersion: AUTH_V,
    membershipId: 'mem_0001',
    revision,
    association,
    term,
    lastCommand: { commandType, commandId, expectedRevision: revision - 1 },
  };
}

// linked + approved/suspended/ended term: revision 3, record_term_decision.
function decidedRecord(state, startsAtMs, endsAtMs, association = linkedAssoc) {
  return makeRecord({
    association,
    term: decidedTerm(state, startsAtMs, endsAtMs),
    revision: 3,
    commandType: 'record_term_decision',
    commandId: 'cmd_term',
  });
}
// linked + decision_pending term: revision 2, associate_account.
const pendingRecord = makeRecord({
  association: linkedAssoc,
  term: pendingTerm,
  revision: 2,
  commandType: 'associate_account',
  commandId: 'cmd_assoc',
});
// unlinked + decision_pending term: revision 1, create_membership.
const unlinkedRecord = makeRecord({
  association: unlinkedAssoc,
  term: pendingTerm,
  revision: 1,
  commandType: 'create_membership',
  commandId: 'cmd_create',
});
// unlinked + approved term: revision 2, record_term_decision.
const unlinkedApprovedRecord = makeRecord({
  association: unlinkedAssoc,
  term: decidedTerm('approved', STARTS, ENDS),
  revision: 2,
  commandType: 'record_term_decision',
  commandId: 'cmd_term_unlinked',
});

function input(record, asOfMs, uid = UID) {
  return { membershipAccountStatusSchemaVersion: V, record, uid, asOfMs };
}
function policy(renewalWindowMs) {
  return { membershipAccountStatusSchemaVersion: V, renewalWindowMs };
}

// ---- the decision matrix: named rows with the full expected verdict ---------
const ROWS = [
  {
    name: 'active (comfortably in window)',
    record: decidedRecord('approved', STARTS, ENDS),
    asOfMs: STARTS + 100 * DAY,
    window: WINDOW,
    status: 'active', entitlement: 'current_member',
    renewalOffered: false, activeThroughMs: ENDS,
  },
  {
    name: 'expiring_soon (within renewal window)',
    record: decidedRecord('approved', STARTS, ENDS),
    asOfMs: ENDS - 10 * DAY,
    window: WINDOW,
    status: 'expiring_soon', entitlement: 'current_member',
    renewalOffered: true, activeThroughMs: ENDS,
  },
  {
    name: 'upcoming (approved but not yet started — early renewal)',
    record: decidedRecord('approved', STARTS, ENDS),
    asOfMs: STARTS - 5 * DAY,
    window: WINDOW,
    status: 'upcoming', entitlement: 'not_entitled',
    renewalOffered: false, activeThroughMs: ENDS,
  },
  {
    name: 'expired (approved but window elapsed)',
    record: decidedRecord('approved', STARTS, ENDS),
    asOfMs: ENDS + 5 * DAY,
    window: WINDOW,
    status: 'expired', entitlement: 'not_entitled',
    renewalOffered: true, activeThroughMs: ENDS,
  },
  {
    name: 'suspended (refund/dispute clawback — even while in window)',
    record: decidedRecord('suspended', STARTS, ENDS),
    asOfMs: STARTS + 100 * DAY,
    window: WINDOW,
    status: 'suspended', entitlement: 'not_entitled',
    renewalOffered: false, activeThroughMs: null,
  },
  {
    name: 'ended (offboarded — even while in window)',
    record: decidedRecord('ended', STARTS, ENDS),
    asOfMs: STARTS + 100 * DAY,
    window: WINDOW,
    status: 'ended', entitlement: 'not_entitled',
    renewalOffered: false, activeThroughMs: null,
  },
  {
    name: 'pending (decision_pending term)',
    record: pendingRecord,
    asOfMs: STARTS + 100 * DAY,
    window: WINDOW,
    status: 'pending', entitlement: 'decision_pending',
    renewalOffered: false, activeThroughMs: null,
  },
  {
    name: 'none (unlinked association)',
    record: unlinkedRecord,
    asOfMs: STARTS + 100 * DAY,
    window: WINDOW,
    status: 'none', entitlement: 'not_entitled',
    renewalOffered: false, activeThroughMs: null,
  },
  {
    name: 'none (approved in-window term but no account association)',
    record: unlinkedApprovedRecord,
    asOfMs: STARTS + 100 * DAY,
    window: WINDOW,
    status: 'none', entitlement: 'not_entitled',
    renewalOffered: false, activeThroughMs: null,
  },
  {
    name: 'none (linked to a DIFFERENT uid — approved in-window, must NOT be active)',
    record: decidedRecord('approved', STARTS, ENDS, otherAssoc),
    asOfMs: STARTS + 100 * DAY,
    window: WINDOW,
    status: 'none', entitlement: 'not_entitled',
    renewalOffered: false, activeThroughMs: null,
  },
];

function verdictOf(row) {
  return projectMemberAccountStatus(input(row.record, row.asOfMs), policy(row.window));
}

describe('projectMemberAccountStatus — decision matrix', () => {
  test.each(ROWS)('$name', (row) => {
    expect(verdictOf(row)).toEqual({
      decision: 'projected',
      status: row.status,
      entitlement: row.entitlement,
      renewalOffered: row.renewalOffered,
      activeThroughMs: row.activeThroughMs,
    });
  });

  test('every display status in the matrix is covered', () => {
    const seen = new Set(ROWS.map((r) => r.status));
    for (const s of ['active', 'expiring_soon', 'upcoming', 'expired',
      'suspended', 'ended', 'pending', 'none']) {
      expect(seen.has(s)).toBe(true);
    }
  });
});

describe('the consistency seam — display never over-states authorization', () => {
  // Invariant 1, proven against the REAL §8.0a for every matrix row.
  test.each(ROWS)('projection.entitlement === deriveMembershipEntitlement for: $name', (row) => {
    const authority = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: AUTH_V,
      record: row.record,
      uid: UID,
      asOfMs: row.asOfMs,
    });
    const verdict = verdictOf(row);
    // the authority accepts every fixture (never throws) and the projection
    // echoes its entitlement verbatim
    expect(verdict.decision).toBe('projected');
    expect(verdict.entitlement).toBe(authority.entitlement);
    expect(verdict.entitlement).toBe(row.entitlement);
  });

  test('entitled-reading statuses map to current_member; the rest never do', () => {
    for (const row of ROWS) {
      const v = verdictOf(row);
      if (v.status === 'active' || v.status === 'expiring_soon') {
        expect(v.entitlement).toBe('current_member');
      } else {
        expect(v.entitlement).not.toBe('current_member');
      }
      if (v.status === 'pending') {
        expect(v.entitlement).toBe('decision_pending');
      }
      if (['upcoming', 'expired', 'suspended', 'ended', 'none'].includes(v.status)) {
        expect(v.entitlement).toBe('not_entitled');
      }
    }
  });

  test('a fuzzed sweep of instants never lets a not-current display read as entitled', () => {
    // Sweep asOf across the whole timeline for the approved/suspended/other-uid
    // records; for each, the projection's "entitled" reading must agree with the
    // real authority, never over-stating.
    const records = [
      decidedRecord('approved', STARTS, ENDS),
      decidedRecord('suspended', STARTS, ENDS),
      decidedRecord('ended', STARTS, ENDS),
      decidedRecord('approved', STARTS, ENDS, otherAssoc),
      pendingRecord,
      unlinkedRecord,
      unlinkedApprovedRecord,
    ];
    for (const record of records) {
      for (let k = -3; k <= 370; k += 7) {
        const asOfMs = STARTS + k * DAY;
        if (asOfMs < 0) continue;
        const authority = deriveMembershipEntitlement({
          membershipAuthoritySchemaVersion: AUTH_V, record, uid: UID, asOfMs,
        });
        const v = projectMemberAccountStatus(input(record, asOfMs), policy(WINDOW));
        expect(v.decision).toBe('projected');
        expect(v.entitlement).toBe(authority.entitlement);
        const readsEntitled = v.status === 'active' || v.status === 'expiring_soon';
        expect(readsEntitled).toBe(authority.entitlement === 'current_member');
      }
    }
  });
});

describe('invariant 2 — renewal offered only for a safe self-serve re-purchase', () => {
  test.each(ROWS)('renewalOffered iff status in {expiring_soon, expired}: $name', (row) => {
    const v = verdictOf(row);
    expect(v.renewalOffered).toBe(v.status === 'expiring_soon' || v.status === 'expired');
  });

  test('a suspended term never offers renewal at any instant (clawback safety)', () => {
    const record = decidedRecord('suspended', STARTS, ENDS);
    for (let k = -3; k <= 370; k += 11) {
      const asOfMs = STARTS + k * DAY;
      if (asOfMs < 0) continue;
      const v = projectMemberAccountStatus(input(record, asOfMs), policy(WINDOW));
      expect(v.status).toBe('suspended');
      expect(v.renewalOffered).toBe(false);
    }
  });

  test('an ended term never offers renewal at any instant (owner re-admits)', () => {
    const record = decidedRecord('ended', STARTS, ENDS);
    for (let k = -3; k <= 370; k += 11) {
      const asOfMs = STARTS + k * DAY;
      if (asOfMs < 0) continue;
      const v = projectMemberAccountStatus(input(record, asOfMs), policy(WINDOW));
      expect(v.status).toBe('ended');
      expect(v.renewalOffered).toBe(false);
    }
  });
});

describe('invariant 3 — the expiring-soon threshold is owner policy, never invented', () => {
  const record = decidedRecord('approved', STARTS, ENDS);

  test('window boundary is inclusive: endsAtMs - asOfMs === window is expiring_soon', () => {
    const asOfMs = ENDS - WINDOW; // exactly WINDOW remaining
    expect(verdictOf({ record, asOfMs, window: WINDOW }).status).toBe('expiring_soon');
  });

  test('one ms more than the window remaining is still active', () => {
    const asOfMs = ENDS - WINDOW - 1; // WINDOW + 1 remaining
    expect(verdictOf({ record, asOfMs, window: WINDOW }).status).toBe('active');
  });

  test('window 0 never yields expiring_soon (active flips straight to expired)', () => {
    expect(verdictOf({ record, asOfMs: ENDS - 1, window: 0 }).status).toBe('active');
    expect(verdictOf({ record, asOfMs: ENDS, window: 0 }).status).toBe('expired');
  });

  test('a window wider than the term makes an in-window term perpetually expiring_soon', () => {
    const asOfMs = STARTS + 1;
    expect(verdictOf({ record, asOfMs, window: 400 * DAY }).status).toBe('expiring_soon');
  });

  test('the same instant with different windows moves only the active/expiring_soon line', () => {
    const asOfMs = ENDS - 20 * DAY; // 20 days remaining
    expect(verdictOf({ record, asOfMs, window: 10 * DAY }).status).toBe('active');
    expect(verdictOf({ record, asOfMs, window: 30 * DAY }).status).toBe('expiring_soon');
  });
});

describe('window/term boundaries', () => {
  const record = decidedRecord('approved', STARTS, ENDS);

  test('asOfMs === startsAtMs is in window (not upcoming)', () => {
    // with a wide-enough window this is active; the point is it is NOT upcoming
    const v = verdictOf({ record, asOfMs: STARTS, window: 0 });
    expect(v.status).toBe('active');
    expect(v.entitlement).toBe('current_member');
  });

  test('asOfMs === startsAtMs - 1 is upcoming', () => {
    const v = verdictOf({ record, asOfMs: STARTS - 1, window: WINDOW });
    expect(v.status).toBe('upcoming');
    expect(v.entitlement).toBe('not_entitled');
  });

  test('asOfMs === endsAtMs is expired (never expiring_soon or active)', () => {
    const v = verdictOf({ record, asOfMs: ENDS, window: 400 * DAY });
    expect(v.status).toBe('expired');
    expect(v.entitlement).toBe('not_entitled');
    expect(v.renewalOffered).toBe(true);
  });

  test('asOfMs === endsAtMs - 1 is in window', () => {
    const v = verdictOf({ record, asOfMs: ENDS - 1, window: 0 });
    expect(v.status).toBe('active');
    expect(v.entitlement).toBe('current_member');
  });
});

// ---- malformed input battery ------------------------------------------------
describe('malformed input → denied malformed_input', () => {
  const good = () => input(decidedRecord('approved', STARTS, ENDS), STARTS + DAY);
  const D = { decision: 'denied', reason: 'malformed_input' };

  test('null / undefined / primitive / array', () => {
    for (const bad of [null, undefined, 0, 1, '', 'x', true, Symbol('s'), 42n, [], [1, 2]]) {
      expect(projectMemberAccountStatus(bad, policy(WINDOW))).toEqual(D);
    }
  });

  test('proxy input (incl. revoked) is rejected, not trapped', () => {
    const p = new Proxy(good(), { get() { throw new Error('trap'); } });
    expect(projectMemberAccountStatus(p, policy(WINDOW))).toEqual(D);
    const { proxy, revoke } = Proxy.revocable(good(), {});
    revoke();
    expect(projectMemberAccountStatus(proxy, policy(WINDOW))).toEqual(D);
  });

  test('foreign prototype / null prototype', () => {
    const nullProto = Object.assign(Object.create(null), good());
    expect(projectMemberAccountStatus(nullProto, policy(WINDOW))).toEqual(D);
    class Bag {}
    const foreign = Object.assign(new Bag(), good());
    expect(projectMemberAccountStatus(foreign, policy(WINDOW))).toEqual(D);
  });

  test('missing / extra / inherited / symbol / accessor keys', () => {
    const base = good();
    const missing = { membershipAccountStatusSchemaVersion: V, record: base.record, uid: UID };
    expect(projectMemberAccountStatus(missing, policy(WINDOW))).toEqual(D);
    const extra = { ...base, sneaky: 1 };
    expect(projectMemberAccountStatus(extra, policy(WINDOW))).toEqual(D);
    const inherited = Object.create({ asOfMs: STARTS + DAY });
    Object.assign(inherited, {
      membershipAccountStatusSchemaVersion: V, record: base.record, uid: UID,
    });
    expect(projectMemberAccountStatus(inherited, policy(WINDOW))).toEqual(D);
    const sym = { ...base, [Symbol('x')]: 1 };
    expect(projectMemberAccountStatus(sym, policy(WINDOW))).toEqual(D);
    const accessor = { ...base };
    let touched = false;
    Object.defineProperty(accessor, 'asOfMs', { enumerable: true, get() { touched = true; return STARTS; } });
    // redefine as accessor over an existing key: need to delete first
    delete accessor.asOfMs;
    Object.defineProperty(accessor, 'asOfMs', { enumerable: true, get() { touched = true; return STARTS; } });
    expect(projectMemberAccountStatus(accessor, policy(WINDOW))).toEqual(D);
    expect(touched).toBe(false);
    const nonEnum = { ...base };
    delete nonEnum.uid;
    Object.defineProperty(nonEnum, 'uid', { enumerable: false, value: UID, writable: true, configurable: true });
    expect(projectMemberAccountStatus(nonEnum, policy(WINDOW))).toEqual(D);
  });

  test('bad schema version', () => {
    for (const bad of [0, 2, '1', 1.5, null, undefined, true]) {
      const i = { ...good(), membershipAccountStatusSchemaVersion: bad };
      expect(projectMemberAccountStatus(i, policy(WINDOW))).toEqual(D);
    }
  });

  test('bad uid (non-opaque, empty, phone-shape allowed as opaque, wrong type)', () => {
    for (const bad of [null, undefined, 0, 42, '', ' ', 'has space', 'x'.repeat(129),
      'bad/slash', 'trailing\n', {}, []]) {
      const i = { ...good(), uid: bad };
      expect(projectMemberAccountStatus(i, policy(WINDOW))).toEqual(D);
    }
  });

  test('bad asOfMs (non-integer, negative, float, out of range, wrong type)', () => {
    for (const bad of [null, undefined, -1, 1.5, NaN, Infinity, '0', 8_640_000_000_000_001, {}]) {
      const i = { ...good(), asOfMs: bad };
      expect(projectMemberAccountStatus(i, policy(WINDOW))).toEqual(D);
    }
  });
});

describe('malformed record (via the composed authority) → denied malformed_input', () => {
  const D = { decision: 'denied', reason: 'malformed_input' };
  const bads = {
    'null record': null,
    'array record': [],
    'missing lastCommand': (() => {
      const r = decidedRecord('approved', STARTS, ENDS); delete r.lastCommand; return r;
    })(),
    'extra field': { ...decidedRecord('approved', STARTS, ENDS), extra: 1 },
    'bad revision math': { ...decidedRecord('approved', STARTS, ENDS), revision: 99 },
    'bad term.state enum': (() => {
      const r = decidedRecord('approved', STARTS, ENDS); r.term = { ...r.term, state: 'frozen' }; return r;
    })(),
    'ill-ordered term window': (() => {
      const r = decidedRecord('approved', ENDS, STARTS); return r; // startsAtMs >= endsAtMs
    })(),
    'wrong authority schema version': { ...decidedRecord('approved', STARTS, ENDS), membershipAuthoritySchemaVersion: 2 },
    'non-opaque membershipId': { ...decidedRecord('approved', STARTS, ENDS), membershipId: 'bad id' },
    'proxy record': new Proxy(decidedRecord('approved', STARTS, ENDS), {}),
    'getter on association': (() => {
      const r = decidedRecord('approved', STARTS, ENDS);
      const assoc = { ...linkedAssoc };
      delete r.association;
      Object.defineProperty(r, 'association', { enumerable: true, get() { return assoc; } });
      return r;
    })(),
  };

  test.each(Object.entries(bads))('%s → denied AND the real authority also rejects it', (_name, badRecord) => {
    // the projection denies
    expect(projectMemberAccountStatus(input(badRecord, STARTS + DAY), policy(WINDOW))).toEqual(D);
    // and the seam is honest: the composed authority rejects the same record
    expect(() => deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: AUTH_V, record: badRecord, uid: UID, asOfMs: STARTS + DAY,
    })).toThrow();
  });
});

describe('malformed policy → denied malformed_policy', () => {
  const good = () => input(decidedRecord('approved', STARTS, ENDS), STARTS + DAY);
  const D = { decision: 'denied', reason: 'malformed_policy' };

  test('non-object / proxy / array', () => {
    for (const bad of [null, undefined, 0, 'x', true, [], new Proxy(policy(WINDOW), {})]) {
      expect(projectMemberAccountStatus(good(), bad)).toEqual(D);
    }
  });

  test('bad schema version / missing / extra keys', () => {
    expect(projectMemberAccountStatus(good(), { membershipAccountStatusSchemaVersion: 2, renewalWindowMs: WINDOW })).toEqual(D);
    expect(projectMemberAccountStatus(good(), { membershipAccountStatusSchemaVersion: V })).toEqual(D);
    expect(projectMemberAccountStatus(good(), { ...policy(WINDOW), extra: 1 })).toEqual(D);
  });

  test('bad renewalWindowMs (negative, float, NaN, huge, wrong type)', () => {
    for (const bad of [null, undefined, -1, 1.5, NaN, Infinity, '0', 8_640_000_000_000_001, {}]) {
      expect(projectMemberAccountStatus(good(), { membershipAccountStatusSchemaVersion: V, renewalWindowMs: bad })).toEqual(D);
    }
  });

  test('input malformity is reported before policy malformity', () => {
    // both args malformed → the input denial wins (input is validated first)
    expect(projectMemberAccountStatus(null, null)).toEqual({ decision: 'denied', reason: 'malformed_input' });
  });
});

// ---- total, never-throwing behavior ----------------------------------------
describe('never throws for any value in either argument position', () => {
  const hostile = [
    null, undefined, 0, NaN, '', 'x', true, Symbol('s'), 42n, [], {},
    new Proxy({}, { get() { throw new Error('x'); }, ownKeys() { throw new Error('x'); } }),
    (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })(),
    (() => { const o = {}; o.self = o; return o; })(),
    Object.create(null),
  ];
  test('input position', () => {
    for (const h of hostile) {
      expect(() => projectMemberAccountStatus(h, policy(WINDOW))).not.toThrow();
      const v = projectMemberAccountStatus(h, policy(WINDOW));
      expect(v.decision).toBe('denied');
    }
  });
  test('policy position (with a valid input)', () => {
    const good = input(decidedRecord('approved', STARTS, ENDS), STARTS + DAY);
    for (const h of hostile) {
      expect(() => projectMemberAccountStatus(good, h)).not.toThrow();
    }
  });
  test('record position (nested hostile record)', () => {
    for (const h of hostile) {
      const i = { membershipAccountStatusSchemaVersion: V, record: h, uid: UID, asOfMs: STARTS + DAY };
      expect(() => projectMemberAccountStatus(i, policy(WINDOW))).not.toThrow();
      expect(projectMemberAccountStatus(i, policy(WINDOW)).decision).toBe('denied');
    }
  });
});

// ---- determinism & immutability --------------------------------------------
describe('determinism, immutability, and mint-nothing surface', () => {
  test('the projected verdict is deeply frozen', () => {
    const v = verdictOf(ROWS[0]);
    expect(Object.isFrozen(v)).toBe(true);
    expect(() => { 'use strict'; v.status = 'x'; }).toThrow(TypeError);
  });

  test('denial verdicts are frozen singletons (context-free)', () => {
    const a = projectMemberAccountStatus(null, policy(WINDOW));
    const b = projectMemberAccountStatus(42, policy(WINDOW));
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('same inputs → identical verdict (clockless determinism)', () => {
    const a = verdictOf(ROWS[1]);
    const b = verdictOf(ROWS[1]);
    expect(a).toEqual(b);
  });

  test('mutating the input object after the call does not change the returned verdict', () => {
    const record = decidedRecord('approved', STARTS, ENDS);
    const i = input(record, STARTS + 100 * DAY);
    const v = projectMemberAccountStatus(i, policy(WINDOW));
    i.asOfMs = ENDS + DAY;
    i.uid = OTHER_UID;
    record.term.state = 'suspended';
    expect(v).toEqual({
      decision: 'projected', status: 'active', entitlement: 'current_member',
      renewalOffered: false, activeThroughMs: ENDS,
    });
  });

  test('the verdict carries no code/token/role/price/PII vocabulary', () => {
    for (const row of ROWS) {
      const s = JSON.stringify(verdictOf(row));
      expect(s).not.toMatch(/\b(code|token|secret|password|hash|ssn|dob|email|address|amount|price|role|claim)\b/i);
    }
  });

  test('the verdict shape is exactly the documented keys', () => {
    const v = verdictOf(ROWS[0]);
    expect(Object.keys(v).sort()).toEqual(
      ['activeThroughMs', 'decision', 'entitlement', 'renewalOffered', 'status'],
    );
  });
});

// ---- source-boundary checks -------------------------------------------------
describe('source-boundary — pure, composes only the authority, imported by nothing', () => {
  const moduleFile = path.join(__dirname, 'membershipAccountStatusProjection.js');
  const authorityFile = path.join(__dirname, 'membershipAuthority.js');
  const raw = fs.readFileSync(moduleFile, 'utf8');
  // strip block then line comments so vocabulary/require checks see code only
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  function requiresOf(src) {
    const out = new Set();
    const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) out.add(m[2]);
    return out;
  }

  test('this module requires exactly node:util and ./membershipAuthority', () => {
    expect([...requiresOf(code)].sort()).toEqual(['./membershipAuthority', 'node:util']);
  });

  test('the composed authority is itself pure (requires only node:util) — transitive purity', () => {
    const authRaw = fs.readFileSync(authorityFile, 'utf8');
    const authCode = authRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect([...requiresOf(authCode)]).toEqual(['node:util']);
  });

  test('the header pins §8.0h / MEMBERS-DUES-001F and the SOURCE ONLY status', () => {
    expect(raw).toContain('§8.0h');
    expect(raw).toContain('MEMBERS-DUES-001F');
    expect(raw).toContain('SOURCE ONLY, UNUSED');
  });

  test('code (comment-stripped) holds no credential/PII/mint vocabulary', () => {
    expect(code).not.toMatch(/\b(secret|password|hash|ssn|dob|apikey|api_key|bearer|privatekey)\b/i);
  });

  test('no other functions/ module imports this one (imported by nothing)', () => {
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')
      && f !== 'membershipAccountStatusProjection.js'
      && f !== 'membershipAccountStatusProjection.test.js');
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/membershipAccountStatusProjection/);
    }
  });
});
