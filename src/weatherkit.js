// -----------------------------------------------------------------------------
// The URLs of the WeatherKit REST API (pure). Coordinates are rounded to 3
// decimals (about 100 m) before they leave Gladys.
// -----------------------------------------------------------------------------

import { API_BASE } from './constants.js';

export const round3 = (value) => Math.round(value * 1000) / 1000;

const hourFloor = (ms) => new Date(Math.floor(ms / 3600_000) * 3600_000);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * /api/v1/weather: current conditions, the next 25 hours, 9 days, and the
 * alerts when a country is given (WeatherKit needs it for them).
 */
export function weatherUrl({ latitude, longitude, language, country, alerts, nowMs }) {
  const sets = ['currentWeather', 'forecastHourly', 'forecastDaily'];
  if (alerts && country) sets.push('weatherAlerts');
  const start = hourFloor(nowMs);
  const params = new URLSearchParams({
    dataSets: sets.join(','),
    hourlyStart: iso(start),
    hourlyEnd: iso(new Date(start.getTime() + 25 * 3600_000)),
    dailyEnd: iso(new Date(start.getTime() + 9 * 86_400_000)),
  });
  if (alerts && country) params.set('countryCode', country);
  return `${API_BASE}/api/v1/weather/${language}/${round3(latitude)}/${round3(longitude)}?${params}`;
}

/** /api/v1/availability: the data sets offered at a location. */
export function availabilityUrl({ latitude, longitude, country }) {
  const query = country ? `?${new URLSearchParams({ country })}` : '';
  return `${API_BASE}/api/v1/availability/${round3(latitude)}/${round3(longitude)}${query}`;
}

/**
 * Retry-After in milliseconds: delta-seconds, or an HTTP date compared with
 * the server's own Date header (never with the local clock). Undefined when
 * unreadable.
 */
export function retryAfterMs(value, serverDate) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (/^\d{1,9}$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  const now = typeof serverDate === 'string' ? Date.parse(serverDate) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(now)) return undefined;
  return Math.max(0, at - now);
}
