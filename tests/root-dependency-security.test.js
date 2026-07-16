'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPOSITORY = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(REPOSITORY, 'package.json');
const LOCK_PATH = path.join(REPOSITORY, 'package-lock.json');

const EXPECTED_FORM_DATA = Object.freeze({
  'node_modules/form-data': Object.freeze({
    version: '4.0.6',
    resolved: 'https://registry.npmjs.org/form-data/-/form-data-4.0.6.tgz',
    integrity: 'sha512-vKatAh4SlVfgbv+YtmhiRjhEMJsYpsG1Y2rMQtR+SVSbytsSD1YGzDIcrAJmdFec88u/+VoGmxnl+80gL1tRCQ==',
  }),
  'node_modules/jest-environment-jsdom/node_modules/form-data': Object.freeze({
    version: '3.0.5',
    resolved: 'https://registry.npmjs.org/form-data/-/form-data-3.0.5.tgz',
    integrity: 'sha512-j23EibVLnp4zNXGW7LjryXYa2X6U/M96yoOX+ybZxwkYajdxRNEqYY3zhh7y0i6kfISKS2jr+EJq1YTUDEv5+w==',
  }),
});
const EXPECTED_HASOWN = Object.freeze({
  version: '2.0.4',
  resolved: 'https://registry.npmjs.org/hasown/-/hasown-2.0.4.tgz',
  integrity: 'sha512-T2UbfbBEF32wiepXIsMlTW9+dDYC6wMh/t/vYA4tuOMKqWz/n3vr1NFSxQiyP+zk2mXsoMA/i/7qV6LKut1t1A==',
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function lockedFormDataEntries(lock) {
  return Object.entries(lock.packages)
    .filter(([packagePath]) => (
      packagePath === 'node_modules/form-data'
      || packagePath.endsWith('/node_modules/form-data')
    ))
    .sort(([left], [right]) => left.localeCompare(right));
}

function requireInstalledFormData(packagePath) {
  return require(path.join(REPOSITORY, packagePath));
}

function multipartBody(FormData) {
  const form = new FormData();
  form.append(
    'safe"\r\nX-Synthetic-Field: injected\r\ntail',
    'synthetic-value',
  );
  form.append('synthetic-file', Buffer.from('synthetic-file-content'), {
    contentType: 'text/plain',
    filename: 'safe"\r\nX-Synthetic-File: injected\r\ntail.txt',
  });
  return form.getBuffer().toString('utf8');
}

test('pins every root form-data resolution to the reviewed patched releases', () => {
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);
  const entries = lockedFormDataEntries(lock);

  assert.equal(packageJson.dependencies?.['form-data'], undefined);
  assert.equal(packageJson.devDependencies?.['form-data'], undefined);
  assert.equal(packageJson.optionalDependencies?.['form-data'], undefined);
  assert.equal(packageJson.peerDependencies?.['form-data'], undefined);
  assert.equal(packageJson.overrides?.['form-data'], undefined);
  assert.equal(
    lock.packages['node_modules/firebase-tools']?.dependencies?.['form-data'],
    '^4.0.0',
  );
  assert.equal(
    lock.packages['node_modules/jest-environment-jsdom/node_modules/jsdom']
      ?.dependencies?.['form-data'],
    '^3.0.0',
  );
  assert.deepEqual(
    entries.map(([packagePath]) => packagePath),
    Object.keys(EXPECTED_FORM_DATA),
  );

  for (const [packagePath, packageRecord] of entries) {
    assert.deepEqual(
      {
        version: packageRecord.version,
        resolved: packageRecord.resolved,
        integrity: packageRecord.integrity,
      },
      EXPECTED_FORM_DATA[packagePath],
      `${packagePath} must retain its reviewed public-registry identity`,
    );
    assert.equal(packageRecord.dev, true, `${packagePath} must remain development-only`);
    assert.equal(packageRecord.dependencies?.hasown, '^2.0.4');

    const installedPackage = readJson(path.join(REPOSITORY, packagePath, 'package.json'));
    assert.equal(installedPackage.version, EXPECTED_FORM_DATA[packagePath].version);
  }

  const hasownRecord = lock.packages['node_modules/hasown'];
  assert.deepEqual(
    {
      version: hasownRecord?.version,
      resolved: hasownRecord?.resolved,
      integrity: hasownRecord?.integrity,
    },
    EXPECTED_HASOWN,
  );
  assert.equal(
    readJson(path.join(REPOSITORY, 'node_modules/hasown/package.json')).version,
    EXPECTED_HASOWN.version,
  );
});

test('escapes synthetic multipart field names and filenames in every installed copy', async (t) => {
  const lock = readJson(LOCK_PATH);
  const entries = lockedFormDataEntries(lock);

  assert.equal(entries.length, 2);
  for (const [packagePath] of entries) {
    await t.test(packagePath, () => {
      const body = multipartBody(requireInstalledFormData(packagePath));

      assert.deepEqual(
        {
          rawFieldHeader: /\r\nX-Synthetic-Field: injected\r\n/.test(body),
          rawFilenameHeader: /\r\nX-Synthetic-File: injected\r\n/.test(body),
          escapedFieldName: /name="safe%22%0D%0AX-Synthetic-Field: injected%0D%0Atail"/.test(body),
          escapedFilename: /filename="safe%22%0D%0AX-Synthetic-File: injected%0D%0Atail\.txt"/.test(body),
        },
        {
          rawFieldHeader: false,
          rawFilenameHeader: false,
          escapedFieldName: true,
          escapedFilename: true,
        },
      );
    });
  }
});
