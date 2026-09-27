'use strict';

const ORIGIN = 'http://127.0.0.1:9619';
const HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' http://127.0.0.1:9919 http://127.0.0.1:9519; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});
function route(method, url, host, origin) {
  // Literal Host rejects DNS rebinding; exact Origin rejects cross-site cleanup
  // and fixture access. There are no filesystem paths or arbitrary Admin APIs.
  if (host !== '127.0.0.1:9619' || (origin !== undefined && origin !== ORIGIN)) return null;
  if (method === 'GET' && ['/', '/bundle.js', '/fixture.json'].includes(url)) return url;
  if (method === 'POST' && url === '/finish' && origin === ORIGIN) return url;
  return null;
}
module.exports = { ORIGIN, HEADERS, route };
