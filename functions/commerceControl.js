const functions = require('firebase-functions');

const COMMERCE_CONTROL_MESSAGE = 'Commerce is temporarily unavailable';
const COMMERCE_CONTROL_PATH = 'systemConfig/commerce';
const COMMERCE_OPERATIONS = Object.freeze({
  RACE_REGISTRATION: 'race_registration',
  MERCHANDISE_CHECKOUT: 'merchandise_checkout',
  INCIDENT_REFUND: 'incident_refund',
});
const CONTROL_FIELDS = Object.freeze([
  'incidentRefundsEnabled',
  'merchandiseCheckoutEnabled',
  'newCommerceEnabled',
  'raceRegistrationEnabled',
  'revision',
  'schemaVersion',
]);

class CommerceControlError extends Error {
  constructor(reason) {
    super(COMMERCE_CONTROL_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'CommerceControlError',
      enumerable: false,
    });
    Object.defineProperty(this, 'reason', {
      value: reason,
      enumerable: false,
    });
    Error.captureStackTrace?.(this, CommerceControlError);
  }
}

function reject(reason) {
  throw new CommerceControlError(reason);
}

/**
 * Parse the exact versioned server-only runtime control document.
 *
 * @param {unknown} value
 * @returns {Readonly<{
 *   schemaVersion: 1,
 *   revision: number,
 *   newCommerceEnabled: boolean,
 *   raceRegistrationEnabled: boolean,
 *   merchandiseCheckoutEnabled: boolean,
 *   incidentRefundsEnabled: boolean,
 * }>}
 */
function parseCommerceControl(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject('control_invalid');
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== CONTROL_FIELDS.length
    || keys.some((key, index) => key !== CONTROL_FIELDS[index])) {
    reject('control_fields_invalid');
  }
  if (value.schemaVersion !== 1) reject('control_version_invalid');
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    reject('control_revision_invalid');
  }
  const booleanFields = [
    'newCommerceEnabled',
    'raceRegistrationEnabled',
    'merchandiseCheckoutEnabled',
    'incidentRefundsEnabled',
  ];
  if (booleanFields.some((field) => typeof value[field] !== 'boolean')) {
    reject('control_switch_invalid');
  }
  return Object.freeze({
    schemaVersion: 1,
    revision: value.revision,
    newCommerceEnabled: value.newCommerceEnabled,
    raceRegistrationEnabled: value.raceRegistrationEnabled,
    merchandiseCheckoutEnabled: value.merchandiseCheckoutEnabled,
    incidentRefundsEnabled: value.incidentRefundsEnabled,
  });
}

function controlDocumentReference(db) {
  const [collectionName, documentId] = COMMERCE_CONTROL_PATH.split('/');
  return db.collection(collectionName).doc(documentId);
}

function operationIsKnown(operation) {
  return Object.values(COMMERCE_OPERATIONS).includes(operation);
}

function operationAllowed({ operation, deploymentEnabled, control, targetSnapshot }) {
  if (operation === COMMERCE_OPERATIONS.INCIDENT_REFUND) {
    return control.incidentRefundsEnabled;
  }

  if (deploymentEnabled !== true
    || control.newCommerceEnabled !== true
    || !targetSnapshot?.exists
    || targetSnapshot.data()?.checkoutEnabled !== true) {
    return false;
  }

  if (operation === COMMERCE_OPERATIONS.RACE_REGISTRATION) {
    return control.raceRegistrationEnabled;
  }
  return control.merchandiseCheckoutEnabled;
}

/**
 * Strongly read and apply the runtime policy for one current commerce command.
 * The returned resource snapshot is the same snapshot admitted by the policy.
 *
 * @param {Object} input
 * @param {FirebaseFirestore.Firestore} input.db
 * @param {string} input.operation
 * @param {boolean} input.deploymentEnabled
 * @param {FirebaseFirestore.DocumentReference} [input.targetRef]
 * @returns {Promise<Readonly<{
 *   revision: number,
 *   targetSnapshot?: FirebaseFirestore.DocumentSnapshot,
 * }>>}
 */
async function requireCommerceAdmission({
  db,
  operation,
  deploymentEnabled,
  targetRef,
}) {
  try {
    if (!operationIsKnown(operation)) reject('operation_unknown');
    if (typeof deploymentEnabled !== 'boolean') reject('deployment_ceiling_invalid');
    const needsTarget = operation !== COMMERCE_OPERATIONS.INCIDENT_REFUND;
    if (needsTarget !== Boolean(targetRef)) reject('target_invalid');
    if (needsTarget && deploymentEnabled !== true) reject('command_disabled');

    const refs = [controlDocumentReference(db)];
    if (targetRef) refs.push(targetRef);
    const [controlSnapshot, targetSnapshot] = await db.getAll(...refs);
    if (!controlSnapshot?.exists) reject('control_missing');
    const control = parseCommerceControl(controlSnapshot.data());
    if (!operationAllowed({
      operation,
      deploymentEnabled,
      control,
      targetSnapshot,
    })) {
      reject('command_disabled');
    }

    const admitted = { revision: control.revision };
    if (targetSnapshot) admitted.targetSnapshot = targetSnapshot;
    return Object.freeze(admitted);
  } catch (error) {
    if (!(error instanceof CommerceControlError)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        COMMERCE_CONTROL_MESSAGE,
      );
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      COMMERCE_CONTROL_MESSAGE,
    );
  }
}

module.exports = {
  COMMERCE_CONTROL_MESSAGE,
  COMMERCE_CONTROL_PATH,
  COMMERCE_OPERATIONS,
  CommerceControlError,
  parseCommerceControl,
  requireCommerceAdmission,
};
