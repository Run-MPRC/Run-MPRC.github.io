'use strict';

const { route, HEADERS, ORIGIN } = require('../../../tests/runner-browser/policy.cjs');
test.each(['/', '/bundle.js', '/fixture.json'])('only exact local test assets are served: %s', (url) => {
  expect(route('GET', url, '127.0.0.1:9619')).toBe(url);
  expect(route('GET', url, '127.0.0.1:9619', ORIGIN)).toBe(url);
});
test.each([
  ['GET', '/fixture.json', 'localhost:9619', undefined],
  ['GET', '/fixture.json', 'synthetic.example:9619', undefined],
  ['GET', '/fixture.json', '127.0.0.1:9619', 'https://example.test'],
  ['GET', '/../package.json', '127.0.0.1:9619', undefined],
  ['GET', '/fixture.json?project=production', '127.0.0.1:9619', undefined],
  ['POST', '/finish', '127.0.0.1:9619', undefined],
  ['POST', '/finish', '127.0.0.1:9619', 'null'],
  ['POST', '/finish', '127.0.0.1:9619', 'https://example.test'],
  ['GET', '/finish', '127.0.0.1:9619', ORIGIN],
  ['POST', '/fixture.json', '127.0.0.1:9619', ORIGIN],
])('refuses widened path, host, method or origin %#', (...args) => {
  expect(route(...args)).toBeNull();
});
test('cleanup requires same-origin POST and CSP limits browser connections to loopback', () => {
  expect(route('POST', '/finish', '127.0.0.1:9619', ORIGIN)).toBe('/finish');
  expect(HEADERS['Cache-Control']).toBe('no-store');
  expect(HEADERS['Content-Security-Policy']).toContain("connect-src 'self' http://127.0.0.1:9919 http://127.0.0.1:9519;");
  expect(HEADERS['Content-Security-Policy']).toContain("frame-ancestors 'none'");
});
