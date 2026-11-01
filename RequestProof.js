'use strict';
const crypto = require('node:crypto');
module.exports = function verify(auth, token, path, body, now = Date.now()) {
  if (typeof token !== 'string' || !token || typeof auth?.RequestTime !== 'string'
    || !/^\d{10,11}$/.test(auth.RequestTime) || typeof auth.RequestNonce !== 'string'
    || !/^[0-9a-f]{32}$/.test(auth.RequestNonce) || typeof auth.RequestProof !== 'string'
    || !/^[0-9a-f]{64}$/.test(auth.RequestProof)) return null;
  if (Math.abs(now / 1000 - Number(auth.RequestTime)) > 60) return null;
  const hash = crypto.createHash('sha256').update(body || Buffer.alloc(0)).digest('hex');
  const expected = crypto.createHmac('sha256', token).update(
    `${auth.RequestTime}\n${auth.RequestNonce}\n${path}\n${hash}`).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(auth.RequestProof, 'hex'))) return null;
  return crypto.createHash('sha256').update(token).update(':').update(auth.RequestNonce).digest('hex');
};
