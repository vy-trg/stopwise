# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stopwise: live map and journey tools for TransLink South East Queensland (trains, buses, trams, ferries). Express 5 server (ES modules, Node >= 22) that joins TransLink GTFS-realtime feeds with the GTFS timetable in PostgreSQL and serves JSON to a vanilla-JS + Leaflet frontend in `public/`. README.md, ARCHITECTURE.md and `docs/*.md` hold the product and design detail (mermaid diagrams, API table).

## Commands

```bash
PORT=3200 npm run dev          # node --env-file=.env --watch server.js (ports 3000/3001 are taken by Docker here; never `npm start`)
npm test                       # node --test test/*.test.js (built-in runner, no network, no DB)
node --test test/raptor.test.js                      # one test file
node --test --test-name-pattern="change" test/*.test.js   # one test by name
npm run load-gtfs -- data/gtfs # load the unzipped GTFS timetable into Postgres (needs DATABASE_URL)
npm run record-delays          # one delay snapshot (also run by GitHub Actions every 10 min)
FEED_FIXTURES=test/fixtures PORT=3200 npm run dev    # offline: use saved protobuf feeds instead of TransLink
docker compose up --build      # app + Postgres (Postgres on host port 5433)
```

There is no linter or build step. `.env` needs `DATABASE_URL`; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` are optional (Web Push). Overridable feed URLs: `FEED_URL`, `TRIP_UPDATES_URL`, `ALERTS_URL`. `NODE_ENV=test` disables the background timers in `server.js`.

CI (`.github/workflows/ci.yml`) runs `npm test` and a Docker build on every PR. gitleaks runs as a pre-commit hook and in Actions.

## Architecture

Flat layout: backend modules sit in the repo root, `server.js` is the only entry point (routes, rate limiting, helmet, push watcher), and `public/app.js` (~2500 lines) is the whole frontend.

**Realtime path** (`realtime.js` -> `feed.js` -> `live.js`): `realtime.js` fetches Rail/Tram/Ferry VehiclePositions, TripUpdates and Alerts with a 30 s in-memory cache, a shared in-flight promise (concurrent requests wait on one fetch), a 10 s timeout, and stale-data fallback (a failing mode is skipped, the others still show). `feed.js` decodes protobuf. `live.js` and `schedule.js` join realtime data with timetable rows (delay carry-forward to stops without their own value, departure board, summary numbers, GTFS times past 24:00). Brisbane is UTC+10 with no DST; boards also include trips that started the previous service day.

**Timetable** (`db/schema.sql`, `db/queries.js`, `scripts/load-gtfs.js`): stop times are stored compressed as trip *patterns* (`pattern_stops` + per-trip start offsets, ~274k rows instead of 3.6M) to fit Neon's 0.5 GB free tier. Trip ids change with every TransLink timetable, so `load-timetable.yml` reloads it weekly; stale ids mean live services can't be matched. `trip_delays` holds one row per trip per day (upserted in place, pruned after 35 days) written by `scripts/record-delays.js` from GitHub Actions, because Render's free plan sleeps.

**Journey planning** (`planner.js`, `raptor.js`, `walk.js`, `geo.js`, `geocode.js`, `landmarks.js`, `patterns.js`): `raptor.js` is a pure RAPTOR implementation (no DB/network, times are seconds after service-day midnight, can be negative or > 86400). `planner.js` loads the whole network into memory once and each service date's trips on first use. `walk.js` gives street-based walking times. `connection.js` is the pure "will I make the train -> bus connection" classifier (Make it / Tight / Miss); rules in `docs/connections.md`. Keep these modules pure and unit tested.

**Start journey + push** (`push.js`, `/api/push/*` in `server.js`, `public/sw.js`): the server follows a journey from the vehicle's reported position (not GPS) and sends Web Push alerts; subscriptions/journeys are in memory only (one per subscription, lost on restart). Spec in `docs/start-journey.md`. Push endpoints are inert unless VAPID keys are set.

**Addresses** (`geocode.js`, `/api/geocode`, `/api/stops/near`): street search goes through the server to Photon (OpenStreetMap), limited to a South East Queensland bounding box, with an in-memory cache (24 h). The browser never calls Photon. In `public/app.js` an address is pushed into the same `stations` array as stations, with id `addr:<lat>,<lng>:<name>` and `modes: 'address'` (`isAddress()`), so the Plan boxes and Departures treat it as a point: Plan walks from/to it, Departures lists stops within ~10 min walk. Addresses are not saved between visits (no recent-addresses list exists).

**Frontend** (`public/app.js`, one script, no framework, no build): five tabs (Live, Plan, Departures, Alerts, Stats), one shared `state` object.
- URL state: `mode`, `line`, `place`, `station`, `tab`, `at` are read from the query string once on load and written back with `history.replaceState` by `saveUrl()` (no popstate handling; the open trip and planned journey are not in the URL).
- `localStorage` (every access wrapped in try/catch, the app must work with storage blocked): `stopwise-favourites` (saved lines and stops, per browser, no account; lines show on Live, stops on Departures), plus keys for the stop reminder, Plan's access mode and "more time to change", the followed connection, the active Start journey and its push subscription id.

**Other:** `delays.js` (stats aggregation), `lines.js` (line grouping/colours).

## Testing notes

- Tests never touch the network or DB; DB-backed logic is split into pure functions that tests call directly.
- `test/fixtures/*.pb` are real TransLink feeds saved 6 Nov 2026; `realtime.test.js` and the `FEED_FIXTURES` mode depend on them. Don't regenerate casually.

## Workflow constraints (from the owner's global setup)

- `main` is protected: branch per issue -> PR -> CI green -> merge. Never push to main.
- Database changes: Neon dev branch first, then production, then merge. `db/schema.sql` uses `CREATE TABLE IF NOT EXISTS`.
- Test-only UI (e.g. test notification buttons) must show only on localhost.
- Code, commits, PRs and UI text are in English.
