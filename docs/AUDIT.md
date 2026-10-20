# Integration audit

**Input:** the uploaded private project and the supplied scope screenshots. **Output:** focused integration release 0.3.0; the original archive was not overwritten.

## What was already there

The initial project was not an empty scaffold. It included a native Node.js server, a browser client, 2GIS collection/routing, Yandex forecast and Wikipedia adapters, Gemini structured chat, an embedding builder, 315 place records, a matching 315-entry index and 26 passing automated tests. Populated provider credentials were also present in its private `.env`.

## Material changes

| Gap in the supplied implementation | Change | Main files |
|---|---|---|
| 5 km defaults vs agreed fixed 2 km | Fixed territory checked at collection, dataset read, search, API input and map selection; private dataset/index trimmed offline | `places.js`, `server.js`, `collect.js`, `map.js` |
| Display-only map; chat and map disconnected | Click-to-select origin; one shared collection of cards/markers; mobile chat/map tabs | `public/app.js`, `map.js`, `index.html`, `style.css` |
| UI constraints omitted from chat | Category, subtype, budget, features, strict opening and duration sent and enforced; contradictory constraints return no result | `public/app.js`, `src/chat.js` |
| Relative departure not applied | Resolve relative departure against now; keep duration separate; reflect effective time in form and follow-ups | `src/time.js`, `chat.js`, `public/app.js` |
| Weak temporal/weather checks | Continuous forecast coverage, missing values remain unknown; route arrival plus minimum visit checked against opening; exact closing handled | `weather.js`, `recommendations.js`, `route-weather.js` |
| Filtering/routing could discard eligible candidates too early | Child/time eligibility before semantic top-k; explicit names/types constrained; routes fetched for selected candidates | `chat.js`, `places.js` |
| Failure states obscured | Explicit keyword/generation fallback labels, provider warnings, request cancellation, stale-response protection | `chat.js`, `public/app.js` |
| Weak API boundary | Validated bodies/dates/coordinates; whitelist static assets; safe errors; origin rules, limits and optional demo authentication | `server.js` |
| Collection retained stale rows | Bounded, deduplicated replacement after successful run; manifest and atomic file writes | `collect.js`, `places.js`, `embeddings.js` |
| Missing handoff materials | Startup guide, architecture/privacy notes, scenarios, demo script, submission checklist and verification receipts | `README.md`, `START-HERE.md`, `docs/` |

The runtime stack was retained. No database service, account system, vector database dependency, model training, multi-stop planner, socket/quietness enrichment or transport-price integration was added.

## Verified here

67 Node tests passed, including 41 additional tests over the original suite. One original forecast fixture was corrected to include the temperature field its “complete weather” assertion requires. Twenty offline browser checks passed with synthetic API results and a minimal Leaflet contract double. Source content is escaped in both cards and map popups; the browser checks exercise an HTML-injection payload and cancellation after changing filters.

The private package contains 105 records and 105 matching existing embeddings, all within the fixed area. Original source timestamps were retained; there was no new collection or new embedding generation. The source-only package intentionally omits those files.

## Not established here

No live provider calls were made using the user's keys. Model access, tariffs, routing quality, forecast response shape, Wikipedia availability, real map tiles and deployed browser behavior still require acceptance testing. No quantitative retrieval-quality benchmark or latency/load study was run. The archived dataset may be incomplete or stale. A generated explanation is not evidence that the business has seats, an available session, an exact admission price or a guaranteed accessible route.

The browser environment blocked URL navigation; the DOM harness is separate from the Node HTTP tests. Passing both is not the same as a successful real-browser, real-provider end-to-end run.

No hosted URL, repository publication, actual presentation file or recorded video was created. The submission outline and recording script are provided, but those remaining submission actions must be completed by the team.
