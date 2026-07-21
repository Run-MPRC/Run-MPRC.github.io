const fs = require('fs');
const path = require('path');

const {
  channelReconciliationSchemaVersion,
  CHANNEL_PROVIDERS,
  PROVIDER_WRITE_MODE,
  ChannelProvider,
  ChannelTaskAction,
  ChannelReconciliationError,
  deriveChannelReconciliationTasks,
} = require('./channelReconciliationTasks');

// A base valid membership-change record. Overrides replace top-level fields.
function change(overrides = {}) {
  return {
    channelReconciliationSchemaVersion: 1,
    memberRef: 'mbr_ABC123',
    membershipVersion: 7,
    membershipActive: true,
    channelDesired: { google: true, strava: true, whatsapp: false },
    ...overrides,
  };
}

// Strip block and line comments so the source-boundary batteries test executable
// code, not the header prose (which legitimately names excluded categories).
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

const MODULE_PATH = path.join(__dirname, 'channelReconciliationTasks.js');
const RAW_SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');
const CODE = codeOnly(RAW_SOURCE);

describe('channelReconciliationTasks frozen versioned surface', () => {
  test('exports a frozen module object', () => {
    const mod = require('./channelReconciliationTasks');
    expect(Object.isFrozen(mod)).toBe(true);
  });

  test('schema version is the constant 1', () => {
    expect(channelReconciliationSchemaVersion).toBe(1);
  });

  test('provider registry and write mode are frozen', () => {
    expect(Object.isFrozen(CHANNEL_PROVIDERS)).toBe(true);
    expect(Object.isFrozen(PROVIDER_WRITE_MODE)).toBe(true);
    expect(CHANNEL_PROVIDERS).toEqual(['google', 'strava', 'whatsapp']);
  });

  test('enums are frozen and map upper-case keys to lower-case values', () => {
    expect(Object.isFrozen(ChannelProvider)).toBe(true);
    expect(Object.isFrozen(ChannelTaskAction)).toBe(true);
    expect(ChannelProvider).toEqual({ GOOGLE: 'google', STRAVA: 'strava', WHATSAPP: 'whatsapp' });
    expect(ChannelTaskAction).toEqual({
      ENSURE_PRESENT: 'ensure_present',
      ENSURE_ABSENT: 'ensure_absent',
    });
  });

  test('error prototype and constructor are frozen', () => {
    expect(Object.isFrozen(ChannelReconciliationError)).toBe(true);
    expect(Object.isFrozen(ChannelReconciliationError.prototype)).toBe(true);
  });
});

describe('happy-path derivation', () => {
  test('derives one task per supported provider, in registry order', () => {
    const result = deriveChannelReconciliationTasks(change());
    expect(result.tasks.map((t) => t.provider)).toEqual(['google', 'strava', 'whatsapp']);
    expect(result.taskCount).toBe(3);
  });

  test('carries the change metadata through', () => {
    const result = deriveChannelReconciliationTasks(change());
    expect(result.channelReconciliationSchemaVersion).toBe(1);
    expect(result.memberRef).toBe('mbr_ABC123');
    expect(result.membershipVersion).toBe(7);
    expect(result.membershipActive).toBe(true);
  });

  test('each task has the expected shape and stable identity', () => {
    const result = deriveChannelReconciliationTasks(change());
    expect(result.tasks[0]).toEqual({
      taskId: 'chn.v1.mbr_ABC123.google.7',
      provider: 'google',
      action: 'ensure_present',
      mode: 'manual',
      membershipVersion: 7,
    });
    expect(result.tasks[1]).toEqual({
      taskId: 'chn.v1.mbr_ABC123.strava.7',
      provider: 'strava',
      action: 'ensure_present',
      mode: 'manual',
      membershipVersion: 7,
    });
    expect(result.tasks[2]).toEqual({
      taskId: 'chn.v1.mbr_ABC123.whatsapp.7',
      provider: 'whatsapp',
      action: 'ensure_absent',
      mode: 'manual',
      membershipVersion: 7,
    });
  });

  test('result, tasks array, and every task are frozen', () => {
    const result = deriveChannelReconciliationTasks(change());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.tasks)).toBe(true);
    result.tasks.forEach((task) => expect(Object.isFrozen(task)).toBe(true));
  });
});

describe('action logic (desired standing vs active membership)', () => {
  test.each([
    [true, true, 'ensure_present'],
    [true, false, 'ensure_absent'],
    [false, true, 'ensure_absent'],
    [false, false, 'ensure_absent'],
  ])('active=%s desired=%s -> %s', (membershipActive, googleDesired, expected) => {
    const result = deriveChannelReconciliationTasks(change({
      membershipActive,
      channelDesired: { google: googleDesired, strava: false, whatsapp: false },
    }));
    const google = result.tasks.find((t) => t.provider === 'google');
    expect(google.action).toBe(expected);
  });

  test('a lapse (inactive) ensures absence in every channel regardless of desired', () => {
    const result = deriveChannelReconciliationTasks(change({
      membershipActive: false,
      channelDesired: { google: true, strava: true, whatsapp: true },
    }));
    expect(result.tasks.every((t) => t.action === 'ensure_absent')).toBe(true);
  });

  test('a reactivation restores ensure_present for every desired channel', () => {
    const result = deriveChannelReconciliationTasks(change({
      membershipActive: true,
      channelDesired: { google: true, strava: true, whatsapp: true },
    }));
    expect(result.tasks.every((t) => t.action === 'ensure_present')).toBe(true);
  });
});

describe('stable-ID idempotency and determinism', () => {
  test('the same change yields byte-identical output on repeat calls', () => {
    const a = deriveChannelReconciliationTasks(change());
    const b = deriveChannelReconciliationTasks(change());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('task identity is stable across the membership version', () => {
    const v7 = deriveChannelReconciliationTasks(change({ membershipVersion: 7 }));
    expect(v7.tasks[0].taskId).toBe('chn.v1.mbr_ABC123.google.7');
  });

  test('a newer membership version yields distinct identities that supersede', () => {
    const v7 = deriveChannelReconciliationTasks(change({ membershipVersion: 7 }));
    const v8 = deriveChannelReconciliationTasks(change({ membershipVersion: 8 }));
    expect(v8.tasks[0].taskId).toBe('chn.v1.mbr_ABC123.google.8');
    expect(v8.tasks[0].taskId).not.toBe(v7.tasks[0].taskId);
  });

  test('distinct members yield distinct identities (no cross-member collision)', () => {
    const a = deriveChannelReconciliationTasks(change({ memberRef: 'mbr_ONE' }));
    const b = deriveChannelReconciliationTasks(change({ memberRef: 'mbr_TWO' }));
    const idsA = new Set(a.tasks.map((t) => t.taskId));
    b.tasks.forEach((task) => expect(idsA.has(task.taskId)).toBe(false));
  });

  test('every task identity within one change is unique across providers', () => {
    const result = deriveChannelReconciliationTasks(change());
    const ids = result.tasks.map((t) => t.taskId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the action does not perturb the task identity', () => {
    const present = deriveChannelReconciliationTasks(change({
      channelDesired: { google: true, strava: true, whatsapp: true },
    }));
    const absent = deriveChannelReconciliationTasks(change({
      channelDesired: { google: false, strava: false, whatsapp: false },
    }));
    expect(present.tasks[0].taskId).toBe(absent.tasks[0].taskId);
    expect(present.tasks[0].action).not.toBe(absent.tasks[0].action);
  });
});

describe('member reference validation', () => {
  test.each([
    ['mbr_ABC123'],
    ['A'],
    ['aZ0-_'],
    ['firebaseUID28charsAlnumExampleX'],
    ['a'.repeat(128)],
  ])('accepts opaque reference %s', (memberRef) => {
    expect(() => deriveChannelReconciliationTasks(change({ memberRef }))).not.toThrow();
  });

  test.each([
    ['1234567890'],
    ['5551234567'],
    ['0'],
  ])('rejects a bare all-digit (phone-shaped) reference %s', (memberRef) => {
    expect(() => deriveChannelReconciliationTasks(change({ memberRef }))).toThrow(ChannelReconciliationError);
  });

  test.each([
    [''],
    ['a'.repeat(129)],
    ['has.dot'],
    ['has@at'],
    ['has+plus'],
    ['has space'],
    ['has/slash'],
    ['emoji\u{1F600}'],
  ])('rejects a malformed reference %s', (memberRef) => {
    expect(() => deriveChannelReconciliationTasks(change({ memberRef }))).toThrow(ChannelReconciliationError);
  });

  test.each([
    [123],
    [null],
    [undefined],
    [{}],
    [['mbr_A']],
    [true],
  ])('rejects a non-string reference %p', (memberRef) => {
    expect(() => deriveChannelReconciliationTasks(change({ memberRef }))).toThrow(ChannelReconciliationError);
  });
});

describe('membership version validation', () => {
  test.each([
    [0],
    [1],
    [7],
    [1000000000],
  ])('accepts bounded non-negative integer %p', (membershipVersion) => {
    expect(() => deriveChannelReconciliationTasks(change({ membershipVersion }))).not.toThrow();
  });

  test.each([
    [-1],
    [1.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
    [1000000001],
    ['7'],
    [null],
    [undefined],
    [true],
  ])('rejects out-of-range or non-integer version %p', (membershipVersion) => {
    expect(() => deriveChannelReconciliationTasks(change({ membershipVersion }))).toThrow(ChannelReconciliationError);
  });
});

describe('membership active flag validation', () => {
  test.each([[true], [false]])('accepts strict boolean %p', (membershipActive) => {
    expect(() => deriveChannelReconciliationTasks(change({ membershipActive }))).not.toThrow();
  });

  test.each([
    [1],
    [0],
    ['true'],
    [null],
    [undefined],
    [{}],
  ])('rejects a non-boolean active flag %p', (membershipActive) => {
    expect(() => deriveChannelReconciliationTasks(change({ membershipActive }))).toThrow(ChannelReconciliationError);
  });
});

describe('desired-channel map validation', () => {
  test('accepts an exact three-provider boolean map', () => {
    expect(() => deriveChannelReconciliationTasks(change({
      channelDesired: { google: true, strava: false, whatsapp: true },
    }))).not.toThrow();
  });

  test('rejects a map missing a provider', () => {
    expect(() => deriveChannelReconciliationTasks(change({
      channelDesired: { google: true, strava: false },
    }))).toThrow(ChannelReconciliationError);
  });

  test('rejects a map with an extra channel', () => {
    expect(() => deriveChannelReconciliationTasks(change({
      channelDesired: {
        google: true, strava: false, whatsapp: true, instagram: true,
      },
    }))).toThrow(ChannelReconciliationError);
  });

  test('rejects a map naming an unsupported provider', () => {
    expect(() => deriveChannelReconciliationTasks(change({
      channelDesired: { google: true, strava: false, facebook: true },
    }))).toThrow(ChannelReconciliationError);
  });

  test('rejects a non-boolean desired value', () => {
    expect(() => deriveChannelReconciliationTasks(change({
      channelDesired: { google: 1, strava: false, whatsapp: true },
    }))).toThrow(ChannelReconciliationError);
  });

  test.each([
    ['x'],
    [123],
    [null],
    [undefined],
    [[true, false, true]],
  ])('rejects a non-object desired map %p', (channelDesired) => {
    expect(() => deriveChannelReconciliationTasks(change({ channelDesired }))).toThrow(ChannelReconciliationError);
  });

  test('rejects a proxy desired map', () => {
    const channelDesired = new Proxy(
      { google: true, strava: false, whatsapp: true },
      {},
    );
    expect(() => deriveChannelReconciliationTasks(change({ channelDesired }))).toThrow(ChannelReconciliationError);
  });

  test('rejects a null-prototype desired map', () => {
    const channelDesired = Object.create(null);
    channelDesired.google = true;
    channelDesired.strava = false;
    channelDesired.whatsapp = true;
    expect(() => deriveChannelReconciliationTasks(change({ channelDesired }))).toThrow(ChannelReconciliationError);
  });

  test('rejects an accessor-backed desired value without invoking the getter', () => {
    let touched = false;
    const channelDesired = { google: true, strava: false };
    Object.defineProperty(channelDesired, 'whatsapp', {
      enumerable: true,
      configurable: true,
      get() { touched = true; return true; },
    });
    expect(() => deriveChannelReconciliationTasks(change({ channelDesired }))).toThrow(ChannelReconciliationError);
    expect(touched).toBe(false);
  });

  test('rejects a desired map carrying a non-enumerable data property', () => {
    const channelDesired = { google: true, strava: false, whatsapp: true };
    Object.defineProperty(channelDesired, 'hidden', {
      enumerable: false,
      value: true,
    });
    expect(() => deriveChannelReconciliationTasks(change({ channelDesired }))).toThrow(ChannelReconciliationError);
  });
});

describe('envelope hostility', () => {
  test.each([
    [null],
    [undefined],
    ['x'],
    [123],
    [[]],
  ])('rejects a non-object change %p', (input) => {
    expect(() => deriveChannelReconciliationTasks(input)).toThrow(ChannelReconciliationError);
  });

  test('rejects an extra top-level key', () => {
    expect(() => deriveChannelReconciliationTasks({ ...change(), extra: 1 })).toThrow(ChannelReconciliationError);
  });

  test('rejects a missing top-level key', () => {
    const partial = change();
    delete partial.membershipActive;
    expect(() => deriveChannelReconciliationTasks(partial)).toThrow(ChannelReconciliationError);
  });

  test.each([
    [2],
    [0],
    ['1'],
    [null],
  ])('rejects a wrong schema version %p', (version) => {
    expect(() => deriveChannelReconciliationTasks(change({
      channelReconciliationSchemaVersion: version,
    }))).toThrow(ChannelReconciliationError);
  });

  test('rejects a proxy change envelope', () => {
    expect(() => deriveChannelReconciliationTasks(new Proxy(change(), {}))).toThrow(ChannelReconciliationError);
  });

  test('rejects a change whose prototype is not Object.prototype', () => {
    const proto = { channelReconciliationSchemaVersion: 1 };
    const obj = Object.create(proto);
    obj.memberRef = 'mbr_A';
    obj.membershipVersion = 1;
    obj.membershipActive = true;
    obj.channelDesired = { google: true, strava: true, whatsapp: true };
    expect(() => deriveChannelReconciliationTasks(obj)).toThrow(ChannelReconciliationError);
  });

  test('rejects a null-prototype change envelope', () => {
    const obj = Object.create(null);
    obj.channelReconciliationSchemaVersion = 1;
    obj.memberRef = 'mbr_A';
    obj.membershipVersion = 1;
    obj.membershipActive = true;
    obj.channelDesired = { google: true, strava: true, whatsapp: true };
    expect(() => deriveChannelReconciliationTasks(obj)).toThrow(ChannelReconciliationError);
  });

  test('rejects an accessor-backed top-level field without invoking the getter', () => {
    let touched = false;
    const hostile = {
      channelReconciliationSchemaVersion: 1,
      membershipVersion: 7,
      membershipActive: true,
      channelDesired: { google: true, strava: true, whatsapp: true },
    };
    Object.defineProperty(hostile, 'memberRef', {
      enumerable: true,
      configurable: true,
      get() { touched = true; return 'mbr_A'; },
    });
    expect(() => deriveChannelReconciliationTasks(hostile)).toThrow(ChannelReconciliationError);
    expect(touched).toBe(false);
  });
});

describe('error identity and non-echo', () => {
  test('throws a typed, frozen error with a fixed code and message', () => {
    let caught;
    try {
      deriveChannelReconciliationTasks(null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChannelReconciliationError);
    expect(caught.name).toBe('ChannelReconciliationError');
    expect(caught.code).toBe('invalid_channel_reconciliation_change');
    expect(caught.message).toBe('Channel reconciliation change evidence is invalid.');
    expect(Object.isFrozen(caught)).toBe(true);
  });

  test('never echoes a hostile field name or value into the error', () => {
    let caught;
    try {
      deriveChannelReconciliationTasks({ ...change(), leakedSecretField: 'LEAK-MARKER-7788' });
    } catch (err) {
      caught = err;
    }
    const serialized = `${caught.message}|${JSON.stringify(
      Object.getOwnPropertyNames(caught).reduce((acc, key) => {
        acc[key] = caught[key];
        return acc;
      }, {}),
    )}`;
    expect(serialized).not.toContain('LEAK-MARKER-7788');
    expect(serialized).not.toContain('leakedSecretField');
  });
});

describe('provider write-mode registry', () => {
  test('every supported provider is manual by default', () => {
    expect(PROVIDER_WRITE_MODE).toEqual({
      google: 'manual',
      strava: 'manual',
      whatsapp: 'manual',
    });
  });

  test('every derived task carries its provider write mode', () => {
    const result = deriveChannelReconciliationTasks(change());
    result.tasks.forEach((task) => {
      expect(task.mode).toBe(PROVIDER_WRITE_MODE[task.provider]);
      expect(task.mode).toBe('manual');
    });
  });
});

describe('source boundary (executable code only)', () => {
  test.each([
    [/process\.env/],
    [/Date\.now/],
    [/new Date/],
    [/Math\.random/],
    [/console\./],
    [/fetch\(/],
    [/https?:/],
    [/firebase/i],
    [/firestore/i],
    [/stripe/i],
    [/instagram/i],
    [/facebook/i],
    [/phone/i],
    [/address/i],
    [/\bdob\b/i],
    [/\bssn\b/i],
    [/secret/i],
    [/\btoken\b/i],
    [/password/i],
    [/bearer/i],
    [/api[_-]?key/i],
    [/invite/i],
    [/roster/i],
  ])('module code does not reference %p', (pattern) => {
    expect(CODE).not.toMatch(pattern);
  });

  test('module requires only node:util', () => {
    const requires = CODE.match(/require\((?:'[^']*'|"[^"]*")\)/g) || [];
    expect(requires).toEqual(["require('node:util')"]);
  });

  test('raw source still documents its issue code and versioned surface', () => {
    expect(RAW_SOURCE).toContain('CHANNEL-QUEUE-001A');
    expect(RAW_SOURCE).toContain('channelReconciliationSchemaVersion');
    expect(RAW_SOURCE).toContain("require('node:util')");
  });

  test('the module is imported by nothing in the Functions index', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('channelReconciliationTasks');
  });
});
