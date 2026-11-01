'use strict';
const crypto = require('node:crypto');

// Client-supplied account/device identifiers are lookup keys, not credentials.
function matchesSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const a = crypto.createHash('sha256').update(actual).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = function sessionIdentity(auth, user) {
  return !!user && !user.isBanned && matchesSecret(auth?.Token, user.token)
    && matchesSecret(auth?.DeviceId, user.deviceId);
};
