'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');

test('native Journey claim URL and legacy suffix both reach the claim handler', async () => {
  const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
  const start = source.indexOf("app.post('/xp-road/rewards/claim/");
  const end = source.indexOf("app.post('/user/profile/country'", start);
  assert.ok(start > 0 && end > start);
  const app = express();
  let claims = 0;
  app.use((req, res, next) => {
    if (req.headers['x-test-auth']) req.user = { stumbleId: 'test-user' };
    next();
  });
  vm.runInNewContext(source.slice(start, end), {
    app, console: { log() {}, error() {} },
    UserModel: { async claimJourney(id) {
      assert.equal(id, 'test-user'); claims++;
      return { level: 2, rewards: [{ Type: 'SKIN', TypeInfo: '86', Amount: 1 }] };
    } },
    getActionEmoteUserResponse: async () => ({ User: {} })
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/xp-road/rewards/claim', '/xp-road/rewards/claim/', '/xp-road/rewards/claim/2']) {
      const response = await fetch(base + path, { method: 'POST', headers: { 'x-test-auth': 'yes' } });
      assert.equal(response.status, 200, path);
      assert.equal((await response.json()).UpdatedUser.User.Rewards[0].TypeInfo, '86');
    }
    const denied = await fetch(base + '/xp-road/rewards/claim', { method: 'POST' });
    assert.equal(denied.status, 401);
    assert.equal(claims, 3);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
