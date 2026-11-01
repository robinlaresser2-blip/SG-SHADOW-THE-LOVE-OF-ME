const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('./ProfileCountry');
function response(){return {code:200,status(c){this.code=c;return this;},json(v){this.body=v;return this;}};}
test('country update binds to authenticated account and synchronizes country fields',async()=>{
 let saved;
 const res=response();
 await handler({update:async(...args)=>{saved=args;}})({user:{stumbleId:'owner'},body:{Country:' nl ',stumbleId:'other',id:99}},res);
 assert.deepEqual(saved,['owner',{country:'NL','userProfile.country':'NL'}]);
 assert.deepEqual(res.body,{Country:'NL'});
});
test('invalid codes and unauthenticated requests never write',async()=>{
 const h=handler({update:async()=>{throw Error('must not write');}});
 for(const code of ['ZZ','NLD','',{},null]){const res=response();await h({user:{stumbleId:'owner'},body:{Country:code}},res);assert.equal(res.code,400);}
 const res=response();await h({body:{Country:'NL'}},res);assert.equal(res.code,401);
});
test('database failure is not reported as success',async()=>{
 const res=response();await handler({update:async()=>{throw Error('offline');}})({user:{stumbleId:'owner'},body:{Country:'NL'}},res);
 assert.equal(res.code,503);
});
