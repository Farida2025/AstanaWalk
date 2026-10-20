# Source data, permissions and attribution

The uploaded project contains data obtained through third-party services. This release preserves source identifiers, URLs and record timestamps; it does not establish a right to publish, indefinitely store, embed or display those records with another provider's map.

**Private demo archive:** includes a 105-record geographic subset of the user's uploaded data and the existing matching embedding vectors. It is provided back to the user for their project, not licensed here for public redistribution. Check the actual 2GIS account/product conditions, authorized fields, retention, attribution and use with a Leaflet/OpenStreetMap display. A technical success response is not a legal permission check.

**Source-only archive:** omits `data/*.json` and all credentials. It still refers to provider endpoints and contains a mapped Khan Shatyr ID/coordinates inherited from the project. The team must decide the code's own distribution license; none is invented by this release. Review files before making a repository public.

**2GIS:** cards identify 2GIS and link to the record; walking estimates identify the routing source. Do not remove attribution or claim a check/price/availability the API did not provide. The collector has finite limits and preserves source timestamps; its output is not complete city coverage.

**Yandex Weather:** the UI identifies the weather source and selected time window. Actual account entitlement, forecast horizon, caching and display terms need checking. Incomplete hourly data does not establish safe weather.

**Wikipedia:** the facts view uses a short introductory extract with an article link, provider label and a notice directing readers to the source's attribution/license. It does not relicense the article. Only Khan Shatyr is enabled in this prototype. Check the final attribution requirements before publication.

**Leaflet / OpenStreetMap:** Leaflet loads from a pinned CDN URL with integrity metadata; map tiles retain OpenStreetMap contributor attribution. Check the current tile usage policy before public/high-traffic operation. No offline map tiles or unlicensed map imagery are bundled.

**Gemini:** review model/embedding access, costs, data-use/retention settings and applicable terms for the actual account. Sending unstructured user text can disclose personal information even when coordinates are not added as separate fields.

Useful primary documentation to check against the actual account:

- 2GIS Places: https://docs.2gis.com/en/api/search/places/overview
- Gemini model: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- Structured output: https://ai.google.dev/gemini-api/docs/structured-output
- OpenStreetMap attribution: https://www.openstreetmap.org/copyright
- Tile policy: https://operations.osmfoundation.org/policies/tiles/
- Source article attribution/license: follow the Wikipedia link displayed in the app.

Documentation links are starting points, not proof that a particular subscription permits this use. No independent legal-compliance conclusion is supplied.
