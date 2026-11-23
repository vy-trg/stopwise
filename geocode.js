// Street addresses (feedback, Nov 2026: "you have to pick a bus stop rather than a street
// address"). Photon (photon.komoot.io, OpenStreetMap data, free, made for search-as-you-type),
// limited to South East Queensland. The server asks it, so results are cached and every visitor
// shares one polite stream of requests; the page never talks to Photon directly.
const PHOTON = 'https://photon.komoot.io/api/';
// South East Queensland: Noosa to the Gold Coast, west past Toowoomba
export const SEQ_BBOX = [151.8, -28.3, 153.6, -26.1];
const cache = new Map(); // query -> { at, places }
const DAY = 24 * 3600 * 1000;

// "12 Bounty Street, Springfield Lakes" from a Photon feature; null if it has no usable place
export function placeFromFeature(f) {
  const p = f?.properties ?? {};
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const street = p.street ? `${p.housenumber ? `${p.housenumber} ` : ''}${p.street}` : null;
  const area = p.district || p.locality || p.city || p.county;
  // A named place (a school, a park) keeps its name; an address is "number street"
  const first = p.name && p.name !== p.street ? p.name : street ?? p.name;
  if (!first) return null;
  const second = p.name && p.name !== p.street && street ? street : null;
  const parts = [first, second, area && area !== first ? area : null].filter(Boolean);
  return { name: parts.join(', '), lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

// Australian short forms people type ("12 Bounty St") spelled out, which the search matches better
const SHORT = { st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', dr: 'drive', cres: 'crescent', cr: 'crescent',
  ct: 'court', pl: 'place', tce: 'terrace', pde: 'parade', hwy: 'highway', cct: 'circuit', cir: 'circuit',
  bvd: 'boulevard', blvd: 'boulevard', ln: 'lane', cl: 'close', gr: 'grove', wy: 'way', esp: 'esplanade' };
export function expandShortForms(q) {
  return q.replace(/\b([a-z]+)\b\.?/gi, (w, word) => SHORT[word.toLowerCase()] ?? w);
}

// "12 Bounty Street, Springfield" -> { number: '12', rest: 'Bounty Street, Springfield' }; also "12/34 X St", "12A X St"
export function splitHouseNumber(q) {
  const m = q.trim().match(/^(?:\d+[a-z]?\s*\/\s*)?(\d+[a-z]?)\s*,?\s+(.+)$/i);
  return m ? { number: m[1], rest: m[2] } : null;
}

async function photon(q, fetchImpl) {
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=${SEQ_BBOX.join(',')}`;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'Stopwise (https://github.com/vy-trg/stopwise)' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Address search answered ${res.status}`);
  return (await res.json()).features ?? [];
}

// Many houses in OpenStreetMap have no number yet (common in newer suburbs), so "12 Bounty Street"
// can find nothing even though Bounty Street is there. Then we search for the street and say so:
// the point is the street, a few hundred metres at most from the house.
export async function geocode(q, { fetchImpl = fetch } = {}) {
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.places;
  const full = expandShortForms(q.trim());
  const house = splitHouseNumber(full);
  let features = await photon(full, fetchImpl);
  let streetOnly = false;
  if (house && !features.some((f) => String(f.properties?.housenumber ?? '').toLowerCase() === house.number.toLowerCase())) {
    const streets = await photon(house.rest, fetchImpl);
    if (streets.length) { features = streets; streetOnly = true; }
  }
  const seen = new Set();
  const places = features.map(placeFromFeature)
    .filter((p) => p && !seen.has(p.name) && seen.add(p.name))
    .map((p) => (streetOnly ? { ...p, name: `${house.number} ${p.name}`, streetOnly: true } : p));
  if (cache.size > 5000) cache.clear();
  cache.set(key, { at: Date.now(), places });
  return places;
}
