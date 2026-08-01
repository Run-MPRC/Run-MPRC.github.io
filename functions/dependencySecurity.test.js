'use strict';

const {spawnSync} = require('node:child_process');
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
const PATCHED_BRACE_EXPANSION_VERSION = '1.1.18';
const PATCHED_BRACE_EXPANSION_URL =
  'https://registry.npmjs.org/brace-expansion/-/brace-expansion-1.1.18.tgz';
const PATCHED_BRACE_EXPANSION_INTEGRITY =
  'sha512-Edep/X9fGqVNmzKBVsDYIOtD+z1tuezV70LBjdCst9Tqu76lsnvRiZ6oTic1n+/BIwX6QDGAO94PN4N2SADvtw==';
const PATCHED_BODY_PARSER_VERSION = '1.20.6';
const PATCHED_BODY_PARSER_URL =
  'https://registry.npmjs.org/body-parser/-/body-parser-1.20.6.tgz';
const PATCHED_BODY_PARSER_INTEGRITY =
  'sha512-p5tAzS57i5MV9fZFDj9LeIiTZEufbSe2eDozP+ElheSUq1m74CRq1jI4mYNDdVs9vQztXFLuk/Gd6BWTdwRJ5g==';
const BODY_PARSER_FACTORIES = ['json', 'raw', 'text', 'urlencoded'];

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

describe('SUPPLY-001D12 Functions brace-expansion containment', () => {
  test('pins the sole transitive copy to the reviewed maintenance release', () => {
    const packageJson = readJson(PACKAGE_PATH);
    const lock = readJson(LOCK_PATH);
    const rootRecord = lock.packages[''];
    const entries = Object.entries(lock.packages)
      .filter(([packagePath]) => (
        packagePath === 'node_modules/brace-expansion'
        || packagePath.endsWith('/node_modules/brace-expansion')
      ));

    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
      'resolutions',
      'overrides',
    ]) {
      expect(packageJson[field]?.['brace-expansion']).toBeUndefined();
      expect(rootRecord?.[field]?.['brace-expansion']).toBeUndefined();
    }

    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBe('node_modules/brace-expansion');
    expect(entries[0][1]).toMatchObject({
      version: PATCHED_BRACE_EXPANSION_VERSION,
      resolved: PATCHED_BRACE_EXPANSION_URL,
      integrity: PATCHED_BRACE_EXPANSION_INTEGRITY,
      dev: true,
    });
    expect(entries[0][1].dependencies).toEqual({
      'balanced-match': '^1.0.0',
      'concat-map': '0.0.1',
    });

    const consumers = Object.entries(lock.packages)
      .filter(([, packageRecord]) => (
        packageRecord?.dependencies?.['brace-expansion'] !== undefined
      ));
    expect(consumers).toHaveLength(1);
    expect(consumers[0][0]).toBe('node_modules/minimatch');
    expect(consumers[0][1]).toMatchObject({
      version: '3.1.5',
      dev: true,
    });
    expect(consumers[0][1].dependencies).toEqual({
      'brace-expansion': '^1.1.7',
    });

    const installedPackagePath = require.resolve('brace-expansion/package.json');
    const minimatchPackagePath = require.resolve('minimatch/package.json');
    expect(require.resolve('brace-expansion/package.json', {
      paths: [path.dirname(minimatchPackagePath)],
    })).toBe(installedPackagePath);
    expect(readJson(installedPackagePath).version)
      .toBe(PATCHED_BRACE_EXPANSION_VERSION);
  });

  test('bounds safe cumulative-output witnesses without changing ordinary results', () => {
    const installedPath = require.resolve('brace-expansion');
    const minimatchPath = require.resolve('minimatch');
    const script = `
      const expand = require(${JSON.stringify(installedPath)});
      const minimatch = require(${JSON.stringify(minimatchPath)});
      const summarize = (values) => ({
        count: values.length,
        totalLength: values.reduce((total, value) => total + value.length, 0),
      });
      const consumerBranch =
        '{' + 'a'.repeat(512) + ',' + 'b'.repeat(512) + '}';
      const consumerResults = minimatch.braceExpand(consumerBranch.repeat(10));
      const chained = expand('{a,b}'.repeat(10), {
        max: 2_048,
        maxLength: 200,
      });
      const alternatives = expand(
        '{' + Array(100).fill('{1..5}').join(',') + '}',
        {max: 2_048, maxLength: 50},
      );
      process.stdout.write(JSON.stringify({
        consumer: {
          ...summarize(consumerResults),
          lengths: [...new Set(consumerResults.map((value) => value.length))],
        },
        chained: summarize(chained),
        alternatives: summarize(alternatives),
        sequence: expand('a{1..3}b'),
        options: expand('x{a,b}y'),
        keptResults: expand('{a,,b}', {max: 2}),
        keptEmptyOption: expand('x{a,,b}y', {max: 2}),
      }));
    `;
    const result = spawnSync(
      process.execPath,
      ['--max-old-space-size=64', '-e', script],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024,
        timeout: 2_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      consumer: {
        count: 781,
        totalLength: 3_998_720,
        lengths: [5_120],
      },
      chained: {count: 20, totalLength: 200},
      alternatives: {count: 50, totalLength: 50},
      sequence: ['a1b', 'a2b', 'a3b'],
      options: ['xay', 'xby'],
      keptResults: ['a', 'b'],
      keptEmptyOption: ['xay', 'xy'],
    });
  });

  test('bounds non-expanding groups and the padded-sequence edge', () => {
    expect(require('brace-expansion/package.json').version)
      .toBe(PATCHED_BRACE_EXPANSION_VERSION);

    const installedPath = require.resolve('brace-expansion');
    const script = `
      const expand = require(${JSON.stringify(installedPath)});
      const nonExpanding = Array.from({length: 5_000}, () => '{}').join(',');
      const padded = expand(
        '{' + '0'.repeat(100_000) + '1..100000}',
        {max: 100_000, maxLength: 200_000},
      );
      process.stdout.write(JSON.stringify({
        nonExpanding: expand(nonExpanding),
        padded: {
          count: padded.length,
          totalLength: padded.reduce((total, value) => total + value.length, 0),
        },
        paddedSequence: expand('{01..10}'),
      }));
    `;
    const result = spawnSync(
      process.execPath,
      ['--max-old-space-size=64', '-e', script],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024,
        timeout: 5_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.nonExpanding).toEqual([
      Array.from({length: 5_000}, () => '{}').join(','),
    ]);
    expect(parsed.padded).toEqual({count: 1, totalLength: 100_001});
    expect(parsed.paddedSequence).toEqual([
      '01', '02', '03', '04', '05',
      '06', '07', '08', '09', '10',
    ]);
  });
});

describe('SUPPLY-001D13 Functions body-parser limit enforcement', () => {
  test('pins the sole production copy through the unchanged Express range', () => {
    const packageJson = readJson(PACKAGE_PATH);
    const lock = readJson(LOCK_PATH);
    const rootRecord = lock.packages[''];
    const entries = Object.entries(lock.packages)
      .filter(([packagePath]) => (
        packagePath === 'node_modules/body-parser'
        || packagePath.endsWith('/node_modules/body-parser')
      ));

    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
      'resolutions',
      'overrides',
    ]) {
      expect(packageJson[field]?.['body-parser']).toBeUndefined();
      expect(rootRecord?.[field]?.['body-parser']).toBeUndefined();
    }

    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBe('node_modules/body-parser');
    expect(entries[0][1]).toMatchObject({
      version: PATCHED_BODY_PARSER_VERSION,
      resolved: PATCHED_BODY_PARSER_URL,
      integrity: PATCHED_BODY_PARSER_INTEGRITY,
      license: 'MIT',
    });
    expect(entries[0][1]).not.toHaveProperty('dev');
    expect(entries[0][1].dependencies).toEqual({
      bytes: '~3.1.2',
      'content-type': '~1.0.5',
      debug: '2.6.9',
      depd: '2.0.0',
      destroy: '~1.2.0',
      'http-errors': '~2.0.1',
      'iconv-lite': '~0.4.24',
      'on-finished': '~2.4.1',
      qs: '~6.15.1',
      'raw-body': '~2.5.3',
      'type-is': '~1.6.18',
      unpipe: '~1.0.0',
    });
    expect(entries[0][1].engines).toEqual({
      node: '>= 0.8',
      npm: '1.2.8000 || >= 1.4.16',
    });

    const consumers = Object.entries(lock.packages)
      .filter(([, packageRecord]) => (
        packageRecord?.dependencies?.['body-parser'] !== undefined
      ));
    expect(consumers).toHaveLength(1);
    expect(consumers[0][0]).toBe('node_modules/express');
    expect(consumers[0][1]).toMatchObject({
      version: '4.22.2',
    });
    expect(consumers[0][1]).not.toHaveProperty('dev');
    expect(consumers[0][1].dependencies['body-parser']).toBe('~1.20.5');

    const installedPackagePath = require.resolve('body-parser/package.json');
    const expressPackagePath = require.resolve('express/package.json');
    expect(require.resolve('body-parser/package.json', {
      paths: [path.dirname(expressPackagePath)],
    })).toBe(installedPackagePath);
    expect(readJson(installedPackagePath).version)
      .toBe(PATCHED_BODY_PARSER_VERSION);
  });

  test.each(BODY_PARSER_FACTORIES)(
    '%s rejects invalid limits when the parser is constructed',
    (factory) => {
      const bodyParser = require('body-parser');
      const baseOptions = factory === 'urlencoded' ? {extended: false} : {};

      expect(() => bodyParser[factory]({
        ...baseOptions,
        limit: 'synthetic-invalid-limit',
      })).toThrow(TypeError);
      expect(() => bodyParser[factory]({
        ...baseOptions,
        limit: Number.NaN,
      })).toThrow(TypeError);
    },
  );

  test.each(BODY_PARSER_FACTORIES)(
    '%s preserves default and valid limit construction',
    (factory) => {
      const bodyParser = require('body-parser');
      const baseOptions = factory === 'urlencoded' ? {extended: false} : {};
      const compatibleOptions = [
        baseOptions,
        {...baseOptions, limit: undefined},
        {...baseOptions, limit: null},
        {...baseOptions, limit: 8_192},
        {...baseOptions, limit: '8kb'},
      ];

      for (const options of compatibleOptions) {
        expect(bodyParser[factory](options)).toEqual(expect.any(Function));
      }
    },
  );
});

describe('SUPPLY-001D14 Functions js-yaml merge containment', () => {
  const patchedVersion3 = '3.15.1';
  const patchedUrl3 =
    'https://registry.npmjs.org/js-yaml/-/js-yaml-3.15.1.tgz';
  const patchedIntegrity3 =
    'sha512-S99WuO3HlhO3XN41EtYUNl9zzXjoJx7QvmipxsJVxtCBT0YHEFy+iOJhjSvrmV12nYhWpZaM8lPHkJm0yUMbag==';
  const patchedVersion4 = '4.3.1';
  const patchedUrl4 =
    'https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.1.tgz';
  const patchedIntegrity4 =
    'sha512-CY6crGq313MX8GkwvB7tzgp99vjQxY1++5y10/BKN/GUfHqWaOGQMNZkBvqSzsZKWk/ijwHlWzzkLulsGHhjWQ==';
  const nestedPackagePath =
    'node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml';
  const rootPackagePath = 'node_modules/js-yaml';
  const mergeSource = [
    'base: &base { one: 1 }',
    'middle: &middle { <<: *base, two: 2 }',
    'result: { <<: *middle, three: 3 }',
  ].join('\n');
  const orderedMapSource = [
    'ordered: !!omap',
    '  - alpha: 1',
    '  - beta: 2',
    '  - gamma: 3',
  ].join('\n');

  function installedVariants() {
    const nycPackagePath =
      require.resolve('@istanbuljs/load-nyc-config/package.json');
    const nestedSearchPaths = [path.dirname(nycPackagePath)];

    return [
      {
        label: 'legacy 3.x safeLoad',
        loaderName: 'safeLoad',
        modulePath: require.resolve('js-yaml', {paths: nestedSearchPaths}),
        packageJsonPath: require.resolve('js-yaml/package.json', {
          paths: nestedSearchPaths,
        }),
      },
      {
        label: 'legacy 4.x load',
        loaderName: 'load',
        modulePath: require.resolve('js-yaml'),
        packageJsonPath: require.resolve('js-yaml/package.json'),
      },
    ];
  }

  test('pins both development-only copies through unchanged parent ranges', () => {
    const packageJson = readJson(PACKAGE_PATH);
    const lock = readJson(LOCK_PATH);
    const rootRecord = lock.packages[''];
    const entries = Object.entries(lock.packages)
      .filter(([packagePath]) => (
        packagePath === rootPackagePath
        || packagePath.endsWith('/node_modules/js-yaml')
      ));

    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
      'resolutions',
      'overrides',
    ]) {
      expect(packageJson[field]?.['js-yaml']).toBeUndefined();
      expect(rootRecord?.[field]?.['js-yaml']).toBeUndefined();
    }

    expect(entries.map(([packagePath]) => packagePath).sort()).toEqual([
      nestedPackagePath,
      rootPackagePath,
    ]);
    expect(lock.packages[nestedPackagePath]).toMatchObject({
      version: patchedVersion3,
      resolved: patchedUrl3,
      integrity: patchedIntegrity3,
      dev: true,
      license: 'MIT',
    });
    expect(lock.packages[nestedPackagePath].dependencies).toEqual({
      argparse: '^1.0.7',
      esprima: '^4.0.0',
    });
    expect(lock.packages[nestedPackagePath].bin).toEqual({
      'js-yaml': 'bin/js-yaml.js',
    });
    expect(lock.packages[rootPackagePath]).toMatchObject({
      version: patchedVersion4,
      resolved: patchedUrl4,
      integrity: patchedIntegrity4,
      dev: true,
      license: 'MIT',
    });
    expect(lock.packages[rootPackagePath].dependencies).toEqual({
      argparse: '^2.0.1',
    });
    expect(lock.packages[rootPackagePath].bin).toEqual({
      'js-yaml': 'bin/js-yaml.js',
    });

    const consumers = Object.entries(lock.packages)
      .filter(([, packageRecord]) => (
        packageRecord?.dependencies?.['js-yaml'] !== undefined
      ))
      .map(([packagePath, packageRecord]) => ({
        packagePath,
        version: packageRecord.version,
        dev: packageRecord.dev,
        range: packageRecord.dependencies['js-yaml'],
      }))
      .sort((left, right) => left.packagePath.localeCompare(right.packagePath));
    expect(consumers).toEqual([
      {
        packagePath: 'node_modules/@eslint/eslintrc',
        version: '2.1.4',
        dev: true,
        range: '^4.1.0',
      },
      {
        packagePath: 'node_modules/@istanbuljs/load-nyc-config',
        version: '1.1.0',
        dev: true,
        range: '^3.13.1',
      },
      {
        packagePath: 'node_modules/eslint',
        version: '8.57.1',
        dev: true,
        range: '^4.1.0',
      },
    ]);

    const variants = installedVariants();
    expect(path.relative(FUNCTIONS_ROOT, variants[0].packageJsonPath))
      .toBe(`${nestedPackagePath}/package.json`);
    expect(path.relative(FUNCTIONS_ROOT, variants[1].packageJsonPath))
      .toBe(`${rootPackagePath}/package.json`);
    expect(readJson(variants[0].packageJsonPath).version)
      .toBe(patchedVersion3);
    expect(readJson(variants[1].packageJsonPath).version)
      .toBe(patchedVersion4);
  });

  test.each([
    ['legacy 3.x safeLoad', 0],
    ['legacy 4.x load', 1],
  ])('%s enforces the cumulative merge-key ceiling', (_label, index) => {
    const variant = installedVariants()[index];
    const yaml = require(variant.modulePath);
    const loader = yaml[variant.loaderName];
    const expected = {one: 1, two: 2, three: 3};
    let rejection;

    try {
      loader(mergeSource, {maxTotalMergeKeys: 2});
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(yaml.YAMLException);
    expect(rejection.reason)
      .toBe('merge keys exceeded maxTotalMergeKeys (2)');
    expect(loader(mergeSource, {maxTotalMergeKeys: 3}).result)
      .toEqual(expected);
    expect(loader(mergeSource, {maxTotalMergeKeys: -1}).result)
      .toEqual(expected);
  });

  test.each([
    ['legacy 3.x safeLoad', 0],
    ['legacy 4.x load', 1],
  ])('%s avoids a linear scan of prior ordered-map keys', (_label, index) => {
    const variant = installedVariants()[index];
    const script = `
      const yaml = require(${JSON.stringify(variant.modulePath)});
      const originalIndexOf = Array.prototype.indexOf;
      let indexOfCalls = 0;
      Array.prototype.indexOf = function instrumentedIndexOf(...args) {
        indexOfCalls += 1;
        return Reflect.apply(originalIndexOf, this, args);
      };
      try {
        const parsed = yaml[${JSON.stringify(variant.loaderName)}](
          ${JSON.stringify(orderedMapSource)},
        );
        process.stdout.write(JSON.stringify({indexOfCalls, parsed}));
      } finally {
        Array.prototype.indexOf = originalIndexOf;
      }
    `;
    const result = spawnSync(
      process.execPath,
      ['--max-old-space-size=64', '-e', script],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024,
        timeout: 2_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      indexOfCalls: 0,
      parsed: {
        ordered: [
          {alpha: 1},
          {beta: 2},
          {gamma: 3},
        ],
      },
    });
  });
});

describe('SUPPLY-001D15 Functions protobufjs option parsing', () => {
  const patchedVersion = '7.6.5';
  const patchedUrl =
    'https://registry.npmjs.org/protobufjs/-/protobufjs-7.6.5.tgz';
  const patchedIntegrity =
    'sha512-/FPD0nUc9jH6rfFjji9IBqOz4pcSE3CsT1m7Ep6Mdb0LxSUMj8hgl6GomOvZzpNpAqqGaXA0P3VSrZLFzIhQrw==';
  const protobufPackagePath = 'node_modules/protobufjs';
  const inquirePackagePath = 'node_modules/@protobufjs/inquire';

  test('pins the sole production copy through six unchanged parent ranges', () => {
    const packageJson = readJson(PACKAGE_PATH);
    const lock = readJson(LOCK_PATH);
    const rootRecord = lock.packages[''];
    const protobufEntries = Object.entries(lock.packages)
      .filter(([packagePath]) => (
        packagePath === protobufPackagePath
        || packagePath.endsWith('/node_modules/protobufjs')
      ));
    const inquireEntries = Object.entries(lock.packages)
      .filter(([packagePath]) => (
        packagePath === inquirePackagePath
        || packagePath.endsWith('/node_modules/@protobufjs/inquire')
      ));

    for (const dependency of ['protobufjs', '@protobufjs/inquire']) {
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
        'resolutions',
        'overrides',
      ]) {
        expect(packageJson[field]?.[dependency]).toBeUndefined();
        expect(rootRecord?.[field]?.[dependency]).toBeUndefined();
      }
    }

    expect(protobufEntries).toHaveLength(1);
    expect(protobufEntries[0][0]).toBe(protobufPackagePath);
    expect(protobufEntries[0][1]).toMatchObject({
      version: patchedVersion,
      resolved: patchedUrl,
      integrity: patchedIntegrity,
      hasInstallScript: true,
      license: 'BSD-3-Clause',
    });
    expect(protobufEntries[0][1]).not.toHaveProperty('dev');
    expect(protobufEntries[0][1].dependencies).toEqual({
      '@protobufjs/aspromise': '^1.1.2',
      '@protobufjs/base64': '^1.1.2',
      '@protobufjs/codegen': '^2.0.5',
      '@protobufjs/eventemitter': '^1.1.1',
      '@protobufjs/fetch': '^1.1.1',
      '@protobufjs/float': '^1.0.2',
      '@protobufjs/path': '^1.1.2',
      '@protobufjs/pool': '^1.1.0',
      '@protobufjs/utf8': '^1.1.1',
      '@types/node': '>=13.7.0',
      long: '^5.3.2',
    });
    expect(protobufEntries[0][1].engines).toEqual({node: '>=12.0.0'});
    expect(inquireEntries).toEqual([]);

    const consumers = Object.entries(lock.packages)
      .filter(([, packageRecord]) => (
        packageRecord?.dependencies?.protobufjs !== undefined
      ))
      .map(([packagePath, packageRecord]) => ({
        packagePath,
        version: packageRecord.version,
        dev: packageRecord.dev ?? false,
        range: packageRecord.dependencies.protobufjs,
      }))
      .sort((left, right) => left.packagePath.localeCompare(right.packagePath));
    expect(consumers).toEqual([
      {
        packagePath: 'node_modules/@google-cloud/firestore',
        version: '7.11.6',
        dev: false,
        range: '^7.2.6',
      },
      {
        packagePath:
          'node_modules/@grpc/grpc-js/node_modules/@grpc/proto-loader',
        version: '0.8.1',
        dev: false,
        range: '^7.5.5',
      },
      {
        packagePath: 'node_modules/@grpc/proto-loader',
        version: '0.7.15',
        dev: false,
        range: '^7.2.5',
      },
      {
        packagePath: 'node_modules/firebase-functions',
        version: '4.9.0',
        dev: false,
        range: '^7.2.2',
      },
      {
        packagePath: 'node_modules/google-gax',
        version: '4.6.1',
        dev: false,
        range: '^7.3.2',
      },
      {
        packagePath: 'node_modules/proto3-json-serializer',
        version: '2.0.2',
        dev: false,
        range: '^7.2.5',
      },
    ]);

    const installedPackagePath = require.resolve('protobufjs/package.json');
    expect(path.relative(FUNCTIONS_ROOT, installedPackagePath))
      .toBe(`${protobufPackagePath}/package.json`);
    expect(readJson(installedPackagePath).version).toBe(patchedVersion);
    for (const consumer of consumers) {
      expect(require.resolve('protobufjs/package.json', {
        paths: [path.join(FUNCTIONS_ROOT, consumer.packagePath)],
      })).toBe(installedPackagePath);
    }

    let inquireResolution;
    let inquireError;
    try {
      inquireResolution = require.resolve('@protobufjs/inquire/package.json');
    } catch (error) {
      inquireError = error;
    }
    expect(inquireResolution).toBeUndefined();
    expect(inquireError?.code).toBe('MODULE_NOT_FOUND');
  });

  test('rejects an unterminated option promptly and preserves valid parsing', () => {
    const installedPath = require.resolve('protobufjs');
    const validScript = `
      const protobuf = require(${JSON.stringify(installedPath)});
      const parsed = protobuf.parse(
        'syntax = "proto3"; '
          + 'option java_package = "org.example"; '
          + 'message Ping { string id = 1; }',
      );
      process.stdout.write(JSON.stringify({
        javaPackage: parsed.root.options.java_package,
        messageFields: Object.keys(parsed.root.lookupType('Ping').fields),
      }));
    `;
    const validResult = spawnSync(
      process.execPath,
      ['--max-old-space-size=64', '-e', validScript],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024,
        timeout: 2_000,
      },
    );

    expect(validResult.error).toBeUndefined();
    expect(validResult.signal).toBeNull();
    expect(validResult.status).toBe(0);
    expect(validResult.stderr).toBe('');
    expect(JSON.parse(validResult.stdout)).toEqual({
      javaPackage: 'org.example',
      messageFields: ['id'],
    });

    const affectedScript = `
      const protobuf = require(${JSON.stringify(installedPath)});
      let unterminated;
      try {
        protobuf.parse('option foo');
        unterminated = 'resolved';
      } catch {
        unterminated = 'rejected';
      }
      process.stdout.write(JSON.stringify({unterminated}));
    `;
    const affectedResult = spawnSync(
      process.execPath,
      ['--max-old-space-size=64', '-e', affectedScript],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024,
        timeout: 2_000,
      },
    );

    expect(affectedResult.error).toBeUndefined();
    expect(affectedResult.signal).toBeNull();
    expect(affectedResult.status).toBe(0);
    expect(affectedResult.stderr).toBe('');
    expect(JSON.parse(affectedResult.stdout))
      .toEqual({unterminated: 'rejected'});
  });
});
