// -----------------------------------------------------------------------------
// Endpoints, pacing and limits. Every delay is in milliseconds.
// -----------------------------------------------------------------------------

export const VERSION = '0.1.0';
export const REPO_URL = 'https://github.com/LM1LC3N7/gladys-apple-weatherkit';
export const USER_AGENT = `gladys-apple-weatherkit/${VERSION} (+${REPO_URL})`;

export const API_BASE = 'https://weatherkit.apple.com';

// One answer of WeatherKit (current + 25 hours + 9 days + alerts) is about
// 30 KB: 1 MB is a generous cap, cut before the whole body is read.
export const MAX_BODY_BYTES = 1_000_000;
// Gladys waits 15 s for the weather: one request and its retry fit.
export const HTTP_TIMEOUT = 6_000;
// Everything of one weather request (waiting for /data, counting, the call and
// its retry) ends within this, under the 15 s of Gladys.
export const ANSWER_BUDGET = 13_000;
// A call with less time than this left does not leave.
export const MIN_CALL_TIME = 1_500;

// The signed token (JWT): valid 1 hour at Apple, reused 30 minutes here.
export const TOKEN_LIFETIME_S = 3600;
export const TOKEN_REUSE = 30 * 60_000;

// Pacing per location: never read faster than this (minutes, user option).
export const REFRESH_DEFAULT_MIN = 15;
export const REFRESH_MIN_MIN = 10;
export const REFRESH_MAX_MIN = 120;
// A copy older than this is never served, even when WeatherKit is down.
export const STALE_LIMIT = 60 * 60_000;

// Monthly budget of calls (Apple includes 500,000 per month per team).
export const BUDGET_DEFAULT = 50_000;
export const BUDGET_MIN = 1_000;
export const BUDGET_MAX = 500_000;

// Pauses after an error: 429 follows Retry-After within 60 s - 6 h, the
// others double from 60 s up to 1 h.
export const PAUSE_MIN = 60_000;
export const PAUSE_MAX_429 = 6 * 3600_000;
export const PAUSE_MAX_ERROR = 3600_000;

// /data: read within 2 s, else re-read every 10 s (one read at a time).
export const STATE_READ_TIMEOUT = 2_000;
export const STATE_RETRY = 10_000;
// A weather request waits at most this long for /data.
export const STATE_WAIT = 2_000;
// getConfig() failing: retried from 5 s, doubling, up to 5 minutes.
export const CONFIG_RETRY_MIN = 5_000;
export const CONFIG_RETRY_MAX = 5 * 60_000;
// The test button: one call per 30 s at most.
export const TEST_SPACING = 30_000;

// At most this many locations kept (memory and /data).
export const MAX_CACHE_ENTRIES = 8;
// Gladys keeps 24 hours and 8 days.
export const MAX_HOURS = 24;
export const MAX_DAYS = 8;
export const MAX_ALERTS = 10;

// The test button reads the availability here when no house is located
// (Apple Park, Cupertino: no personal data).
export const FALLBACK_POINT = { latitude: 37.335, longitude: -122.009 };

export const ACTIONS = { TEST: 'test_connection' };
