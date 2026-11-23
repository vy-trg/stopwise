import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeFromFeature, geocode, expandShortForms, splitHouseNumber } from '../geocode.js';

const feature = (props, lng = 152.9, lat = -27.66) => ({ geometry: { coordinates: [lng, lat] }, properties: props });

test('an address reads "number street, suburb"', () => {
  assert.deepEqual(placeFromFeature(feature({ housenumber: '12', street: 'Bounty Street', district: 'Springfield Lakes', city: 'Ipswich' })),
    { name: '12 Bounty Street, Springfield Lakes', lat: -27.66, lng: 152.9 });
});

test('a named place keeps its name, then the street and suburb', () => {
  assert.equal(placeFromFeature(feature({ name: 'Springfield Lakes State School', street: 'Springfield Lakes Boulevard', locality: 'Springfield Lakes' })).name,
    'Springfield Lakes State School, Springfield Lakes Boulevard, Springfield Lakes');
});

test('nothing to call it, or no coordinates: left out', () => {
  assert.equal(placeFromFeature(feature({})), null);
  assert.equal(placeFromFeature({ properties: { name: 'x' } }), null);
});

test('results are cached, duplicates dropped, and the search stays in South East Queensland', async () => {
  let calls = 0;
  let asked = '';
  const fetchImpl = async (url) => {
    calls += 1;
    asked = url;
    return { ok: true, json: async () => ({ features: [feature({ housenumber: '1', street: 'A St', district: 'X' }), feature({ housenumber: '1', street: 'A St', district: 'X' })] }) };
  };
  const a = await geocode('1 A St test', { fetchImpl });
  const b = await geocode('1 A St test', { fetchImpl });
  assert.equal(a.length, 1);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.match(asked, /bbox=151\.8,-28\.3,153\.6,-26\.1/);
});

test('short forms are spelled out and the house number is split off', () => {
  assert.equal(expandShortForms('12 Bounty St, Springfield Lakes'), '12 Bounty street, Springfield Lakes');
  assert.equal(expandShortForms('3 Liberty Cres.'), '3 Liberty crescent');
  assert.deepEqual(splitHouseNumber('12 Bounty street'), { number: '12', rest: 'Bounty street' });
  assert.deepEqual(splitHouseNumber('4/12A Bounty street'), { number: '12A', rest: 'Bounty street' });
  assert.equal(splitHouseNumber('Bounty street'), null);
});

test('a house number the map does not have falls back to the street, and says so', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    asked.push(q);
    const features = q.startsWith('77') ? [] : [feature({ name: 'Bounty Street', district: 'Springfield Lakes' }, 152.92, -27.67)];
    return { ok: true, json: async () => ({ features }) };
  };
  const [p] = await geocode('77 Bounty St Springfield Lakes', { fetchImpl });
  assert.deepEqual(asked, ['77 Bounty street Springfield Lakes', 'Bounty street Springfield Lakes']);
  assert.equal(p.name, '77 Bounty Street, Springfield Lakes');
  assert.equal(p.streetOnly, true);
});
