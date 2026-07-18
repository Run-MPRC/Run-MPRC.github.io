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
const EXPECTED_WEBSOCKET_DRIVER = Object.freeze({
  version: '0.7.5',
  resolved: 'https://registry.npmjs.org/websocket-driver/-/websocket-driver-0.7.5.tgz',
  integrity: 'sha512-ZL2+3c7kMBdIRCMz6l8jQMHyGVxj+UL+xVk74Ombiciboca8rHa15L86B19E5oh1pL9Ii/uj54gtsIrZGMo6zA==',
});
const EXPECTED_WEBSOCKET_DRIVER_DEPENDENCIES = Object.freeze({
  'http-parser-js': '>=0.5.1',
  'safe-buffer': '>=5.1.0',
  'websocket-extensions': '>=0.1.1',
});
const EXPECTED_SHELL_QUOTE = Object.freeze({
  version: '1.8.4',
  resolved: 'https://registry.npmjs.org/shell-quote/-/shell-quote-1.8.4.tgz',
  integrity: 'sha512-VsC6n6vz1ihYYyZZwX7YZSF5l5x36ca17OC+a69h94YqB7X6XLwf+5MOgynYir2SLFUbl8gIYvBo8K8RoNQ6bQ==',
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

test('pins the sole root websocket-driver resolution to the patched 0.7.5 release', () => {
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);

  assert.equal(packageJson.dependencies?.['websocket-driver'], undefined);
  assert.equal(packageJson.devDependencies?.['websocket-driver'], undefined);
  assert.equal(packageJson.optionalDependencies?.['websocket-driver'], undefined);
  assert.equal(packageJson.peerDependencies?.['websocket-driver'], undefined);
  assert.equal(packageJson.overrides?.['websocket-driver'], undefined);

  // Both transitive parents keep their existing ranges, which already admit 0.7.5.
  assert.equal(
    lock.packages['node_modules/faye-websocket']?.dependencies?.['websocket-driver'],
    '>=0.5.1',
  );
  assert.equal(
    lock.packages['node_modules/sockjs']?.dependencies?.['websocket-driver'],
    '^0.7.4',
  );

  // Exactly one locked copy, hoisted at the root, satisfying both parents.
  const lockedPaths = Object.keys(lock.packages).filter((packagePath) => (
    packagePath === 'node_modules/websocket-driver'
    || packagePath.endsWith('/node_modules/websocket-driver')
  ));
  assert.deepEqual(lockedPaths, ['node_modules/websocket-driver']);

  const record = lock.packages['node_modules/websocket-driver'];
  assert.deepEqual(
    {
      version: record.version,
      resolved: record.resolved,
      integrity: record.integrity,
    },
    EXPECTED_WEBSOCKET_DRIVER,
    'websocket-driver must retain its reviewed public-registry identity',
  );
  // The finding is in the production tree; the node must not be reclassified development-only.
  assert.notEqual(record.dev, true);
  // The bump changes only version/resolved/integrity; declared child ranges are untouched.
  assert.deepEqual(record.dependencies, EXPECTED_WEBSOCKET_DRIVER_DEPENDENCIES);

  const installed = readJson(
    path.join(REPOSITORY, 'node_modules/websocket-driver/package.json'),
  );
  assert.equal(installed.version, EXPECTED_WEBSOCKET_DRIVER.version);
});

test('fails a draft-75 length header that exceeds the configured maxLength closed', () => {
  const websocket = require(path.join(REPOSITORY, 'node_modules/websocket-driver'));

  // A hixie-75 upgrade carries none of the newer key/version headers.
  const request = {
    method: 'GET',
    url: '/socket',
    headers: {
      host: 'example.com',
      origin: 'http://example.com',
      connection: 'Upgrade',
      upgrade: 'WebSocket',
    },
  };
  const driver = websocket.http(request, { maxLength: 1 });

  const events = [];
  driver.on('open', () => events.push('open'));
  driver.on('close', () => events.push('close'));
  driver.on('error', () => events.push('error'));
  const handshake = [];
  driver.io.on('data', (chunk) => handshake.push(chunk));

  // Prove a successful draft-75 handshake / open state before the hostile input.
  assert.equal(driver.version, 'hixie-75');
  assert.equal(driver.readyState, 0);
  driver.start();
  assert.equal(driver.readyState, 1);
  assert.ok(events.includes('open'));
  assert.match(
    Buffer.concat(handshake).toString('utf8'),
    /HTTP\/1\.1 101 Web Socket Protocol Handshake/,
  );

  // Length-delimited binary frame: 0x80 marks a length-prefixed frame and 0x05
  // declares a five-byte payload, five times the configured one-byte maxLength.
  driver.parse(Buffer.from([0x80, 0x05]));

  // Patched 0.7.5 fails closed at the bound; vulnerable 0.7.4 stays open and skips bytes.
  assert.equal(
    driver.readyState,
    3,
    'the driver must close when a declared length exceeds maxLength',
  );
  assert.ok(events.includes('close'), 'a close event must fire at the length bound');
});

test('pins the sole root shell-quote resolution to the patched 1.8.4 release', () => {
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);

  assert.equal(packageJson.dependencies?.['shell-quote'], undefined);
  assert.equal(packageJson.devDependencies?.['shell-quote'], undefined);
  assert.equal(packageJson.optionalDependencies?.['shell-quote'], undefined);
  assert.equal(packageJson.peerDependencies?.['shell-quote'], undefined);
  assert.equal(packageJson.resolutions?.['shell-quote'], undefined);
  assert.equal(packageJson.overrides?.['shell-quote'], undefined);

  // Both existing development-tool parents already admit the patched release.
  assert.equal(
    lock.packages['node_modules/launch-editor']?.dependencies?.['shell-quote'],
    '^1.8.1',
  );
  assert.equal(
    lock.packages['node_modules/react-dev-utils']?.dependencies?.['shell-quote'],
    '^1.7.3',
  );

  const lockedPaths = Object.keys(lock.packages).filter((packagePath) => (
    packagePath === 'node_modules/shell-quote'
    || packagePath.endsWith('/node_modules/shell-quote')
  ));
  assert.deepEqual(lockedPaths, ['node_modules/shell-quote']);

  const record = lock.packages['node_modules/shell-quote'];
  assert.deepEqual(
    {
      version: record.version,
      resolved: record.resolved,
      integrity: record.integrity,
    },
    EXPECTED_SHELL_QUOTE,
    'shell-quote must retain its reviewed public-registry identity',
  );
  assert.equal(record.dev, true);
  assert.equal(record.license, 'MIT');
  assert.deepEqual(record.engines, { node: '>= 0.4' });
  assert.equal(record.dependencies, undefined);

  const installed = readJson(
    path.join(REPOSITORY, 'node_modules/shell-quote/package.json'),
  );
  assert.equal(installed.version, EXPECTED_SHELL_QUOTE.version);
});

test('rejects line-terminator shell operator objects without executing a shell', () => {
  const { quote } = require(path.join(REPOSITORY, 'node_modules/shell-quote'));

  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(
      () => quote([{ op: `;${terminator}id` }]),
      TypeError,
      'object operators outside the parser allowlist must fail closed',
    );
  }
  assert.equal(quote([{ op: ';' }]), '\\;');
  assert.equal(quote(['safe value']), "'safe value'");
});
