# gladys-apple-weatherkit

**Unofficial** [Gladys Assistant](https://gladysassistant.com) integration (type `weather`) that makes
**Apple WeatherKit** the weather provider of Gladys: current conditions, 24-hour and 8-day forecasts and the
official alerts of a chosen country, with **your own Apple Developer key**. Not affiliated with Apple.

> Never tested with a real Apple Developer account: written from the WeatherKit REST API documentation.

- User guide: [English](docs/en.md) · [Français](docs/fr.md)
- Needs an Apple Developer Program membership (99 USD a year), which includes 500,000 WeatherKit calls a month
  for the whole team. The integration reads each location at most once per refresh interval (15 minutes by
  default, about 3,000 calls a month per location) and stops at a monthly budget (50,000 by default).
- Data: Apple Weather. Attribution and data sources: <https://weatherkit.apple.com/legal-attribution.html>.

## How it works

|                              |                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gladys asks (`onWeatherGet`) | answered from the copy of the location if younger than the interval, else one call to `/api/v1/weather/{lang}/{lat}/{lon}` (coordinates rounded to 3 decimals) |
| Token                        | JWT ES256 signed in the container with node:crypto (`kid`, `id` = team.service, `iss`, `sub`, 1 hour)                                                          |
| 401/403                      | tried once more with a new token; twice in a row = refused, never sent again on its own (one byte of a salted hash of ids + public key in `/data`)             |
| 429 / errors                 | pause: `Retry-After` (60 s - 6 h) / 60 s doubled up to 1 h; the copy under 1 hour is served meanwhile, with its own date                                       |
| `/data/state.json`           | month counter, pause, refused hash, last answers under a salted hash of the location (no secret); unreadable = nothing sent, read again every 10 s             |
| Test button                  | one call to `/api/v1/availability` at the first located house; lifts a refusal on success; once per 30 s                                                       |

## Development

```bash
npm install
npm test             # node --test (the SDK's fake Gladys, a fake WeatherKit, a clock that advances)
npm run lint
npm run format:check
npm run audit
node scripts/mutants.mjs   # mutation check of the guards (not in the CI)
node scripts/cover.mjs cover.png
```

Code layout and rules: [CLAUDE.md](CLAUDE.md). Changes: [CHANGELOG.md](CHANGELOG.md). Open points:
[TODO.md](TODO.md).

## License

Apache-2.0 (see `LICENSE`). The token and request shape follow the MIT-licensed
[python-weatherkit](https://github.com/tjhorner/python-weatherkit): see `THIRD_PARTY_NOTICES.md`.
