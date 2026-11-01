const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const source = fs.readFileSync(__dirname + '/index.js', 'utf8');
test('new routes authenticate, match trailing slashes, and forward season parameters', async () => {
  const app = express();
  app.use((req,res,next) => {
    if (!req.headers['x-test-user']) return res.sendStatus(401);
    req.user = { offerPurchasedInfo: { test: { Count: 2, IterationCount: 2, LastPurchased: null } } };
    next();
  });
  const handler = (req,res) => res.json({ params: req.params });
  const start = source.indexOf('// Account-specific routes');
  const end = source.indexOf('const rankedLeaderboard', start);
  vm.runInNewContext(source.slice(start,end), { app,
    CreatorCodeController: {getCreator:handler,support:handler,stopSupport:handler},
    TournamentXController: {getSeasons:handler,getSeasonProgress:handler,claimSeasonReward:handler}
  });
  const server = app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for(const [method,url] of [['GET','/user/creator-codes/'],['POST','/user/creator-codes'],['DELETE','/user/creator-codes/code'],['GET','/economy/offers/purchasedV2/'],['GET','/tournamentx/seasons'],['GET','/tournamentx/season/1/progress'],['POST','/tournamentx/season/1/claim/2']]) {
      assert.equal((await fetch(base+url,{method})).status,401);
      const res=await fetch(base+url,{method,headers:{'x-test-user':'1'}});
      assert.equal(res.status,200,url);
      const body=await res.json();
      if(url.includes('claim')) assert.deepEqual(body.params,{seasonId:'1',awardId:'2'});
      if(url.includes('purchasedV2')) assert.equal(body.test.Count,2);
    }
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});
test('corrected routes and season currency account identifier', () => {
  assert.ok(!source.includes("'/friends/request/accept', FriendsController.add"));
  assert.ok(source.includes("'/economy/purchasedrop/:itemId/:count', EconomyController.purchaseDrop"));
  assert.ok(source.indexOf("app.get('/user/creator-codes'") > source.indexOf('app.use(authenticate)'));
  const backend=fs.readFileSync(__dirname+'/BackendUtils.js','utf8');
  assert.ok(backend.includes('UserModel.addBalance(foundUser.deviceId, currencyName, award.amount)'));
});

