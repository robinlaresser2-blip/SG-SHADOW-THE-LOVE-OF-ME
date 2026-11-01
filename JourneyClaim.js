const crypto = require('node:crypto');
const fail = (message,status=409) => Object.assign(new Error(message),{status});
function calculate(user, shared, random=()=>crypto.randomInt(0,0x1000000)/0x1000000) {
 const config=shared.XpRoad;
 const xp=user.userProfile?.experience ?? user.experience ?? 0;
 if(!Number.isSafeInteger(xp)||xp<0)throw fail('Invalid stored XP.');
 const road=user.xpRoad||{};
 const last=road.lastClaimedLevel ?? 1;
 const cap=Math.min(config.LevelCap,road.currentLevelCap ?? config.LevelCap);
 const levels=config.Levels.filter(l=>l.Level>last && l.Level<=cap && l.RequiredXp<=xp).sort((a,b)=>a.Level-b.Level);
 const set={}; const rewards=[];
 const balances=structuredClone(user.balances||[]);
 const inventory={};
 const fields={SKIN:'skins',EMOTE:'emotes',ANIMATION:'animations',FOOTSTEPS:'footsteps'};
 function grant(r,depth=0){
  if(depth>5)throw fail('Invalid nested Journey reward.',503);
  const amount=r.min, maximum=r.max ?? amount;
  if(!Number.isSafeInteger(amount)||amount<1||maximum!==amount)throw fail('Unsupported Journey reward amount.',503);
  const result={Amount:amount,Type:r.type,TypeInfo:r.typeInfo,DuplicateCurrency:null,DuplicateCurrencyAmount:0,NestedRewards:[]};
  if(r.type==='CURRENCY'){
   let balance=balances.find(b=>b.name===r.typeInfo);
   if(!balance){balance={name:r.typeInfo,amount:0,secondsSince:0,secondsPerUnit:0,maxAmount:0};balances.push(balance);}
   if(!Number.isSafeInteger(balance.amount)||!Number.isSafeInteger(balance.amount+amount))throw fail('Invalid currency balance.');
   balance.amount+=amount;set.balances=balances;
  }else if(fields[r.type]){
   const field=fields[r.type];inventory[field]??=[...(user[field]||[])];
   if(!inventory[field].includes(r.typeInfo))inventory[field].push(r.typeInfo);
   set[field]=inventory[field];
  }else if(r.type==='LOOTBOX'){
   const box=shared.Lootboxes?.Lootboxes.find(b=>b.Id===r.typeInfo);
   if(!box)throw fail('Journey lootbox configuration missing.',503);
   for(let n=0;n<amount;n++)for(const [name,count] of Object.entries(box.LootDrops||{})){
    if(!Number.isSafeInteger(count)||count<1||count>100)throw fail('Invalid lootbox count.',503);
    const items=shared.Lootboxes.LootTables[name]?.ChanceLoot?.filter(x=>x.chance>0)||[];
    const total=items.reduce((s,x)=>s+x.chance,0);
    if(!Number.isFinite(total)||total<=0)throw fail('Journey loot table missing.',503);
    for(let i=0;i<count;i++){
     let roll=random()*total,pick=items.at(-1);
     for(const item of items){roll-=item.chance;if(roll<0){pick=item;break;}}
     result.NestedRewards.push(grant(pick,depth+1));
    }
   }
  }else throw fail('Unsupported Journey reward type.',503);
  return result;
 }
 for(const level of levels){
  // With no configured segment, use the default reward option (Id 1).
  const selected=config.SegmentedLevelRewards?.[String(level.Level)];
  const group=selected==null ? level.Rewards.find(r=>r.Id===1 && !r.Segmented) : level.Rewards.find(r=>String(r.Id)===String(selected));
  if(!group)throw fail('Journey reward selection requires configuration.',503);
  for(const reward of group.Rewards)rewards.push(grant(reward));
 }
 if(levels.length){
  set['xpRoad.lastClaimedLevel']=levels.at(-1).Level;
  set['xpRoad.hasBeenEnabled']=true;
 }
 return {set,rewards,level:levels.at(-1)?.Level ?? last};
}
async function claim({client,users,shared},stumbleId){
 const session=client.startSession();let result;
 try{
  await session.withTransaction(async()=>{
   const user=await users.findOne({stumbleId},{session});
   if(!user)throw fail('User not found.',404);
   result=calculate(user,shared);
   if(Object.keys(result.set).length)await users.updateOne({_id:user._id},{$set:result.set},{session});
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},timeoutMS:15000});
  return result;
 }finally{await session.endSession();}
}
module.exports={calculate,claim};
