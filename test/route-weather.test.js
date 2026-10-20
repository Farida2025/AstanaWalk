import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transitionAdvice} from '../public/route-weather.js';
const hour=t=>({timestamp:String(Date.parse(t)/1000),accumulatedPrec:0,windGust:5,temperature:10});
test('advice includes next hour if walk crosses the hour boundary',()=>{
  const h1=hour('2026-10-20T10:00:00+05:00'),h2={...hour('2026-10-20T11:00:00+05:00'),accumulatedPrec:1};
  assert.match(transitionAdvice([h1,h2],'2026-10-20T10:50:00+05:00',1200).text,/осадки/);
  assert.match(transitionAdvice([h1,h2],'2026-10-20T10:10:00+05:00',1200).text,/не ожидается/);
});
test('missing forecast hour does not imply good weather',()=>{
  assert.equal(transitionAdvice([hour('2026-10-20T10:00:00+05:00')],'2026-10-20T10:50:00+05:00',1200).available,false);
});

 test('rain, snow and wind produce specific practical advice',()=>{
 const base={...hour('2026-10-20T10:00:00+05:00'),temperature:5,accumulatedPrec:1};
 const advice=h=>transitionAdvice([h],'2026-10-20T10:10:00+05:00',1200).text;
 assert.match(advice({...base,precType:'RAIN'}),/зонт/);
 assert.match(advice({...base,precType:'RAIN',windGust:12}),/капюшоном/);
 assert.match(advice({...base,precType:'SNOW',temperature:-5}),/снег/);
 assert.doesNotMatch(advice({...base,precType:'SNOW',temperature:-5}),/зонт/);
 assert.match(advice({...base,precType:'SLEET'}),/дождь со снегом/);
 });
