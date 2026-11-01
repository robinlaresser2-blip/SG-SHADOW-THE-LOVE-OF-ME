const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {sameMaps,selectMap}=require('./RankedMaps');
test('map comparison includes every round in order',()=>{
 assert.equal(sameMaps([{Id:'a'}],[{Id:'b'}]),false);
 assert.equal(sameMaps([{Id:'a'},{Id:'b'}],[{Id:'b'},{Id:'a'}]),false);
 assert.equal(sameMaps([{Id:'a'}],[{Id:'a'}]),true);
 assert.equal(sameMaps([],[]),false);
});
test('selection follows rank pool and weights without falling back to another rank',()=>{
 const season={MapPools:[{RankIdFrom:1,RankIdTo:2,Maps:[{MapId:'disabled',Weight:0},{MapId:'a',Weight:1},{MapId:'b',Weight:3}]}]};
 assert.equal(selectMap(season,1,()=>0).MapId,'a');
 assert.equal(selectMap(season,2,()=>0.5).MapId,'b');
 assert.equal(selectMap(season,3),null);
});
test('actual room assignment preserves each issued ticket map and only groups matching maps',()=>{
 const source=fs.readFileSync(require.resolve('./BackendUtils'),'utf8');
 const start=source.indexOf('  static assignLocalRankedRoom(ticket) {');
 const end=source.indexOf('  static async createRankedTicket',start);
 assert.ok(start>0 && end>start);
 const Controller=vm.runInNewContext('class MatchmakingController { static rankedRooms = new Map();'+source.slice(start,end)+'}; MatchmakingController',{require});
 let id=1;
 const ticket=map=>({rankId:1,parameters:{Region:'EU',MaxPlayers:12,UserId:id++,Maps:[{Id:map}]}});
 const a=ticket('a'), b=ticket('b'), c=ticket('a');
 const first=Controller.assignLocalRankedRoom(a);
 const second=Controller.assignLocalRankedRoom(b);
 assert.notEqual(first,second);
 assert.deepEqual(b.parameters.Maps,[{Id:'b'}]);
 assert.equal(Controller.assignLocalRankedRoom(c),first);
 assert.deepEqual(c.parameters.Maps,[{Id:'a'}]);
});
