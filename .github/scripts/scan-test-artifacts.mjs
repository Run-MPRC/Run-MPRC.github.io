import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const EXIT_INVALID_ROOT = 2;
const EXIT_UNSAFE_ARTIFACT = 3;
const EXIT_SCAN_FAILURE = 4;

const MAX_FILES = 128;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 256;
const MAX_ROOTS = 8;

const ROOT_NAME = /^(?:\.test-artifacts|artifacts|coverage|reports|test-artifacts|test-results)(?:[-_.][a-z0-9]+)*$/i;
const SOURCE_ROOT_NAMES = new Set([
  '.git',
  '.github',
  'docs',
  'functions',
  'node_modules',
  'public',
  'scripts',
  'src',
  'tests',
]);
const SOURCE_MARKERS = new Set([
  '.git',
  '.github',
  'AGENTS.md',
  'firebase.json',
  'firestore.rules',
  'functions',
  'package.json',
  'public',
  'src',
]);
const ALLOWED_EXTENSIONS = new Set([
  '.info',
  '.json',
  '.jsonl',
  '.lcov',
  '.log',
  '.tap',
  '.txt',
  '.xml',
]);
const ARCHIVE_EXTENSIONS = new Set([
  '.7z',
  '.bz2',
  '.gz',
  '.rar',
  '.tar',
  '.tgz',
  '.xz',
  '.zip',
]);
const REDACTED_VALUES = new Set([
  '',
  '*',
  '***',
  '<redacted>',
  '[redacted]',
  'redacted',
]);
const SYNTHETIC_IDENTITY = /^(?:demo|example|reserved|synthetic|test)(?:[-_ ](?:demo|example|reserved|synthetic|test))*$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true });

class ArtifactSafetyError extends Error {
  constructor(ruleId, exitCode) {
    super('Test artifact scan failed.');
    this.name = 'ArtifactSafetyError';
    this.ruleId = ruleId;
    this.exitCode = exitCode;
  }
}

function fail(ruleId, exitCode = EXIT_UNSAFE_ARTIFACT) {
  throw new ArtifactSafetyError(ruleId, exitCode);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function hasParentSegment(rawRoot) {
  return rawRoot.split(/[\\/]+/u).includes('..');
}

function isAncestor(candidate, target) {
  const relative = path.relative(candidate, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

function directoryIdentity(stat) {
  return Object.freeze({
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
  });
}

function sameDirectoryIdentity(stat, expected) {
  return stat.isDirectory()
    && stat.dev === expected.dev
    && stat.ino === expected.ino
    && stat.ctimeNs === expected.ctimeNs;
}

function sameIdentityRecord(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.ctimeNs === right.ctimeNs;
}

function readDirectoryIdentity(
  directory,
  ruleId = 'ENTRY_CHANGED',
  exitCode = EXIT_SCAN_FAILURE,
) {
  try {
    const stat = fs.lstatSync(directory, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(ruleId, exitCode);
    return directoryIdentity(stat);
  } catch (error) {
    if (error instanceof ArtifactSafetyError) throw error;
    fail(ruleId, exitCode);
  }
}

function openBoundDirectory(directory, expected) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!sameDirectoryIdentity(stat, expected)) fail('ENTRY_CHANGED', EXIT_SCAN_FAILURE);
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error instanceof ArtifactSafetyError) throw error;
    fail('ENTRY_UNREADABLE', EXIT_SCAN_FAILURE);
  }
}

function assertBoundDirectory(directory, expected, descriptor) {
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    const pathStat = fs.lstatSync(directory, { bigint: true });
    if (!sameDirectoryIdentity(descriptorStat, expected)
      || !sameDirectoryIdentity(pathStat, expected)) {
      fail('ENTRY_CHANGED', EXIT_SCAN_FAILURE);
    }
  } catch (error) {
    if (error instanceof ArtifactSafetyError) throw error;
    fail('ENTRY_CHANGED', EXIT_SCAN_FAILURE);
  }
}

function validateRoot(rawRoot, cwd) {
  if (typeof rawRoot !== 'string'
    || rawRoot.length === 0
    || rawRoot.length > 1024
    || hasParentSegment(rawRoot)) {
    fail('ROOT_INVALID', EXIT_INVALID_ROOT);
  }

  const resolved = path.resolve(cwd, rawRoot);
  if (isAncestor(resolved, cwd) || resolved === path.parse(resolved).root) {
    fail('ROOT_TOO_BROAD', EXIT_INVALID_ROOT);
  }
  if (!ROOT_NAME.test(path.basename(resolved)) || SOURCE_ROOT_NAMES.has(path.basename(resolved))) {
    fail('ROOT_NOT_ARTIFACT_OUTPUT', EXIT_INVALID_ROOT);
  }

  let rootStat;
  try {
    rootStat = fs.lstatSync(resolved, { bigint: true });
  } catch {
    fail('ROOT_UNREADABLE', EXIT_INVALID_ROOT);
  }
  if (rootStat.isSymbolicLink()) fail('ROOT_SYMLINK', EXIT_INVALID_ROOT);
  if (!rootStat.isDirectory()) fail('ROOT_NOT_DIRECTORY', EXIT_INVALID_ROOT);

  let realRoot;
  try {
    realRoot = fs.realpathSync(resolved);
    fs.accessSync(realRoot, fs.constants.R_OK);
  } catch {
    fail('ROOT_UNREADABLE', EXIT_INVALID_ROOT);
  }
  if (isAncestor(realRoot, cwd) || realRoot === path.parse(realRoot).root) {
    fail('ROOT_TOO_BROAD', EXIT_INVALID_ROOT);
  }
  if (!ROOT_NAME.test(path.basename(realRoot)) || SOURCE_ROOT_NAMES.has(path.basename(realRoot))) {
    fail('ROOT_NOT_ARTIFACT_OUTPUT', EXIT_INVALID_ROOT);
  }
  const initialIdentity = directoryIdentity(rootStat);
  const realIdentity = readDirectoryIdentity(realRoot, 'ROOT_UNREADABLE', EXIT_INVALID_ROOT);
  if (!sameIdentityRecord(initialIdentity, realIdentity)) {
    fail('ENTRY_CHANGED', EXIT_SCAN_FAILURE);
  }
  return Object.freeze({
    identity: realIdentity,
    path: realRoot,
  });
}

function snapshotRootArguments(rawRoots) {
  try {
    if (!Array.isArray(rawRoots) || Object.getPrototypeOf(rawRoots) !== Array.prototype) {
      throw new TypeError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(rawRoots);
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor
      || !Object.hasOwn(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0) {
      throw new TypeError();
    }

    const allowedKeys = new Set(['length']);
    const roots = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const key = String(index);
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError();
      allowedKeys.add(key);
      roots.push(descriptor.value);
    }
    if (Reflect.ownKeys(descriptors).some((key) => (
      typeof key !== 'string' || !allowedKeys.has(key)
    ))) {
      throw new TypeError();
    }
    return roots;
  } catch {
    fail('API_INVALID', EXIT_INVALID_ROOT);
  }
}

function snapshotScanOptions(rawOptions) {
  try {
    if (rawOptions === undefined) return Object.freeze({ cwd: process.cwd() });
    if (rawOptions === null || typeof rawOptions !== 'object') throw new TypeError();
    const prototype = Object.getPrototypeOf(rawOptions);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();

    const descriptors = Object.getOwnPropertyDescriptors(rawOptions);
    if (Reflect.ownKeys(descriptors).some((key) => key !== 'cwd')) throw new TypeError();
    const cwdDescriptor = descriptors.cwd;
    if (cwdDescriptor && !Object.hasOwn(cwdDescriptor, 'value')) throw new TypeError();
    const cwd = cwdDescriptor ? cwdDescriptor.value : process.cwd();
    if (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > 4096) {
      throw new TypeError();
    }
    return Object.freeze({ cwd });
  } catch {
    fail('API_INVALID', EXIT_INVALID_ROOT);
  }
}

function normalizedViews(text) {
  const views = new Set([text]);
  const decodeUnicodeEscapes = (value) => value.replace(
    /\\u([0-9a-f]{4})/giu,
    (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)),
  );
  const decodePercentRuns = (value) => value.replace(/(?:%[0-9a-f]{2})+/giu, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%([0-9a-f]{2})/giu, (_match, octet) => (
        String.fromCodePoint(Number.parseInt(octet, 16))
      ));
    }
  });
  const xmlEntities = Object.freeze({
    amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
  });
  const decodeXmlEntities = (value) => value.replace(
    /&(?:#([0-9]{1,7})|#x([0-9a-f]{1,6})|(amp|apos|gt|lt|quot));/giu,
    (_match, decimal, hexadecimal, named) => {
      const codePoint = decimal === undefined
        ? (hexadecimal === undefined ? null : Number.parseInt(hexadecimal, 16))
        : Number.parseInt(decimal, 10);
      if (codePoint === null) return xmlEntities[named.toLowerCase()];
      if (!Number.isSafeInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return _match;
      }
      return String.fromCodePoint(codePoint);
    },
  );

  const queue = [text];
  const transforms = [
    decodeUnicodeEscapes,
    (value) => decodePercentRuns(value.replace(/\+/gu, '%20')),
    decodeXmlEntities,
    (value) => value.normalize('NFKC'),
  ];
  while (queue.length > 0 && views.size < 32) {
    const current = queue.shift();
    for (const transform of transforms) {
      const decoded = transform(current);
      if (decoded !== current && !views.has(decoded)) {
        views.add(decoded);
        queue.push(decoded);
      }
    }
  }
  return [...views];
}

function isRedacted(value) {
  return REDACTED_VALUES.has(value.trim().toLowerCase());
}

function isReservedEmail(value) {
  const domain = value.slice(value.lastIndexOf('@') + 1).toLowerCase();
  return domain === 'example.com'
    || domain === 'example.net'
    || domain === 'example.org'
    || domain === 'invalid'
    || domain === 'localhost'
    || domain.endsWith('.example')
    || domain.endsWith('.invalid')
    || domain.endsWith('.localhost')
    || domain.endsWith('.test');
}

function isReservedPhone(value) {
  const digits = value.replace(/\D/gu, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) return false;
  const exchange = national.slice(3, 6);
  const subscriber = Number.parseInt(national.slice(6), 10);
  return exchange === '555' && subscriber >= 100 && subscriber <= 199;
}

function isReservedIdentity(value) {
  return SYNTHETIC_IDENTITY.test(value)
    || /^Synthetic Runner [0-9]{6}$/u.test(value);
}

function normalizedFieldName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

const NAME_FIELD_NAMES = new Set([
  'displayname',
  'emergencycontactname',
  'firstname',
  'fullname',
  'lastname',
  'legalname',
  'membername',
  'runnername',
]);
const EMAIL_FIELD_NAMES = new Set([
  'contactemail',
  'email',
  'emailaddress',
  'emergencycontactemail',
  'memberemail',
  'runneremail',
]);
const PHONE_FIELD_NAMES = new Set([
  'contactphone',
  'emergencycontactphone',
  'homephone',
  'mobilephone',
  'phone',
  'phonenumber',
]);
const BIRTH_FIELD_NAMES = new Set(['birthdate', 'birthday', 'dateofbirth', 'dob']);
const ADDRESS_FIELD_NAMES = new Set([
  'address',
  'address1',
  'address2',
  'addressline1',
  'addressline2',
  'billingaddress',
  'homeaddress',
  'mailingaddress',
  'postaladdress',
  'shippingaddress',
  'streetaddress',
]);
const AUTH_FIELD_NAMES = new Set([
  'accesstoken',
  'apicredential',
  'apikey',
  'authtoken',
  'authorization',
  'authorizationcode',
  'checkoutsessionid',
  'clientsecret',
  'confirmationtoken',
  'cookie',
  'csrftoken',
  'idtoken',
  'oauthcode',
  'oauthstate',
  'oauthtoken',
  'oobcode',
  'password',
  'paymentintentclientsecret',
  'privatekey',
  'refreshtoken',
  'resettoken',
  'secret',
  'sessionid',
  'sessiontoken',
  'setcookie',
  'token',
  'verificationtoken',
  'xapikey',
]);

function assertSensitiveScalar(fieldName, rawValue) {
  const value = String(rawValue).trim();
  const normalizedName = normalizedFieldName(fieldName);
  if (isRedacted(value)) return;
  if (NAME_FIELD_NAMES.has(normalizedName) && isReservedIdentity(value)) return;
  if (EMAIL_FIELD_NAMES.has(normalizedName) && isReservedEmail(value)) return;
  if (PHONE_FIELD_NAMES.has(normalizedName) && isReservedPhone(value)) return;
  if (AUTH_FIELD_NAMES.has(normalizedName)) fail('AUTH_MATERIAL');
  if (NAME_FIELD_NAMES.has(normalizedName)
    || EMAIL_FIELD_NAMES.has(normalizedName)
    || PHONE_FIELD_NAMES.has(normalizedName)
    || BIRTH_FIELD_NAMES.has(normalizedName)) {
    fail('SENSITIVE_IDENTITY_FIELD');
  }
}

function isSensitiveFieldName(fieldName) {
  const normalizedName = normalizedFieldName(fieldName);
  return ADDRESS_FIELD_NAMES.has(normalizedName)
    || AUTH_FIELD_NAMES.has(normalizedName)
    || BIRTH_FIELD_NAMES.has(normalizedName)
    || EMAIL_FIELD_NAMES.has(normalizedName)
    || NAME_FIELD_NAMES.has(normalizedName)
    || PHONE_FIELD_NAMES.has(normalizedName)
    || normalizedName.startsWith('emergencycontact');
}

function assertSensitiveNamedValue(fieldName, rawValue) {
  const normalizedName = normalizedFieldName(fieldName);
  if (ADDRESS_FIELD_NAMES.has(normalizedName)
    || (normalizedName.startsWith('emergencycontact')
      && normalizedName !== 'emergencycontactname'
      && normalizedName !== 'emergencycontactemail'
      && normalizedName !== 'emergencycontactphone')) {
    if (!isRedacted(String(rawValue))) fail('SENSITIVE_IDENTITY_FIELD');
    return;
  }
  assertSensitiveScalar(normalizedName, rawValue);
}

function xmlLocalName(qualifiedName) {
  return qualifiedName.slice(qualifiedName.lastIndexOf(':') + 1);
}

function xmlAttributes(fragment) {
  return [...fragment.matchAll(
    /(?:^|\s)([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu,
  )].map((match) => Object.freeze({
    name: xmlLocalName(match[1]),
    value: match[2] ?? match[3],
  }));
}

function sensitiveFieldValues(text) {
  const values = [];
  const field = '(?:address(?:[_-]?(?:line)?[12])?|billing[_-]?address|birth[_-]?date|birthday|contact[_-]?(?:email|phone)|date[_-]?of[_-]?birth|display[_-]?name|dob|email(?:[_-]?address)?|emergency[_-]?contact(?:[_-]?[a-z0-9]+)*|first[_-]?name|full[_-]?name|home[_-]?(?:address|phone)|last[_-]?name|legal[_-]?name|mailing[_-]?address|member[_-]?(?:email|name)|mobile[_-]?phone|phone(?:[_-]?number)?|postal[_-]?address|runner[_-]?(?:email|name)|shipping[_-]?address|street[_-]?address)';
  const patterns = [
    new RegExp(`["']?(${field})["']?\\s*[:=]\\s*["']([^"'\\r\\n]{0,256})["']`, 'giu'),
    new RegExp(`(?:^|[?&#])(${field})=([^&#\\s]{0,512})`, 'giu'),
    new RegExp(`(?:^|[\\s,{;])["']?(${field})["']?\\s*[:=]\\s*(?!["'])([^,;}\\r\\n]{1,512})`, 'giu'),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      values.push(Object.freeze({ fieldName: match[1], value: match[2] }));
    }
  }
  return values;
}

function inspectJsonLookingIdentity(text) {
  const trimmed = text.trim();
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return false;
  }
  try {
    inspectStructuredIdentity(JSON.parse(trimmed));
    return true;
  } catch (error) {
    if (error instanceof ArtifactSafetyError) throw error;
    return false;
  }
}

function rejectSensitiveContent(text) {
  for (const view of normalizedViews(text)) {
    const structuredJson = inspectJsonLookingIdentity(view);
    if (/\b(?:mid-peninsula-running-club|runmprc-97922)\b/iu.test(view)
      || /\bmid-peninsula-running-club\.(?:firebaseapp\.com|web\.app)\b/iu.test(view)) {
      fail('PRODUCTION_AUTHORITY');
    }

    if (/-----BEGIN [A-Z0-9 -]{0,64}PRIVATE KEY(?: BLOCK)?-----/iu.test(view)) {
      fail('PRIVATE_KEY_MATERIAL');
    }
    if (/\b(?:A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b/u.test(view)
      || /\bAIza[0-9A-Za-z_-]{30,}\b/u.test(view)
      || /\bgh[pousr]_[0-9A-Za-z]{20,}\b/u.test(view)
      || /\bgithub_pat_[0-9A-Za-z_]{20,}\b/u.test(view)
      || /\bcs_(?:live|test)_[0-9A-Za-z]{12,}\b/iu.test(view)
      || /\bpi_[0-9A-Za-z]{8,}_secret_[0-9A-Za-z]{12,}\b/iu.test(view)
      || /\b(?:pk|rk|sk)_(?:live|test)_[0-9A-Za-z]{12,}\b/iu.test(view)
      || /\bwhsec_[0-9A-Za-z]{12,}\b/iu.test(view)) {
      fail('CREDENTIAL_SHAPE');
    }
    if (/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/u.test(view)) {
      fail('JWT_SHAPE');
    }

    const authorizationAssignments = /\bauthorization["']?\s*[:=]\s*["']?([^"'\r\n]{1,512})/giu;
    for (const match of view.matchAll(authorizationAssignments)) {
      const value = match[1].trim();
      const bearer = /^bearer\s+([^\s,;]+)/iu.exec(value);
      if (bearer) {
        if (!isRedacted(bearer[1])) fail('BEARER_MATERIAL');
      } else if (!isRedacted(value)) {
        fail('AUTH_MATERIAL');
      }
    }
    for (const match of view.matchAll(/(?:^|[^A-Za-z0-9_-])bearer\s+([^\s,;"']{1,512})/gimu)) {
      if (!isRedacted(match[1])) fail('BEARER_MATERIAL');
    }
    if (/\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/iu.test(view)) {
      fail('AUTH_MATERIAL');
    }
    const authAssignments = /(?:^|[\s,{;])["']?(?:access[_-]?token|api[_-]?(?:credential|key)|auth[_-]?token|authorization[_-]?code|checkout[_-]?session[_-]?id|client[_-]?secret|confirmation[_-]?token|cookie|csrf[_-]?token|id[_-]?token|oauth[_-]?(?:code|state|token)|oob[_-]?code|password|payment[_-]?intent[_-]?client[_-]?secret|private[_-]?key|refresh[_-]?token|reset[_-]?token|secret|session[_-]?(?:id|token)|set[_-]?cookie|token|verification[_-]?token|x[_-]?api[_-]?key)["']?\s*[:=]\s*["']?([^"'\s,;}]{1,512})/gimu;
    for (const match of view.matchAll(authAssignments)) {
      if (!isRedacted(match[1])) fail('AUTH_MATERIAL');
    }
    const capabilityParameter = '(?:access[_-]?token|api[_-]?key|auth|auth[_-]?token|authorization|bearer|checkout(?:[_-]?session)?|client[_-]?secret|code|confirmation(?:[_-]?token)?|cookie|csrf[_-]?token|id[_-]?token|key|oauth[_-]?token|oob[_-]?code|password|payment[_-]?intent[_-]?client[_-]?secret|refresh[_-]?token|reset[_-]?token|secret|session(?:[-_]?(?:id|token))?|set[_-]?cookie|sig(?:nature)?|state|token|verification[_-]?token|x[_-]?api[_-]?key)';
    const capabilityPattern = new RegExp(`(?:^|[?&#])${capabilityParameter}=([^&#\\s]+)`, 'gimu');
    if (new RegExp(`(?:^|[?&#])${capabilityParameter}=([^&#\\s]+)`, 'imu').test(view)) {
      const values = [...view.matchAll(capabilityPattern)];
      if (values.some((match) => !isRedacted(match[1]))) fail('CAPABILITY_URL');
    }

    for (const match of view.matchAll(/\b[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,63}\b/giu)) {
      if (!isReservedEmail(match[0])) fail('PERSONAL_EMAIL');
    }
    for (const match of view.matchAll(/(?:\+?1[ .-]?)?(?:\([2-9][0-9]{2}\)|[2-9][0-9]{2})[ .-][0-9]{3}[ .-][0-9]{4}\b/gu)) {
      if (!isReservedPhone(match[0])) fail('PERSONAL_PHONE');
    }
    for (const match of view.matchAll(/\+[1-9][0-9]{7,14}\b/gu)) {
      if (!isReservedPhone(match[0])) fail('PERSONAL_PHONE');
    }

    const sensitiveElementName = '(?:access[_-]?token|address(?:[_-]?(?:line)?[12])?|api[_-]?(?:credential|key)|auth[_-]?token|authorization(?:[_-]?code)?|billing[_-]?address|birth[_-]?date|birthday|checkout[_-]?session[_-]?id|client[_-]?secret|confirmation[_-]?token|contact[_-]?(?:email|phone)|cookie|csrf[_-]?token|date[_-]?of[_-]?birth|display[_-]?name|dob|email(?:[_-]?address)?|emergency[_-]?contact(?:[_-]?(?:email|name|phone))?|first[_-]?name|full[_-]?name|home[_-]?(?:address|phone)|id[_-]?token|last[_-]?name|legal[_-]?name|mailing[_-]?address|member[_-]?(?:email|name)|mobile[_-]?phone|oauth[_-]?(?:code|state|token)|oob[_-]?code|password|payment[_-]?intent[_-]?client[_-]?secret|phone(?:[_-]?number)?|postal[_-]?address|private[_-]?key|refresh[_-]?token|reset[_-]?token|runner[_-]?(?:email|name)|secret|session[_-]?(?:id|token)|set[_-]?cookie|shipping[_-]?address|street[_-]?address|token|verification[_-]?token|x[_-]?api[_-]?key)';
    const sensitiveElement = new RegExp(`<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?(${sensitiveElementName}))\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, 'giu');
    for (const match of view.matchAll(sensitiveElement)) {
      if (/<[^>]*>/u.test(match[3])) {
        fail(AUTH_FIELD_NAMES.has(normalizedFieldName(match[2]))
          ? 'AUTH_MATERIAL'
          : 'SENSITIVE_IDENTITY_FIELD');
      }
      assertSensitiveNamedValue(match[2], match[3]);
    }

    const startElement = /<([A-Za-z_][A-Za-z0-9_.:-]*)(\s[^<>]*?)?\/?>/gu;
    for (const match of view.matchAll(startElement)) {
      const elementName = xmlLocalName(match[1]);
      const attributes = xmlAttributes(match[2] ?? '');
      for (const attribute of attributes) {
        if (isSensitiveFieldName(attribute.name)) {
          assertSensitiveNamedValue(attribute.name, attribute.value);
        }
      }
      const valueAttribute = attributes.find((attribute) => (
        normalizedFieldName(attribute.name) === 'value'
      ));
      if (isSensitiveFieldName(elementName) && valueAttribute) {
        assertSensitiveNamedValue(elementName, valueAttribute.value);
      }
    }

    const propertyElement = /<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:attribute|field|property))\b([^<>]*?)>([\s\S]*?)<\/\1\s*>/giu;
    for (const match of view.matchAll(propertyElement)) {
      const attributes = xmlAttributes(match[2]);
      const fieldAttribute = attributes.find((attribute) => (
        ['key', 'name'].includes(normalizedFieldName(attribute.name))
      ));
      if (!fieldAttribute || !isSensitiveFieldName(fieldAttribute.value)) continue;
      const valueAttribute = attributes.find((attribute) => (
        normalizedFieldName(attribute.name) === 'value'
      ));
      const value = valueAttribute ? valueAttribute.value : match[3];
      if (/<[^>]*>/u.test(value)) {
        fail(AUTH_FIELD_NAMES.has(normalizedFieldName(fieldAttribute.value))
          ? 'AUTH_MATERIAL'
          : 'SENSITIVE_IDENTITY_FIELD');
      }
      assertSensitiveNamedValue(fieldAttribute.value, value);
    }

    const propertyStart = /<([A-Za-z_][A-Za-z0-9_.:-]*)(\s[^<>]*?)\/?>/gu;
    for (const match of view.matchAll(propertyStart)) {
      if (!['attribute', 'field', 'property'].includes(normalizedFieldName(xmlLocalName(match[1])))) {
        continue;
      }
      const attributes = xmlAttributes(match[2] ?? '');
      const fieldAttribute = attributes.find((attribute) => (
        ['key', 'name'].includes(normalizedFieldName(attribute.name))
      ));
      const valueAttribute = attributes.find((attribute) => (
        normalizedFieldName(attribute.name) === 'value'
      ));
      if (fieldAttribute && valueAttribute && isSensitiveFieldName(fieldAttribute.value)) {
        assertSensitiveNamedValue(fieldAttribute.value, valueAttribute.value);
      }
    }

    if (!structuredJson) {
      for (const { fieldName, value } of sensitiveFieldValues(view)) {
        assertSensitiveNamedValue(fieldName, value);
      }
    }
  }
}

function rejectSensitiveFilename(relativePath) {
  const portablePath = relativePath.split(path.sep).join('/');
  rejectSensitiveContent(portablePath);
  for (const view of normalizedViews(portablePath)) {
    if (/(?:^|[._/-])(?:auth|bearer|cookie|credential|password|private[-_]?key|secret|session[-_]?id|token)[-_=][0-9a-z_-]{8,}(?:[._/-]|$)/iu.test(view)) {
      fail('SENSITIVE_FILENAME');
    }
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExactSyntheticAddress(value) {
  if (!isPlainRecord(value)) return false;
  const expectedKeys = ['city', 'country', 'line1', 'line2', 'postalCode', 'state'];
  const keys = Object.keys(value).sort(compareText);
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index])
    && /^[1-9][0-9]{2} Test Only Avenue$/u.test(value.line1)
    && value.line2 === null
    && value.city === 'Example'
    && value.state === 'CA'
    && value.postalCode === '00000'
    && value.country === 'US';
}

function inspectStructuredIdentity(value, context = '') {
  if (Array.isArray(value)) {
    value.forEach((entry) => inspectStructuredIdentity(entry, context));
    return;
  }
  if (!isPlainRecord(value)) return;

  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const normalizedName = normalizedFieldName(fieldName);
    const effectiveName = context === 'emergencycontact' && normalizedName === 'name'
      ? 'emergencycontactname'
      : (context === 'emergencycontact' && normalizedName === 'phone'
        ? 'emergencycontactphone'
        : (context === 'emergencycontact' && normalizedName === 'email'
          ? 'emergencycontactemail'
          : normalizedName));

    if (ADDRESS_FIELD_NAMES.has(normalizedName)) {
      if (typeof fieldValue === 'string' && isRedacted(fieldValue)) continue;
      if (isExactSyntheticAddress(fieldValue)) continue;
      fail('SENSITIVE_IDENTITY_FIELD');
    }
    if (normalizedName === 'emergencycontact') {
      if (typeof fieldValue === 'string' && isRedacted(fieldValue)) continue;
      if (!isPlainRecord(fieldValue)) fail('SENSITIVE_IDENTITY_FIELD');
      inspectStructuredIdentity(fieldValue, 'emergencycontact');
      continue;
    }
    if (AUTH_FIELD_NAMES.has(effectiveName)
      || NAME_FIELD_NAMES.has(effectiveName)
      || EMAIL_FIELD_NAMES.has(effectiveName)
      || PHONE_FIELD_NAMES.has(effectiveName)
      || BIRTH_FIELD_NAMES.has(effectiveName)) {
      if (!['string', 'number'].includes(typeof fieldValue)) {
        fail(AUTH_FIELD_NAMES.has(effectiveName)
          ? 'AUTH_MATERIAL'
          : 'SENSITIVE_IDENTITY_FIELD');
      }
      assertSensitiveScalar(effectiveName, fieldValue);
      continue;
    }
    inspectStructuredIdentity(fieldValue, context);
  }
}

function isValidXmlCodePoint(codePoint) {
  return codePoint === 0x09
    || codePoint === 0x0a
    || codePoint === 0x0d
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function validateXml(text) {
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/iu.test(text)) fail('FORMAT_INVALID');
  if (Array.from(text).some((character) => !isValidXmlCodePoint(character.codePointAt(0)))) {
    fail('FORMAT_INVALID');
  }
  for (const match of text.matchAll(/&#(?:x([0-9a-f]{1,8})|([0-9]{1,9}));/giu)) {
    const codePoint = match[1] === undefined
      ? Number.parseInt(match[2], 10)
      : Number.parseInt(match[1], 16);
    if (!Number.isSafeInteger(codePoint) || !isValidXmlCodePoint(codePoint)) {
      fail('FORMAT_INVALID');
    }
  }
  const withoutAllowedEntities = text.replace(
    /&(?:amp|apos|gt|lt|quot|#[0-9]{1,9}|#x[0-9a-f]{1,8});/giu,
    '',
  );
  if (/&(?:#|[a-z])/iu.test(withoutAllowedEntities)) fail('FORMAT_INVALID');

  const stack = [];
  let cursor = 0;
  let rootElements = 0;
  let declarationSeen = false;
  const tags = /<([^<>]+)>/gu;
  for (const match of text.matchAll(tags)) {
    const between = text.slice(cursor, match.index);
    if (/[<>]/u.test(between) || (stack.length === 0 && between.trim() !== '')) {
      fail('FORMAT_INVALID');
    }
    cursor = match.index + match[0].length;
    const body = match[1].trim();
    if (body.startsWith('?') && body.endsWith('?')) {
      if (declarationSeen
        || match.index !== 0
        || rootElements !== 0
        || stack.length !== 0
        || !/^\?xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"UTF-8"|'UTF-8'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?$/iu.test(body)) {
        fail('FORMAT_INVALID');
      }
      declarationSeen = true;
      continue;
    }
    if (body.startsWith('!--') && body.endsWith('--')) continue;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(name) || stack.pop() !== name) {
        fail('FORMAT_INVALID');
      }
      continue;
    }
    const selfClosing = body.endsWith('/');
    const content = selfClosing ? body.slice(0, -1).trim() : body;
    const name = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(content)?.[0];
    if (!name) fail('FORMAT_INVALID');
    const attributes = content.slice(name.length);
    if (!/^(?:\s+[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*$/u.test(attributes)) {
      fail('FORMAT_INVALID');
    }
    const attributeNames = [...attributes.matchAll(/\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=/gu)]
      .map((attribute) => attribute[1]);
    if (new Set(attributeNames).size !== attributeNames.length) fail('FORMAT_INVALID');
    if (stack.length === 0) rootElements += 1;
    if (!selfClosing) stack.push(name);
  }
  const trailing = text.slice(cursor);
  if (cursor === 0
    || /[<>]/u.test(trailing)
    || trailing.trim() !== ''
    || stack.length !== 0
    || rootElements !== 1) {
    fail('FORMAT_INVALID');
  }
}

function validateTap(text) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '');
  if (lines[0] !== 'TAP version 13') fail('FORMAT_INVALID');

  const plans = [];
  const results = [];
  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;
    if (/^\s/u.test(line)) continue;
    const plan = /^1\.\.([0-9]+)(?:\s+#.*)?$/u.exec(line);
    if (plan) {
      plans.push(Number.parseInt(plan[1], 10));
      continue;
    }
    const result = /^(?:not )?ok\s+([0-9]+)(?:\s+-[^\r\n]*)?(?:\s+#.*)?$/u.exec(line);
    if (result) {
      results.push(Number.parseInt(result[1], 10));
      continue;
    }
    if (/^#/u.test(line)) continue;
    fail('FORMAT_INVALID');
  }

  if (plans.length !== 1
    || results.length !== plans[0]
    || results.some((number, index) => number !== index + 1)) {
    fail('FORMAT_INVALID');
  }
}

function validateLcov(text) {
  const lines = text.split(/\r?\n/u).filter((line) => line !== '');
  let inRecord = false;
  let pendingTestName = false;
  let records = 0;
  const metric = /^(?:BRDA:[0-9]+,[0-9]+,[0-9]+,(?:[0-9]+|-)|BRF:[0-9]+|BRH:[0-9]+|DA:[0-9]+,[0-9]+(?:,[^,\s]+)?|FN:[0-9]+(?:,[0-9]+)?,.+|FNDA:[0-9]+,.+|FNF:[0-9]+|FNH:[0-9]+|LF:[0-9]+|LH:[0-9]+)$/u;

  for (const line of lines) {
    if (/^TN:[^\r\n]*$/u.test(line)) {
      if (inRecord || pendingTestName) fail('FORMAT_INVALID');
      pendingTestName = true;
      continue;
    }
    if (/^SF:.+$/u.test(line)) {
      if (inRecord) fail('FORMAT_INVALID');
      inRecord = true;
      pendingTestName = false;
      records += 1;
      continue;
    }
    if (line === 'end_of_record') {
      if (!inRecord) fail('FORMAT_INVALID');
      inRecord = false;
      continue;
    }
    if (!inRecord || !metric.test(line)) fail('FORMAT_INVALID');
  }

  if (inRecord || pendingTestName || records === 0) fail('FORMAT_INVALID');
}

function validateArtifactStructure(filePath, text) {
  const extension = path.extname(filePath).toLowerCase();
  try {
    if (extension === '.json') {
      inspectStructuredIdentity(JSON.parse(text));
      return;
    }
    if (extension === '.jsonl') {
      const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '');
      if (lines.length === 0) fail('FORMAT_INVALID');
      lines.forEach((line) => inspectStructuredIdentity(JSON.parse(line)));
      return;
    }
    if (extension === '.xml') {
      validateXml(text);
      return;
    }
    if (extension === '.tap') {
      validateTap(text);
      return;
    }
    if (extension === '.lcov' || extension === '.info') {
      validateLcov(text);
    }
  } catch (error) {
    if (error instanceof ArtifactSafetyError) throw error;
    fail('FORMAT_INVALID');
  }
}

function readTextFile(filePath, expectedStat) {
  const extension = path.extname(filePath).toLowerCase();
  if (ARCHIVE_EXTENSIONS.has(extension)) fail('ARCHIVE_UNSUPPORTED');
  if (!ALLOWED_EXTENSIONS.has(extension)) fail('FORMAT_UNSUPPORTED');
  if (expectedStat.size > MAX_FILE_BYTES) fail('FILE_TOO_LARGE');

  let bytes;
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const actualStat = fs.fstatSync(descriptor);
    if (!actualStat.isFile()
      || actualStat.dev !== expectedStat.dev
      || actualStat.ino !== expectedStat.ino
      || actualStat.size !== expectedStat.size
      || actualStat.ctimeMs !== expectedStat.ctimeMs) {
      fail('ENTRY_CHANGED', EXIT_SCAN_FAILURE);
    }
    const boundedBuffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1);
    let offset = 0;
    while (offset < boundedBuffer.length) {
      const bytesRead = fs.readSync(
        descriptor,
        boundedBuffer,
        offset,
        boundedBuffer.length - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_FILE_BYTES) fail('FILE_TOO_LARGE');
    const finalStat = fs.fstatSync(descriptor);
    if (finalStat.dev !== actualStat.dev
      || finalStat.ino !== actualStat.ino
      || finalStat.size !== offset
      || finalStat.size !== actualStat.size
      || finalStat.mtimeMs !== actualStat.mtimeMs
      || finalStat.ctimeMs !== actualStat.ctimeMs
      || finalStat.ctimeMs !== expectedStat.ctimeMs) {
      fail('ENTRY_CHANGED', EXIT_SCAN_FAILURE);
    }
    bytes = boundedBuffer.subarray(0, offset);
  } catch (error) {
    if (error instanceof ArtifactSafetyError) throw error;
    fail('ENTRY_UNREADABLE', EXIT_SCAN_FAILURE);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    fail('BINARY_CONTENT');
  }
  if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
    fail('BINARY_CONTENT');
  }
  rejectSensitiveContent(text);
  validateArtifactStructure(filePath, text);
  return { bytes, text };
}

function scanRoot(rootRecord, rootIndex, digest, totals) {
  const root = rootRecord.path;
  const visit = (directory, expectedIdentity, depth, relativeDirectory) => {
    if (depth > MAX_DEPTH) fail('DEPTH_LIMIT');
    const directoryDescriptor = openBoundDirectory(directory, expectedIdentity);
    try {
      let directoryHandle;
      const entries = [];
      try {
        assertBoundDirectory(directory, expectedIdentity, directoryDescriptor);
        directoryHandle = fs.opendirSync(directory);
        while (true) {
          const entry = directoryHandle.readSync();
          if (entry === null) break;
          totals.entries += 1;
          if (totals.entries > MAX_ENTRIES) fail('ENTRY_LIMIT');
          entries.push(entry);
        }
        directoryHandle.closeSync();
        directoryHandle = undefined;
        assertBoundDirectory(directory, expectedIdentity, directoryDescriptor);
      } catch (error) {
        if (error instanceof ArtifactSafetyError) throw error;
        fail('ENTRY_UNREADABLE', EXIT_SCAN_FAILURE);
      } finally {
        if (directoryHandle !== undefined) directoryHandle.closeSync();
      }
      entries.sort((left, right) => compareText(left.name, right.name));

      for (const entry of entries) {
        if (relativeDirectory === '' && SOURCE_MARKERS.has(entry.name)) {
          fail('ROOT_CONTAINS_SOURCE', EXIT_INVALID_ROOT);
        }
        const entryPath = path.join(directory, entry.name);
        const relativePath = relativeDirectory
          ? path.join(relativeDirectory, entry.name)
          : entry.name;
        if (!isAncestor(root, entryPath)) fail('PATH_ESCAPE', EXIT_SCAN_FAILURE);

        let stat;
        try {
          stat = fs.lstatSync(entryPath);
        } catch {
          fail('ENTRY_UNREADABLE', EXIT_SCAN_FAILURE);
        }
        if (stat.isSymbolicLink()) fail('SYMLINK_UNSUPPORTED');
        if (stat.isDirectory()) {
          let realDirectory;
          try {
            realDirectory = fs.realpathSync(entryPath);
          } catch {
            fail('ENTRY_UNREADABLE', EXIT_SCAN_FAILURE);
          }
          if (realDirectory !== entryPath || !isAncestor(root, realDirectory)) {
            fail('PATH_ESCAPE', EXIT_SCAN_FAILURE);
          }
          const childIdentity = readDirectoryIdentity(realDirectory);
          visit(realDirectory, childIdentity, depth + 1, relativePath);
          continue;
        }
        if (!stat.isFile()) fail('ENTRY_TYPE_UNSUPPORTED');

        totals.files += 1;
        if (totals.files > MAX_FILES) fail('FILE_LIMIT');

        rejectSensitiveFilename(relativePath);
        const artifact = readTextFile(entryPath, stat);
        totals.bytes += artifact.bytes.length;
        if (totals.bytes > MAX_TOTAL_BYTES) fail('TOTAL_BYTES_LIMIT');
        digest.update(`${rootIndex}\0${relativePath.split(path.sep).join('/')}\0`);
        digest.update(artifact.bytes);
        digest.update('\0');
      }
      assertBoundDirectory(directory, expectedIdentity, directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  };

  visit(root, rootRecord.identity, 0, '');
}

function scanArtifactRootsInternal(rawRoots, rawOptions) {
  const rootsInput = snapshotRootArguments(rawRoots);
  const { cwd } = snapshotScanOptions(rawOptions);
  if (rootsInput.length === 0) {
    fail('ROOT_REQUIRED', EXIT_INVALID_ROOT);
  }
  if (rootsInput.length > MAX_ROOTS) fail('ROOT_LIMIT', EXIT_INVALID_ROOT);
  const roots = rootsInput
    .map((rawRoot) => validateRoot(rawRoot, cwd))
    .sort((left, right) => compareText(left.path, right.path));
  if (new Set(roots.map((root) => root.path)).size !== roots.length) {
    fail('ROOT_DUPLICATE', EXIT_INVALID_ROOT);
  }

  const totals = { bytes: 0, entries: 0, files: 0 };
  const digest = crypto.createHash('sha256');
  roots.forEach((root, index) => scanRoot(root, index, digest, totals));
  return Object.freeze({
    bytes: totals.bytes,
    files: totals.files,
    manifestDigest: digest.digest('hex'),
    roots: roots.length,
  });
}

export function scanArtifactRoots(rawRoots, rawOptions) {
  try {
    return scanArtifactRootsInternal(rawRoots, rawOptions);
  } catch (error) {
    if (error instanceof ArtifactSafetyError) throw error;
    fail('SCAN_INTERNAL', EXIT_SCAN_FAILURE);
  }
}

function reportFailure(error) {
  if (error instanceof ArtifactSafetyError) {
    process.stderr.write(`TEST_ARTIFACT_SCAN_FAILED ${error.ruleId}\n`);
    process.exitCode = error.exitCode;
    return;
  }
  process.stderr.write('TEST_ARTIFACT_SCAN_FAILED INTERNAL_ERROR\n');
  process.exitCode = EXIT_SCAN_FAILURE;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const summary = scanArtifactRoots(process.argv.slice(2));
    process.stdout.write(`TEST_ARTIFACT_SCAN_OK roots=${summary.roots} files=${summary.files} bytes=${summary.bytes} digest=${summary.manifestDigest}\n`);
  } catch (error) {
    reportFailure(error);
  }
}

export const TEST_ARTIFACT_LIMITS = Object.freeze({
  maxDepth: MAX_DEPTH,
  maxEntries: MAX_ENTRIES,
  maxFileBytes: MAX_FILE_BYTES,
  maxFiles: MAX_FILES,
  maxRoots: MAX_ROOTS,
  maxTotalBytes: MAX_TOTAL_BYTES,
});
