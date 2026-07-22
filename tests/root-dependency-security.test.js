'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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
const EXPECTED_PICOMATCH = Object.freeze({
  version: '2.3.2',
  resolved: 'https://registry.npmjs.org/picomatch/-/picomatch-2.3.2.tgz',
  integrity: 'sha512-V7+vQEJ06Z+c5tSye8S+nHUfI51xoXIXjHQ99cQtKUkQqqO1kO/KCJUfZXuB47h/YBlDhah2H3hdUGXn8ie0oA==',
});
const EXPECTED_NESTED_PICOMATCH = Object.freeze({
  path: 'node_modules/tinyglobby/node_modules/picomatch',
  version: '4.0.4',
  resolved: 'https://registry.npmjs.org/picomatch/-/picomatch-4.0.4.tgz',
  integrity: 'sha512-QP88BAKvMam/3NxH6vj2o21R6MjxZUAd6nlwAS/pnGvN9IVLocLHxGYIzFhg6fUQ+5th6P4dv4eW9jX3DSIj7A==',
});
const EXPECTED_SYSTEMJS_TRANSFORM = Object.freeze({
  version: '7.29.7',
  resolved: 'https://registry.npmjs.org/@babel/plugin-transform-modules-systemjs/-/plugin-transform-modules-systemjs-7.29.7.tgz',
  integrity: 'sha512-TM2ZcQLoG2/y4HODiStCo10DibYhWhGWAwVv+EQKmG/7GFl0N+AAmUiXOMKM+aiJ9XBJ9AHVZBvTzMnJ2sM3cQ==',
});
const EXPECTED_FIREBASE_TOOLS = Object.freeze({
  version: '15.24.0',
  resolved: 'https://registry.npmjs.org/firebase-tools/-/firebase-tools-15.24.0.tgz',
  integrity: 'sha512-2P5qd3O3YD7a7AaA89lt/zgRIgR7FGS0Ye7fW9z/sNt9/b6cbmI1TtQtYDlmJDUOh9nMk+72ll/gu4MlN/qY7Q==',
  nodeEngine: '>=20.0.0 || >=22.0.0 || >=24.0.0',
});
const CRITICAL_VERSION_CEILINGS = Object.freeze({
  protobufjs: '7.6.2',
  tar: '7.5.18',
});
const EXPECTED_SYSTEMJS_LOCK_CLOSURE = Object.freeze({
  'node_modules/@babel/code-frame': '7.29.7',
  'node_modules/@babel/generator': '7.29.7',
  'node_modules/@babel/helper-globals': '7.29.7',
  'node_modules/@babel/helper-module-imports': '7.29.7',
  'node_modules/@babel/helper-module-transforms': '7.29.7',
  'node_modules/@babel/helper-plugin-utils': '7.29.7',
  'node_modules/@babel/helper-string-parser': '7.29.7',
  'node_modules/@babel/helper-validator-identifier': '7.29.7',
  'node_modules/@babel/parser': '7.29.7',
  'node_modules/@babel/plugin-transform-modules-systemjs': '7.29.7',
  'node_modules/@babel/template': '7.29.7',
  'node_modules/@babel/traverse': '7.29.7',
  'node_modules/@babel/types': '7.29.7',
  'node_modules/@jridgewell/gen-mapping': '0.3.13',
  'node_modules/@jridgewell/trace-mapping': '0.3.31',
});
const EXPECTED_YAML = Object.freeze({
  version: '1.10.3',
  resolved: 'https://registry.npmjs.org/yaml/-/yaml-1.10.3.tgz',
  integrity: 'sha512-vIYeF1u3CjlhAFekPPAk2h/Kv4T3mAkMox5OymRiJQB0spDP10LHvt+K7G9Ny6NuuMAb25/6n1qyUjAcGNf/AA==',
});
const EXPECTED_NESTED_YAML = Object.freeze({
  'node_modules/firebase-tools/node_modules/yaml': Object.freeze({
    version: '2.9.0',
    resolved: 'https://registry.npmjs.org/yaml/-/yaml-2.9.0.tgz',
    integrity: 'sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==',
  }),
  'node_modules/lint-staged/node_modules/yaml': Object.freeze({
    version: '2.7.1',
    resolved: 'https://registry.npmjs.org/yaml/-/yaml-2.7.1.tgz',
    integrity: 'sha512-10ULxpnOCQXxJvBgxsn9ptjq6uviG/htZKk9veJGhlqn3w/DxQ631zFF+nlQXLwmImeS5amR2dl2U8sg6U9jsQ==',
  }),
  'node_modules/openapi3-ts/node_modules/yaml': Object.freeze({
    version: '2.8.4',
    resolved: 'https://registry.npmjs.org/yaml/-/yaml-2.8.4.tgz',
    integrity: 'sha512-ml/JPOj9fOQK8RNnWojA67GbZ0ApXAUlN2UQclwv2eVgTgn7O9gg9o7paZWKMp4g0H3nTLtS9LVzhkpOFIKzog==',
  }),
  'node_modules/postcss-load-config/node_modules/yaml': Object.freeze({
    version: '2.8.0',
    resolved: 'https://registry.npmjs.org/yaml/-/yaml-2.8.0.tgz',
    integrity: 'sha512-4lLa/EcQCB0cJkyts+FpIRx5G/llPxfP6VQU5KByHEhLxY3IJCH0f0Hy1MHI8sClTvsIb8qwRJ6R/ZdlDJ/leQ==',
  }),
});
const YAML_RECURSION_DEPTH = 300;
const YAML_RECURSION_BYTES = (YAML_RECURSION_DEPTH * 2) + 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compareNumericVersions(left, right) {
  const parse = (value) => {
    assert.match(value, /^\d+\.\d+\.\d+$/, `unexpected non-numeric version ${value}`);
    return value.split('.').map(Number);
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

function lockedPackageEntries(lock, packageName) {
  const suffix = `/node_modules/${packageName}`;
  return Object.entries(lock.packages)
    .filter(([packagePath]) => (
      packagePath === `node_modules/${packageName}` || packagePath.endsWith(suffix)
    ))
    .sort(([left], [right]) => left.localeCompare(right));
}

test('pins the committed Firebase CLI and excludes its critical package ranges', () => {
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);
  const rootRecord = lock.packages[''];
  const cliRecord = lock.packages['node_modules/firebase-tools'];

  assert.equal(packageJson.devDependencies?.['firebase-tools'], EXPECTED_FIREBASE_TOOLS.version);
  assert.equal(rootRecord?.devDependencies?.['firebase-tools'], EXPECTED_FIREBASE_TOOLS.version);
  assert.equal(packageJson.dependencies?.['firebase-tools'], undefined);
  assert.equal(packageJson.optionalDependencies?.['firebase-tools'], undefined);
  assert.equal(packageJson.peerDependencies?.['firebase-tools'], undefined);
  assert.equal(packageJson.overrides?.['firebase-tools'], undefined);
  assert.deepEqual(
    lockedPackageEntries(lock, 'firebase-tools').map(([packagePath]) => packagePath),
    ['node_modules/firebase-tools'],
  );
  assert.deepEqual(
    {
      version: cliRecord?.version,
      resolved: cliRecord?.resolved,
      integrity: cliRecord?.integrity,
      nodeEngine: cliRecord?.engines?.node,
    },
    EXPECTED_FIREBASE_TOOLS,
  );
  assert.equal(cliRecord?.dev, true);

  const installedCli = readJson(path.join(
    REPOSITORY,
    'node_modules/firebase-tools/package.json',
  ));
  assert.equal(installedCli.version, EXPECTED_FIREBASE_TOOLS.version);
  assert.equal(installedCli.engines?.node, EXPECTED_FIREBASE_TOOLS.nodeEngine);

  for (const [packageName, vulnerableCeiling] of Object.entries(CRITICAL_VERSION_CEILINGS)) {
    const entries = lockedPackageEntries(lock, packageName);
    assert.ok(entries.length > 0, `${packageName} must remain reviewable in the lockfile`);
    for (const [packagePath, packageRecord] of entries) {
      assert.ok(
        compareNumericVersions(packageRecord.version, vulnerableCeiling) > 0,
        `${packagePath}@${packageRecord.version} remains in the critical range`,
      );
    }
  }
});

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
    '^4.0.1',
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

function openSyntheticDraft75Driver(maxLength) {
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
  const driver = websocket.http(request, { maxLength });

  const events = [];
  driver.on('open', () => events.push('open'));
  driver.on('close', () => events.push('close'));
  driver.on('error', () => events.push('error'));
  const handshake = [];
  driver.io.on('data', (chunk) => handshake.push(chunk));

  // Prove a successful draft-75 handshake / open state before the hostile input.
  assert.equal(driver.version, 'hixie-75');
  assert.equal(driver.readyState, 0);
  assert.equal(driver.start(), true);
  assert.equal(driver.readyState, 1);
  assert.deepEqual(events, ['open']);
  assert.match(
    Buffer.concat(handshake).toString('utf8'),
    /HTTP\/1\.1 101 Web Socket Protocol Handshake/,
  );

  return { driver, events };
}

test('closes draft-75 length headers only when declared length exceeds maxLength', () => {
  // Length-delimited binary frame: 0x80 marks a length-prefixed frame and 0x05
  // declares a five-byte payload.
  const fiveByteLengthHeader = Buffer.from([0x80, 0x05]);

  const overLimit = openSyntheticDraft75Driver(1);
  assert.equal(overLimit.driver.io.write(fiveByteLengthHeader), true);

  // Patched 0.7.5 fails closed above the bound; vulnerable 0.7.4 stays open.
  assert.equal(
    overLimit.driver.readyState,
    3,
    'the driver must close when a declared length exceeds maxLength',
  );
  assert.deepEqual(overLimit.events, ['open', 'close']);

  const atThreshold = openSyntheticDraft75Driver(5);
  assert.equal(atThreshold.driver.io.write(fiveByteLengthHeader), true);

  // The same header must remain open at the exact threshold. This control
  // prevents an unconditional-disconnect implementation from satisfying the test.
  assert.equal(atThreshold.driver.readyState, 1);
  assert.deepEqual(atThreshold.events, ['open']);

  assert.equal(atThreshold.driver.close(), true);
  assert.equal(atThreshold.driver.readyState, 3);
  assert.deepEqual(atThreshold.events, ['open', 'close']);
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

test('pins the sole root picomatch 2.x resolution to the patched 2.3.2 release', () => {
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);

  assert.equal(packageJson.dependencies?.picomatch, undefined);
  assert.equal(packageJson.devDependencies?.picomatch, undefined);
  assert.equal(packageJson.optionalDependencies?.picomatch, undefined);
  assert.equal(packageJson.peerDependencies?.picomatch, undefined);
  assert.equal(packageJson.resolutions?.picomatch, undefined);
  assert.equal(packageJson.overrides?.picomatch, undefined);

  assert.equal(
    lock.packages['node_modules/jest-util']?.dependencies?.picomatch,
    '^2.2.3',
  );
  assert.equal(
    lock.packages['node_modules/micromatch']?.dependencies?.picomatch,
    '^2.3.1',
  );

  const lockedPaths = Object.keys(lock.packages).filter((packagePath) => (
    packagePath === 'node_modules/picomatch'
    || packagePath.endsWith('/node_modules/picomatch')
  )).sort();
  assert.deepEqual(lockedPaths, [
    'node_modules/picomatch',
    EXPECTED_NESTED_PICOMATCH.path,
  ]);

  const rootRecord = lock.packages['node_modules/picomatch'];
  assert.deepEqual(
    {
      version: rootRecord.version,
      resolved: rootRecord.resolved,
      integrity: rootRecord.integrity,
    },
    EXPECTED_PICOMATCH,
    'the root picomatch copy must retain its reviewed public-registry identity',
  );
  assert.notEqual(rootRecord.dev, true);
  assert.equal(rootRecord.license, 'MIT');
  assert.deepEqual(rootRecord.engines, { node: '>=8.6' });

  const nestedRecord = lock.packages[EXPECTED_NESTED_PICOMATCH.path];
  assert.deepEqual(
    {
      path: EXPECTED_NESTED_PICOMATCH.path,
      version: nestedRecord.version,
      resolved: nestedRecord.resolved,
      integrity: nestedRecord.integrity,
    },
    EXPECTED_NESTED_PICOMATCH,
    'the separate picomatch 4.x development copy must remain unchanged',
  );
  assert.equal(nestedRecord.dev, true);
  assert.equal(
    readJson(
      path.join(REPOSITORY, EXPECTED_NESTED_PICOMATCH.path, 'package.json'),
    ).version,
    EXPECTED_NESTED_PICOMATCH.version,
  );

  const installed = readJson(
    path.join(REPOSITORY, 'node_modules/picomatch/package.json'),
  );
  assert.equal(installed.version, EXPECTED_PICOMATCH.version);
});

test('does not compile inherited POSIX class names into host method text', () => {
  const picomatch = require(path.join(REPOSITORY, 'node_modules/picomatch'));
  const injectedHostText = /function|native code|\[object Object\]/i;

  for (const className of ['constructor', 'toString', '__proto__']) {
    const expression = picomatch.makeRe(`[[:${className}:]]`);
    assert.doesNotMatch(
      expression.source,
      injectedHostText,
      `${className} must not inject an inherited host value into the expression`,
    );
  }

  const alpha = picomatch.makeRe('[[:alpha:]]');
  assert.equal(alpha.test('A'), true);
  assert.equal(alpha.test('7'), false);
});

test('pins the sole SystemJS transform resolution to the reviewed patched chain', () => {
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);

  assert.equal(packageJson.dependencies?.['@babel/plugin-transform-modules-systemjs'], undefined);
  assert.equal(packageJson.devDependencies?.['@babel/plugin-transform-modules-systemjs'], undefined);
  assert.equal(packageJson.optionalDependencies?.['@babel/plugin-transform-modules-systemjs'], undefined);
  assert.equal(packageJson.peerDependencies?.['@babel/plugin-transform-modules-systemjs'], undefined);
  assert.equal(packageJson.resolutions?.['@babel/plugin-transform-modules-systemjs'], undefined);
  assert.equal(packageJson.overrides?.['@babel/plugin-transform-modules-systemjs'], undefined);

  const preset = lock.packages['node_modules/@babel/preset-env'];
  assert.equal(preset?.version, '7.26.9');
  assert.equal(
    preset?.dependencies?.['@babel/plugin-transform-modules-systemjs'],
    '^7.25.9',
  );

  const lockedPaths = Object.keys(lock.packages).filter((packagePath) => (
    packagePath === 'node_modules/@babel/plugin-transform-modules-systemjs'
    || packagePath.endsWith('/node_modules/@babel/plugin-transform-modules-systemjs')
  ));
  assert.deepEqual(lockedPaths, ['node_modules/@babel/plugin-transform-modules-systemjs']);

  const transform = lock.packages['node_modules/@babel/plugin-transform-modules-systemjs'];
  assert.deepEqual(
    {
      version: transform?.version,
      resolved: transform?.resolved,
      integrity: transform?.integrity,
    },
    EXPECTED_SYSTEMJS_TRANSFORM,
    'the SystemJS transform must retain its reviewed public-registry identity',
  );
  assert.notEqual(transform?.dev, true);

  for (const [packagePath, version] of Object.entries(EXPECTED_SYSTEMJS_LOCK_CLOSURE)) {
    const record = lock.packages[packagePath];
    assert.equal(record?.version, version, `${packagePath} must retain its reviewed version`);
    assert.match(record?.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//);
    assert.match(record?.integrity ?? '', /^sha512-/);
    assert.notEqual(record?.dev, true);
  }
  assert.equal(lock.packages['node_modules/@jridgewell/set-array'], undefined);

  const installed = readJson(path.join(
    REPOSITORY,
    'node_modules/@babel/plugin-transform-modules-systemjs/package.json',
  ));
  assert.equal(installed.version, EXPECTED_SYSTEMJS_TRANSFORM.version);
});

test('emits computed syntax for an upstream SystemJS string-export fixture', () => {
  const babel = require(path.join(REPOSITORY, 'node_modules/@babel/core'));
  const systemJsTransform = require(path.join(
    REPOSITORY,
    'node_modules/@babel/plugin-transform-modules-systemjs',
  ));
  const source = [
    'var foo, bar;',
    'export {foo as "default exports", bar} from "./other.mjs";',
    'export * from "./other.mjs";',
  ].join('\n');

  const output = babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    plugins: [systemJsTransform],
  }).code;

  assert.match(output, /_exportObj\["default exports"\] = _otherMjs\.foo;/);
  assert.doesNotMatch(output, /_exportObj\.default exports/);
  assert.doesNotThrow(() => new Function(output)); // eslint-disable-line no-new-func
});

test('pins the sole root yaml 1.x resolution to the patched 1.10.3 release', () => {
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);

  assert.equal(packageJson.dependencies?.yaml, undefined);
  assert.equal(packageJson.devDependencies?.yaml, undefined);
  assert.equal(packageJson.optionalDependencies?.yaml, undefined);
  assert.equal(packageJson.peerDependencies?.yaml, undefined);
  assert.equal(packageJson.resolutions?.yaml, undefined);
  assert.equal(packageJson.overrides?.yaml, undefined);

  assert.equal(
    lock.packages['node_modules/cosmiconfig']?.dependencies?.yaml,
    '^1.10.0',
  );
  assert.equal(
    lock.packages['node_modules/cssnano']?.dependencies?.yaml,
    '^1.10.2',
  );
  assert.equal(
    lock.packages['node_modules/fork-ts-checker-webpack-plugin/node_modules/cosmiconfig']
      ?.dependencies?.yaml,
    '^1.7.2',
  );

  const lockedPaths = Object.keys(lock.packages).filter((packagePath) => (
    packagePath === 'node_modules/yaml'
    || packagePath.endsWith('/node_modules/yaml')
  )).sort();
  assert.deepEqual(lockedPaths, [
    ...Object.keys(EXPECTED_NESTED_YAML),
    'node_modules/yaml',
  ]);

  const record = lock.packages['node_modules/yaml'];
  assert.deepEqual(
    {
      version: record.version,
      resolved: record.resolved,
      integrity: record.integrity,
    },
    EXPECTED_YAML,
    'the root yaml copy must retain its reviewed public-registry identity',
  );
  assert.notEqual(record.dev, true);
  assert.equal(record.license, 'ISC');
  assert.deepEqual(record.engines, { node: '>= 6' });

  for (const [packagePath, expected] of Object.entries(EXPECTED_NESTED_YAML)) {
    const nestedRecord = lock.packages[packagePath];
    assert.deepEqual(
      {
        version: nestedRecord.version,
        resolved: nestedRecord.resolved,
        integrity: nestedRecord.integrity,
      },
      expected,
      `${packagePath} must retain its reviewed public-registry identity`,
    );
    assert.equal(nestedRecord.dev, true);
  }

  const installed = readJson(
    path.join(REPOSITORY, 'node_modules/yaml/package.json'),
  );
  assert.equal(installed.version, EXPECTED_YAML.version);
});

test('turns bounded yaml collection stack exhaustion into a parser error', () => {
  const yamlPath = path.join(REPOSITORY, 'node_modules/yaml');
  const childSource = `
    const YAML = require(${JSON.stringify(yamlPath)});
    const depth = ${YAML_RECURSION_DEPTH};
    const source = '['.repeat(depth) + '1' + ']'.repeat(depth);
    const document = YAML.parseDocument(source);
    process.stdout.write(JSON.stringify({
      bytes: Buffer.byteLength(source),
      errors: document.errors.map((error) => ({
        name: error.name,
        rangeError: error instanceof RangeError,
      })),
    }));
  `;
  const result = spawnSync(
    process.execPath,
    ['--stack_size=256', '-e', childSource],
    {
      cwd: REPOSITORY,
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      timeout: 5_000,
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const observation = JSON.parse(result.stdout);
  assert.equal(observation.bytes, YAML_RECURSION_BYTES);
  assert.deepEqual(observation.errors, [{
    name: 'YAMLSemanticError',
    rangeError: false,
  }]);
});
