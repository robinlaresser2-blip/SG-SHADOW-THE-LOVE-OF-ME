const test = require('node:test');
const assert = require('node:assert/strict');
const verify = require('./SessionIdentity');
const user = { token: 'test-session-token', deviceId: 'test-device' };
test('requires both the active session credential and its device', () => {
  assert.equal(verify({ Token: user.token, DeviceId: user.deviceId }, user), true);
  for (const auth of [null, {}, { Token: 'old', DeviceId: user.deviceId },
    { Token: user.token, DeviceId: 'different' }, { Token: {}, DeviceId: user.deviceId }]) {
    assert.equal(verify(auth, user), false);
  }
  assert.equal(verify({ Token: user.token, DeviceId: user.deviceId }, { ...user, isBanned: true }), false);
});
test('rotation revokes previously issued session credentials', () => {
  assert.equal(verify({ Token: user.token, DeviceId: user.deviceId }, { ...user, token: 'new-token' }), false);
});
