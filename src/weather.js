import {weatherMessage} from '../public/route-weather.js';
const number = value => typeof value === 'number' && Number.isFinite(value);

/** Normalize only real numeric readings. Missing precipitation must not become zero. */
export function normalizeHours(edges = []) {
  if (!Array.isArray(edges)) return [];
  return edges.map(e => e?.node ?? e).filter(h => h && h.timestamp !== null && h.timestamp !== undefined && String(h.timestamp).trim() !== '' && number(Number(h.timestamp)) && Number.isFinite(new Date(Number(h.timestamp) * 1000).getTime())).map(h => ({
    ...h, timestamp: Number(h.timestamp), time: new Date(Number(h.timestamp) * 1000).toISOString(),
  })).sort((a,b) => a.timestamp - b.timestamp);
}
export function coversPeriod(hours, start, end) {
  let until = start;
  for (const h of [...hours].sort((a,b) => a.timestamp-b.timestamp)) {
    const t = h.timestamp * 1000;
    if (t + 3600000 <= until) continue;
    if (t > until) return false;
    until = t + 3600000;
    if (until >= end) return true;
  }
  return false;
}
export function forecastWindow(all, at, durationMinutes) {
  const start = Date.parse(at), end = start + durationMinutes * 60000;
  const hours = all.filter(h => h.timestamp*1000 < end && h.timestamp*1000+3600000 > start);
  const metricsComplete = hours.every(h => ['temperature','windSpeed','windGust','accumulatedPrec'].every(k => number(h[k])));
  const complete = coversPeriod(hours, start, end) && metricsComplete;
  return {
    hours, outlook: all.filter(h => h.timestamp*1000+3600000 > start).slice(0, 6),
    coverage: complete ? 'complete' : 'incomplete',
    period: {at, durationMinutes, until: new Date(end).toISOString()},
    forecastRange: all.length ? {from: all[0].time, until: new Date((all.at(-1).timestamp+3600)*1000).toISOString()} : null,
    advice: complete ? weatherMessage(hours) : 'На весь выбранный период нет полного прогноза. Погода не подтверждена.',
  };
}
