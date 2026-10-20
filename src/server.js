import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {readPlaces,searchPlaces,CENTER,SERVICE_RADIUS_METERS,inServiceArea} from './places.js';
import {contextualCandidates} from './recommendations.js';
import {route,weather,facts} from './providers.js';
import {chat,ChatError} from './chat.js';
import {typeLabels} from './categories.js';
import {indexStatus} from './embeddings.js';
import {validInstant} from './time.js';

class InputError extends Error {constructor(message,status=400){super(message);this.status=status;}}
function number(value,min,max,name) {
  if(value===null||value===undefined||typeof value==='boolean'||(typeof value==='string'&&!value.trim())) throw new InputError(`Invalid ${name}`);
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max) throw new InputError(`Invalid ${name}`);
  return n;
}
function integer(value,min,max,name) {
  const n=number(value,min,max,name);if(!Number.isInteger(n))throw new InputError(`Invalid ${name}`);return n;
}
function point(q,prefix='') {
  const value={lat:number(q.get(prefix+'lat'),-90,90,'latitude'),lon:number(q.get(prefix+'lon'),-180,180,'longitude')};
  if(!inServiceArea(value)) throw new InputError('Демо работает только в пределах 2 км от Хан Шатыра. Выберите точку внутри отмеченной области.',422);
  return value;
}
function time(value) {
  const at=value||new Date().toISOString();
  if(!validInstant(at))throw new InputError('Выберите корректную дату и время с часовым поясом.');
  return at;
}
function category(value) {
  if(value && !['eat','walk','fun','sights','any'].includes(value))throw new InputError('Invalid category');
  return value||'any';
}
const featureKeys=['wifi','laptop','kidsMenu','dogFriendly','accessibleEntrance'];
function features(value) {
  if(!Array.isArray(value)||value.length>featureKeys.length||value.some(x=>!featureKeys.includes(x)))throw new InputError('Invalid features');
  return [...new Set(value)];
}
function subtype(value) {
  if(value&&!Object.hasOwn(typeLabels,value))throw new InputError('Invalid type');return value||'';
}
async function jsonBody(req) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Content-Type must be application/json',415);
  const chunks=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;if(size>12000)throw new InputError('Сообщение слишком большое.',413);chunks.push(chunk);}
  try {const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!input||Array.isArray(input)||typeof input!=='object')throw new Error();return input;}
  catch {throw new InputError('Invalid JSON object');}
}
const assets={
  '/':['index.html','text/html; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/map.js':['map.js','text/javascript; charset=utf-8'], '/route-weather.js':['route-weather.js','text/javascript; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8'],
};

/** Injectable services let HTTP tests run without keys, networks or billed calls. */
export function createApp({services={},rateLimit=90,chatRateLimit=8}={}) {
  const loadPlaces=services.readPlaces||readPlaces;
  const api={route,weather,facts,chat,indexStatus,...services};
  const origins=(process.env.FRONTEND_ORIGINS||'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s=>s.trim()).filter(Boolean);
  const buckets=new Map(),salt=randomBytes(32);
  let busyChat=0,busyExternal=0;
  const limit=(req,kind,max)=>{
    const now=Date.now();
    for(const [key,value] of buckets)if(value.until<=now)buckets.delete(key);
    // Never trust X-Forwarded-For from a public client. Proxy users share a bucket.
    const ip=createHmac('sha256',salt).update(req.socket.remoteAddress||'unknown').digest('hex');
    const key=kind+ip,entry=buckets.get(key)||{n:0,until:now+60000};entry.n++;buckets.set(key,entry);
    if(buckets.size>2000)buckets.delete(buckets.keys().next().value);
    return entry.n<=max;
  };
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','geolocation=(), microphone=(), camera=()');
    const send=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
    let claimedChat=false,claimedExternal=false;
    try {
      if(process.env.DEMO_PASSWORD) {
        const expected=Buffer.from(`${process.env.DEMO_USERNAME||'demo'}:${process.env.DEMO_PASSWORD}`);
        const supplied=Buffer.from((req.headers.authorization||'').replace(/^Basic /,''),'base64');
        if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied)) {
          res.setHeader('WWW-Authenticate','Basic realm="AstanaWalk demo", charset="UTF-8"');return send(401,{error:'Demo sign-in required'});
        }
      }
      const url=new URL(req.url,'http://localhost'),q=url.searchParams;
      if(req.headers.origin&&!origins.includes(req.headers.origin))return send(403,{error:'Origin not allowed. Configure FRONTEND_ORIGINS for your deployed address.'});
      if(req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
      }
      if(req.method==='OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
        res.writeHead(204);return res.end();
      }
      if(!['GET','POST'].includes(req.method))return send(405,{error:'Method not allowed'});
      if(url.pathname.startsWith('/api/')) {
        if(!limit(req,'all',rateLimit)) {res.setHeader('Retry-After','60');return send(429,{error:'Слишком много запросов. Повторите через минуту.'});}
      }
      if(req.method==='POST'&&url.pathname==='/api/chat') {
        if(!limit(req,'chat',chatRateLimit)) {res.setHeader('Retry-After','60');return send(429,{error:'Лимит чата: повторите через минуту. Поиск по фильтрам доступен.'});}
        if(busyChat>=2)return send(503,{error:'Помощник занят. Повторите через несколько секунд.'});
        const input=await jsonBody(req);
        if(typeof input.message!=='string'||!input.message.trim()||input.message.length>1500)throw new InputError('Введите сообщение до 1500 символов.');
        if(input.openOnly!==undefined&&typeof input.openOnly!=='boolean')throw new InputError('Invalid openOnly');
        const coords=new URLSearchParams({lat:String(input.lat??CENTER.lat),lon:String(input.lon??CENTER.lon)});
        const validated={message:input.message.trim(),history:Array.isArray(input.history)?input.history.filter(m=>typeof m==='string').slice(-4).map(m=>m.slice(0,1500)):[],
          ...point(coords),at:time(input.at),category:category(input.category),type:subtype(input.type),features:features(input.features??[]),openOnly:input.openOnly===true,
          radius:input.radius===undefined?SERVICE_RADIUS_METERS:integer(input.radius,1,SERVICE_RADIUS_METERS,'radius'),
          timeBudgetMinutes:input.timeBudgetMinutes===undefined?0:integer(input.timeBudgetMinutes,0,1440,'timeBudgetMinutes'),
          maxAverageCheck:input.maxAverageCheck==null?0:integer(input.maxAverageCheck,0,1000000,'maxAverageCheck')};
        claimedChat=true;busyChat++;
        return send(200,await api.chat(validated));
      }
      if(req.method!=='GET')return send(405,{error:'Method not allowed'});
      if(assets[url.pathname]) {
        const [file,type]=assets[url.pathname];const body=await readFile(new URL('../public/'+file,import.meta.url));
        res.setHeader('Content-Type',type);res.writeHead(200);return res.end(body);
      }
      if(url.pathname==='/api/health') {
        const places=await loadPlaces(),index=await api.indexStatus(places);
        return send(200,{status:places.length?'ok':'needs_data',places:places.length,center:CENTER,serviceRadiusMeters:SERVICE_RADIUS_METERS,index,
          capabilities:{places:places.length>0,routes:!!process.env.TWOGIS_API_KEY,weather:!!process.env.YANDEX_WEATHER_KEY,aiChat:!!process.env.GEMINI_API_KEY,semanticRetrieval:index.ready},
          note:'Capabilities indicate configuration, not a live provider availability check.'});
      }
      if(url.pathname==='/api/places') {
        const filters={...point(q),at:time(q.get('at')),category:category(q.get('category')),features:features((q.get('features')||'').split(',').filter(Boolean)),type:subtype(q.get('type')),
          radius:q.has('radius')?integer(q.get('radius'),1,SERVICE_RADIUS_METERS,'radius'):SERVICE_RADIUS_METERS,
          maxAverageCheck:q.has('maxAverageCheck')?integer(q.get('maxAverageCheck'),1,1000000,'maxAverageCheck'):null,
          openOnly:q.get('openOnly')==='true',query:(q.get('q')||'').slice(0,500)};
        const timeBudgetMinutes=q.has('timeBudgetMinutes')?integer(q.get('timeBudgetMinutes'),0,1440,'timeBudgetMinutes'):0;
        const matches=contextualCandidates(searchPlaces(await loadPlaces(),{...filters,limit:Infinity}),{at:filters.at,timeBudgetMinutes});
        const offset=q.has('offset')?integer(q.get('offset'),0,100000,'offset'):0;
        const limitValue=q.has('limit')?integer(q.get('limit'),1,60,'limit'):12;
        return send(200,{items:matches.slice(offset,offset+limitValue),total:matches.length,hasMore:offset+limitValue<matches.length,
          retrieval:'structured_filters_and_keyword_ranking',limitations:['Каталог проверяет открытие на время начала; чат проверяет прибытие и визит.','Время по прямой — предварительный фильтр, не подтверждение пешего маршрута.']});
      }
      if(['/api/route','/api/weather','/api/facts'].includes(url.pathname)) {
        if(busyExternal>=12)return send(503,{error:'Сервисы заняты. Повторите запрос позже.'});
        claimedExternal=true;busyExternal++;
      }
      if(url.pathname==='/api/route')return send(200,await api.route(point(q,'from_'),point(q,'to_')));
      if(url.pathname==='/api/weather')return send(200,await api.weather(point(q),time(q.get('at')),q.has('durationMinutes')?integer(q.get('durationMinutes'),1,1440,'durationMinutes'):60));
      if(url.pathname==='/api/facts') {
        if(q.get('title')!=='Хан Шатыр')throw new InputError('Для этого места нет сопоставленного источника.');
        return send(200,await api.facts('Хан Шатыр'));
      }
      return send(404,{error:'Not found'});
    } catch(e) {
      if(e instanceof InputError||e instanceof ChatError)return send(e.status,{error:e.message});
      const missing=String(e.message).startsWith('Missing ');
      return send(missing?503:502,{error:missing?'Сервис не настроен: добавьте API-ключи в .env на сервере. Поиск по базе доступен.':'Внешний сервис недоступен. Попробуйте позже или используйте каталог.'});
    } finally {
      if(claimedChat)busyChat--;if(claimedExternal)busyExternal--;
    }
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  const server=createApp();
  server.listen(port,host,()=>console.log(`AstanaWalk listening on ${host}:${port}`));
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is already in use. Change PORT or stop the other server.':'Server failed to start.');process.exitCode=1;});
}
