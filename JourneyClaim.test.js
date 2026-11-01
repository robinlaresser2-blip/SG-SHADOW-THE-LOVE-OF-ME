const test=require('node:test'),assert=require('node:assert/strict');
const {calculate,claim}=require('./JourneyClaim');
const shared=require('./shared.json');
function user(xp=11000){return {_id:1,stumbleId:'u',experience:xp,userProfile:{experience:xp},xpRoad:{lastClaimedLevel:1,currentLevelCap:70},skins:['SKIN1'],balances:[{name:'gems',amount:10}]};}
test('eligible tiers award configured default rewards and synchronize claimed progress',()=>{
 const result=calculate(user(),shared);
 assert.equal(result.level,5);assert.equal(result.set['xpRoad.lastClaimedLevel'],5);
 assert.ok(result.set.skins.includes('SKIN86'));
 assert.ok(result.set.footsteps.includes('footsteps_sparkles'));
 assert.ok(result.set.animations.includes('animation4'));
 assert.equal(result.set.balances.find(b=>b.name==='gems').amount,60);
});
test('unearned and already claimed tiers award nothing',()=>{
 assert.equal(calculate(user(499),shared).rewards.length,0);
 const u=user();u.xpRoad.lastClaimedLevel=5;
 assert.deepEqual(calculate(u,shared).set,{});
});
test('all default configured Journey levels can be evaluated, including lootboxes',()=>{
 const result=calculate(user(100000000),shared,()=>0);
 assert.equal(result.level,shared.XpRoad.LevelCap);
 assert.ok(result.rewards.some(r=>r.Type==='LOOTBOX'&&r.NestedRewards.length>0));
});
test('retry after a committed claim cannot grant twice; failure rolls back',async()=>{
 let stored=user(),failWrite=false;
 const db={shared,client:{startSession:()=>({endSession:async()=>{},withTransaction:async fn=>{const old=structuredClone(stored);try{await fn();}catch(e){stored=old;throw e;}}})},users:{findOne:async()=>structuredClone(stored),updateOne:async(q,u)=>{for(const[k,v]of Object.entries(u.$set)){const p=k.split('.');if(p.length===2)stored[p[0]][p[1]]=v;else stored[k]=v;}if(failWrite)throw Error('offline');}}};
 await claim(db,'u');assert.equal(stored.balances[0].amount,60);
 assert.equal((await claim(db,'u')).rewards.length,0);assert.equal(stored.balances[0].amount,60);
 stored=user();failWrite=true;await assert.rejects(claim(db,'u'),/offline/);assert.deepEqual(stored,user());
});
