const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('./DiscordLoginWebhook');
const flush = () => new Promise(r => setImmediate(r));
test('webhook uses fixed content, drops bursts and backs off without throwing', async () => {
 let calls = [], time = 10000;
 const log = create({env:{DISCORD_LOGIN_WEBHOOK_URL:'https://discord.com/api/webhooks/123/fake_test'},now:()=>time,fetchImpl:async (url, options)=>{calls.push(options);return {ok:false};}});
 log('game_failure', {httpStatus:409,durationMs:123.6,token:'NEVER_SEND'});log('game_success');log('secret text');await flush();
 assert.equal(calls.length,1);
 const payload = JSON.parse(calls[0].body);
 assert.deepEqual(payload.allowed_mentions,{parse:[]});
 assert.equal(payload.embeds[0].title,'Discord game login failed');
 assert.equal(payload.embeds[0].color,0xe74c3c);
 assert.equal(payload.embeds[0].timestamp,new Date(10000).toISOString());
 assert.ok(payload.embeds[0].fields.some(f=>f.name==='HTTP status' && f.value==='409'));
 assert.ok(payload.embeds[0].fields.some(f=>f.name==='Request duration' && f.value==='124 ms'));
 assert.ok(!calls[0].body.includes('NEVER_SEND'));
 time+=4000;log('approved');await flush();assert.equal(calls.length,1);
 time+=60000;log('approved');await flush();assert.equal(calls.length,2);
});
test('disabled and non-Discord destinations never send',async()=>{
 for(const url of ['', 'https://example.com/api/webhooks/123/token']) {
 const log=create({env:{DISCORD_LOGIN_WEBHOOK_URL:url},fetchImpl:()=>{assert.fail('unexpected send');}});log('approved');await flush();
 }
});