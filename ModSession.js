'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const options = { issuer: 'stumble-ultimate-mod', audience: 'stumble-ultimate-backend', algorithm: 'HS256' };
function key() {
  const value = process.env.MOD_SESSION_SIGNING_KEY;
  if (typeof value !== 'string' || Buffer.byteLength(value) < 48)
    throw new Error('MOD_SESSION_SIGNING_KEY must contain at least 48 bytes from a secure random generator.');
  return value;
}
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function issue(user, build) {
  return jwt.sign({ device: digest(user.deviceId), session: digest(user.token), build }, key(),
    { ...options, subject: String(user.stumbleId), expiresIn: 300, jwtid: crypto.randomUUID() });
}
function verify(token, user, build) {
  try {
    const claims = jwt.verify(token, key(), { issuer: options.issuer, audience: options.audience,
      algorithms: ['HS256'], maxAge: '5m' });
    return claims.sub === String(user.stumbleId) && claims.device === digest(user.deviceId)
      && claims.session === digest(user.token) && claims.build === build;
  } catch { return false; }
}
module.exports = { issue, verify, validateConfiguration: key };
