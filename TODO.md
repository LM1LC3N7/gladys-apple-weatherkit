# TODO

## Decisions

- Version 0.1.0 set by hand (package.json, lock, manifest, `docker_image`).
- SDK `^0.16.0` (latest on npm on 2026-11-11). Manifest: `gladys_version`
  `>=5.1.0`, category `environment` only, no `keywords`/`countries` (the store
  infers the country filter; WeatherKit covers the world).
- `location: true` only for the test button (it reads the availability at the
  first located house, or at Apple Park when none is located).
- Credentials refused only after two 401/403 in a row (a new token for the
  second): WeatherKit is known to answer one 401 for nothing. The refusal is one
  byte of a salted hash of the ids and of the PUBLIC key in `/data` (review
  r1); credentials changed while running are always tried; after a restart a
  1-in-256 collision is lifted by the test button (documented).
- Other 4xx (400/404) hold back their location for one interval, no global
  pause. A weather request ends within 13 s of the 15 s of Gladys.
- The copies in `/data` are filed under a salted hash of the rounded location
  (the docs say it can be brute-forced with the salt beside it).
- Every failure pauses (429: Retry-After against Apple's Date, 60 s - 6 h;
  others: 60 s doubled up to 1 h); a copy under 1 h is served meanwhile, with
  its own date. No copy: an error, so Gladys falls back to its next provider.
- Monthly budget counted locally (UTC month), 50,000 by default: Apple's own
  counter is not readable through the REST API.
- Alert severity "unknown" kept as "minor"; phenomenon guessed from the title
  (en/fr/de/es); the long text of an alert is not fetched (one call per alert).
- Coordinates rounded to 3 decimals before they leave; none kept in `/data`.
- Haze and Smoke shown as fog, Dust as sandstorm, Hot/Frigid as clear.

## Before announcing

- [ ] Test with a real Apple Developer account on a real Gladys 5.3: the
      weather widget (current, hours, days, alerts), the assistant, the
      weather-alert scene trigger, the test button.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store.

## To confirm with a real account

- [ ] A key pasted in the Gladys secret field keeps its line breaks (the
      parser also accepts one line or literal `\n`).
- [ ] `windSpeedAvg` / `windGustSpeedMax` / `daytimeForecast` in the daily
      forecast (used when present).
- [ ] The language of the alert titles follows the `language` of the URL (the
      phenomenon detection reads en/fr/de/es).
- [ ] What WeatherKit answers for a country without alerts (no
      `weatherAlerts` key, or an empty list: both handled).
- [ ] The body of a 401/403 (the reason is not shown, only the status).

## Ideas

- The next-hour precipitation (`forecastNextHour`) as a scene trigger.
- The long text of the alerts (`/api/v1/weatherAlert/{language}/{id}`), once a
  day, if the quota allows.
- The Apple Weather mark in the widget, when Gladys can show provider
  attribution.
