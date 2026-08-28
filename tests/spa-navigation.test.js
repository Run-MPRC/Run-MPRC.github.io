const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  STORAGE_KEY,
  captureRedirect,
  parseSameOriginTarget,
  restoreRedirect,
} = require('../public/spa-navigation');

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
      search: '?reg=reg_123&token=secret&event=race-2026',
      hash: '#receipt',
      replace: (target) => replacements.push(target),
    },
    sessionStorage: storage,
  };

  assert.equal(captureRedirect(browserWindow), true);
  assert.equal(
    storage.getItem(STORAGE_KEY),
    '/register/success?reg=reg_123&token=secret&event=race-2026#receipt',
  );
  assert.deepEqual(replacements, ['/']);
});

test('restores the exact same-origin route and clears temporary state', () => {
  const target = '/account/strava/callback?code=abc123&state=csrf-token#connected';
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

test('rejects cross-origin or malformed stored targets and still clears them', () => {
  assert.equal(
    parseSameOriginTarget('//attacker.example/collect?token=secret', 'https://runmprc.com'),
    null,
  );
  assert.equal(
    parseSameOriginTarget('https://attacker.example/collect', 'https://runmprc.com'),
    null,
  );

  const storage = storageWith({ [STORAGE_KEY]: '//attacker.example/collect' });
  const browserWindow = {
    location: { origin: 'https://runmprc.com' },
    sessionStorage: storage,
    history: { replaceState: () => assert.fail('unsafe target must not be restored') },
  };
  assert.equal(restoreRedirect(browserWindow), false);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('the GitHub Pages documents invoke the shared capture and restore actions', () => {
  const root = path.join(__dirname, '..', 'public');
  const notFound = fs.readFileSync(path.join(root, '404.html'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(notFound, /spa-navigation\.js" data-mprc-spa-action="capture"/);
  assert.match(index, /spa-navigation\.js"[\s\S]*data-mprc-spa-action="restore"/);
});
