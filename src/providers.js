import {forecastWindow,normalizeHours} from './weather.js';
const providerCache=new Map();
async function cached(key,fn){
  const existing=providerCache.get(key);if(existing&&existing.expires>Date.now())return existing.value;
  const value=Promise.resolve().then(fn);const entry={value,expires:Date.now()+300000};providerCache.set(key,entry);
  setTimeout(()=>{if(providerCache.get(key)===entry)providerCache.delete(key);},300000).unref();
  if(providerCache.size>100)providerCache.delete(providerCache.keys().next().value);
  try{return await value;}catch(e){providerCache.delete(key);throw e;}
}
export async function fetchJson(url, options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  return response.json();
}
export function requireKey(name) {const key=process.env[name];if(!key) throw new Error(`Missing ${name}`);return key;}
export async function route(from,to) {
  return cached('route:'+JSON.stringify([from,to]),async()=>{
  const url=new URL('https://routing.api.2gis.com/routing/7.0.0/global');
  url.searchParams.set('key',requireKey('TWOGIS_API_KEY'));
  const data=await fetchJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:[from,to].map(p=>({...p,type:'walking'})),transport:'walking',output:'summary',locale:'ru'})});
  if(data.status!=='OK'||!data.result?.length||!Number.isFinite(data.result[0].duration)||data.result[0].duration<0||!Number.isFinite(data.result[0].length)||data.result[0].length<0) throw new Error('Route unavailable');
  return {durationSeconds:data.result[0].duration,lengthMeters:data.result[0].length,provider:'2GIS'};
  });
}
export async function weather(point,at,durationMinutes=60) {
  const query=`query Weather { weatherByPoint(request: {lat: ${point.lat}, lon: ${point.lon}}) { now {temperature windSpeed windGust precType} forecast {hours(first: 48) {edges {node {timestamp temperature windSpeed windGust accumulatedPrec precType}}}} } }`;
  const data=await cached('weather:'+JSON.stringify(point),async()=>{
    const result=await fetchJson(process.env.YANDEX_WEATHER_URL||'https://api.weather.yandex.ru/graphql/query',{method:'POST',headers:{'Content-Type':'application/json','X-Yandex-Weather-Key':requireKey('YANDEX_WEATHER_KEY')},body:JSON.stringify({query})});
    if(result.errors||!result.data?.weatherByPoint) throw new Error('Weather query unavailable');
    return result;
  });
  const source=data.data.weatherByPoint;
  const all = normalizeHours(source.forecast?.hours?.edges ?? []);
  return {provider:'Yandex Weather', now:source.now, ...forecastWindow(all,at,durationMinutes)};
}
export async function facts(title) {
  if(title!=='Хан Шатыр') throw new Error('Invalid landmark title');
  return cached('facts:'+title,async()=>{
  const url=new URL('https://ru.wikipedia.org/w/api.php');
  url.search=new URLSearchParams({action:'query',prop:'extracts',exintro:'1',explaintext:'1',redirects:'1',titles:title,format:'json',formatversion:'2'});
  const data=await fetchJson(url,{headers:{'User-Agent':'AstanaWalkHackathon/0.1'}});
  const page=data.query?.pages?.[0];
  return {provider:'Wikipedia',title:page?.title,text:page?.extract?.slice(0,2500)??null,url:page?.extract?`https://ru.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ','_'))}`:null};
  });
}
