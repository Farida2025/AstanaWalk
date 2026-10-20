import {writeFile,rename} from 'node:fs/promises';
import {normalize,savePlaces,CENTER,SERVICE_RADIUS_METERS,inServiceArea} from '../src/places.js';
import {fetchJson,requireKey} from '../src/providers.js';
import {landmarks} from '../src/landmarks.js';
// A complete successful run replaces the bounded snapshot. Failure leaves the previous file untouched.
// Never commit cached provider records or embeddings to a public repository without permission.
const queries=['кафе','ресторан','кофейня','парк','сквер','достопримечательности','музей','галерея','детские игровые залы','центры виртуальной реальности','квесты','боулинг','клубы настольных игр','компьютерные клубы','бильярд','караоке','ночные клубы'];
const key=requireKey('TWOGIS_API_KEY');
const maxPages=Number(process.env.COLLECT_MAX_PAGES||3);
if(!Number.isInteger(maxPages)||maxPages<1||maxPages>5)throw new Error('COLLECT_MAX_PAGES must be 1–5');
const startedAt=new Date().toISOString(),collected=new Map(),runs=[];
const ingest=item=>{
  const place=normalize(item),landmark=landmarks.find(l=>l.id===place.id);
  if(landmark) {place.categories=[...new Set([...place.categories,'sights'])];place.wikipediaTitle=landmark.wikipediaTitle;}
  if(inServiceArea(place.point)&&place.categories.length)collected.set(place.id,place);
};
try {
  for(const query of queries) {
    let count=0,total=0,pages=0;
    for(let page=1;page<=maxPages;page++) {
      const url=new URL('https://catalog.api.2gis.com/3.0/items');
      url.search=new URLSearchParams({q:query,point:`${CENTER.lon},${CENTER.lat}`,radius:String(SERVICE_RADIUS_METERS),fields:'items.point,items.rubrics,items.schedule,items.schedule_special,items.attribute_groups',page:String(page),page_size:'10',key});
      const response=await fetchJson(url);
      if(response.meta?.code!==200)throw new Error('Places API rejected a collection request');
      const items=response.result?.items??[];total=response.result?.total??0;pages=page;count+=items.length;
      items.forEach(ingest);
      console.log(`${query}: page ${page}, received ${items.length}`);
      if(page*10>=total||!items.length)break;
    }
    runs.push({query,pages,received:count,reportedTotal:total,truncated:count<total});
  }
  // Mapped landmark is fetched, not silently seeded as a current business record.
  for(const landmark of landmarks) {
    const url=new URL('https://catalog.api.2gis.com/3.0/items/byid');
    url.search=new URLSearchParams({id:landmark.id,fields:'items.point,items.rubrics,items.schedule,items.schedule_special,items.attribute_groups',key});
    const response=await fetchJson(url);
    if(response.meta?.code!==200)throw new Error('Landmark refresh failed');
    (response.result?.items??[]).forEach(ingest);
  }
  if(!collected.size)throw new Error('Collection is empty; preserving previous snapshot');
  await savePlaces([...collected.values()]);
  const manifest={provider:'2GIS',startedAt,completedAt:new Date().toISOString(),center:CENTER,radiusMeters:SERVICE_RADIUS_METERS,queries:runs,places:collected.size,partial: runs.some(r=>r.truncated),note:'Bounded sample, not an exhaustive city directory. Storage and redistribution permission must be checked for the account.'};
  const temp=new URL('../data/collection.tmp.json',import.meta.url),file=new URL('../data/collection.json',import.meta.url);
  await writeFile(temp,JSON.stringify(manifest,null,2));await rename(temp,file);
  console.log(`Saved ${collected.size} unique places within 2 km. Run npm run index to update semantic retrieval.`);
} catch {
  console.error('Collection failed. No API keys or provider response details are printed. Check key permissions/quota/network. Previous place snapshot is preserved unless writing the collection report itself failed.');
  process.exitCode=1;
}
