import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {CENTER,normalize} from '../src/places.js';
const at='2026-10-20T12:00:00+05:00';
const place=normalize({id:'test',name:'Кофейня',point:CENTER,rubrics:[{id:'161',name:'Кафе'}]});
async function server(t,options={}) {
  const services={readPlaces:async()=>[place],indexStatus:async()=>({ready:true,indexed:1,total:1}),chat:async input=>({message:'test',items:[],received:input}),route:async()=>({durationSeconds:600,lengthMeters:700}),weather:async()=>({coverage:'incomplete',hours:[]}),facts:async()=>({text:'test'}),...options.services};
  const app=createApp({...options,services});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
  const root='http://127.0.0.1:'+app.address().port;
  return {get:path=>fetch(root+path),post:body=>fetch(root+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),fetch:(path,init)=>fetch(root+path,init)};
}
test('health is explicit that configured capability is not a live availability check',async t=>{
  const s=await server(t),r=await s.get('/api/health'),d=await r.json();
  assert.equal(r.status,200);assert.equal(d.serviceRadiusMeters,2000);assert.match(d.note,/not a live/);
});
test('chat passes every selected filter to backend and limits history',async t=>{
  const s=await server(t),r=await s.post({message:'Кофе',...CENTER,at,category:'eat',features:['wifi'],maxAverageCheck:5000,type:'',timeBudgetMinutes:90,history:Array.from({length:9},()=> 'previous')});
  const d=await r.json();assert.equal(r.status,200);assert.equal(d.received.history.length,4);assert.equal(d.received.maxAverageCheck,5000);assert.deepEqual(d.received.features,['wifi']);
});
test('null and array bodies are rejected, not interpreted as upstream outages',async t=>{
  const s=await server(t);assert.equal((await s.post(null)).status,400);assert.equal((await s.post([])).status,400);
});
test('non-JSON chat content is rejected',async t=>{
  const s=await server(t);assert.equal((await s.fetch('/api/chat',{method:'POST',headers:{'Content-Type':'text/plain'},body:'hello'})).status,415);
});
test('large payload and oversized message are rejected before provider use',async t=>{
  const s=await server(t);assert.equal((await s.post({message:'x'.repeat(1600)})).status,400);assert.equal((await s.post({message:'x'.repeat(13000)})).status,413);
});
test('invalid coordinates, out of scope and radius beyond scope are rejected',async t=>{
  const s=await server(t);
  assert.equal((await s.get('/api/places?lat=&lon=71.4')).status,400);
  assert.equal((await s.get('/api/places?lat=0&lon=0')).status,422);
  assert.equal((await s.post({message:'coffee',...CENTER,at,radius:5000})).status,400);
});
test('date with invalid calendar day is rejected before any external call',async t=>{
  const s=await server(t);assert.equal((await s.post({message:'coffee',...CENTER,at:'2026-02-30T12:00:00Z'})).status,400);
});
test('invalid booleans and feature arrays are rejected',async t=>{
  const s=await server(t);assert.equal((await s.post({message:'coffee',features:'wifi'})).status,400);assert.equal((await s.post({message:'coffee',features:['sockets']})).status,400);assert.equal((await s.post({message:'coffee',openOnly:'false'})).status,400);
});
test('foreign browser origins cannot invoke even GET provider APIs',async t=>{
  const s=await server(t);assert.equal((await s.fetch('/api/health',{headers:{Origin:'https://evil.example'}})).status,403);
});
test('allowed CORS preflight works for JSON POST',async t=>{
  const s=await server(t);const r=await s.fetch('/api/chat',{method:'OPTIONS',headers:{Origin:'http://localhost:3000','Access-Control-Request-Method':'POST'}});
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:3000');
});
test('chat rate limiting returns Retry-After and leaves catalog available',async t=>{
  const s=await server(t,{chatRateLimit:1});assert.equal((await s.post({message:'coffee',...CENTER,at})).status,200);
  const r=await s.post({message:'coffee',...CENTER,at});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal((await s.get('/api/health')).status,200);
});
test('secrets and raw data files are not served; security headers are set',async t=>{
  const s=await server(t);for(const path of ['/.env','/data/places.json','/src/chat.js','/../.env'])assert.equal((await s.get(path)).status,404);
  const r=await s.get('/');assert.equal(r.status,200);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
});
test('facts endpoint cannot act as an arbitrary Wikipedia proxy',async t=>{
  const s=await server(t);assert.equal((await s.get('/api/facts?title=Unrelated')).status,400);
});
test('unknown provider exception details never leak to clients',async t=>{
  const s=await server(t,{services:{chat:async()=>{throw new Error('secret-provider-token');}}});
  const r=await s.post({message:'coffee',...CENTER,at});assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/secret-provider-token/);
});
