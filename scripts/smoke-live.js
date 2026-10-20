// Explicit, opt-in live check. May consume paid API quota. No collection or re-indexing.
import {readPlaces,CENTER} from '../src/places.js';
import {chat} from '../src/chat.js';
if(!process.argv.includes('--confirm-live')) {
  console.error('This uses real external APIs and may incur charges. Run: npm run smoke:live -- --confirm-live');
  process.exitCode=1;
} else {
  const places=await readPlaces();
  if(!places.length)throw new Error('Dataset is empty. Collect data first.');
  try {
    const result=await chat({message:'Нужна кофейня с Wi-Fi. У меня 90 минут, средний чек до 7000 тенге.',...CENTER,at:new Date().toISOString(),radius:2000,category:'any',timeBudgetMinutes:90});
    console.log(JSON.stringify({generation:result.generation,retrieval:result.retrieval,places:result.items.map(p=>({id:p.id,name:p.name,route:!!p.travel,timeFit:p.timeFit})),weatherAvailable:result.weather?.available,unknowns:result.unknowns},null,2));
    if(result.generation!=='grounded_model'||result.retrieval!=='hybrid_embeddings_and_structured_filters'||!result.items.length)process.exitCode=1;
  } catch {console.error('Live check failed. Check keys, API model access, network and quota. No credentials are printed.');process.exitCode=1;}
}
