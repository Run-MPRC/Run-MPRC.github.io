jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  return { https: { HttpsError } };
});

const {
  COMMERCE_CONTROL_MESSAGE,
  COMMERCE_OPERATIONS,
  CommerceControlError,
  parseCommerceControl,
  requireCommerceAdmission,
} = require('./commerceControl');

function validControl(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 1,
    newCommerceEnabled: true,
    raceRegistrationEnabled: true,
    merchandiseCheckoutEnabled: true,
    incidentRefundsEnabled: true,
    ...overrides,
  };
}

function snapshot(data, exists = true) {
  return { exists, data: () => data };
}

function mockDb(options = {}) {
  const control = Object.prototype.hasOwnProperty.call(options, 'control')
    ? options.control
    : validControl();
  const target = Object.prototype.hasOwnProperty.call(options, 'target')
    ? options.target
    : { checkoutEnabled: true };
  const getAll = jest.fn().mockResolvedValue([
    snapshot(control, control !== undefined),
    snapshot(target, target !== undefined),
  ]);
  return {
    collection: jest.fn(() => ({ doc: jest.fn(() => ({ path: 'systemConfig/commerce' })) })),
    getAll,
  };
}

function captureParserError(value) {
  try {
    parseCommerceControl(value);
  } catch (error) {
    return error;
  }
  throw new Error('Expected commerce control rejection');
}

describe('commerceControl', () => {
  test('returns a frozen minimal control snapshot', () => {
    const input = validControl({ revision: 7 });
    const parsed = parseCommerceControl(input);

    expect(parsed).toEqual(input);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  test.each([
    ['missing object', undefined, 'control_invalid'],
    ['null object', null, 'control_invalid'],
    ['array', [], 'control_invalid'],
    ['missing field', (() => {
      const value = validControl();
      delete value.newCommerceEnabled;
      return value;
    })(), 'control_fields_invalid'],
    ['extra field', { ...validControl(), suppliedCanary: 'private-value' }, 'control_fields_invalid'],
    ['unknown version', validControl({ schemaVersion: 2 }), 'control_version_invalid'],
    ['zero revision', validControl({ revision: 0 }), 'control_revision_invalid'],
    ['fractional revision', validControl({ revision: 1.5 }), 'control_revision_invalid'],
    ['unsafe revision', validControl({ revision: Number.MAX_SAFE_INTEGER + 1 }), 'control_revision_invalid'],
    ['string switch', validControl({ newCommerceEnabled: 'true' }), 'control_switch_invalid'],
  ])('rejects %s without exposing supplied data', (_name, value, reason) => {
    const error = captureParserError(value);

    expect(error).toBeInstanceOf(CommerceControlError);
    expect(error.message).toBe(COMMERCE_CONTROL_MESSAGE);
    expect(error.reason).toBe(reason);
    expect(JSON.stringify(error)).toBe('{}');
    expect(error.stack).not.toContain('private-value');
  });

  test.each([
    [COMMERCE_OPERATIONS.RACE_REGISTRATION, 'raceRegistrationEnabled'],
    [COMMERCE_OPERATIONS.MERCHANDISE_CHECKOUT, 'merchandiseCheckoutEnabled'],
  ])('admits %s only when every new-commerce layer is enabled', async (operation, domainField) => {
    for (const [deploymentEnabled, controlPatch, targetData, admitted] of [
      [true, {}, { checkoutEnabled: true }, true],
      [false, {}, { checkoutEnabled: true }, false],
      [true, { newCommerceEnabled: false }, { checkoutEnabled: true }, false],
      [true, { [domainField]: false }, { checkoutEnabled: true }, false],
      [true, {}, { checkoutEnabled: false }, false],
      [true, {}, {}, false],
    ]) {
      const db = mockDb({ control: validControl(controlPatch), target: targetData });
      const promise = requireCommerceAdmission({
        db,
        operation,
        deploymentEnabled,
        targetRef: { path: 'synthetic/target' },
      });
      if (admitted) {
        await expect(promise).resolves.toMatchObject({ revision: 1 });
      } else {
        await expect(promise).rejects.toMatchObject({
          code: 'failed-precondition',
          message: COMMERCE_CONTROL_MESSAGE,
        });
      }
    }
  });

  test('keeps incident refunds independent of the new-commerce ceiling', async () => {
    const allowedDb = mockDb({
      control: validControl({
        newCommerceEnabled: false,
        raceRegistrationEnabled: false,
        merchandiseCheckoutEnabled: false,
        incidentRefundsEnabled: true,
      }),
    });
    await expect(requireCommerceAdmission({
      db: allowedDb,
      operation: COMMERCE_OPERATIONS.INCIDENT_REFUND,
      deploymentEnabled: false,
    })).resolves.toMatchObject({ revision: 1 });

    const blockedDb = mockDb({
      control: validControl({ incidentRefundsEnabled: false }),
    });
    await expect(requireCommerceAdmission({
      db: blockedDb,
      operation: COMMERCE_OPERATIONS.INCIDENT_REFUND,
      deploymentEnabled: true,
    })).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('deployment ceiling denies new commerce before a runtime-control read', async () => {
    const db = mockDb();

    await expect(requireCommerceAdmission({
      db,
      operation: COMMERCE_OPERATIONS.RACE_REGISTRATION,
      deploymentEnabled: false,
      targetRef: { path: 'events/race-1' },
    })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(db.getAll).not.toHaveBeenCalled();
  });

  test.each([
    ['unknown operation', { operation: 'future_command', deploymentEnabled: true }],
    ['missing target', {
      operation: COMMERCE_OPERATIONS.RACE_REGISTRATION,
      deploymentEnabled: true,
    }],
    ['unexpected refund target', {
      operation: COMMERCE_OPERATIONS.INCIDENT_REFUND,
      deploymentEnabled: true,
      targetRef: { path: 'synthetic/target' },
    }],
  ])('fails closed for %s before reading Firestore', async (_name, input) => {
    const db = mockDb();

    await expect(requireCommerceAdmission({ db, ...input })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: COMMERCE_CONTROL_MESSAGE,
    });
    expect(db.getAll).not.toHaveBeenCalled();
  });

  test('reads a fresh revision on every invocation and never caches admission', async () => {
    const db = mockDb();
    db.getAll
      .mockResolvedValueOnce([
        snapshot(validControl({ revision: 4 })),
        snapshot({ checkoutEnabled: true }),
      ])
      .mockResolvedValueOnce([
        snapshot(validControl({ revision: 5, newCommerceEnabled: false })),
        snapshot({ checkoutEnabled: true }),
      ]);
    const input = {
      db,
      operation: COMMERCE_OPERATIONS.RACE_REGISTRATION,
      deploymentEnabled: true,
      targetRef: { path: 'events/race-1' },
    };

    await expect(requireCommerceAdmission(input)).resolves.toMatchObject({ revision: 4 });
    await expect(requireCommerceAdmission(input)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(db.getAll).toHaveBeenCalledTimes(2);
  });

  test('a disable committed before the admission read completes denies the command', async () => {
    const db = mockDb();
    let currentControl = validControl({ revision: 8 });
    let releaseRead;
    const readMayFinish = new Promise((resolve) => {
      releaseRead = resolve;
    });
    db.getAll.mockImplementation(async () => {
      await readMayFinish;
      return [
        snapshot(currentControl),
        snapshot({ checkoutEnabled: true }),
      ];
    });

    const admission = requireCommerceAdmission({
      db,
      operation: COMMERCE_OPERATIONS.MERCHANDISE_CHECKOUT,
      deploymentEnabled: true,
      targetRef: { path: 'products/hat' },
    });
    currentControl = validControl({ revision: 9, newCommerceEnabled: false });
    releaseRead();

    await expect(admission).rejects.toMatchObject({
      code: 'failed-precondition',
      message: COMMERCE_CONTROL_MESSAGE,
    });
    expect(db.getAll).toHaveBeenCalledTimes(1);
  });

  test('fails generically for missing control or Firestore read failure', async () => {
    const missingDb = mockDb({ control: undefined });
    await expect(requireCommerceAdmission({
      db: missingDb,
      operation: COMMERCE_OPERATIONS.INCIDENT_REFUND,
      deploymentEnabled: false,
    })).rejects.toMatchObject({ message: COMMERCE_CONTROL_MESSAGE });

    const failingDb = mockDb();
    failingDb.getAll.mockRejectedValue(new Error('synthetic provider detail'));
    await expect(requireCommerceAdmission({
      db: failingDb,
      operation: COMMERCE_OPERATIONS.INCIDENT_REFUND,
      deploymentEnabled: false,
    })).rejects.toMatchObject({ message: COMMERCE_CONTROL_MESSAGE });
  });
});
