const { types: { isProxy } } = require('node:util');

const {
  parseBoundedString,
  parseCalendarDate,
  parseEmail,
  parseStrictObject,
} = require('./requestValidation');

const RACE_CHECKOUT_VALIDATION_MESSAGE = 'Race checkout request is invalid';
const MAX_CUSTOM_FIELDS = 50;
const MAX_SELECT_OPTIONS = 50;
const SAFE_CUSTOM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FIELD_TYPES = new Set([
  'text',
  'email',
  'tel',
  'number',
  'date',
  'select',
  'checkbox',
  'textarea',
]);
const PARTICIPANT_PRICE_TIERS = new Set(['member', 'nonMember', 'earlyBird']);
const UNSAFE_UNICODE_SEPARATORS_OR_FORMATS = /[\p{Cf}\p{Zl}\p{Zp}]/u;

class RaceCheckoutValidationError extends Error {
  constructor() {
    super(RACE_CHECKOUT_VALIDATION_MESSAGE);
    Object.defineProperty(this, 'message', {
      value: RACE_CHECKOUT_VALIDATION_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'name', {
      value: 'RaceCheckoutValidationError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, RaceCheckoutValidationError);
    Object.freeze(this);
  }
}

function reject() {
  throw new RaceCheckoutValidationError();
}

function withFixedFailure(callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof RaceCheckoutValidationError) throw error;
    reject();
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function defineOwnDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isSafeCustomKey(value) {
  return typeof value === 'string'
    && SAFE_CUSTOM_KEY.test(value)
    && !DANGEROUS_KEYS.has(value);
}

function hasUnsafeControl(value, multiline) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const allowedMultilineControl = multiline && [9, 10, 13].includes(code);
    if ((!allowedMultilineControl && code <= 31)
      || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return UNSAFE_UNICODE_SEPARATORS_OR_FORMATS.test(value);
}

function parseText(value, {
  maxCodePoints,
  maxBytes,
  trim = true,
  multiline = false,
  allowEmpty = false,
}) {
  const parsed = parseBoundedString(value, {
    maxCodePoints,
    maxBytes,
    normalize: 'NFC',
    trim,
  });
  if ((!allowEmpty && parsed.length === 0) || hasUnsafeControl(parsed, multiline)) reject();
  return parsed;
}

function parseEventId(value) {
  const parsed = parseBoundedString(value, {
    maxCodePoints: 128,
    maxBytes: 512,
    normalize: false,
    trim: false,
  });
  if (parsed !== parsed.trim()
    || parsed.length === 0
    || hasUnsafeControl(parsed, false)
    || parsed === '.'
    || parsed === '..'
    || parsed.includes('/')) {
    reject();
  }
  return parsed;
}

function parseOptionalText(value, present, limits) {
  if (!present || value === null) return null;
  if (typeof value !== 'string') reject();
  const parsed = parseText(value, { ...limits, allowEmpty: true });
  return parsed === '' ? null : parsed;
}

function parseOptionalDate(value, present) {
  if (!present || value === null || value === '') return null;
  return parseCalendarDate(value);
}

function parseRunner(value) {
  const runner = parseStrictObject(value, {
    requiredKeys: ['firstName', 'lastName', 'email'],
    optionalKeys: [
      'phone',
      'dob',
      'emergencyContactName',
      'emergencyContactPhone',
      'shirtSize',
    ],
    limits: {
      maxDepth: 1,
      maxEntries: 8,
      maxArrayLength: 1,
      maxKeyCodePoints: 64,
      maxKeyBytes: 256,
      maxStringCodePoints: 254,
      maxStringBytes: 1016,
      maxSerializedBytes: 4096,
    },
  });

  const result = {
    firstName: parseText(runner.firstName, { maxCodePoints: 100, maxBytes: 400 }),
    lastName: parseText(runner.lastName, { maxCodePoints: 100, maxBytes: 400 }),
    email: parseEmail(runner.email),
    phone: parseOptionalText(runner.phone, hasOwn(runner, 'phone'), {
      maxCodePoints: 32,
      maxBytes: 128,
    }),
    dob: parseOptionalDate(runner.dob, hasOwn(runner, 'dob')),
    emergencyContactName: parseOptionalText(
      runner.emergencyContactName,
      hasOwn(runner, 'emergencyContactName'),
      { maxCodePoints: 100, maxBytes: 400 },
    ),
    emergencyContactPhone: parseOptionalText(
      runner.emergencyContactPhone,
      hasOwn(runner, 'emergencyContactPhone'),
      { maxCodePoints: 32, maxBytes: 128 },
    ),
    shirtSize: parseOptionalText(runner.shirtSize, hasOwn(runner, 'shirtSize'), {
      maxCodePoints: 32,
      maxBytes: 128,
    }),
  };
  return Object.freeze(result);
}

function parseRequestCustomFields(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject();
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_CUSTOM_FIELDS) reject();

  const result = {};
  for (const key of keys) {
    if (!isSafeCustomKey(key)) reject();
    const answer = value[key];
    if (typeof answer === 'boolean') {
      defineOwnDataProperty(result, key, answer);
    } else if (typeof answer === 'string') {
      defineOwnDataProperty(result, key, parseText(answer, {
        maxCodePoints: 2000,
        maxBytes: 8192,
        trim: false,
        multiline: true,
        allowEmpty: true,
      }));
    } else {
      reject();
    }
  }
  return Object.freeze(result);
}

function parseRaceCheckoutRequest(data) {
  return withFixedFailure(() => {
    const request = parseStrictObject(data, {
      requiredKeys: ['eventId', 'runner', 'acceptedWaiver'],
      optionalKeys: ['customFields', 'priceTier', 'signupType'],
      limits: {
        maxDepth: 3,
        maxEntries: 70,
        maxArrayLength: 50,
        maxKeyCodePoints: 64,
        maxKeyBytes: 256,
        maxStringCodePoints: 2000,
        maxStringBytes: 8192,
        maxSerializedBytes: 32768,
      },
    });
    if (request.acceptedWaiver !== true) reject();

    const signupType = hasOwn(request, 'signupType')
      ? request.signupType
      : 'participant';
    if (signupType !== 'participant' && signupType !== 'volunteer') reject();

    const hasPriceTier = hasOwn(request, 'priceTier');
    if (signupType === 'participant') {
      if (!hasPriceTier || !PARTICIPANT_PRICE_TIERS.has(request.priceTier)) reject();
    } else if (hasPriceTier) {
      reject();
    }

    const customFields = hasOwn(request, 'customFields')
      ? parseRequestCustomFields(request.customFields)
      : Object.freeze({});
    const result = {
      eventId: parseEventId(request.eventId),
      runner: parseRunner(request.runner),
      customFields,
      signupType,
      acceptedWaiver: true,
    };
    if (signupType === 'participant') {
      defineOwnDataProperty(result, 'priceTier', request.priceTier);
    }
    return Object.freeze(result);
  });
}

function readPlainObject(value, { requiredKeys, optionalKeys, maximumEntries }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) {
    reject();
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    reject();
  }
  if (prototype !== Object.prototype || keys.length > maximumEntries) reject();

  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const entries = new Map();
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.has(key)) reject();
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      reject();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !hasOwn(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      reject();
    }
    entries.set(key, descriptor.value);
  }
  if (requiredKeys.some((key) => !entries.has(key))) reject();
  for (const key in value) {
    if (!hasOwn(value, key)) reject();
  }
  return entries;
}

function readArray(value, maximumLength) {
  if (value === null || typeof value !== 'object' || isProxy(value) || !Array.isArray(value)) {
    reject();
  }
  let prototype;
  let keys;
  let lengthDescriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  } catch {
    reject();
  }
  if (prototype !== Array.prototype
    || !lengthDescriptor
    || !hasOwn(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > maximumLength) {
    reject();
  }

  const length = lengthDescriptor.value;
  const values = new Map();
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string') reject();
    const index = Number(key);
    if (!Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || String(index) !== key) {
      reject();
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      reject();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !hasOwn(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      reject();
    }
    values.set(index, descriptor.value);
  }
  if (values.size !== length) reject();
  for (const key in value) {
    if (!hasOwn(value, key)) reject();
  }
  return Array.from({ length }, (_unused, index) => values.get(index));
}

function parseDefinitionString(
  value,
  maximumCodePoints,
  maximumBytes,
  allowEmpty = false,
  multiline = false,
) {
  return parseText(value, {
    maxCodePoints: maximumCodePoints,
    maxBytes: maximumBytes,
    trim: true,
    multiline,
    allowEmpty,
  });
}

function parseFieldDefinitionValues(fields) {
  const keys = new Set();

  return fields.map((field) => {
    const entries = readPlainObject(field, {
      requiredKeys: ['key', 'label', 'type', 'required'],
      optionalKeys: ['options', 'helpText'],
      maximumEntries: 6,
    });
    const key = entries.get('key');
    if (!isSafeCustomKey(key) || keys.has(key)) reject();
    keys.add(key);

    const label = parseDefinitionString(entries.get('label'), 100, 400);
    const type = entries.get('type');
    const required = entries.get('required');
    if (!FIELD_TYPES.has(type) || typeof required !== 'boolean') reject();

    if (entries.has('helpText')) {
      parseDefinitionString(entries.get('helpText'), 500, 2000, true, true);
    }

    let options = null;
    if (type === 'select') {
      if (!entries.has('options')) reject();
      const rawOptions = readArray(entries.get('options'), MAX_SELECT_OPTIONS);
      if (rawOptions.length === 0) reject();
      const seenOptions = new Set();
      options = rawOptions.map((option) => {
        const parsed = parseDefinitionString(option, 100, 400);
        if (seenOptions.has(parsed)) reject();
        seenOptions.add(parsed);
        return parsed;
      });
      Object.freeze(options);
    } else if (entries.has('options')) {
      reject();
    }

    return Object.freeze({ key, label, type, required, options });
  });
}

function parseFieldDefinitions(value) {
  return parseFieldDefinitionValues(readArray(value, MAX_CUSTOM_FIELDS));
}

function readCustomAnswers(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) {
    reject();
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    reject();
  }
  if (prototype !== Object.prototype || keys.length > MAX_CUSTOM_FIELDS) reject();

  const answers = new Map();
  for (const key of keys) {
    if (!isSafeCustomKey(key)) reject();
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      reject();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !hasOwn(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || !['string', 'boolean'].includes(typeof descriptor.value)) {
      reject();
    }
    answers.set(key, descriptor.value);
  }
  for (const key in value) {
    if (!hasOwn(value, key)) reject();
  }
  return answers;
}

function parseDecimalString(value) {
  const parsed = parseText(value, {
    maxCodePoints: 32,
    maxBytes: 32,
    trim: true,
  });
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(parsed)
    || /^-0(?:\.0+)?$/.test(parsed)) {
    reject();
  }
  return parsed;
}

function parseAnswerValue(value, field) {
  if (field.type === 'checkbox') {
    if (typeof value !== 'boolean' || (field.required && value !== true)) reject();
    return value;
  }
  if (typeof value !== 'string') reject();

  if (field.type === 'email') return parseEmail(value);
  if (field.type === 'date') return parseCalendarDate(value);
  if (field.type === 'number') return parseDecimalString(value);
  if (field.type === 'select') {
    const parsed = parseText(value, { maxCodePoints: 100, maxBytes: 400, trim: true });
    if (!field.options.includes(parsed)) reject();
    return parsed;
  }
  if (field.type === 'tel') {
    return parseText(value, { maxCodePoints: 32, maxBytes: 128, trim: true });
  }
  if (field.type === 'textarea') {
    return parseText(value, {
      maxCodePoints: 2000,
      maxBytes: 8192,
      trim: true,
      multiline: true,
    });
  }
  return parseText(value, { maxCodePoints: 200, maxBytes: 800, trim: true });
}

function parseRaceCheckoutAnswers(input) {
  return withFixedFailure(() => {
    const entries = readPlainObject(input, {
      requiredKeys: ['signupType', 'customFields', 'eventCustomFields'],
      optionalKeys: ['volunteerCustomFields'],
      maximumEntries: 4,
    });
    const signupType = entries.get('signupType');
    if (signupType !== 'participant' && signupType !== 'volunteer') reject();

    let selectedFields;
    if (signupType === 'participant') {
      selectedFields = parseFieldDefinitions(entries.get('eventCustomFields'));
    } else if (entries.has('volunteerCustomFields')) {
      const volunteerValues = readArray(
        entries.get('volunteerCustomFields'),
        MAX_CUSTOM_FIELDS,
      );
      selectedFields = volunteerValues.length > 0
        ? parseFieldDefinitionValues(volunteerValues)
        : parseFieldDefinitions(entries.get('eventCustomFields'));
    } else {
      selectedFields = parseFieldDefinitions(entries.get('eventCustomFields'));
    }
    const supplied = readCustomAnswers(entries.get('customFields'));
    const knownKeys = new Set(selectedFields.map((field) => field.key));
    for (const key of supplied.keys()) {
      if (!knownKeys.has(key)) reject();
    }

    const result = {};
    for (const field of selectedFields) {
      if (!supplied.has(field.key)) {
        if (field.required) reject();
        continue;
      }
      const rawValue = supplied.get(field.key);
      if (typeof rawValue === 'string' && rawValue.trim() === '') {
        if (field.required) reject();
        continue;
      }
      defineOwnDataProperty(result, field.key, parseAnswerValue(rawValue, field));
    }
    return Object.freeze(result);
  });
}

module.exports = {
  RaceCheckoutValidationError,
  parseRaceCheckoutAnswers,
  parseRaceCheckoutRequest,
};
