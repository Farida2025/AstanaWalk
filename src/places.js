import {describePlace} from './recommendations.js';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import {landmarks} from './landmarks.js';
import {placeTypes} from './categories.js';

export const CENTER = { lat: 51.13213, lon: 71.402828 };
export const SERVICE_RADIUS_METERS = 2000;
export const inServiceArea = point => !!point && Number.isFinite(point.lat) && Number.isFinite(point.lon) && distanceMeters(CENTER,point) <= SERVICE_RADIUS_METERS;
export const DATA_FILE = new URL('../data/places.json', import.meta.url);
const food = new Set(['161','162','164','165','51459']);
const walks = new Set(['168']);
export function normalize(item, fetchedAt = new Date().toISOString()) {
  const attrs = (item.attribute_groups ?? []).flatMap(g => g.attributes ?? []);
  const rubrics = item.rubrics ?? [];
  const names = rubrics.map(r => r.name).join(' ');
  const categories = [];
  if (rubrics.some(r => food.has(String(r.id)))) categories.push('eat');
  if (rubrics.some(r => walks.has(String(r.id)))) categories.push('walk');
  if (/музе|выстав|галере|детские развлекательные|игровые залы|виртуальной реальности|квест|аттракцион|настольных|смотров|боулинг|бильярд|караоке|ночные клубы|компьютерные клубы|видеоигр/i.test(names)) categories.push('fun');
  if (/достопримечательности|памятники|смотровые площадки|архитектурные/i.test(names))categories.push('sights');
  const price = attrs.find(a => a.tag === 'food_service_avg_price');
  const feature = tag => attrs.some(a => a.tag === tag) ? true : null;
  return {
    id: String(item.id), name: item.name, address: item.address_name ?? null,
    point: item.point ?? null, categories, rubrics,
    averageCheck: price ? Number(price.name.replace(/[^\d]/g,'')) || null : null,
    currency: 'KZT', features: {
      wifi: attrs.some(a=>/wi.?fi/i.test(a.name))?true:feature('additionally_services_freewifi'),
      laptop: feature('food_service_cafe_working'),
      kidsMenu: feature('food_service_details_food_kids_menu'),
      dogFriendly: feature('available_dog_friendly'),
      accessibleEntrance: feature('accessible_entrance_accessible_entrance'),
    },
    attributes: attrs.map(({name,tag})=>({name,tag})), schedule: item.schedule ?? null,
    scheduleSpecial: item.schedule_special ?? null,
    bookingNote: /запис/i.test(item.schedule?.comment ?? '') ? item.schedule.comment : null,
    source: { provider: '2GIS', fetchedAt, url: `https://2gis.kz/astana/firm/${item.id}` },
  };
}
export async function readPlaces() {
  let imported;
  try { imported = JSON.parse(await readFile(DATA_FILE, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  if (!Array.isArray(imported)) throw new Error('Invalid place dataset');
  // Do not fabricate a populated database when the collector has not run.
  const merged = new Map(imported.map(p => [p.id, p]));
  for (const landmark of landmarks) {
    const original = merged.get(landmark.id);
    if (original) merged.set(landmark.id, {...original, wikipediaTitle: landmark.wikipediaTitle,
      categories: [...new Set([...original.categories, 'sights'])]});
  }
  return [...merged.values()].filter(p => inServiceArea(p.point)).map(p => ({...p,
    description: describePlace(p), descriptionSource: 'Сводка полей 2ГИС'}));
}
export async function savePlaces(places) {
  await mkdir(new URL('../data/', import.meta.url), {recursive: true});
  const temp = new URL('../data/places.tmp.json', import.meta.url);
  await writeFile(temp, JSON.stringify(places, null, 2));
  await rename(temp, DATA_FILE);
}
export function distanceMeters(a,b) {
  const rad=x=>x*Math.PI/180;
  const dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon);
  const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
  return Math.round(6371000*2*Math.asin(Math.sqrt(Math.min(1,h))));
}
// Evaluate intervals on the local calendar, including yesterday's overnight span.
export function openingStatus(place, at) {
  if (!place.schedule || !Number.isFinite(Date.parse(at))) return 'unknown';
  const local = new Date(Date.parse(at) + 5 * 3600000);
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const date = local.toISOString().slice(0,10);
  const prev = new Date(local.getTime() - 86400000);
  const specials = Array.isArray(place.scheduleSpecial) ? place.scheduleSpecial : [];
  // Unknown special-hours shapes are not interpreted as regular opening.
  if (place.scheduleSpecial && !Array.isArray(place.scheduleSpecial)) return 'unknown';
  const periods = (d, key) => {
    const special = specials.find(s => s.date === d);
    return special ? special.working_hours ?? [] :
      place.schedule[names[key]]?.working_hours ?? (place.schedule.is_24x7 ? [{from:'00:00',to:'24:00'}] : []);
  };
  const toMin = t => {
    if (typeof t !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(t)) return NaN;
    const [h,m] = t.split(':').map(Number); return h*60+m;
  };
  const today = periods(date, local.getUTCDay()), yesterday = periods(prev.toISOString().slice(0,10), prev.getUTCDay());
  if (!Array.isArray(today)||!Array.isArray(yesterday)||![...today,...yesterday].every(p => p && Number.isFinite(toMin(p.from)) && Number.isFinite(toMin(p.to)))) return 'unknown';
  // An explicit closure on this date overrides an overnight interval as well.
  const specialToday = specials.find(s => s.date === date);
  if (specialToday && !today.length) return 'closed_by_schedule';
  const open = today.some(p => {
    const from=toMin(p.from),to=toMin(p.to);
    if (from===to) return false; // Ambiguous zero-length intervals are not "24 hours".
    return to>from ? mins>=from && mins<to : mins>=from;
  }) || yesterday.some(p => toMin(p.to)<toMin(p.from) && mins<toMin(p.to));
  return open ? 'open_by_schedule' : 'closed_by_schedule';
}
export function searchPlaces(places, filters) {
  const {lat,lon,radius=2000,category,maxAverageCheck,at,features=[],openOnly=false,query='',limit=3,type,types=[],categories=[],specificName=''}=filters;
  const tokens=query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>2);
  return places.filter(p=>inServiceArea(p.point)&&p.categories.length).map(p=>{
    const distance=distanceMeters({lat,lon},p.point);
    const status=openingStatus(p,at);
    const text=[p.name,...p.rubrics.map(r=>r.name),...p.attributes.map(a=>a.name)].join(' ').toLowerCase();
    const matches=tokens.filter(t=>text.includes(t));
    return {...p,types:placeTypes(p),distanceMeters:distance,distanceKind:'straight_line',openingStatus:status,matchedTerms:matches};
  }).filter(p=>p.distanceMeters<=radius&&(!category||category==='any'||p.categories.includes(category)||(category==='walk'&&p.categories.includes('sights')))&&(!categories.length||categories.some(c=>p.categories.includes(c)||(c==='walk'&&p.categories.includes('sights'))))&&(!type||p.types.includes(type)||(type==='sights'&&p.categories.includes('sights')))&&(!types.length||types.some(t=>p.types.includes(t)||(t==='sights'&&p.categories.includes('sights'))))&&(!specificName||specificName.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every(t=>p.name.toLowerCase().includes(t)))&&(!maxAverageCheck||(!p.categories.includes('eat')&&category!=='eat')||(p.averageCheck!==null&&p.averageCheck<=maxAverageCheck))&&features.every(f=>p.features[f]===true)&&(!openOnly||p.openingStatus==='open_by_schedule'))
    .sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length||a.distanceMeters-b.distanceMeters).slice(0,limit);
}
