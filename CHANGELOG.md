# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-11

### Added

- Apple WeatherKit as the weather provider of Gladys: current conditions, 24
  hours, 8 days and the official alerts of a chosen country, in metric or US
  units, with the user's own Apple Developer key (.p8, ES256 token).
- One copy per location, read at most once per refresh interval (15 minutes
  by default), a monthly budget of calls, pauses after 429 and errors, all
  kept in `/data` across restarts.
- Credentials refused twice in a row are no longer sent; "Test WeatherKit"
  checks them and lifts the refusal.

[Unreleased]: https://github.com/LM1LC3N7/gladys-apple-weatherkit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-apple-weatherkit/releases/tag/v0.1.1
