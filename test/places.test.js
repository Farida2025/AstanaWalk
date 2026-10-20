import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openingStatus,normalize,searchPlaces,CENTER} from '../src/places.js';
test('overnight opening uses previous day, including end boundary',()=>{
  const place={schedule:{Mon:{working_hours:[{from:'12:00',to:'02:00'}]}}};
  assert.equal(openingStatus(place,'2026-10-20T01:00:00+05:00'),'open_by_schedule');
  assert.equal(openingStatus(place,'2026-10-20T02:00:00+05:00'),'closed_by_schedule');
});
test('special closure overrides weekly opening',()=>{
  const place={schedule:{Tue:{working_hours:[{from:'00:00',to:'24:00'}]}},scheduleSpecial:[{date:'2026-10-20',working_hours:[]}]};
  assert.equal(openingStatus(place,'2026-10-20T12:00:00+05:00'),'closed_by_schedule');
});
test('missing feature and price remain unknown and cannot pass strict filters',()=>{
  const p=normalize({id:'1',name:'Cafe',point:CENTER,rubrics:[{id:'161',name:'Кафе'}]});
  assert.equal(p.features.wifi,null);assert.equal(p.averageCheck,null);
  assert.equal(searchPlaces([p],{...CENTER,at:'2026-10-20T12:00:00+05:00',features:['wifi']}).length,0);
  assert.equal(searchPlaces([p],{...CENTER,at:'2026-10-20T12:00:00+05:00',maxAverageCheck:5000}).length,0);
});
test('mall named Park is not a walking park',()=>{
  assert.deepEqual(normalize({id:'2',name:'Asia Park',rubrics:[{id:'19499',name:'Торгово-развлекательные центры'}]}).categories,[]);
});
