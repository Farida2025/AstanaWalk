import {readPlaces,CENTER,distanceMeters} from '../src/places.js';
import {indexStatus} from '../src/embeddings.js';
const places=await readPlaces(),index=await indexStatus(places);
const report={node:process.version,places:places.length,outsideScope:places.filter(p=>distanceMeters(CENTER,p.point)>2000).length,
  categories:Object.fromEntries(['eat','walk','fun','sights'].map(c=>[c,places.filter(p=>p.categories.includes(c)).length])),
  knownPrices:places.filter(p=>Number.isFinite(p.averageCheck)).length,withSchedule:places.filter(p=>p.schedule).length,
  index,configured:Object.fromEntries(['TWOGIS_API_KEY','YANDEX_WEATHER_KEY','GEMINI_API_KEY'].map(k=>[k,!!process.env[k]])),
  warning:'No external requests were sent. Configured keys are not proof of provider availability.'};
console.log(JSON.stringify(report,null,2));
if(!places.length)process.exitCode=1;
