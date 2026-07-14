'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FUNCTIONS_ROOT = __dirname;
const PACKAGE_PATH = path.join(FUNCTIONS_ROOT, 'package.json');
const LOCK_PATH = path.join(FUNCTIONS_ROOT, 'package-lock.json');
const PATCHED_FORM_DATA_VERSION = '2.5.6';
const PATCHED_FORM_DATA_URL =
  'https://registry.npmjs.org/form-data/-/form-data-2.5.6.tgz';
const PATCHED_FORM_DATA_INTEGRITY =
  'sha512-Ogz/E85h9tlfJzpI6TuFpGcHZFhLrb9Gw8wq9v40CxSCPnv7ahKr6Xgtkn0KYCDQJ8DNn5VoMO8EXr9V5PadyA==';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('Functions production dependency security', () => {
  test('pins every form-data resolution to the reviewed patched 2.x release', () => {
    const packageJson = readJson(PACKAGE_PATH);
    const lock = readJson(LOCK_PATH);
    const formDataEntries = Object.entries(lock.packages)
      .filter(([packagePath]) => (
        packagePath === 'node_modules/form-data'
        || packagePath.endsWith('/node_modules/form-data')
      ));

    expect(packageJson.dependencies).not.toHaveProperty('form-data');
    expect(packageJson.overrides).toEqual({
      'form-data': PATCHED_FORM_DATA_VERSION,
    });
    expect(formDataEntries).toHaveLength(1);

    const [[packagePath, packageRecord]] = formDataEntries;
    expect(packagePath).toBe('node_modules/form-data');
    expect(packageRecord).toMatchObject({
      version: PATCHED_FORM_DATA_VERSION,
      resolved: PATCHED_FORM_DATA_URL,
      integrity: PATCHED_FORM_DATA_INTEGRITY,
      optional: true,
    });

    const installedPackage = require('form-data/package.json');
    expect(installedPackage.version).toBe(PATCHED_FORM_DATA_VERSION);
  });

  test('escapes synthetic multipart field-name control characters', () => {
    const FormData = require('form-data');
    const form = new FormData();
    const injectedHeader = '\r\nX-Synthetic-Injected: true\r\n';

    form.append(`safe"${injectedHeader}fake="`, 'synthetic-value');

    const body = form.getBuffer().toString('utf8');
    expect(body).not.toContain(injectedHeader);
    expect(body).toContain('%22%0D%0AX-Synthetic-Injected: true%0D%0Afake=%22');
  });
});
