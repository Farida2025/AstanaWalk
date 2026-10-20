import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chat} from '../src/chat.js';
import {normalize,CENTER} from '../src/places.js';
import {contextualCandidates,routePlan,weatherContext,describePlace} from '../src/recommendations.js';
const at='2026-10-20T12:00:00+05:00';
const cafe=(id,price=3000)=>({...normalize({id,name:'Кафе '+id,point:CENTER,rubrics:[{id:'161',name:'Кафе'}]}),averageCheck:price,schedule:{Tue:{working_hours:[{from:'00:00',to:'24:00'}]}}});
const intent={inScope:true,category:'eat',maxAverageCheck:5000,features:[],openOnly:false,keywords:'кафе',unknowns:[],strictUnknown:false,timeBudgetMinutes:60,withChild:false};
const args={message:'Где поесть до 5000? У меня час',...CENTER,at};
function services({places=[cafe('cheap'),cafe('expensive',8000)],extract=intent,badGeneration=false,routeFails=false,weatherFails=false}={}){
 let calls=0;
 return {readPlaces:async()=>places,semanticRank:async items=>({items,mode:'hybrid_embeddings_and_structured_filters'}),weather:async()=>{if(weatherFails)throw Error('unavailable');return {coverage:'complete',advice:'Ожидается дождь. Возьмите зонт.',hours:[{temperature:5,windGust:5,accumulatedPrec:1}]};},route:async()=>{if(routeFails)throw Error('quota');return {durationSeconds:600,lengthMeters:800,provider:'2GIS'};},generate:async(system,input)=>{calls++;if(calls===1)return extract;if(badGeneration)return {recommendations:[{id:'invented',evidence:['sockets'],plan:'brief'}]};return {recommendations:input.candidates.slice(0,3).map(p=>({id:p.id,evidence:['averageCheck','distance'],plan:'brief'}))};}};
}
test('RAG generation receives retrieved POI and preserves budget, visit plan and weather',async()=>{
 const result=await chat(args,services());assert.equal(result.generation,'grounded_model');assert.equal(result.items.length,1);assert.equal(result.items[0].id,'cheap');assert.equal(result.items[0].visit.minMinutes,25);assert.ok(result.items[0].visit.action);assert.equal(result.items[0].timeFit,'estimated_fit');assert.equal(result.weather.adverse,true);assert.equal(result.usedData.maxAverageCheck,5000);
});
test('unverifiable mandatory outlets return no invented recommendations',async()=>{
 const result=await chat({...args,message:'Обязательно с подтверждёнными розетками'},services({extract:{...intent,unknowns:['sockets'],strictUnknown:true}}));assert.equal(result.items.length,0);assert.equal(result.retrieval,'constraints_not_verifiable');
});
test('invented model ID falls back to verified records with explicit label',async()=>{
 const result=await chat(args,services({badGeneration:true}));assert.equal(result.generation,'verified_template_fallback');assert.equal(result.items[0].id,'cheap');assert.ok(!result.items[0].why.join(' ').includes('розет'));
});
test('route and weather failure do not promise ETA or good weather',async()=>{
 const result=await chat(args,services({routeFails:true,weatherFails:true}));assert.equal(result.items[0].timeFit,'unconfirmed');assert.equal(result.items[0].travel,null);assert.equal(result.weather.available,false);
});
test('closed at arrival is removed even if open at search time',async()=>{
 const place=cafe('closing');place.schedule.Tue.working_hours=[{from:'10:00',to:'12:05'}];
 const result=await chat(args,services({places:[place]}));assert.equal(result.items.length,0);
});
test('time budget excludes physically impossible visit without inventing route time',()=>{
 const places=[{...cafe('far'),distanceMeters:4000,openingStatus:'open_by_schedule'}];assert.equal(contextualCandidates(places,{at,timeBudgetMinutes:30}).length,0);
});
test('poor weather ranks supported indoor category ahead of outdoor for mixed request',()=>{
 const park={...cafe('park'),categories:['walk'],rubrics:[{name:'Парки'}],distanceMeters:50,openingStatus:'open_by_schedule'};const food={...cafe('cafe'),distanceMeters:100,openingStatus:'open_by_schedule'};
 assert.equal(contextualCandidates([park,food],{at,weather:{adverse:true}})[0].id,'cafe');assert.equal(contextualCandidates([park],{at,weather:{adverse:true}})[0].id,'park');
});
test('child request requires source-supported relevant category or kids menu',async()=>{
 const suitable={...cafe('family'),features:{kidsMenu:true}};
 const result=await chat(args,services({places:[cafe('other'),suitable],extract:{...intent,withChild:true}}));assert.deepEqual(result.items.map(p=>p.id),['family']);
});
test('visit closing midway remains unconfirmed, never promises full visit',()=>{
 const p=cafe('short');p.schedule.Tue.working_hours=[{from:'10:00',to:'12:20'}];const result=routePlan(p,{durationSeconds:600,lengthMeters:800},at,60);assert.equal(result.timeFit,'unconfirmed');assert.equal(result.visitOpen,false);
});
test('description uses only fields from source and no invented amenities',()=>{
 const text=describePlace(cafe('one'));assert.match(text,/Категория: Кафе/);assert.doesNotMatch(text,/розет|тихо|Wi-Fi/);
});
test('incomplete forecast is not interpreted as fine weather',()=>assert.equal(weatherContext({coverage:'incomplete',hours:[]}).available,false));
