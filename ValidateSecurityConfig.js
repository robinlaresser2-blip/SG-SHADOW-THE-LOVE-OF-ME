'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = function validate() {
  for (const name of ['MOD_LICENSE_REQUIRED', 'MOD_SESSION_REQUIRED', 'MOD_REQUEST_PROOF_REQUIRED'])
    if (process.env[name] !== undefined && !['0', '1'].includes(process.env[name]))
      throw new Error(`${name} must be 0 or 1.`);
  if (process.env.MOD_LICENSE_REQUIRED === '1' && !(process.env.MOD_ALLOWED_BUILDS || '').trim())
    throw new Error('MOD_ALLOWED_BUILDS is required when licensing is enforced.');
  if (process.env.MOD_SESSION_REQUIRED === '1') require('./ModSession').validateConfiguration();
  const expected = process.env.MOD_SHARED_SHA256;
  if (expected !== undefined) {
    if (!/^[0-9a-fA-F]{64}$/.test(expected)) throw new Error('MOD_SHARED_SHA256 must be a SHA-256 hexadecimal digest.');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'shared.json'))).digest();
    if (!crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex')))
      throw new Error('Shared configuration integrity check failed.');
  }
};
