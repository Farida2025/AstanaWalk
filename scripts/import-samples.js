import {readFile} from 'node:fs/promises';
import {normalize,savePlaces} from '../src/places.js';
// Import user-supplied API responses; paths are passed as arguments, not hardcoded.
const files=process.argv.slice(2);
if(!files.length) {console.error('Usage: npm run import:samples -- <response.json-or-txt> ...');process.exit(1);}
const items=new Map();
for(const path of files) {
  const response=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
  if(response.meta?.code!==200) throw new Error('Expected successful 2GIS response');
  const issueDate=response.meta.issue_date;
  const obtained=issueDate?`${issueDate.slice(0,4)}-${issueDate.slice(4,6)}-${issueDate.slice(6,8)}`:'unknown';
  for(const item of response.result?.items??[]) items.set(String(item.id),normalize(item,obtained));
}
const places=[...items.values()].filter(p=>p.point&&p.categories.length);
await savePlaces(places);console.log(`Imported ${places.length} places from ${files.length} supplied responses. No new API requests.`);
