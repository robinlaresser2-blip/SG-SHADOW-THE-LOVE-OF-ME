const test = require('node:test');
const assert = require('node:assert/strict');
const {score, finishRankedGame} = require('./RankedFinish');
const shared = require('./shared.json');
const now = Date.parse('2026-09-15T00:00:00Z');
const account = () => ({_id:'db-id',id:42,stumbleId:'account',userProfile:{experience:50,ranked:{currentSeasonId:'LIVE_RANKED_SEASON_12',currentRankPoints:0}},battlePass:{passTokens:20}});
const request = () => ({GameId:'game-1',ClientViewPlacements:{42:1,99:2}});
test('winner receives configured RP, XP and pass tokens', () => {
  const result=score(account(),request(),shared,now);
  assert.equal(result.response.StandardRankPointsEarned,100);
  assert.equal(result.response.ExperienceEarned,1000);
  assert.equal(result.set.experience,1050);
  assert.equal(result.set['userProfile.experience'],1050);
  assert.equal(result.set.passTokens,1020);
});
test('placement validation never substitutes another player or invents a win', () => {
  for (const p of [-1,0,13,'1',null,undefined]) assert.throws(() => score(account(),{ClientViewPlacements:{42:p,99:1}},shared,now), /placement/);
  assert.throws(() => score(account(),request(),shared,Date.parse('2040-01-01')),/active ranked/);
});
test('tier advancement uses configured thresholds and season mismatch fails', () => {
  const u=account(); u.userProfile.ranked.currentRankPoints=200;
  assert.equal(score(u,request(),shared,now).response.CurrentTierIndex,1);
  u.userProfile.ranked.currentSeasonId='old';
  assert.throws(() => score(u,request(),shared,now),/migration/);
});
function memory(failInsert=false) {
  let user=account(), saved=new Map(), closed=false;
  return {
    shared,
    client:{startSession:()=>({
      withTransaction:async fn=>{ const backup=structuredClone(user), receipts=new Map(saved); try {await fn();} catch(e){user=backup;saved=receipts;throw e;} },
      endSession:async()=>{closed=true;}
    })},
    users:{findOne:async()=>structuredClone(user),updateOne:async(q,update)=>{for(const [key,value] of Object.entries(update.$set)){ const keys=key.split('.');let target=user;for(const part of keys.slice(0,-1))target=target[part]??={};target[keys.at(-1)]=value; }}},
    receipts:{findOne:async q=>saved.get(q._id),insertOne:async r=>{if(failInsert)throw Error('receipt write failed');saved.set(r._id,r);}},
    state:()=>({user,saved,closed})
  };
}
test('retry returns original result and awards once even with changed placement',async()=>{
  const db=memory(); const first=await finishRankedGame(db,'account',request());
  const retry=await finishRankedGame(db,'account',{...request(),ClientViewPlacements:{42:2}});
  assert.deepEqual(retry,first); assert.equal(db.state().user.experience,1050);
  assert.equal(db.state().saved.size,1); assert.equal(db.state().closed,true);
  await assert.rejects(finishRankedGame(db,'account',{GameId:''}),/game ID/);
});
test('failed receipt rolls back rewards and closes session',async()=>{
  const db=memory(true);
  await assert.rejects(finishRankedGame(db,'account',request()),/receipt write failed/);
  assert.deepEqual(db.state().user,account()); assert.equal(db.state().closed,true);
});
