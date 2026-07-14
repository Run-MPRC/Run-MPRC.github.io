const fs = require('node:fs');
const path = require('node:path');

const {
  RaceCheckoutValidationError,
  parseRaceCheckoutAnswers,
  parseRaceCheckoutRequest,
} = require('./raceCheckoutValidation');

const HOSTILE_CANARY = 'private-runner@example.test/token?secret=do-not-copy';
const FIXED_MESSAGE = 'Race checkout request is invalid';

function participant(overrides = {}) {
  return {
    eventId: 'race-2026',
    runner: {
      firstName: 'Test',
      lastName: 'Runner',
      email: 'runner@example.test',
    },
    priceTier: 'nonMember',
    acceptedWaiver: true,
    ...overrides,
  };
}

function field(overrides = {}) {
  return {
    key: 'pace_group',
    label: 'Pace group',
    type: 'text',
    required: false,
    ...overrides,
  };
}

function answers(overrides = {}) {
  return {
    signupType: 'participant',
    customFields: {},
    eventCustomFields: [],
    volunteerCustomFields: [],
    ...overrides,
  };
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected validation to fail');
}

function expectFixedFailure(callback) {
  const error = captureError(callback);
  expect(error).toBeInstanceOf(RaceCheckoutValidationError);
  expect(error.name).toBe('RaceCheckoutValidationError');
  expect(error.message).toBe(FIXED_MESSAGE);
  expect(Object.keys(error)).toEqual([]);
  expect(JSON.stringify(error)).toBe('{}');
  expect(error.stack).not.toContain(HOSTILE_CANARY);
  expect(Object.isFrozen(error)).toBe(true);
  return error;
}

function expectDeepFrozenRegularRequest(result) {
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(result.runner)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(result.customFields)).toBe(Object.prototype);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.runner)).toBe(true);
  expect(Object.isFrozen(result.customFields)).toBe(true);
}

describe('race checkout request envelope', () => {
  test('returns a new normalized deeply frozen participant projection without mutation', () => {
    const input = participant({
      eventId: 'race_2026-final',
      runner: {
        firstName: '  Jose\u0301  ',
        lastName: '  Runner  ',
        email: ' Runner@Example.TEST ',
        phone: ' +1 (650) 555-0100 ',
        dob: '2000-02-29',
        emergencyContactName: '  Test Contact  ',
        emergencyContactPhone: ' 650-555-0199 ',
        shirtSize: ' M ',
      },
      customFields: {
        pace_group: '  8:00\nwave  ',
        needs_bus: false,
      },
      signupType: 'participant',
      priceTier: 'member',
    });
    const before = JSON.stringify(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const runnerDescriptors = Object.getOwnPropertyDescriptors(input.runner);
    const output = parseRaceCheckoutRequest(input);

    expect(output).toEqual({
      eventId: 'race_2026-final',
      runner: {
        firstName: 'José',
        lastName: 'Runner',
        email: 'runner@example.test',
        phone: '+1 (650) 555-0100',
        dob: '2000-02-29',
        emergencyContactName: 'Test Contact',
        emergencyContactPhone: '650-555-0199',
        shirtSize: 'M',
      },
      customFields: {
        needs_bus: false,
        pace_group: '  8:00\nwave  ',
      },
      signupType: 'participant',
      acceptedWaiver: true,
      priceTier: 'member',
    });
    expect(output).not.toBe(input);
    expect(output.runner).not.toBe(input.runner);
    expect(output.customFields).not.toBe(input.customFields);
    expectDeepFrozenRegularRequest(output);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(descriptors);
    expect(Object.getOwnPropertyDescriptors(input.runner)).toEqual(runnerDescriptors);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.runner)).toBe(false);
  });

  test.each(['member', 'nonMember', 'earlyBird'])(
    'accepts the exact participant price tier %s',
    (priceTier) => {
      const output = parseRaceCheckoutRequest(participant({ priceTier }));
      expect(output.signupType).toBe('participant');
      expect(output.priceTier).toBe(priceTier);
    },
  );

  test('defaults an omitted signup type to participant and supplies an empty answer map', () => {
    const output = parseRaceCheckoutRequest(participant());

    expect(output.signupType).toBe('participant');
    expect(output.priceTier).toBe('nonMember');
    expect(output.customFields).toEqual({});
    expectDeepFrozenRegularRequest(output);
  });

  test('accepts an exact volunteer request only without a price tier', () => {
    const input = participant({ signupType: 'volunteer' });
    delete input.priceTier;
    const output = parseRaceCheckoutRequest(input);

    expect(output.signupType).toBe('volunteer');
    expect(output).not.toHaveProperty('priceTier');
    expect(output.acceptedWaiver).toBe(true);
    expectDeepFrozenRegularRequest(output);
  });

  test('normalizes absent, null, and empty optional runner values to null', () => {
    const output = parseRaceCheckoutRequest(participant({
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
        phone: '',
        dob: null,
        emergencyContactName: '   ',
        emergencyContactPhone: null,
        shirtSize: '',
      },
    }));

    expect(output.runner).toEqual({
      firstName: 'Test',
      lastName: 'Runner',
      email: 'runner@example.test',
      phone: null,
      dob: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      shirtSize: null,
    });
  });

  test.each([
    ['missing eventId', (() => { const value = participant(); delete value.eventId; return value; })()],
    ['missing runner', (() => { const value = participant(); delete value.runner; return value; })()],
    ['missing waiver', (() => { const value = participant(); delete value.acceptedWaiver; return value; })()],
    ['unknown root key', participant({ amountCents: 1 })],
    ['false waiver', participant({ acceptedWaiver: false })],
    ['string waiver', participant({ acceptedWaiver: 'true' })],
    ['unknown signup type', participant({ signupType: 'staff' })],
    ['participant without tier', (() => { const value = participant(); delete value.priceTier; return value; })()],
    ['unsupported participant tier', participant({ priceTier: 'comp' })],
    ['volunteer with tier', participant({ signupType: 'volunteer' })],
  ])('rejects %s with one fixed failure', (_name, value) => {
    expectFixedFailure(() => parseRaceCheckoutRequest(value));
  });

  test.each([
    ['missing firstName', (() => {
      const value = participant();
      delete value.runner.firstName;
      return value;
    })()],
    ['missing lastName', (() => {
      const value = participant();
      delete value.runner.lastName;
      return value;
    })()],
    ['missing email', (() => {
      const value = participant();
      delete value.runner.email;
      return value;
    })()],
    ['unknown runner key', participant({
      runner: {
        firstName: 'Test', lastName: 'Runner', email: 'runner@example.test', role: 'admin',
      },
    })],
    ['array runner', participant({ runner: [] })],
    ['class runner', participant({ runner: new (class Runner {})() })],
  ])('rejects %s', (_name, value) => {
    expectFixedFailure(() => parseRaceCheckoutRequest(value));
  });

  test.each([
    ['empty event ID', ''],
    ['leading event-ID space', ' race-1'],
    ['trailing event-ID space', 'race-1 '],
    ['path separator', 'races/one'],
    ['dot', '.'],
    ['dot-dot', '..'],
    ['control', `race\u0000${HOSTILE_CANARY}`],
    ['too many code points', 'r'.repeat(129)],
    ['malformed Unicode', `race-\uD800${HOSTILE_CANARY}`],
  ])('rejects %s in the event ID', (_name, eventId) => {
    expectFixedFailure(() => parseRaceCheckoutRequest(participant({ eventId })));
  });

  test('accepts the exact event-ID code-point and UTF-8 byte boundary', () => {
    const eventId = '😀'.repeat(128);
    expect(Buffer.byteLength(eventId, 'utf8')).toBe(512);
    expect(parseRaceCheckoutRequest(participant({ eventId })).eventId).toBe(eventId);
  });

  test.each([
    ['decomposed Unicode', 'race-e\u0301'],
    ['URL-reserved characters', 'race?wave=1&return=#finish%25'],
  ])('preserves an opaque %s event ID byte-for-byte', (_name, eventId) => {
    expect(parseRaceCheckoutRequest(participant({ eventId })).eventId).toBe(eventId);
  });

  test.each([
    ['empty first name', { firstName: ' ' }],
    ['control in last name', { lastName: `Run\u0000ner${HOSTILE_CANARY}` }],
    ['too-long first name', { firstName: 'n'.repeat(101) }],
    ['invalid email', { email: HOSTILE_CANARY }],
    ['invalid date', { dob: '2025-02-29' }],
    ['noncanonical date', { dob: '01/02/2025' }],
    ['number phone', { phone: 6505550100 }],
    ['too-long phone', { phone: '1'.repeat(33) }],
    ['control in emergency name', { emergencyContactName: 'A\u0009B' }],
    ['object shirt size', { shirtSize: { size: HOSTILE_CANARY } }],
    ['malformed Unicode contact', { emergencyContactPhone: '\uD800' }],
  ])('rejects %s', (_name, runnerPatch) => {
    expectFixedFailure(() => parseRaceCheckoutRequest(participant({
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
        ...runnerPatch,
      },
    })));
  });

  test('accepts exactly fifty safe string/boolean custom answers and normalizes Unicode', () => {
    const customFields = Object.fromEntries(Array.from({ length: 50 }, (_unused, index) => [
      `field_${index}`,
      index === 0 ? 'Cafe\u0301' : index % 2 === 0,
    ]));
    const output = parseRaceCheckoutRequest(participant({ customFields }));

    expect(Object.keys(output.customFields)).toHaveLength(50);
    expect(output.customFields.field_0).toBe('Café');
    expect(Object.isFrozen(output.customFields)).toBe(true);
  });

  test.each([
    ['061C', '\u061C'],
    ['00AD', '\u00AD'],
    ['180E', '\u180E'],
    ['2028', '\u2028'],
    ['2029', '\u2029'],
  ])(
    'rejects Unicode format or line separator U+%s in names and multiline answers',
    (_codePoint, unsafeCharacter) => {
      expectFixedFailure(() => parseRaceCheckoutRequest(participant({
        runner: {
          firstName: `Test${unsafeCharacter}Name`,
          lastName: 'Runner',
          email: 'runner@example.test',
        },
      })));
      expectFixedFailure(() => parseRaceCheckoutRequest(participant({
        customFields: { notes: `before${unsafeCharacter}after` },
      })));
    },
  );

  test('defines dynamic output fields without invoking inherited setters', () => {
    const requestInput = participant({
      customFields: { checkoutBoundaryField: 'request value' },
    });
    const answerInput = answers({
      customFields: { checkoutBoundaryField: 'answer value' },
      eventCustomFields: [field({
        key: 'checkoutBoundaryField',
        label: 'Synthetic field',
        required: true,
      })],
    });
    const priceSetter = jest.fn();
    const fieldSetter = jest.fn();
    let requestOutput;
    let answerOutput;

    Object.defineProperty(Object.prototype, 'priceTier', {
      configurable: true,
      get: () => 'member',
      set: priceSetter,
    });
    Object.defineProperty(Object.prototype, 'checkoutBoundaryField', {
      configurable: true,
      get: () => HOSTILE_CANARY,
      set: fieldSetter,
    });
    try {
      requestOutput = parseRaceCheckoutRequest(requestInput);
      answerOutput = parseRaceCheckoutAnswers(answerInput);
    } finally {
      delete Object.prototype.priceTier;
      delete Object.prototype.checkoutBoundaryField;
    }

    expect(priceSetter).not.toHaveBeenCalled();
    expect(fieldSetter).not.toHaveBeenCalled();
    expect(Object.hasOwn(requestOutput, 'priceTier')).toBe(true);
    expect(requestOutput.priceTier).toBe('nonMember');
    expect(Object.hasOwn(requestOutput.customFields, 'checkoutBoundaryField')).toBe(true);
    expect(requestOutput.customFields.checkoutBoundaryField).toBe('request value');
    expect(Object.hasOwn(answerOutput, 'checkoutBoundaryField')).toBe(true);
    expect(answerOutput.checkoutBoundaryField).toBe('answer value');
  });

  test.each([
    ['too many answers', Object.fromEntries(Array.from(
      { length: 51 }, (_unused, index) => [`field_${index}`, 'value'],
    ))],
    ['unsafe key', { 'not-safe': 'value' }],
    ['leading-digit key', { '1field': 'value' }],
    ['constructor key', { constructor: 'value' }],
    ['prototype key', { prototype: 'value' }],
    ['dangerous JSON key', JSON.parse('{"__proto__":"value"}')],
    ['number answer', { field_1: 1 }],
    ['null answer', { field_1: null }],
    ['array answer', { field_1: [HOSTILE_CANARY] }],
    ['nested answer', { field_1: { value: HOSTILE_CANARY } }],
    ['unsafe text control', { field_1: `value\u0000${HOSTILE_CANARY}` }],
    ['malformed answer Unicode', { field_1: `value\uD800${HOSTILE_CANARY}` }],
  ])('rejects custom answer case: %s', (_name, customFields) => {
    expectFixedFailure(() => parseRaceCheckoutRequest(participant({ customFields })));
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['array', []],
    ['date', new Date('2026-01-01T00:00:00Z')],
    ['regular expression', /race/u],
    ['null prototype', Object.assign(Object.create(null), participant())],
    ['class instance', Object.assign(new (class Request {})(), participant())],
  ])('rejects a %s request root', (_name, value) => {
    expectFixedFailure(() => parseRaceCheckoutRequest(value));
  });

  test('rejects proxies before invoking any reflection trap', () => {
    const traps = {
      getPrototypeOf: jest.fn(() => Object.prototype),
      ownKeys: jest.fn(() => Reflect.ownKeys(participant())),
      getOwnPropertyDescriptor: jest.fn(),
      get: jest.fn(),
    };
    const rootProxy = new Proxy(participant(), traps);
    expectFixedFailure(() => parseRaceCheckoutRequest(rootProxy));

    const runnerTraps = {
      getPrototypeOf: jest.fn(() => Object.prototype),
      ownKeys: jest.fn(() => ['firstName', 'lastName', 'email']),
      getOwnPropertyDescriptor: jest.fn(),
      get: jest.fn(),
    };
    const runnerProxy = new Proxy({}, runnerTraps);
    expectFixedFailure(() => parseRaceCheckoutRequest(participant({ runner: runnerProxy })));
    [...Object.values(traps), ...Object.values(runnerTraps)]
      .forEach((trap) => expect(trap).not.toHaveBeenCalled());
  });

  test('rejects symbols and accessors without invoking getters', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    const symbolRequest = participant();
    symbolRequest[Symbol('private')] = HOSTILE_CANARY;
    expectFixedFailure(() => parseRaceCheckoutRequest(symbolRequest));

    const accessorRequest = participant();
    Object.defineProperty(accessorRequest, 'eventId', { enumerable: true, get: getter });
    expectFixedFailure(() => parseRaceCheckoutRequest(accessorRequest));

    const customAccessor = {};
    Object.defineProperty(customAccessor, 'field_1', { enumerable: true, get: getter });
    expectFixedFailure(() => parseRaceCheckoutRequest(participant({
      customFields: customAccessor,
    })));
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects dangerous keys, polluted prototypes, cycles, depth, and serialized size', () => {
    const dangerousRoot = JSON.parse(
      `{"eventId":"race-1","runner":{"firstName":"Test","lastName":"Runner",`
      + `"email":"runner@example.test"},"priceTier":"nonMember",`
      + `"acceptedWaiver":true,"constructor":"${HOSTILE_CANARY}"}`,
    );
    expectFixedFailure(() => parseRaceCheckoutRequest(dangerousRoot));

    Object.defineProperty(Object.prototype, 'temporaryCheckoutPollution', {
      value: HOSTILE_CANARY,
      enumerable: true,
      configurable: true,
    });
    try {
      expectFixedFailure(() => parseRaceCheckoutRequest(participant()));
    } finally {
      delete Object.prototype.temporaryCheckoutPollution;
    }

    const cycle = participant();
    cycle.customFields = { field_1: cycle };
    expectFixedFailure(() => parseRaceCheckoutRequest(cycle));

    const deep = participant({ customFields: { field_1: { one: { two: { three: 'x' } } } } });
    expectFixedFailure(() => parseRaceCheckoutRequest(deep));

    expectFixedFailure(() => parseRaceCheckoutRequest(participant({
      customFields: { field_1: 'x'.repeat(8193) },
    })));
  });
});

describe('event-defined custom answers', () => {
  test('validates every supported field type and returns a new frozen regular projection', () => {
    const customFields = {
      name: '  Jose\u0301  ',
      email: ' Runner@Example.TEST ',
      phone: ' +1 650 555 0100 ',
      number: '-12.50',
      date: '2024-02-29',
      choice: '  Wave A  ',
      consent: true,
      notes: '  line one\nline two  ',
      optional_check: false,
    };
    const eventCustomFields = [
      field({ key: 'name', label: 'Name', type: 'text', required: true }),
      field({ key: 'email', label: 'Email', type: 'email', required: true }),
      field({ key: 'phone', label: 'Phone', type: 'tel', required: true }),
      field({ key: 'number', label: 'Number', type: 'number', required: true }),
      field({ key: 'date', label: 'Date', type: 'date', required: true }),
      field({
        key: 'choice',
        label: 'Choice',
        type: 'select',
        required: true,
        options: ['Wave A', 'Wave B'],
      }),
      field({ key: 'consent', label: 'Consent', type: 'checkbox', required: true }),
      field({ key: 'notes', label: 'Notes', type: 'textarea', required: true }),
      field({
        key: 'optional_check', label: 'Updates', type: 'checkbox', required: false,
      }),
    ];
    const inputBefore = JSON.stringify(customFields);
    const schemaBefore = JSON.stringify(eventCustomFields);
    const output = parseRaceCheckoutAnswers(answers({
      customFields,
      eventCustomFields,
    }));

    expect(output).toEqual({
      name: 'José',
      email: 'runner@example.test',
      phone: '+1 650 555 0100',
      number: '-12.50',
      date: '2024-02-29',
      choice: 'Wave A',
      consent: true,
      notes: 'line one\nline two',
      optional_check: false,
    });
    expect(output).not.toBe(customFields);
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.isFrozen(output)).toBe(true);
    expect(JSON.stringify(customFields)).toBe(inputBefore);
    expect(JSON.stringify(eventCustomFields)).toBe(schemaBefore);
    expect(Object.isFrozen(customFields)).toBe(false);
    expect(Object.isFrozen(eventCustomFields)).toBe(false);
  });

  test('uses nonempty volunteer fields and rejects participant-only answers', () => {
    const output = parseRaceCheckoutAnswers(answers({
      signupType: 'volunteer',
      customFields: { shift: 'Morning' },
      eventCustomFields: [field({ key: 'pace', label: 'Pace' })],
      volunteerCustomFields: [field({
        key: 'shift',
        label: 'Shift',
        type: 'select',
        required: true,
        options: ['Morning', 'Afternoon'],
      })],
    }));
    expect(output).toEqual({ shift: 'Morning' });

    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      signupType: 'volunteer',
      customFields: { pace: '8:00' },
      eventCustomFields: [field({ key: 'pace', label: 'Pace' })],
      volunteerCustomFields: [field({ key: 'shift', label: 'Shift' })],
    })));
  });

  test('validates only the selected participant or nonempty volunteer schema', () => {
    expect(parseRaceCheckoutAnswers(answers({
      signupType: 'participant',
      eventCustomFields: [],
      volunteerCustomFields: HOSTILE_CANARY,
    }))).toEqual({});

    expect(parseRaceCheckoutAnswers(answers({
      signupType: 'volunteer',
      customFields: { shift: 'Morning' },
      eventCustomFields: HOSTILE_CANARY,
      volunteerCustomFields: [field({
        key: 'shift', label: 'Shift', required: true,
      })],
    }))).toEqual({ shift: 'Morning' });
  });

  test('rejects a malformed selected volunteer schema instead of falling back', () => {
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      signupType: 'volunteer',
      volunteerCustomFields: HOSTILE_CANARY,
    })));
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      signupType: 'volunteer',
      volunteerCustomFields: [field({ required: 'true' })],
    })));
  });

  test.each([
    ['omitted volunteer fields', undefined],
    ['empty volunteer fields', []],
  ])('volunteer falls back to event fields with %s', (_name, volunteerCustomFields) => {
    const input = answers({
      signupType: 'volunteer',
      customFields: { shared: 'value' },
      eventCustomFields: [field({ key: 'shared', label: 'Shared', required: true })],
      volunteerCustomFields,
    });
    if (volunteerCustomFields === undefined) delete input.volunteerCustomFields;

    expect(parseRaceCheckoutAnswers(input)).toEqual({ shared: 'value' });
  });

  test('allows omitted optional answers and drops provided empty optional strings', () => {
    const output = parseRaceCheckoutAnswers(answers({
      customFields: { optional_text: '   ' },
      eventCustomFields: [
        field({ key: 'optional_text', label: 'Optional', required: false }),
        field({ key: 'also_optional', label: 'Also optional', required: false }),
      ],
    }));

    expect(output).toEqual({});
    expect(Object.isFrozen(output)).toBe(true);
  });

  test.each([
    ['missing required text', {}, field({ required: true })],
    ['empty required text', { pace_group: ' ' }, field({ required: true })],
    ['missing required checkbox', {}, field({ type: 'checkbox', required: true })],
    ['false required checkbox', { pace_group: false }, field({
      type: 'checkbox', required: true,
    })],
    ['unknown answer', { unknown: HOSTILE_CANARY }, field()],
    ['boolean text', { pace_group: true }, field()],
    ['string checkbox', { pace_group: 'true' }, field({ type: 'checkbox' })],
  ])('rejects answer mismatch: %s', (_name, customFields, definition) => {
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      customFields,
      eventCustomFields: [definition],
    })));
  });

  test.each([
    ['invalid email', 'email', HOSTILE_CANARY, {}],
    ['invalid date', 'date', '2023-02-29', {}],
    ['exponent number', 'number', '1e3', {}],
    ['leading-zero number', 'number', '01', {}],
    ['positive sign number', 'number', '+1', {}],
    ['negative zero number', 'number', '-0.0', {}],
    ['too-long number', 'number', '1'.repeat(33), {}],
    ['unknown select choice', 'select', HOSTILE_CANARY, { options: ['Known'] }],
    ['control in text', 'text', `value\n${HOSTILE_CANARY}`, {}],
    ['control in phone', 'tel', `650\u0009${HOSTILE_CANARY}`, {}],
    ['unsafe textarea control', 'textarea', `note\u0000${HOSTILE_CANARY}`, {}],
  ])('rejects invalid typed value: %s', (_name, type, value, extra) => {
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      customFields: { value },
      eventCustomFields: [field({
        key: 'value', label: 'Value', type, required: true, ...extra,
      })],
    })));
  });

  test('accepts canonical bounded decimal strings', () => {
    for (const value of ['0', '12', '-12', '12.50', '-0.5']) {
      expect(parseRaceCheckoutAnswers(answers({
        customFields: { number: value },
        eventCustomFields: [field({
          key: 'number', label: 'Number', type: 'number', required: true,
        })],
      }))).toEqual({ number: value });
    }
  });

  test('accepts exactly fifty field definitions and fifty unique select choices', () => {
    const eventCustomFields = Array.from({ length: 50 }, (_unused, index) => field({
      key: `field_${index}`,
      label: `Field ${index}`,
    }));
    expect(parseRaceCheckoutAnswers(answers({ eventCustomFields }))).toEqual({});

    const options = Array.from({ length: 50 }, (_unused, index) => `Choice ${index}`);
    expect(parseRaceCheckoutAnswers(answers({
      customFields: { choice: 'Choice 49' },
      eventCustomFields: [field({
        key: 'choice', label: 'Choice', type: 'select', required: true, options,
      })],
    }))).toEqual({ choice: 'Choice 49' });
  });

  test.each([
    ['too many fields', Array.from({ length: 51 }, (_unused, index) => field({
      key: `field_${index}`, label: `Field ${index}`,
    }))],
    ['duplicate keys', [field(), field({ label: 'Duplicate' })]],
    ['dangerous constructor key', [field({ key: 'constructor' })]],
    ['dangerous prototype key', [field({ key: 'prototype' })]],
    ['unsafe key syntax', [field({ key: 'not-safe' })]],
    ['empty label', [field({ label: ' ' })]],
    ['unknown type', [field({ type: 'file' })]],
    ['string required flag', [field({ required: 'false' })]],
    ['unknown definition key', [field({ retentionDays: 1 })]],
    ['options on text', [field({ options: ['No'] })]],
    ['select without options', [field({ type: 'select' })]],
    ['select with empty options', [field({ type: 'select', options: [] })]],
    ['select with duplicate options', [field({
      type: 'select', options: ['Wave A', 'Wave A'],
    })]],
    ['select with normalized duplicate options', [field({
      type: 'select', options: ['Café', 'Cafe\u0301'],
    })]],
    ['select with empty option', [field({ type: 'select', options: [' '] })]],
    ['select with too many options', [field({
      type: 'select',
      options: Array.from({ length: 51 }, (_unused, index) => `Choice ${index}`),
    })]],
    ['non-string help text', [field({ helpText: { private: HOSTILE_CANARY } })]],
    ['oversized help text', [field({ helpText: 'h'.repeat(501) })]],
  ])('rejects malformed schema: %s', (_name, eventCustomFields) => {
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({ eventCustomFields })));
  });

  test.each([
    ['missing signupType', (() => { const value = answers(); delete value.signupType; return value; })()],
    ['missing customFields', (() => { const value = answers(); delete value.customFields; return value; })()],
    ['missing eventCustomFields', (() => {
      const value = answers(); delete value.eventCustomFields; return value;
    })()],
    ['unknown argument', answers({ event: HOSTILE_CANARY })],
    ['unknown signupType', answers({ signupType: 'staff' })],
    ['array argument', []],
    ['null-prototype argument', Object.assign(Object.create(null), answers())],
  ])('rejects answer-parser boundary: %s', (_name, value) => {
    expectFixedFailure(() => parseRaceCheckoutAnswers(value));
  });

  test('rejects sparse/custom arrays, prototypes, symbols, and cycles', () => {
    const sparse = new Array(1);
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      eventCustomFields: sparse,
    })));

    const arrayWithProperty = [];
    arrayWithProperty.private = HOSTILE_CANARY;
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      eventCustomFields: arrayWithProperty,
    })));

    const symbolField = field();
    symbolField[Symbol('private')] = HOSTILE_CANARY;
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      eventCustomFields: [symbolField],
    })));

    const inheritedField = Object.create(field());
    Object.assign(inheritedField, field({ key: 'own_field' }));
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      eventCustomFields: [inheritedField],
    })));

    const cyclicOptions = [];
    cyclicOptions.push(cyclicOptions);
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      eventCustomFields: [field({ type: 'select', options: cyclicOptions })],
    })));
  });

  test('rejects answer and schema proxies before invoking traps', () => {
    const answerTraps = {
      getPrototypeOf: jest.fn(() => Object.prototype),
      ownKeys: jest.fn(() => ['pace_group']),
      getOwnPropertyDescriptor: jest.fn(),
      get: jest.fn(),
    };
    const answerProxy = new Proxy({}, answerTraps);
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      customFields: answerProxy,
    })));

    const schemaTraps = {
      getPrototypeOf: jest.fn(() => Array.prototype),
      ownKeys: jest.fn(() => ['length']),
      getOwnPropertyDescriptor: jest.fn(),
      get: jest.fn(),
    };
    const schemaProxy = new Proxy([], schemaTraps);
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      eventCustomFields: schemaProxy,
    })));
    [...Object.values(answerTraps), ...Object.values(schemaTraps)]
      .forEach((trap) => expect(trap).not.toHaveBeenCalled());
  });

  test('rejects answer and definition accessors without invoking getters', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    const customFields = {};
    Object.defineProperty(customFields, 'pace_group', { enumerable: true, get: getter });
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({ customFields })));

    const definition = field();
    Object.defineProperty(definition, 'label', { enumerable: true, get: getter });
    expectFixedFailure(() => parseRaceCheckoutAnswers(answers({
      eventCustomFields: [definition],
    })));
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('fixed errors and dependency boundary', () => {
  test('the error constructor ignores supplied values and exposes no enumerable detail', () => {
    const error = new RaceCheckoutValidationError(HOSTILE_CANARY);

    expect(error.message).toBe(FIXED_MESSAGE);
    expect(error.name).toBe('RaceCheckoutValidationError');
    expect(Object.keys(error)).toEqual([]);
    expect(JSON.stringify(error)).toBe('{}');
    expect(error.stack).not.toContain(HOSTILE_CANARY);
    expect(RaceCheckoutValidationError).toHaveLength(0);
  });

  test('all representative failures have byte-equivalent public errors without input echo', () => {
    const errors = [
      captureError(() => parseRaceCheckoutRequest(participant({ eventId: HOSTILE_CANARY }))),
      captureError(() => parseRaceCheckoutRequest(participant({
        runner: { firstName: HOSTILE_CANARY, lastName: '', email: HOSTILE_CANARY },
      }))),
      captureError(() => parseRaceCheckoutAnswers(answers({
        customFields: { unknown: HOSTILE_CANARY },
      }))),
    ];

    for (const error of errors) {
      expect(error.name).toBe('RaceCheckoutValidationError');
      expect(error.message).toBe(FIXED_MESSAGE);
      expect(JSON.stringify(error)).toBe('{}');
      expect(error.stack).not.toContain(HOSTILE_CANARY);
    }
  });

  test('source has only pure validation dependencies and no side-effect capabilities', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'raceCheckoutValidation.js'),
      'utf8',
    );
    const dependencies = [...source.matchAll(/require\((['"])([^'"]+)\1\)/gu)]
      .map((match) => match[2]);

    expect(dependencies).toEqual(['node:util', './requestValidation']);
    expect(source).not.toMatch(/firebase|stripe|firestore|httpsCallable|onCall/iu);
    expect(source).not.toMatch(
      /console\.|process\.env|\bDate(?:\.|\s*\()|Math\.random|crypto/gu,
    );
    expect(source).not.toMatch(/fetch\(|https?\.request|writeFile|appendFile/gu);
  });
});
