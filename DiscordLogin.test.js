'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const create = require('./DiscordLogin');

function store() {
  const rows = [];
  const match = (r, query) => Object.entries(query).every(([k,v]) =>
    v && v.$gt ? r[k] > v.$gt : v && '$exists' in Object(v) ? (r[k] !== undefined) === v.$exists : r[k] === v);
  return {
    rows,
    async insertOne(row) { rows.push(row); },
    async findOne(q) { return rows.find(r => match(r,q)) || null; },
    async updateOne(q,u) { const r = await this.findOne(q); if (r) Object.assign(r,u.$set); return { modifiedCount: r ? 1 : 0 }; },
    async findOneAndUpdate(q,u) { const r = await this.findOne(q); if (r) Object.assign(r,u.$set); return r; },
    async findOneAndDelete(q) { const i = rows.findIndex(r => match(r,q)); return i < 0 ? null : rows.splice(i,1)[0]; }
  };
}
for (const required of ['0', '1']) test('Discord flow with enforcement=' + required, async () => {
  const db = store(); let exchanges = 0;
  const login = create({ collection: () => db, env: { DISCORD_LOGIN_REQUIRED: required,
    DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'test-secret',
    DISCORD_REDIRECT_URI: 'https://example.com/auth/discord/callback' },
    fetchImpl: async url => {
      exchanges++;
      return { ok: true, json: async () => url.endsWith('/token') ? { access_token: 'private-discord-token' } : { id: '987654321012345678' } };
    }
  });
  const app = express(); app.use(express.json()); app.use('/auth/discord', login.router);
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  const root = `http://127.0.0.1:${server.address().port}/auth/discord`;
  const post = (path, body) => fetch(root + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  try {
    assert.deepEqual(await (await fetch(root + '/config')).json(), { required: required === '1' });
    const start = await (await post('/start',{})).json();
    assert.equal(await login.consume(start.id + '.' + start.secret), null);
    const browser = await fetch(root + '/authorize?id=' + start.id, {redirect:'manual'});
    const state = new URL(browser.headers.get('location')).searchParams.get('state');
    const cookie = browser.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(root + '/callback?state=' + state + '&code=test')).status,400);
    assert.equal(exchanges,0);
    assert.equal((await fetch(root + '/callback?state=' + state + '&code=test', {headers:{cookie}})).status,200);
    assert.equal(exchanges,2);
    assert.equal((await fetch(root + '/callback?state=' + state + '&code=test', {headers:{cookie}})).status,400);
    assert.equal((await post('/status',{id:start.id,secret:'a'.repeat(64)})).status,410);
    assert.deepEqual(await (await post('/status', start)).json(), {status:'approved'});
    assert.ok(!JSON.stringify(db.rows).includes('private-discord-token'));
    assert.equal(await login.consume(start.id + '.' + start.secret),'987654321012345678');
    assert.equal(await login.consume(start.id + '.' + start.secret),null);
    const expired = await (await post('/start',{})).json();
    db.rows[0].expiresAt = new Date(0); db.rows[0].status = 'approved';
    assert.equal(await login.consume(expired.id + '.' + expired.secret),null);
    assert.equal((await post('/status',expired)).status,410);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('remembered login verifies ownership, expiry and revocation', async () => {
 const db = store();
 const user = {deviceId:'device',token:'session',discordId:'987654321012345678'};
 const login = create({collection:()=>db,findUserByDevice:async id=>id==='device'?user:null,env:{DISCORD_LOGIN_REQUIRED:'0'}});
 const app=express();app.use(express.json());app.use(login.router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const post=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  assert.equal((await post('/remember',{deviceId:'device',token:'wrong'})).status,401);
  const saved=await (await post('/remember',{deviceId:'device',token:'session'})).json();
  assert.ok(!JSON.stringify(db.rows).includes(saved.credential));
  assert.ok(!JSON.stringify(db.rows).includes('"session"'));
  const resumed=await (await post('/resume',saved)).json();
  assert.equal(await login.consume(resumed.proof),user.discordId);
  assert.equal(await login.consume(resumed.proof),null);
  user.isBanned=true; assert.equal((await post('/resume',saved)).status,401);user.isBanned=false;
  user.token='rotated';assert.equal((await post('/resume',saved)).status,401);user.token='session';
  db.rows.find(r=>r.kind==='remembered').expiresAt=new Date(0);
  assert.equal((await post('/resume',saved)).status,401);
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});