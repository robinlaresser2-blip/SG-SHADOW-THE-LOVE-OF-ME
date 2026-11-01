const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./CreateLobby');
function invoke(user, body) {
  const response = { statusCode: 200, status(n) { this.statusCode=n; return this; },
    set() { return this; }, json(value) { this.body=value; return this; } };
  return handler({user,body},response);
}
test('private lobby returns the client ticket DTO', () => {
  const response=invoke({stumbleId:'test'}, {LobbyType:'Custom',VariantId:null});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.body,{Ticket:'local'});
});
test('anonymous and malformed lobby requests fail', () => {
  assert.equal(invoke(null,{LobbyType:'Custom'}).statusCode,401);
  for(const body of [{}, {LobbyType:42}, {LobbyType:''}, {LobbyType:'Custom',VariantId:{}}])
    assert.equal(invoke({},body).statusCode,400);
});
test('route is registered after authentication and account rate limiting', () => {
  const source=require('node:fs').readFileSync(__dirname+'/index.js','utf8');
  const at=source.indexOf("app.post('/matchmaking/create-lobby'");
  assert.ok(at>source.indexOf('app.use(authenticate)'));
  assert.ok(at>source.indexOf("app.use(require('./AccountRateLimit')())"));
});
