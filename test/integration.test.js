import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chat,validateSelection} from '../src/chat.js';
import {CENTER,normalize,openingStatus,searchPlaces} from '../src/places.js';
import {resolveStart,validInstant} from '../src/time.js';
import {forecastWindow,normalizeHours} from '../src/weather.js';
import {weatherContext,routePlan} from '../src/recommendations.js';
import {weatherMessage} from '../public/route-weather.js';
const at='2026-10-20T12:00:00+05:00';
const baseIntent={inScope:true,category:'any',categories:[],types:[],specificName:'',features:[],maxAverageCheck:0,openOnly:false,keywords:'',unknowns:[],strictUnknown:false,timeBudgetMinutes:0,withChild:false,startOffsetMinutes:-1,startAt:''};
const cafe=(id='cafe')=>({...normalize({id,name:'Кофейня '+id,point:CENTER,rubrics:[{id:'161',name:'Кафе'}]}),averageCheck:3000,schedule:{Tue:{working_hours:[{from:'09:00',to:'23:00'}]}}});
function dependencies(places=[cafe()],intent={},options={}) {
  const calls={weather:[],rank:[],route:[]};let modelCalls=0;
  const services={
    readPlaces:async()=>places,now:()=>new Date(at),
    semanticRank:async (items,query)=>{calls.rank.push(items);return {items,mode:'hybrid_embeddings_and_structured_filters'};},
    weather:async(point,at,duration)=>{calls.weather.push({point,at,duration});return options.weather||{coverage:'complete',advice:'Без осадков.',hours:[{temperature:12,windGust:3,windSpeed:2,accumulatedPrec:0}]};},
    route:async(from,to)=>{calls.route.push({from,to});if(options.routeFails)throw new Error('quota');return {durationSeconds:options.durationSeconds??600,lengthMeters:700};},
    generate:async(system,input)=>{modelCalls++;if(modelCalls===1)return {...baseIntent,...intent};return {recommendations:input.candidates.slice(0,3).map(p=>({id:p.id,evidence:['distance'],plan:'standard'}))};},
  };
  return {services,calls};
}
const args={message:'Подбери место',...CENTER,at,radius:2000};
test('relative departure is resolved from now, not selected time; duration remains separate',async()=>{
  const {services,calls}=dependencies([cafe()],{category:'eat',timeBudgetMinutes:90});
  const r=await chat({...args,at:'2026-10-20T14:00:00+05:00',message:'Через два часа хочу поесть. У меня полтора часа.'},services);
  assert.equal(r.usedData.at,'2026-10-20T09:00:00.000Z');assert.equal(r.timeBudgetMinutes,90);
  assert.equal(calls.weather[0].duration,90);assert.equal(calls.weather[0].at,r.usedData.at);
});
test('a follow-up with no start change preserves selected absolute time',()=>{
  const r=resolveStart('А дешевле?',baseIntent,'2026-10-20T14:00:00+05:00',new Date(at));
  assert.equal(r.source,'form');assert.equal(r.at,'2026-10-20T14:00:00+05:00');
});
test('relative half hour and explicit ISO date resolve deterministically',()=>{
  assert.equal(resolveStart('Через полчаса хочу кофе',baseIntent,at,new Date(at)).at,'2026-10-20T07:30:00.000Z');
  assert.equal(resolveStart('завтра', {...baseIntent,startAt:'2026-10-21T12:00:00+05:00'},at,new Date(at)).source,'message_absolute');
});
test('calendar rollover, timezone-less dates and midnight 24:00 are rejected',()=>{
  assert.equal(validInstant('2026-02-30T12:00:00+05:00'),false);
  assert.equal(validInstant('2026-10-20T12:00:00'),false);
  assert.equal(validInstant('2026-10-20T24:00:00Z'),false);
  assert.equal(validInstant(at),true);
});
test('mandatory form features and budget are not silently relaxed by a model',async()=>{
  const good={...cafe('good'),features:{wifi:true,laptop:true}};
  const missing={...cafe('missing'),features:{wifi:true,laptop:null}};
  const expensive={...good,id:'expensive',averageCheck:9000};
  const {services}=dependencies([good,missing,expensive],{maxAverageCheck:10000});
  const r=await chat({...args,category:'eat',features:['wifi','laptop'],maxAverageCheck:5000},services);
  assert.deepEqual(r.items.map(p=>p.id),['good']);assert.equal(r.usedData.maxAverageCheck,5000);
});
test('contradictory explicit category and form category yield no invented alternatives',async()=>{
  const {services}=dependencies([cafe()],{category:'walk'});
  const r=await chat({...args,category:'eat'},services);assert.equal(r.items.length,0);
});
test('specific name missing from data never becomes an unrelated business',async()=>{
  const {services}=dependencies([cafe()],{specificName:'Несуществующая кофейня'});
  const r=await chat(args,services);assert.equal(r.items.length,0);
});
test('requested subtype is a structured constraint, not only a semantic preference',async()=>{
  const vr={...cafe('vr'),categories:['fun'],rubrics:[{name:'Центры виртуальной реальности'}]};
  const club={...cafe('club'),categories:['fun'],rubrics:[{name:'Компьютерные клубы'}]};
  const {services}=dependencies([club,vr],{category:'fun',types:['vr']});
  assert.deepEqual((await chat(args,services)).items.map(p=>p.id),['vr']);
});
test('a stricter form time budget cannot be relaxed by generated intent',async()=>{
  const {services}=dependencies([cafe()],{timeBudgetMinutes:90},{durationSeconds:2400});
  assert.equal((await chat({...args,timeBudgetMinutes:60},services)).items.length,0);
});
test('strict opening cannot pass without route verification',async()=>{
  const {services}=dependencies([cafe()],{}, {routeFails:true});
  assert.equal((await chat({...args,openOnly:true},services)).items.length,0);
});
test('business closing halfway through minimum visit is removed from chat',async()=>{
  const p={...cafe(),schedule:{Tue:{working_hours:[{from:'09:00',to:'12:20'}]}}};
  const {services}=dependencies([p]);assert.equal((await chat(args,services)).items.length,0);
});
test('a place opening before calculated arrival can still qualify',async()=>{
  const p={...cafe(),schedule:{Tue:{working_hours:[{from:'12:05',to:'23:00'}]}}};
  const {services}=dependencies([p]);const r=await chat({...args,openOnly:true},services);
  assert.equal(r.items.length,1);assert.equal(r.items[0].arrivalStatus,'open_by_schedule');
});
test('only three routing calls are made even with many retrieved candidates',async()=>{
  const {services,calls}=dependencies(Array.from({length:8},(_,i)=>cafe('p'+i)));
  const r=await chat(args,services);assert.equal(calls.route.length,3);assert.equal(r.items.length,3);
});
test('selection validation rejects overlong and empty evidence selections',()=>{
  const p={...cafe(),distanceMeters:10,openingStatus:'unknown'};
  assert.throws(()=>validateSelection([{id:p.id,evidence:[]}],[p]));
  assert.throws(()=>validateSelection(Array.from({length:4},()=>({id:p.id,evidence:['distance']})),[p]));
});
test('scope is fixed around Khan Shatyr, not moved with arbitrary search coordinates',()=>{
  const outside={...cafe(),point:{lat:51.2,lon:71.45}};
  assert.equal(searchPlaces([outside],{...outside.point,at,radius:2000}).length,0);
});
test('walking category includes mapped sights without changing source category records',()=>{
  const p={...cafe(),categories:['sights']};
  assert.equal(searchPlaces([p],{...CENTER,at,category:'walk',type:'sights'}).length,1);
});
test('unknown weather values never become a confident clear forecast',()=>{
  const hours=[{temperature:12,windGust:3,accumulatedPrec:null}];
  assert.equal(weatherContext({coverage:'complete',hours}).available,false);
  assert.match(weatherMessage(hours),/неполные/);
});
const hour=(n,extra={})=>({timestamp:Date.parse('2026-10-20T07:00:00Z')/1000+n*3600,temperature:12,windSpeed:2,windGust:3,accumulatedPrec:0,...extra});
test('forecast gaps cannot be marked complete by checking only first and last hours',()=>{
  assert.equal(forecastWindow([hour(0),hour(2)],at,180).coverage,'incomplete');
  assert.equal(forecastWindow([hour(0),hour(1),hour(2)],at,180).coverage,'complete');
});
test('missing weather measurements and forecast beyond horizon are incomplete',()=>{
  assert.equal(forecastWindow([hour(0,{windSpeed:null})],at,30).coverage,'incomplete');
  assert.equal(forecastWindow([hour(0)],at,90).coverage,'incomplete');
});
test('weather window includes the next hour when visit crosses its boundary',()=>{
  const r=forecastWindow([hour(0),hour(1,{accumulatedPrec:1,precType:'RAIN'})],'2026-10-20T07:50:00Z',30);
  assert.equal(r.coverage,'complete');assert.equal(r.hours.length,2);assert.match(r.advice,/дождь/);
});
test('weather nodes are sorted and numeric timestamp strings are normalized',()=>{
  const r=normalizeHours([{node:{...hour(1),timestamp:String(hour(1).timestamp)}},{node:hour(0)}]);
  assert.equal(r[0].timestamp,hour(0).timestamp);assert.equal(typeof r[1].timestamp,'number');
});
test('special closure cancels overnight opening from yesterday',()=>{
  const p={schedule:{Mon:{working_hours:[{from:'20:00',to:'02:00'}]}},scheduleSpecial:[{date:'2026-10-20',working_hours:[]}]};
  assert.equal(openingStatus(p,'2026-10-20T01:00:00+05:00'),'closed_by_schedule');
});
test('malformed special hours are unknown, not a server crash',()=>{
  assert.equal(openingStatus({...cafe(),scheduleSpecial:{unexpected:true}},at),'unknown');
});
test('24x7 is recognized and zero-second route at same point is valid',()=>{
  const p={...cafe(),schedule:{is_24x7:true}};
  assert.equal(openingStatus(p,at),'open_by_schedule');
  assert.equal(routePlan(p,{durationSeconds:0,lengthMeters:0},at,30).timeFit,'estimated_fit');
});
test('visit may finish exactly at closing, but never run past it',()=>{
  const p={...cafe(),schedule:{Tue:{working_hours:[{from:'09:00',to:'12:35'}]}}};
  const r=routePlan(p,{durationSeconds:600,lengthMeters:700},at,90);
  assert.equal(r.visitOpen,true);assert.equal(r.visit.maxMinutes,25);
});

test('invalid forecast nodes cannot become epoch zero or crash normalization',()=>{
  assert.deepEqual(normalizeHours([{node:{timestamp:null}},{timestamp:''},{timestamp:1e25},null,{}]),[]);
});
test('malformed daily working hours are unknown instead of crashing schedule checks',()=>{
  assert.equal(openingStatus({...cafe(),schedule:{Tue:{working_hours:{from:'10:00',to:'20:00'}}}},at),'unknown');
});
