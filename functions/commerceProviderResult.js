const OBJECT_PROTOTYPE = Object.prototype;
const SAFE_CREATE = Object.create;
const SAFE_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_FREEZE = Object.freeze;
const SAFE_FUNCTION_TO_STRING = Function.prototype.call.bind(Function.prototype.toString);
const SAFE_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const SAFE_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_HAS_OWN = Object.hasOwn;
const SAFE_JSON_PARSE = JSON.parse;
const SAFE_JSON_STRINGIFY = JSON.stringify;
const SAFE_OWN_KEYS = Reflect.ownKeys;
const SAFE_SET_HAS = Function.prototype.call.bind(Set.prototype.has);
const MAX_SERIALIZED_EVIDENCE_LENGTH = 1024;

const EXPECTED_OBJECT_PROTOTYPE = SAFE_FREEZE([
  SAFE_FREEZE({
    key: 'constructor',
    kind: 'data',
    name: 'Object',
    length: 1,
    source: 'function Object() { [native code] }',
  }),
  SAFE_FREEZE({
    key: '__defineGetter__',
    kind: 'data',
    name: '__defineGetter__',
    length: 2,
    source: 'function __defineGetter__() { [native code] }',
  }),
  SAFE_FREEZE({
    key: '__defineSetter__',
    kind: 'data',
    name: '__defineSetter__',
    length: 2,
    source: 'function __defineSetter__() { [native code] }',
  }),
  SAFE_FREEZE({
    key: 'hasOwnProperty',
    kind: 'data',
    name: 'hasOwnProperty',
    length: 1,
    source: 'function hasOwnProperty() { [native code] }',
  }),
  SAFE_FREEZE({
    key: '__lookupGetter__',
    kind: 'data',
    name: '__lookupGetter__',
    length: 1,
    source: 'function __lookupGetter__() { [native code] }',
  }),
  SAFE_FREEZE({
    key: '__lookupSetter__',
    kind: 'data',
    name: '__lookupSetter__',
    length: 1,
    source: 'function __lookupSetter__() { [native code] }',
  }),
  SAFE_FREEZE({
    key: 'isPrototypeOf',
    kind: 'data',
    name: 'isPrototypeOf',
    length: 1,
    source: 'function isPrototypeOf() { [native code] }',
  }),
  SAFE_FREEZE({
    key: 'propertyIsEnumerable',
    kind: 'data',
    name: 'propertyIsEnumerable',
    length: 1,
    source: 'function propertyIsEnumerable() { [native code] }',
  }),
  SAFE_FREEZE({
    key: 'toString',
    kind: 'data',
    name: 'toString',
    length: 0,
    source: 'function toString() { [native code] }',
  }),
  SAFE_FREEZE({
    key: 'valueOf',
    kind: 'data',
    name: 'valueOf',
    length: 0,
    source: 'function valueOf() { [native code] }',
  }),
  SAFE_FREEZE({
    key: '__proto__',
    kind: 'accessor',
    getName: 'get __proto__',
    getLength: 0,
    getSource: 'function get __proto__() { [native code] }',
    setName: 'set __proto__',
    setLength: 1,
    setSource: 'function set __proto__() { [native code] }',
  }),
  SAFE_FREEZE({
    key: 'toLocaleString',
    kind: 'data',
    name: 'toLocaleString',
    length: 0,
    source: 'function toLocaleString() { [native code] }',
  }),
]);

function matchesPristineDescriptor(descriptor, expected) {
  if (!descriptor
    || !SAFE_HAS_OWN(descriptor, 'enumerable')
    || !SAFE_HAS_OWN(descriptor, 'configurable')
    || descriptor.enumerable !== false
    || descriptor.configurable !== true) {
    return false;
  }

  if (expected.kind === 'data') {
    return SAFE_HAS_OWN(descriptor, 'value')
      && SAFE_HAS_OWN(descriptor, 'writable')
      && !SAFE_HAS_OWN(descriptor, 'get')
      && !SAFE_HAS_OWN(descriptor, 'set')
      && descriptor.writable === true
      && typeof descriptor.value === 'function'
      && SAFE_FUNCTION_TO_STRING(descriptor.value) === expected.source
      && (expected.key !== 'constructor' || descriptor.value === Object);
  }

  return !SAFE_HAS_OWN(descriptor, 'value')
    && !SAFE_HAS_OWN(descriptor, 'writable')
    && SAFE_HAS_OWN(descriptor, 'get')
    && SAFE_HAS_OWN(descriptor, 'set')
    && typeof descriptor.get === 'function'
    && SAFE_FUNCTION_TO_STRING(descriptor.get) === expected.getSource
    && typeof descriptor.set === 'function'
    && SAFE_FUNCTION_TO_STRING(descriptor.set) === expected.setSource;
}

function snapshotDescriptor(descriptor) {
  if (!descriptor) return null;
  const hasConfigurable = SAFE_HAS_OWN(descriptor, 'configurable');
  const hasEnumerable = SAFE_HAS_OWN(descriptor, 'enumerable');
  const hasValue = SAFE_HAS_OWN(descriptor, 'value');
  const hasWritable = SAFE_HAS_OWN(descriptor, 'writable');
  const hasGet = SAFE_HAS_OWN(descriptor, 'get');
  const hasSet = SAFE_HAS_OWN(descriptor, 'set');
  return SAFE_FREEZE({
    hasConfigurable,
    configurable: hasConfigurable ? descriptor.configurable : undefined,
    hasEnumerable,
    enumerable: hasEnumerable ? descriptor.enumerable : undefined,
    hasValue,
    value: hasValue ? descriptor.value : undefined,
    hasWritable,
    writable: hasWritable ? descriptor.writable : undefined,
    hasGet,
    get: hasGet ? descriptor.get : undefined,
    hasSet,
    set: hasSet ? descriptor.set : undefined,
  });
}

function sameDescriptor(descriptor, snapshot) {
  if (descriptor === undefined || snapshot === null) return false;

  const hasConfigurable = SAFE_HAS_OWN(descriptor, 'configurable');
  const hasEnumerable = SAFE_HAS_OWN(descriptor, 'enumerable');
  const hasValue = SAFE_HAS_OWN(descriptor, 'value');
  const hasWritable = SAFE_HAS_OWN(descriptor, 'writable');
  const hasGet = SAFE_HAS_OWN(descriptor, 'get');
  const hasSet = SAFE_HAS_OWN(descriptor, 'set');

  return hasConfigurable === snapshot.hasConfigurable
    && (!hasConfigurable || descriptor.configurable === snapshot.configurable)
    && hasEnumerable === snapshot.hasEnumerable
    && (!hasEnumerable || descriptor.enumerable === snapshot.enumerable)
    && hasValue === snapshot.hasValue
    && (!hasValue || descriptor.value === snapshot.value)
    && hasWritable === snapshot.hasWritable
    && (!hasWritable || descriptor.writable === snapshot.writable)
    && hasGet === snapshot.hasGet
    && (!hasGet || descriptor.get === snapshot.get)
    && hasSet === snapshot.hasSet
    && (!hasSet || descriptor.set === snapshot.set);
}

const OBJECT_PROTOTYPE_SNAPSHOT = SAFE_FREEZE(EXPECTED_OBJECT_PROTOTYPE.map(
  (expected) => SAFE_FREEZE({
    key: expected.key,
    descriptor: snapshotDescriptor(
      SAFE_GET_OWN_PROPERTY_DESCRIPTOR(OBJECT_PROTOTYPE, expected.key),
    ),
  }),
));

let OBJECT_PROTOTYPE_WAS_PRISTINE_AT_LOAD = false;
try {
  const keysAtLoad = SAFE_OWN_KEYS(OBJECT_PROTOTYPE);
  OBJECT_PROTOTYPE_WAS_PRISTINE_AT_LOAD = keysAtLoad.length === OBJECT_PROTOTYPE_SNAPSHOT.length
    && keysAtLoad.every((key, index) => key === OBJECT_PROTOTYPE_SNAPSHOT[index].key)
    && EXPECTED_OBJECT_PROTOTYPE.every((expected) => matchesPristineDescriptor(
      SAFE_GET_OWN_PROPERTY_DESCRIPTOR(OBJECT_PROTOTYPE, expected.key),
      expected,
    ));
} catch {
  OBJECT_PROTOTYPE_WAS_PRISTINE_AT_LOAD = false;
}

function hasPristineObjectPrototype() {
  if (!OBJECT_PROTOTYPE_WAS_PRISTINE_AT_LOAD) return false;

  let keys;
  try {
    keys = SAFE_OWN_KEYS(OBJECT_PROTOTYPE);
  } catch {
    return false;
  }
  if (keys.length !== OBJECT_PROTOTYPE_SNAPSHOT.length) return false;

  for (let index = 0; index < OBJECT_PROTOTYPE_SNAPSHOT.length; index += 1) {
    const snapshot = OBJECT_PROTOTYPE_SNAPSHOT[index];
    if (keys[index] !== snapshot.key) return false;

    let descriptor;
    try {
      descriptor = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(OBJECT_PROTOTYPE, snapshot.key);
    } catch {
      return false;
    }
    if (!sameDescriptor(descriptor, snapshot.descriptor)) return false;
  }
  return true;
}

const providerResultPolicySchemaVersion = 1;
const PROVIDER_RESULT_ERROR_MESSAGE = 'Commerce provider result evidence is invalid.';

const EXPECTED_FIELDS = Object.freeze([
  'providerResultPolicySchemaVersion',
  'provider',
  'providerAttempt',
  'providerOperation',
  'planBinding',
  'sendEvidenceBinding',
  'evidenceSource',
  'evidenceCompleteness',
  'responseEvidence',
  'providerObjectEvidence',
  'environmentEvidence',
  'parameterEvidence',
  'resultReferenceEvidence',
  'redirectEvidence',
  'paymentEvidence',
  'expiryEvidence',
]);

const EXACT_BINDING_VALUES = Object.freeze(['exact', 'missing', 'conflicting']);
const PROVIDER_RESULT_POLICY_ENUMS = Object.freeze({
  planBinding: EXACT_BINDING_VALUES,
  sendEvidenceBinding: EXACT_BINDING_VALUES,
  evidenceSource: Object.freeze([
    'reported_direct_response',
    'unverified_or_missing',
    'conflicting',
  ]),
  evidenceCompleteness: Object.freeze(['complete', 'partial', 'conflicting']),
  responseEvidence: Object.freeze([
    'none',
    'accepted',
    'timeout',
    'connection_lost',
    'conflict',
    'external_dependency_failure',
    'rate_limited',
    'server_failure',
    'other_failure',
    'unknown',
    'conflicting',
  ]),
  providerObjectEvidence: Object.freeze([
    'none',
    'exact_open',
    'exact_complete',
    'exact_expired',
    'exact_unknown',
    'missing_reference',
    'not_found',
    'conflicting',
  ]),
  environmentEvidence: EXACT_BINDING_VALUES,
  parameterEvidence: EXACT_BINDING_VALUES,
  resultReferenceEvidence: Object.freeze([
    'bounded_opaque',
    'missing',
    'invalid',
    'conflicting',
  ]),
  redirectEvidence: Object.freeze([
    'validated_checkout',
    'missing',
    'invalid',
    'conflicting',
  ]),
  paymentEvidence: Object.freeze([
    'none',
    'unpaid',
    'paid',
    'no_payment_required',
    'processing',
    'unknown',
    'conflicting',
  ]),
  expiryEvidence: Object.freeze([
    'valid_future',
    'missing',
    'invalid',
    'expired',
    'unknown',
    'conflicting',
  ]),
});

const ENUM_SETS = Object.freeze(Object.fromEntries(
  Object.entries(PROVIDER_RESULT_POLICY_ENUMS)
    .map(([field, values]) => [field, new Set(values)]),
));
const ENUM_ENTRIES = Object.freeze(Object.entries(ENUM_SETS));

const RESULTS = Object.freeze({
  unboundResultCandidate: Object.freeze({
    providerResultPolicySchemaVersion,
    classification: 'unbound_result_candidate',
    state: 'requires_dispatch_evidence_persistence_and_business_validation',
  }),
  reconciliationRequired: Object.freeze({
    providerResultPolicySchemaVersion,
    classification: 'reconciliation_required',
    state: 'requires_reconciliation',
  }),
});

function createFrozenDataDescriptor(value) {
  const descriptor = SAFE_CREATE(null);
  descriptor.value = value;
  descriptor.enumerable = false;
  descriptor.writable = false;
  descriptor.configurable = false;
  return SAFE_FREEZE(descriptor);
}

const ERROR_NAME_DESCRIPTOR = createFrozenDataDescriptor('CommerceProviderResultError');
const ERROR_MESSAGE_DESCRIPTOR = createFrozenDataDescriptor(PROVIDER_RESULT_ERROR_MESSAGE);
const ERROR_CODE_DESCRIPTOR = createFrozenDataDescriptor('invalid_provider_result_evidence');

class CommerceProviderResultError extends Error {
  constructor() {
    super(PROVIDER_RESULT_ERROR_MESSAGE);
    SAFE_DEFINE_PROPERTY(this, 'name', ERROR_NAME_DESCRIPTOR);
    SAFE_DEFINE_PROPERTY(this, 'message', ERROR_MESSAGE_DESCRIPTOR);
    SAFE_DEFINE_PROPERTY(this, 'code', ERROR_CODE_DESCRIPTOR);
    Error.captureStackTrace?.(this, CommerceProviderResultError);
    SAFE_FREEZE(this);
  }
}

function fail() {
  throw new CommerceProviderResultError();
}

function readExactEvidence(serializedValue) {
  if (!hasPristineObjectPrototype()
    || typeof serializedValue !== 'string'
    || serializedValue.length === 0
    || serializedValue.length > MAX_SERIALIZED_EVIDENCE_LENGTH) {
    fail();
  }

  let value;
  let prototype;
  let keys;
  try {
    value = SAFE_JSON_PARSE(serializedValue);
    prototype = SAFE_GET_PROTOTYPE_OF(value);
    keys = SAFE_OWN_KEYS(value);
  } catch {
    fail();
  }

  if (value === null
    || typeof value !== 'object'
    || prototype !== OBJECT_PROTOTYPE
    || keys.length !== EXPECTED_FIELDS.length) {
    fail();
  }

  for (let index = 0; index < EXPECTED_FIELDS.length; index += 1) {
    if (keys[index] !== EXPECTED_FIELDS[index]) fail();
  }

  let canonicalValue;
  try {
    canonicalValue = SAFE_JSON_STRINGIFY(value, EXPECTED_FIELDS);
  } catch {
    fail();
  }
  if (canonicalValue !== serializedValue) fail();

  const evidence = SAFE_CREATE(null);
  for (const field of EXPECTED_FIELDS) {
    let descriptor;
    try {
      descriptor = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(value, field);
    } catch {
      fail();
    }
    if (!descriptor
      || !SAFE_HAS_OWN(descriptor, 'enumerable')
      || descriptor.enumerable !== true
      || !SAFE_HAS_OWN(descriptor, 'value')
      || SAFE_HAS_OWN(descriptor, 'get')
      || SAFE_HAS_OWN(descriptor, 'set')) {
      fail();
    }
    evidence[field] = descriptor.value;
  }

  if (evidence.providerResultPolicySchemaVersion !== providerResultPolicySchemaVersion
    || evidence.provider !== 'stripe'
    || evidence.providerAttempt !== 2
    || evidence.providerOperation !== 'checkout_session_create') {
    fail();
  }

  for (const [field, allowedValues] of ENUM_ENTRIES) {
    if (!SAFE_SET_HAS(allowedValues, evidence[field])) fail();
  }

  return evidence;
}

function isUnboundResultCandidate(evidence) {
  return evidence.planBinding === 'exact'
    && evidence.sendEvidenceBinding === 'exact'
    && evidence.evidenceSource === 'reported_direct_response'
    && evidence.evidenceCompleteness === 'complete'
    && evidence.responseEvidence === 'accepted'
    && evidence.providerObjectEvidence === 'exact_open'
    && evidence.environmentEvidence === 'exact'
    && evidence.parameterEvidence === 'exact'
    && evidence.resultReferenceEvidence === 'bounded_opaque'
    && evidence.redirectEvidence === 'validated_checkout'
    && evidence.paymentEvidence === 'unpaid'
    && evidence.expiryEvidence === 'valid_future';
}

function classifyAuthorizedStripeCheckoutResultEvidence(input) {
  const evidence = readExactEvidence(input);
  if (isUnboundResultCandidate(evidence)) return RESULTS.unboundResultCandidate;
  return RESULTS.reconciliationRequired;
}

SAFE_FREEZE(CommerceProviderResultError.prototype);
SAFE_FREEZE(CommerceProviderResultError);

module.exports = Object.freeze({
  providerResultPolicySchemaVersion,
  PROVIDER_RESULT_POLICY_ENUMS,
  CommerceProviderResultError,
  classifyAuthorizedStripeCheckoutResultEvidence,
});
