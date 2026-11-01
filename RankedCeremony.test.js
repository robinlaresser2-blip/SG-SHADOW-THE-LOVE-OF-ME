const test = require('node:test');
const assert = require('node:assert/strict');
const {acknowledge} = require('./RankedCeremony');
test('ceremony acknowledges stored rank once without modifying rewards', async () => {
 const user={_id:1,stumbleId:'u',experience:100,userProfile:{ranked:{currentSeasonId:'s',currentRankId:2}}};
 const users={findOne:async()=>structuredClone(user),findOneAndUpdate:async(q,update)=>{
  assert.equal(q['userProfile.ranked.currentSeasonId'],'s');
  assert.deepEqual(Object.keys(update),['$max']);
  const before=structuredClone(user);
  user.userProfile.ranked.lastSeenRankId=Math.max(user.userProfile.ranked.lastSeenRankId||1,update.$max['userProfile.ranked.lastSeenRankId']);
  return before;
 }};
 assert.deepEqual(await acknowledge(users,'u'),{PreviouslySeenRankId:1,CurrentRankId:2});
 assert.deepEqual(await acknowledge(users,'u'),{PreviouslySeenRankId:2,CurrentRankId:2});
 assert.equal(user.experience,100);
});
test('missing account and concurrent season change fail explicitly',async()=>{
 await assert.rejects(acknowledge({findOne:async()=>null},'u'),e=>e.status===404);
 await assert.rejects(acknowledge({findOne:async()=>({_id:1,userProfile:{ranked:{currentSeasonId:'s',currentRankId:2}}}),findOneAndUpdate:async()=>null},'u'),e=>e.status===409);
});
