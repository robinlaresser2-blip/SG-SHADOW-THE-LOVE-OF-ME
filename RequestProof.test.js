const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const verify = require('./RequestProof');
test('proof binds session, path, bytes and expiry; repeated proof returns same replay key', () => {
  const token = 'test-only-session', path = '/action-emotes/level-up', body = '{"Id":"test"}';
  const auth = { RequestTime: '1800000000', RequestNonce: 'a'.repeat(32) };
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  auth.RequestProof = crypto.createHmac('sha256', token)
    .update(`${auth.RequestTime}\n${auth.RequestNonce}\n${path}\n${hash}`).digest('hex');
  const now = Number(auth.RequestTime) * 1000;
  const key = verify(auth, token, path, body, now);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(verify(auth, token, path, body, now), key);
  assert.equal(verify(auth, 'other', path, body, now), null);
  assert.equal(verify(auth, token, '/other', body, now), null);
  assert.equal(verify(auth, token, path, '{}', now), null);
  assert.equal(verify(auth, token, path, body, now + 61000), null);
  assert.equal(verify({ ...auth, RequestNonce: {} }, token, path, body, now), null);
});
