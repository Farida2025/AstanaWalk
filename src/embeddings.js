import {createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {requireKey} from './providers.js';
export const embeddingModel=()=>process.env.GEMINI_EMBEDDING_MODEL||'gemini-embedding-001';
const indexFile=new URL('../data/embeddings.json',import.meta.url);
export function placeDocument(p){
  return [p.name,p.rubrics.map(r=>r.name).join(', '),p.attributes.map(a=>a.name).join('; '),p.averageCheck?`Средний чек ${p.averageCheck} тенге`:'',p.description||''].filter(Boolean).join('\n');
}
export const fingerprint=p=>createHash('sha256').update(p.id+'\n'+placeDocument(p)).digest('hex');
export function cosine(a,b){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length)throw new Error('Invalid vectors');let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0;}
async function embed(texts,taskType){
  const model=embeddingModel();if(!/^[a-zA-Z0-9.-]+$/.test(model))throw new Error('Invalid embedding model');
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':requireKey('GEMINI_API_KEY')},body:JSON.stringify({requests:texts.map(text=>({model:`models/${model}`,content:{parts:[{text}]},taskType,outputDimensionality:768}))}),signal:AbortSignal.timeout(taskType==='RETRIEVAL_QUERY'?8000:45000)});
  if(!response.ok)throw new Error(`Embedding provider HTTP ${response.status}`);
  const data=await response.json();const vectors=data.embeddings?.map(e=>e.values);
  if(vectors?.length!==texts.length||vectors.some(v=>!Array.isArray(v)||v.length!==768||v.some(n=>!Number.isFinite(n))))throw new Error('Invalid embedding response');
  return vectors;
}
function validEntry(entry,place) {
  return entry?.hash===fingerprint(place) && Array.isArray(entry.vector) && entry.vector.length===768 && entry.vector.every(Number.isFinite);
}
async function readIndex(){
  try {
    const index=JSON.parse(await readFile(indexFile,'utf8'));
    return index.model===embeddingModel() && index.entries && typeof index.entries==='object' ? index : null;
  } catch(e) {if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}
}
async function saveIndex(index) {
  await mkdir(new URL('../data/',import.meta.url),{recursive:true});
  const temp=new URL('../data/embeddings.tmp.json',import.meta.url);
  await writeFile(temp,JSON.stringify(index));await rename(temp,indexFile);
}
export async function buildIndex(places){
  const old=await readIndex(),entries={};let count=0;
  const pending=[];
  for(const p of places){const hash=fingerprint(p),cached=old?.entries[p.id];if(validEntry(cached,p))entries[p.id]=cached;else pending.push(p);}
  for(let i=0;i<pending.length;i+=20){
    if(i>0)await new Promise(resolve=>setTimeout(resolve,15000));
    const batch=pending.slice(i,i+20);let vectors;
    for(let attempt=0;attempt<3;attempt++){try{vectors=await embed(batch.map(placeDocument),'RETRIEVAL_DOCUMENT');break;}catch(e){if(!e.message.includes('429')||attempt===2)throw e;console.log('Embedding quota: waiting 45 seconds before retry');await new Promise(resolve=>setTimeout(resolve,45000));}}
    batch.forEach((p,j)=>{entries[p.id]={hash:fingerprint(p),vector:vectors[j]};});count+=batch.length;
    await saveIndex({model:embeddingModel(),createdAt:new Date().toISOString(),entries});
    console.log(`Embedded ${count}/${pending.length} changed places`);
  }
  const index={model:embeddingModel(),createdAt:new Date().toISOString(),entries};await saveIndex(index);return {indexed:places.length,updated:count};
}
export async function indexStatus(places){const index=await readIndex();const count=places.filter(p=>validEntry(index?.entries[p.id],p)).length;return {ready:places.length>0&&count===places.length,indexed:count,total:places.length,model:embeddingModel()};}
export async function semanticRank(places,query,limit=8){
  if(!places.length)return {items:[],mode:'structured_filters_and_keyword_ranking'};
  const index=await readIndex();if(!index||places.some(p=>!validEntry(index.entries[p.id],p)))return {items:places.slice(0,limit),mode:'structured_filters_and_keyword_ranking'};
  const [vector]=await embed([query],'RETRIEVAL_QUERY');
  const items=places.map(p=>({...p,semanticScore:cosine(vector,index.entries[p.id].vector)})).sort((a,b)=>b.semanticScore-a.semanticScore||a.distanceMeters-b.distanceMeters).slice(0,limit);
  return {items,mode:'hybrid_embeddings_and_structured_filters'};
}
