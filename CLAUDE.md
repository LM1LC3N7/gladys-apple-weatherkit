# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `weather`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.16). It
answers `onWeatherGet` with the pivot weather format, from the **Apple
WeatherKit REST API**, signed with the user's own Apple Developer key.
Unofficial: not affiliated with Apple. No devices, no states.

## Commands

```bash
npm install
npm test                 # node --test --test-timeout=60000
npm run lint
npm run format:check
npm run audit            # npm audit --omit=dev
node scripts/mutants.mjs # mutants of scripts/mutants.json, one at a time (use memcap)
```

## Architecture

```
index.js            SDK wiring only (handlers registered before connect())
src/app.js          WeatherKitApp: copies per location, pacing, budget,
                    pauses, refusal, /data, status, test button
src/config.js       config_schema normalized (invalid fields named, never echoed)
src/jwt.js          .p8 key parsing (EC P-256 only), ES256 token
src/weatherkit.js   URLs, Retry-After (pure)
src/pivot.js        answer -> trimmed snapshot -> pivot weather, units (pure)
src/conditions.js   condition codes, severities, alert phenomena (pure)
src/store.js        /data/state.json: read (missing = empty, unreadable = error),
                    one write queue, atomic rename
src/http.js         the only network access: timeout, no redirect, 1 MB cap
src/i18n.js         runtime texts (en/fr)
test/helpers/       clock that advances, fake fetch, memory /data, generated keys
```

## Rules

- The private key and the token never reach a log, a status, an error or
  `/data`. Field errors name the field, never the value.
- Decisions (copy age, pauses, token reuse, test spacing) use the injected
  `monotonic` clock; the wall clock only signs the token, names the month,
  dates `/data` and drops past hours.
- A 401/403 is a refusal only twice in a row; `/data` keeps one byte of a
  salted hash of the ids and of the public key; credentials changed while
  running are always tried (the full id of the refused set is kept in memory).
- Other 4xx hold back their location only, for one interval; no global pause.
- A weather request ends within 13 s (no call leaves with less than 1.5 s).
- Every call is counted in `/data` before it leaves; every failure pauses.
- An unknown value stays out of the answer, never 0.
- Unit tests for every change; `npm run format:check`, `lint`, `test` before
  a commit. Update `docs/`, `README.md`, `TODO.md` and `CHANGELOG.md` with it.
