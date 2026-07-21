const fs = require('fs');
const path = require('path');

const {
  stravaClubStatusSchemaVersion,
  FetchOutcome,
  ClubStatus,
  StravaClubStatusError,
  classifyStravaClubStatus,
} = require('./stravaClubStatus');

// A base successful read in which the member belongs to the configured club.
// Each helper deep-copies the literal and applies overrides so a test can
// perturb one field in isolation.
function evidence(overrides = {}) {
  return {
    stravaClubStatusSchemaVersion: 1,
    configuredClubId: '123456',
    fetchOutcome: 'ok',
    memberClubIds: ['999', '123456', '42'],
    checkedAt: '2026-07-21T11:00:00Z',
    ...overrides,
  };
}

function okEvidence(memberClubIds, configuredClubId = '123456') {
  return evidence({ fetchOutcome: 'ok', configuredClubId, memberClubIds });
}

const rawSource = fs.readFileSync(path.join(__dirname, 'stravaClubStatus.js'), 'utf8');

function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}
const sourceCode = codeOnly(rawSource);

describe('stravaClubStatus frozen versioned surface', () => {
  test('schema version is the frozen revision 1', () => {
    expect(stravaClubStatusSchemaVersion).toBe(1);
  });

  test('module export object is frozen', () => {
    expect(Object.isFrozen(require('./stravaClubStatus'))).toBe(true);
  });

  test('fetch-outcome enum is frozen and complete', () => {
    expect(FetchOutcome).toEqual({
      OK: 'ok',
      MISSING_SCOPE: 'missing_scope',
      REVOKED: 'revoked',
      NOT_AUTHORIZED: 'not_authorized',
      RATE_LIMITED: 'rate_limited',
      PROVIDER_OUTAGE: 'provider_outage',
    });
    expect(Object.isFrozen(FetchOutcome)).toBe(true);
  });

  test('club-status enum is frozen and complete', () => {
    expect(ClubStatus).toEqual({ MEMBER: 'member', NOT_MEMBER: 'not_member', UNKNOWN: 'unknown' });
    expect(Object.isFrozen(ClubStatus)).toBe(true);
  });

  test('the error constructor is exported', () => {
    expect(typeof StravaClubStatusError).toBe('function');
  });
});

describe('stravaClubStatus happy-path classification', () => {
  test('a member of the configured club is reported member', () => {
    const verdict = classifyStravaClubStatus(evidence());
    expect(verdict).toEqual({
      stravaClubStatusSchemaVersion: 1,
      status: 'member',
      reason: 'in_club',
      retryable: false,
      advisory: true,
      checkedAt: '2026-07-21T11:00:00Z',
    });
  });

  test('a non-member is reported not_member', () => {
    const verdict = classifyStravaClubStatus(okEvidence(['999', '42']));
    expect(verdict.status).toBe('not_member');
    expect(verdict.reason).toBe('not_in_club');
    expect(verdict.retryable).toBe(false);
  });

  test('an empty club list is reported not_member', () => {
    expect(classifyStravaClubStatus(okEvidence([])).status).toBe('not_member');
  });

  test('the member sole-club case is reported member', () => {
    expect(classifyStravaClubStatus(okEvidence(['123456'])).status).toBe('member');
  });

  test('the verdict echoes the caller-supplied instant', () => {
    const verdict = classifyStravaClubStatus(evidence({ checkedAt: '2027-01-02T03:04:05Z' }));
    expect(verdict.checkedAt).toBe('2027-01-02T03:04:05Z');
  });

  test('the verdict and its result are frozen', () => {
    expect(Object.isFrozen(classifyStravaClubStatus(evidence()))).toBe(true);
  });
});

describe('stravaClubStatus non-ok read disposition', () => {
  const nonOk = [
    ['missing_scope', false],
    ['revoked', false],
    ['not_authorized', false],
    ['rate_limited', true],
    ['provider_outage', true],
  ];

  test.each(nonOk)('a %s read yields unknown with retryable=%s', (fetchOutcome, retryable) => {
    const verdict = classifyStravaClubStatus(evidence({ fetchOutcome, memberClubIds: null }));
    expect(verdict.status).toBe('unknown');
    expect(verdict.reason).toBe(fetchOutcome);
    expect(verdict.retryable).toBe(retryable);
    expect(verdict.advisory).toBe(true);
  });

  test('an ok read with a null club list is incoherent and throws', () => {
    expect(() => classifyStravaClubStatus(evidence({ fetchOutcome: 'ok', memberClubIds: null })))
      .toThrow(StravaClubStatusError);
  });

  test.each(['missing_scope', 'revoked', 'not_authorized', 'rate_limited', 'provider_outage'])(
    'a %s read that still carries a club list is incoherent and throws',
    (fetchOutcome) => {
      expect(() => classifyStravaClubStatus(evidence({ fetchOutcome, memberClubIds: [] })))
        .toThrow(StravaClubStatusError);
    },
  );
});

describe('stravaClubStatus advisory inertness (grants nothing, leaks no list)', () => {
  test('a verdict carries exactly the informational keys and no entitlement field', () => {
    const verdict = classifyStravaClubStatus(evidence());
    expect(Object.keys(verdict).sort()).toEqual([
      'advisory',
      'checkedAt',
      'reason',
      'retryable',
      'status',
      'stravaClubStatusSchemaVersion',
    ]);
  });

  test('the advisory flag is always true', () => {
    const ok = classifyStravaClubStatus(evidence());
    const err = classifyStravaClubStatus(evidence({ fetchOutcome: 'rate_limited', memberClubIds: null }));
    expect(ok.advisory).toBe(true);
    expect(err.advisory).toBe(true);
  });

  test('a member verdict never echoes any club identity from the read', () => {
    const verdict = classifyStravaClubStatus(okEvidence(
      ['77709999', '55501234', '88801111'],
      '55501234',
    ));
    expect(verdict.status).toBe('member');
    const json = JSON.stringify(verdict);
    expect(json).not.toContain('77709999');
    expect(json).not.toContain('88801111');
    // not even the matched/configured club identity is echoed
    expect(json).not.toContain('55501234');
  });

  test('a not_member verdict never echoes the member club list', () => {
    const verdict = classifyStravaClubStatus(okEvidence(['77709999', '88801111'], '55501234'));
    expect(verdict.status).toBe('not_member');
    const json = JSON.stringify(verdict);
    expect(json).not.toContain('77709999');
    expect(json).not.toContain('88801111');
  });
});

describe('stravaClubStatus configured club-id validation', () => {
  test.each([
    ['0', '0'],
    ['a single digit', '7'],
    ['twenty digits', '12345678901234567890'],
  ])('a valid configured club id (%s) is accepted', (_label, configuredClubId) => {
    expect(() => classifyStravaClubStatus(okEvidence(['1'], configuredClubId))).not.toThrow();
  });

  test.each([
    ['empty', ''],
    ['twenty-one digits', '123456789012345678901'],
    ['a letter', '12a45'],
    ['a space', '12 45'],
    ['a leading plus', '+1245'],
    ['a decimal', '12.45'],
    ['a non-string', 123456],
    ['null', null],
  ])('a configured club id that is %s throws', (_label, configuredClubId) => {
    expect(() => classifyStravaClubStatus(evidence({ configuredClubId })))
      .toThrow(StravaClubStatusError);
  });
});

describe('stravaClubStatus member club-list validation', () => {
  test('a 512-entry club list is accepted', () => {
    const list = Array.from({ length: 512 }, (_unused, i) => String(i + 1));
    expect(() => classifyStravaClubStatus(okEvidence(list))).not.toThrow();
  });

  test('a 513-entry club list throws', () => {
    const list = Array.from({ length: 513 }, (_unused, i) => String(i + 1));
    expect(() => classifyStravaClubStatus(okEvidence(list))).toThrow(StravaClubStatusError);
  });

  test('a non-array club list throws', () => {
    expect(() => classifyStravaClubStatus(okEvidence({ 0: '1', length: 1 })))
      .toThrow(StravaClubStatusError);
  });

  test('a sparse hole in the club list throws', () => {
    const list = ['1', '2', '3'];
    delete list[1];
    expect(() => classifyStravaClubStatus(okEvidence(list))).toThrow(StravaClubStatusError);
  });

  test('a non-club-id element throws', () => {
    expect(() => classifyStravaClubStatus(okEvidence(['1', 'not-an-id', '3'])))
      .toThrow(StravaClubStatusError);
  });

  test('a numeric (non-string) element throws', () => {
    expect(() => classifyStravaClubStatus(okEvidence(['1', 2, '3'])))
      .toThrow(StravaClubStatusError);
  });

  test('a proxy club list throws', () => {
    const list = new Proxy(['1', '123456'], {});
    expect(() => classifyStravaClubStatus(okEvidence(list))).toThrow(StravaClubStatusError);
  });

  test('a club list with an extra named property throws', () => {
    const list = ['1', '123456'];
    list.injected = 'x';
    expect(() => classifyStravaClubStatus(okEvidence(list))).toThrow(StravaClubStatusError);
  });

  test('a club list with a getter element throws and the getter is not invoked', () => {
    let invoked = false;
    const list = ['1'];
    Object.defineProperty(list, '1', {
      get() { invoked = true; return '123456'; },
      enumerable: true,
      configurable: true,
    });
    list.length = 2;
    expect(() => classifyStravaClubStatus(okEvidence(list))).toThrow(StravaClubStatusError);
    expect(invoked).toBe(false);
  });

  test('a foreign-prototype array-like throws', () => {
    const list = Object.create(Array.prototype);
    list[0] = '123456';
    list.length = 1;
    Object.setPrototypeOf(list, { poisoned: true });
    expect(() => classifyStravaClubStatus(okEvidence(list))).toThrow(StravaClubStatusError);
  });
});

describe('stravaClubStatus fetch-outcome and timestamp validation', () => {
  test.each(['ok', 'missing_scope', 'revoked', 'not_authorized', 'rate_limited', 'provider_outage'])(
    'the valid outcome %p is accepted',
    (fetchOutcome) => {
      const ev = fetchOutcome === 'ok'
        ? evidence()
        : evidence({ fetchOutcome, memberClubIds: null });
      expect(() => classifyStravaClubStatus(ev)).not.toThrow();
    },
  );

  test.each([
    ['an unknown outcome', 'timeout'],
    ['a capitalized outcome', 'OK'],
    ['a non-string outcome', 3],
    ['null', null],
  ])('%s throws', (_label, fetchOutcome) => {
    expect(() => classifyStravaClubStatus(evidence({ fetchOutcome, memberClubIds: null })))
      .toThrow(StravaClubStatusError);
  });

  test.each([
    '2026-01-01T00:00:00Z',
    '2026-12-31T23:59:59Z',
  ])('a valid checkedAt %p is accepted', (checkedAt) => {
    expect(() => classifyStravaClubStatus(evidence({ checkedAt }))).not.toThrow();
  });

  test.each([
    ['no Z', '2026-07-21T11:00:00'],
    ['a space form', '2026-07-21 11:00:00'],
    ['milliseconds', '2026-07-21T11:00:00.000Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    ['hour 24', '2026-07-21T24:00:00Z'],
    ['a non-string', 1_700_000_000],
    ['null', null],
  ])('a checkedAt that is %s throws', (_label, checkedAt) => {
    expect(() => classifyStravaClubStatus(evidence({ checkedAt }))).toThrow(StravaClubStatusError);
  });
});

describe('stravaClubStatus envelope hostility', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'ok'],
    ['a boolean', true],
    ['an array', [1, 2]],
  ])('a non-object record (%s) throws', (_label, input) => {
    expect(() => classifyStravaClubStatus(input)).toThrow(StravaClubStatusError);
  });

  test('an extra own key throws', () => {
    expect(() => classifyStravaClubStatus(evidence({ stray: 1 }))).toThrow(StravaClubStatusError);
  });

  test('a missing key throws', () => {
    const ev = evidence();
    delete ev.checkedAt;
    expect(() => classifyStravaClubStatus(ev)).toThrow(StravaClubStatusError);
  });

  test('a wrong schema version throws', () => {
    expect(() => classifyStravaClubStatus(evidence({ stravaClubStatusSchemaVersion: 2 })))
      .toThrow(StravaClubStatusError);
  });

  test('a proxy record throws', () => {
    expect(() => classifyStravaClubStatus(new Proxy(evidence(), {}))).toThrow(StravaClubStatusError);
  });

  test('a null-prototype record throws', () => {
    expect(() => classifyStravaClubStatus(Object.assign(Object.create(null), evidence())))
      .toThrow(StravaClubStatusError);
  });

  test('a record on a foreign prototype throws', () => {
    class Rec {}
    expect(() => classifyStravaClubStatus(Object.assign(new Rec(), evidence())))
      .toThrow(StravaClubStatusError);
  });

  test('a getter-bearing record throws and the getter is not invoked', () => {
    let invoked = false;
    const ev = evidence();
    Object.defineProperty(ev, 'fetchOutcome', {
      get() { invoked = true; return 'ok'; },
      enumerable: true,
      configurable: true,
    });
    expect(() => classifyStravaClubStatus(ev)).toThrow(StravaClubStatusError);
    expect(invoked).toBe(false);
  });

  test('a non-enumerable field throws', () => {
    const ev = evidence();
    Object.defineProperty(ev, 'fetchOutcome', { enumerable: false });
    expect(() => classifyStravaClubStatus(ev)).toThrow(StravaClubStatusError);
  });

  test('an inherited key masquerading as a field throws', () => {
    const base = { checkedAt: '2026-07-21T11:00:00Z' };
    const ev = Object.create(base);
    Object.assign(ev, {
      stravaClubStatusSchemaVersion: 1,
      configuredClubId: '123456',
      fetchOutcome: 'ok',
      memberClubIds: ['123456'],
    });
    expect(() => classifyStravaClubStatus(ev)).toThrow(StravaClubStatusError);
  });
});

describe('stravaClubStatus error identity, non-echo, and determinism', () => {
  test('the error carries a stable name and code', () => {
    expect.assertions(3);
    try {
      classifyStravaClubStatus(null);
    } catch (error) {
      expect(error).toBeInstanceOf(StravaClubStatusError);
      expect(error.name).toBe('StravaClubStatusError');
      expect(error.code).toBe('invalid_strava_club_status_evidence');
    }
  });

  test('the thrown error message is fixed and echoes no input', () => {
    expect.assertions(2);
    try {
      classifyStravaClubStatus({ ...evidence(), leak: 'LEAK-MARKER-9001' });
    } catch (error) {
      expect(error.message).toBe('Strava club-status evidence is invalid.');
      expect(error.message).not.toContain('LEAK-MARKER-9001');
    }
  });

  test('identical inputs yield a deep-equal verdict', () => {
    expect(classifyStravaClubStatus(evidence())).toEqual(classifyStravaClubStatus(evidence()));
  });

  test('the error is frozen', () => {
    expect.assertions(1);
    try {
      classifyStravaClubStatus(null);
    } catch (error) {
      expect(Object.isFrozen(error)).toBe(true);
    }
  });
});

describe('stravaClubStatus source boundary', () => {
  const forbiddenApi = [
    ['ambient environment', /process\.env/],
    ['wall clock now', /Date\.now/],
    ['date construction', /new Date/],
    ['randomness', /Math\.random/],
    ['console', /console\./],
    ['fetch', /fetch\(/],
    ['a url scheme', /https?:/],
    ['firebase', /firebase/i],
    ['firestore', /firestore/i],
    ['stripe', /stripe/i],
  ];

  test.each(forbiddenApi)('the code references no %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  const forbiddenVocab = [
    ['phone', /phone/i],
    ['address', /address/i],
    ['dob', /\bdob\b/i],
    ['ssn', /\bssn\b/i],
    ['secret', /secret/i],
    ['token word', /\btoken\b/i],
    ['password', /password/i],
    ['bearer', /bearer/i],
    ['api key', /api[_-]?key/i],
    ['invite', /invite/i],
    ['roster', /roster/i],
    ['pricing', /pricing/i],
    ['entitlement', /entitle/i],
  ];

  test.each(forbiddenVocab)('the code names no %s field', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test('the module requires only node:util', () => {
    const requires = rawSource.match(/require\(([^)]*)\)/g) || [];
    expect(requires).toEqual(["require('node:util')"]);
  });

  test('the raw source names the issue code in its header', () => {
    expect(rawSource).toContain('STRAVA-002A');
  });

  test('the functions entrypoint does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('stravaClubStatus');
  });
});
