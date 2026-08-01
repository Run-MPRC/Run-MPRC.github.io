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
