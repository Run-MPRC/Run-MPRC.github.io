const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  STORAGE_KEY,
  buildRedirectTarget,
  captureRedirect,
  parseSameOriginTarget,
  restoreRedirect,
} = require('../public/spa-navigation');

const UNSAFE_STORED_TARGETS = [
  '//attacker.example/collect',
  '/\\attacker.example/collect',
  'https://attacker.example/collect',
  ['java', 'script:alert(1)'].join(''),
  'not a URL',
  '/%2e%2e//attacker.example',
  '/.//attacker.example',
  '/a/..//attacker.example',
];

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  };
}

test('captures pathname, query, and hash before redirecting to the root', () => {
  const storage = storageWith();
  const replacements = [];
  const browserWindow = {
    location: {
      pathname: '/register/success',
      search: '?session_id=cs_test_example&registration=r1',
      hash: '#receipt',
      replace: (target) => replacements.push(target),
    },
    sessionStorage: storage,
  };

  assert.equal(captureRedirect(browserWindow), true);
  assert.equal(
    storage.getItem(STORAGE_KEY),
    '/register/success?session_id=cs_test_example&registration=r1#receipt',
  );
  assert.deepEqual(replacements, ['/']);
});

test('drops malformed location components while building the stored route', () => {
  assert.equal(buildRedirectTarget({
    pathname: 'https://attacker.example/path',
    search: 'not-a-query',
    hash: 'not-a-hash',
  }), '/');
});

test('restores the exact same-origin route and clears temporary state', () => {
  const target = '/account/strava/callback?code=example&state=example-state#connected';
  const storage = storageWith({ [STORAGE_KEY]: target });
  const historyCalls = [];
  const browserWindow = {
    location: { origin: 'https://runmprc.com' },
    sessionStorage: storage,
    history: {
      replaceState: (...args) => historyCalls.push(args),
    },
  };

  assert.equal(restoreRedirect(browserWindow), true);
  assert.deepEqual(historyCalls, [[null, '', target]]);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('preserves an Auth action query only for the app to scrub after restoration', () => {
  const target = '/auth/action?mode=verifyEmail&oobCode=synthetic-action-code#private';
  const storage = storageWith();
  const captureWindow = {
    location: {
      pathname: '/auth/action',
      search: '?mode=verifyEmail&oobCode=synthetic-action-code',
      hash: '#private',
      replace: () => undefined,
    },
    sessionStorage: storage,
  };

  assert.equal(captureRedirect(captureWindow), true);
  assert.equal(storage.getItem(STORAGE_KEY), target);

  const historyCalls = [];
  const restoreWindow = {
    location: { origin: 'https://runmprc.com' },
    sessionStorage: storage,
    history: { replaceState: (...args) => historyCalls.push(args) },
  };

  assert.equal(restoreRedirect(restoreWindow), true);
  assert.deepEqual(historyCalls, [[null, '', target]]);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('rejects cross-origin, protocol-relative, and malformed stored targets', () => {
  UNSAFE_STORED_TARGETS.forEach((target) => {
    assert.equal(parseSameOriginTarget(target, 'https://runmprc.com'), null);
  });
  assert.equal(parseSameOriginTarget('/safe?next=%2F%2Fexample.test', 'not an origin'), null);
});

test('clears unsafe stored targets without changing browser history', () => {
  UNSAFE_STORED_TARGETS.forEach((target) => {
    const storage = storageWith({ [STORAGE_KEY]: target });
    const browserWindow = {
      location: { origin: 'https://runmprc.com' },
      sessionStorage: storage,
      history: { replaceState: () => assert.fail('unsafe target must not be restored') },
    };

    assert.equal(restoreRedirect(browserWindow), false);
    assert.equal(storage.has(STORAGE_KEY), false);
  });
});

test('fails safely when session storage is unavailable', () => {
  const replacements = [];
  const browserWindow = {
    location: {
      pathname: '/account',
      search: '',
      hash: '',
      replace: (target) => replacements.push(target),
    },
    sessionStorage: {
      setItem: () => { throw new Error('storage blocked'); },
    },
  };

  assert.equal(captureRedirect(browserWindow), false);
  assert.deepEqual(replacements, ['/']);
});

test('fails safely when stored redirect state cannot be read', () => {
  const browserWindow = {
    location: { origin: 'https://runmprc.com' },
    sessionStorage: {
      getItem: () => { throw new Error('storage blocked'); },
      removeItem: () => assert.fail('unreadable state must not be restored'),
    },
    history: { replaceState: () => assert.fail('history must remain unchanged') },
  };

  assert.equal(restoreRedirect(browserWindow), false);
});

test('clears temporary state and fails safely when history restoration throws', () => {
  const storage = storageWith({ [STORAGE_KEY]: '/account' });
  const browserWindow = {
    location: { origin: 'https://runmprc.com' },
    sessionStorage: storage,
    history: { replaceState: () => { throw new Error('history blocked'); } },
  };

  assert.equal(restoreRedirect(browserWindow), false);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('the Pages documents invoke the shared capture and restore actions', () => {
  const root = path.join(__dirname, '..', 'public');
  const notFound = fs.readFileSync(path.join(root, '404.html'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(notFound, /spa-navigation\.js" data-mprc-spa-action="capture"/);
  assert.match(index, /spa-navigation\.js"[\s\S]*data-mprc-spa-action="restore"/);
  assert.doesNotMatch(notFound, /sessionStorage\.setItem/);
  assert.doesNotMatch(index, /sessionStorage\.getItem/);
});

test('the Pages documents strip callback details before loading subresources', () => {
  const root = path.join(__dirname, '..', 'public');
  const documents = [
    fs.readFileSync(path.join(root, '404.html'), 'utf8'),
    fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  ];

  documents.forEach((document) => {
    const policyIndex = document.search(
      /<meta name="referrer" content="strict-origin"\s*\/?\s*>/i,
    );
    const firstSubresourceIndex = document.search(/<(?:script|link|img)\b/i);

    assert.notEqual(policyIndex, -1, 'strict-origin policy must be present');
    assert.notEqual(firstSubresourceIndex, -1, 'document must load a subresource');
    assert.ok(
      policyIndex < firstSubresourceIndex,
      'referrer policy must precede every subresource',
    );
  });
});
