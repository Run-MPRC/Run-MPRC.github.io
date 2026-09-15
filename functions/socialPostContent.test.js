const fs = require('node:fs');
const path = require('node:path');

const {
  socialPostContentSchemaVersion,
  SocialPostContentError,
  validateSocialPostContent,
  computeSocialPostPayloadHash,
} = require('./socialPostContent');

// The reducer's opaque-identifier shape (socialPostState.js). The derived hash
// must satisfy it so the reducer and plan builder accept it as a payloadHash.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const HOSTILE_CANARY = 'caption=leak; media=https://cdn.example/signed?sig=abc; contact=+12025550123';

function content(overrides = {}) {
  return {
    contentSchemaVersion: 1,
    caption: 'Saturday long run from the boathouse. All paces welcome.',
    mediaReference: 'media_2026_summer.0007',
    altText: 'Runners gathered on a riverside path at sunrise.',
    scheduledAtEpochSeconds: 1_800_000_000,
    displayTimeZone: 'America/Los_Angeles',
    disclosureRequired: false,
    ...overrides,
  };
}

function expectValid(candidate) {
  const result = validateSocialPostContent(candidate);
  expect(result.accepted).toBe(true);
  expect(result.status).toBe('valid');
  expect(result.reasons).toEqual([]);
  expect(Object.isFrozen(result.projection)).toBe(true);
  return result.projection;
}

function expectInvalid(candidate) {
  const result = validateSocialPostContent(candidate);
  expect(result.accepted).toBe(false);
  expect(result.status).toBe('rejected');
  expect(result.reasons).toEqual(['invalid_content']);
  expect(result.projection).toBeNull();
  expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
}

describe('versioned surface', () => {
  test('schema version is 1 and the export is frozen', () => {
    expect(socialPostContentSchemaVersion).toBe(1);
    expect(Object.isFrozen(require('./socialPostContent'))).toBe(true);
  });
});

describe('validateSocialPostContent — acceptance', () => {
  test('a canonical record validates and projects an equal frozen copy', () => {
    expect(expectValid(content())).toEqual(content());
  });

  test('caption may carry tabs and newlines', () => {
    expectValid(content({ caption: 'line one\nline two\twith a tab' }));
  });

  test('displayTimeZone accepts UTC and a three-segment zone', () => {
    expectValid(content({ displayTimeZone: 'UTC' }));
    expectValid(content({ displayTimeZone: 'America/Argentina/Buenos_Aires' }));
  });

  test('the schedule bounds are inclusive at both ends', () => {
    expectValid(content({ scheduledAtEpochSeconds: 0 }));
    expectValid(content({ scheduledAtEpochSeconds: 4_102_444_800 }));
  });
});

describe('validateSocialPostContent — rejection', () => {
  const BAD = [
    ['not an object', HOSTILE_CANARY],
    ['null', null],
    ['an array', [content()]],
    ['wrong schema version', content({ contentSchemaVersion: 2 })],
    ['empty caption', content({ caption: '' })],
    ['caption over the limit', content({ caption: 'x'.repeat(2201) })],
    ['caption with a NUL', content({ caption: 'hi\x00there' })],
    ['caption with a C1 control', content({ caption: 'hi\x85there' })],
    ['non-string caption', content({ caption: 42 })],
    ['media reference with a space', content({ mediaReference: 'media 7' })],
    ['media reference that looks like a URL', content({ mediaReference: 'https://x/y' })],
    ['empty media reference', content({ mediaReference: '' })],
    ['empty alt text', content({ altText: '' })],
    ['alt text with a newline', content({ altText: 'first line\nsecond line' })],
    ['alt text over the limit', content({ altText: 'x'.repeat(1001) })],
    ['fractional schedule', content({ scheduledAtEpochSeconds: 1.5 })],
    ['negative schedule', content({ scheduledAtEpochSeconds: -1 })],
    ['negative zero schedule', content({ scheduledAtEpochSeconds: -0 })],
    ['schedule past the year 2100', content({ scheduledAtEpochSeconds: 4_102_444_801 })],
    ['string schedule', content({ scheduledAtEpochSeconds: '1800000000' })],
    ['unknown time zone shape', content({ displayTimeZone: 'Pacific Time' })],
    ['single-segment time zone', content({ displayTimeZone: 'America' })],
    ['over-long time zone', content({ displayTimeZone: `Etc/${'X'.repeat(64)}` })],
    ['non-boolean disclosure flag', content({ disclosureRequired: 'no' })],
    ['extra key', { ...content(), leaked: HOSTILE_CANARY }],
    ['missing key', (() => { const c = content(); delete c.altText; return c; })()],
  ];

  test.each(BAD)('rejects %s', (_label, candidate) => {
    expectInvalid(candidate);
  });

  test('a Proxy is rejected without invoking a trap', () => {
    let trapped = false;
    const proxied = new Proxy(content(), {
      get(target, prop, receiver) { trapped = true; return Reflect.get(target, prop, receiver); },
    });
    expect(validateSocialPostContent(proxied).accepted).toBe(false);
    expect(trapped).toBe(false);
  });

  test('an accessor-backed field is rejected without invoking the getter', () => {
    let invoked = false;
    const hostile = content();
    Object.defineProperty(hostile, 'caption', {
      enumerable: true,
      get() { invoked = true; return 'clean'; },
    });
    expect(validateSocialPostContent(hostile).accepted).toBe(false);
    expect(invoked).toBe(false);
  });
});

describe('computeSocialPostPayloadHash', () => {
  test('produces a lowercase sha-256 hex that is a valid opaque identifier', () => {
    const hash = computeSocialPostPayloadHash(content());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(OPAQUE_IDENTIFIER_PATTERN);
  });

  test('is deterministic for an equal record', () => {
    expect(computeSocialPostPayloadHash(content())).toBe(computeSocialPostPayloadHash(content()));
  });

  test('every field participates in the digest', () => {
    const base = computeSocialPostPayloadHash(content());
    const changes = [
      { caption: 'A different caption entirely.' },
      { mediaReference: 'media_2026_summer.0008' },
      { altText: 'A different description of the scene.' },
      { scheduledAtEpochSeconds: 1_800_000_001 },
      { displayTimeZone: 'UTC' },
      { disclosureRequired: true },
    ];
    for (const change of changes) {
      expect(computeSocialPostPayloadHash(content(change))).not.toBe(base);
    }
  });

  test('length framing prevents a field-boundary collision', () => {
    const a = computeSocialPostPayloadHash(content({ caption: 'ab', altText: 'cd' }));
    const b = computeSocialPostPayloadHash(content({ caption: 'abc', altText: 'd' }));
    expect(a).not.toBe(b);
  });

  test('throws SocialPostContentError on an invalid record and never echoes it', () => {
    for (const bad of [
      null,
      HOSTILE_CANARY,
      content({ caption: '' }),
      content({ mediaReference: 'https://x/y' }),
      { ...content(), leaked: HOSTILE_CANARY },
    ]) {
      let thrown;
      try {
        computeSocialPostPayloadHash(bad);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SocialPostContentError);
      expect(thrown.reason).toBe('invalid_content');
      expect(String(thrown.message)).not.toContain(HOSTILE_CANARY);
    }
  });
});

describe('source boundary — pure, unused, provider-neutral', () => {
  const source = fs.readFileSync(path.join(__dirname, 'socialPostContent.js'), 'utf8');
  function codeOnly(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  }
  const code = codeOnly(source);

  test('requires only node:crypto and node:util', () => {
    const requires = [...code.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(requires).toEqual(["'node:crypto'", "'node:util'"]);
  });

  test('is not imported by the functions runtime entry point', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('socialPostContent');
  });

  test('reads no clock, randomness, environment, network, or provider surface', () => {
    for (const forbidden of [
      /process\.env/, /Date\.now/, /new Date/, /Math\.random/, /console\./,
      /fetch\(/, /https?:/, /firebase/i, /firestore/i, /stripe/i,
    ]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  test('the executable surface names no concrete social provider', () => {
    expect(code).not.toMatch(/instagram/i);
    expect(code).not.toMatch(/facebook/i);
  });

  test('the digest is domain-separated', () => {
    expect(source).toContain('mprc-social-post-payload-sha256');
    expect(source).toContain('mprc.social-post-payload.v1');
  });
});
