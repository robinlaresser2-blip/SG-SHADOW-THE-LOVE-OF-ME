'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/BackendUtils.js', 'utf8');
const start = source.indexOf('  static async purchase(req, res)', source.indexOf('class EconomyController'));
const end = source.indexOf('  static async purchaseGasha', start);
async function check(amount, balance, expectedCode, expectedReward) {
  const writes = [];
  const user = { stumbleId: 'test', deviceId: 'test', balances: [] };
  const context = {
    Console: { log() {}, error() {} },
    getSharedDataWithPrivateAbilityOffers: () => ({ PurchasableItems: [{
      Name: 'ultimate_free_ability_tokens', prices: [{ currency: 'gems', amount }],
      rewards: [{ type: 'CURRENCY', typeInfo: 'aec', min: 60000 }]
    }] }),
    UserModel: {
      async getBalanceAmount() { return balance; },
      async removeBalance(id, currency, amount) { writes.push(['debit', currency, amount]); },
      async addBalance(id, currency, amount) { writes.push(['credit', currency, amount]); },
      async findByStumbleId() { return user; }
    }
  };
  vm.createContext(context);
  vm.runInContext('this.purchase = (class {' + source.slice(start, end) + '}).purchase', context);
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await context.purchase({ user, params: { item: 'ultimate_free_ability_tokens' } }, response);
  assert.equal(response.code, expectedCode);
  assert.equal(writes.some(entry => entry[0] === 'credit' && entry[1] === 'aec' && entry[2] === 60000), expectedReward);
  if (!expectedReward) assert.equal(writes.length, 0);
}
(async () => {
  await check(0, 0, 200, true);
  await check(10, 0, 402, false);
  await check(10, 10, 200, true);
  console.log('Free token reward and awaited balance checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
