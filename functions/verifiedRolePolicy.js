const { types: utilTypes } = require('node:util');

function ownDataValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    return undefined;
  }
  return descriptor.value;
}

function resolveVerifiedCallerRole(tokenClaims) {
  if (tokenClaims === null || typeof tokenClaims !== 'object') return null;

  try {
    if (utilTypes.isProxy(tokenClaims)) return null;
    const prototype = Object.getPrototypeOf(tokenClaims);
    if (prototype !== Object.prototype && prototype !== null) return null;

    if (ownDataValue(tokenClaims, 'email_verified') !== true) return null;
    const role = ownDataValue(tokenClaims, 'role');
    return role === 'member' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}

function isVerifiedAdmin(tokenClaims) {
  return resolveVerifiedCallerRole(tokenClaims) === 'admin';
}

module.exports = Object.freeze({
  resolveVerifiedCallerRole,
  isVerifiedAdmin,
});
