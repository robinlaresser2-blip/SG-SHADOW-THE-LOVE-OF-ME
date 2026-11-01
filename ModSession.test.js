const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const sessions = require('./ModSession');
test('short-lived tokens bind account, device, login session and build', () => {
  const previous = process.env.MOD_SESSION_SIGNING_KEY;
  process.env.MOD_SESSION_SIGNING_KEY = crypto.randomBytes(48).toString('base64url');
  try {
    const user = { stumbleId: 'account', token: 'session', deviceId: 'device' };
    const token = sessions.issue(user, 'build');
    assert.equal(sessions.verify(token, user, 'build'), true);
    const claims = jwt.decode(token);
    assert.equal(claims.exp - claims.iat, 300);
    for (const [field, value] of [['stumbleId', 'other'], ['token', 'rotated'], ['deviceId', 'other']])
      assert.equal(sessions.verify(token, { ...user, [field]: value }, 'build'), false);
    assert.equal(sessions.verify(token, user, 'old'), false);
    assert.equal(sessions.verify(token.slice(0, -4) + 'xxxx', user, 'build'), false);
    const expired = jwt.sign({ ...claims, iat: claims.iat - 600, exp: claims.exp - 600 }, process.env.MOD_SESSION_SIGNING_KEY);
    assert.equal(sessions.verify(expired, user, 'build'), false);
  } finally {
    if (previous === undefined) delete process.env.MOD_SESSION_SIGNING_KEY;
    else process.env.MOD_SESSION_SIGNING_KEY = previous;
  }
});
