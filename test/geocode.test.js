import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeFromFeature, geocode } from '../geocode.js';

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
