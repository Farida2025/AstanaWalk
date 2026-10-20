import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidenceFor,validateSelection} from '../src/chat.js';
const place={id:'real',name:'Кафе',distanceMeters:100,averageCheck:3000,features:{wifi:true,laptop:null},openingStatus:'open_by_schedule',bookingNote:null,attributes:[]};
test('chat refuses invented place IDs',()=>assert.throws(()=>validateSelection([{id:'invented',evidence:['wifi']}],[place])));
test('chat refuses unsupported attributes',()=>assert.throws(()=>validateSelection([{id:'real',evidence:['laptop']}],[place])));
test('chat substitutes facts from source rather than generated prose',()=>{
  const result=validateSelection([{id:'real',evidence:['wifi','averageCheck'],why:'розетки гарантированы'}],[place]);
  assert.deepEqual(result[0].why,[evidenceFor(place).wifi,evidenceFor(place).averageCheck]);
  assert.ok(!result[0].why.join(' ').includes('розетки'));
});

 test('fast selection keeps verified budget and required evidence',async()=>{
 const {selectCandidates}=await import('../src/chat.js');
 const result=selectCandidates([{...place,openingStatus:'closed_by_schedule'}],['wifi','laptop']);
 assert.equal(result.length,1);
 assert.ok(result[0].why.includes('Wi-Fi'));
 assert.ok(result[0].why.some(s=>s.includes('закрыто')));
 assert.ok(!result[0].why.some(s=>s.includes('ноутбуком')));
 });
