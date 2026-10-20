import {readPlaces} from '../src/places.js';
import {buildIndex} from '../src/embeddings.js';
console.log(JSON.stringify(await buildIndex(await readPlaces())));
