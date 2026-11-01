'use strict';
const assert = require('node:assert/strict');
const { getPlayerEventData } = require('./PlayerEventData');
let payload;
getPlayerEventData({}, {
  status(code) { assert.equal(code, 200); return this; },
  json(value) { payload = JSON.parse(JSON.stringify(value)); }
});
assert.deepEqual(payload, { GameEvents: [], UpdatedUser: null, AutoClaimedEventIds: [] });
payload.GameEvents.push({ Id: 'not-player-progress' });
getPlayerEventData({}, {
  status() { return this; },
  json(value) { assert.deepEqual(value.GameEvents, []); }
});
console.log('Player event response matches the empty 0.79.2 DTO and isolates requests.');
