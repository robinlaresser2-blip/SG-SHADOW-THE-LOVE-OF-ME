const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize, featureForPath } = require('./ModAccessPolicy');
const limit = require('./AccountRateLimit');
test('license authorization rejects revocation, expiry, other device, build and feature', () => {
  const user = { deviceId: 'device', modLicense: { enabled: true, expiresAtMs: 2000,
    deviceId: 'device', features: ['core'] } };
  const check = (u, b = 'build', f = 'core') => authorize(u, b, new Set(['build']), f, 1000);
  assert.equal(check(user), null);
  assert.equal(check({}), 'license_required');
  for (const [change, denial] of [[{ revoked: true }, 'license_required'],
    [{ expiresAtMs: 1000 }, 'license_expired'], [{ deviceId: 'other' }, 'device_not_licensed']])
    assert.equal(check({ ...user, modLicense: { ...user.modLicense, ...change } }), denial);
  assert.equal(check(user, 'old'), 'build_not_allowed');
  assert.equal(check(user, 'build', 'ranked'), 'feature_not_licensed');
  assert.equal(featureForPath('/ranked/game/finish'), 'ranked');
});
test('account rate limits reset and do not expose account identifiers', () => {
  let time = 0, passed = 0;
  const reports = [];
  const middleware = limit({ limit: 2, now: () => time, report: s => reports.push(s) });
  const req = { user: { stumbleId: 'private-account' } };
  const res = { set() {}, status(s) { this.code = s; return this; }, json() {} };
  for (let n = 0; n < 3; n++) middleware(req, res, () => passed++);
  assert.equal(passed, 2); assert.equal(res.code, 429);
  assert.equal(reports.length, 1); assert.ok(!reports[0].includes('private-account'));
  time = 60000; middleware(req, res, () => passed++); assert.equal(passed, 3);
});
