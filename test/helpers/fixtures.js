// -----------------------------------------------------------------------------
// Test material: an EC P-256 key made on the fly (never a real one), a
// WeatherKit answer shaped after the REST API documentation, a fake fetch,
// a memory /data and a logger that keeps every line.
// -----------------------------------------------------------------------------

import { generateKeyPairSync } from 'node:crypto';
import { setFetch } from '../../src/http.js';

export function makeKey(curve = 'prime256v1') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: curve });
  return {
    pem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKey,
  };
}

export const KEY = makeKey();
export const KEY_BODY = KEY.pem.split('\n')[1];

export const CONFIG = {
  team_id: 'A1B2C3D4E5',
  key_id: '9Z8Y7X6W5V',
  service_id: 'com.example.weather',
  private_key: KEY.pem,
  country: 'FR',
};

export const HOME = {
  id: 1,
  name: 'Home',
  selector: 'home',
  latitude: 48.85661,
  longitude: 2.35222,
};
export const REQUEST = { latitude: 48.85661, longitude: 2.35222, language: 'fr', units: 'metric' };

const hour = (base, i) => new Date(Date.parse(base) + i * 3600_000).toISOString();
const day = (base, i) => new Date(Date.parse(base) + i * 86_400_000).toISOString();

/** A WeatherKit answer at `nowIso` (current hour start). */
export function weatherBody(nowIso = '2026-11-11T10:00:00Z', patch = {}) {
  const dayStart = `${nowIso.slice(0, 10)}T00:00:00Z`;
  return {
    currentWeather: {
      name: 'CurrentWeather',
      metadata: { latitude: 48.857, longitude: 2.352, units: 'm', version: 1 },
      asOf: nowIso,
      cloudCover: 0.62,
      conditionCode: 'MostlyCloudy',
      daylight: true,
      humidity: 0.81,
      precipitationIntensity: 0,
      pressure: 1012.4,
      pressureTrend: 'steady',
      temperature: 11.6,
      temperatureApparent: 9.9,
      temperatureDewPoint: 8.5,
      uvIndex: 1,
      visibility: 23500,
      windDirection: 225,
      windGust: 36,
      windSpeed: 18,
      ...patch.current,
    },
    forecastHourly: {
      name: 'HourlyForecast',
      hours: Array.from({ length: 26 }, (_, i) => ({
        forecastStart: hour(nowIso, i),
        cloudCover: 0.5,
        conditionCode: i === 3 ? 'HeavyRain' : 'Cloudy',
        daylight: i < 6,
        humidity: 0.8,
        precipitationAmount: i === 3 ? 4.2 : 0,
        precipitationChance: i === 3 ? 0.9 : 0.1,
        pressure: 1012,
        temperature: 11 + i / 10,
        temperatureApparent: 10,
        uvIndex: 1,
        windDirection: 220,
        windGust: 30,
        windSpeed: 14.4,
      })),
    },
    forecastDaily: {
      name: 'DailyForecast',
      days: Array.from({ length: 10 }, (_, i) => ({
        forecastStart: day(dayStart, i),
        forecastEnd: day(dayStart, i + 1),
        conditionCode: i === 1 ? 'Snow' : 'PartlyCloudy',
        maxUvIndex: 2,
        precipitationAmount: 1.5,
        precipitationChance: 0.35,
        sunrise: new Date(Date.parse(day(dayStart, i)) + 7 * 3600_000).toISOString(),
        sunset: new Date(Date.parse(day(dayStart, i)) + 16 * 3600_000).toISOString(),
        temperatureMax: 13 + i,
        temperatureMin: 5,
        daytimeForecast: { humidity: 0.7, windDirection: 200, windSpeed: 20 },
      })),
    },
    weatherAlerts: {
      alerts: [
        {
          id: 'a-1',
          areaName: 'Paris',
          countryCode: 'FR',
          description: 'Orange vigilance for thunderstorms',
          effectiveTime: '2026-11-11T08:00:00Z',
          expireTime: '2026-11-11T20:00:00Z',
          eventOnsetTime: '2026-11-11T12:00:00Z',
          eventEndTime: '2026-11-11T18:00:00Z',
          severity: 'severe',
          source: 'Météo-France',
          precedence: 0,
        },
        {
          id: 'a-2',
          areaName: 'Paris',
          countryCode: 'FR',
          description: 'Yellow vigilance for wind',
          expireTime: '2026-11-11T09:00:00Z',
          severity: 'moderate',
          source: 'Météo-France',
          precedence: 1,
        },
        {
          id: 'a-3',
          description: 'Special notice',
          severity: 'unknown',
        },
      ],
      ...patch.alerts,
    },
  };
}

export const json = (body, { status = 200, headers = {} } = {}) => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: {
    'content-type': 'application/json',
    date: 'Wed, 11 Nov 2026 10:00:00 GMT',
    ...headers,
  },
});

/**
 * Replace fetch: `handler(call)` returns `{ status, body, headers }`, throws,
 * or never resolves (the request then ends on its AbortSignal).
 */
export function installFetch(handler) {
  const calls = [];
  const previous = setFetch(async (url, init) => {
    const call = { url: new URL(url), init };
    calls.push(call);
    const result = await Promise.race([
      handler(call),
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }),
    ]);
    return new Response(result.body ?? '', {
      status: result.status ?? 200,
      headers: result.headers ?? {},
    });
  });
  return { calls, restore: () => setFetch(previous) };
}

/** A /data in memory; `broken`/`slow` make reads fail or hang. */
export function memoryFs(initial) {
  const files = new Map(initial ? [['/data/state.json', JSON.stringify(initial)]] : []);
  const fs = {
    files,
    reads: 0,
    writes: [],
    broken: false,
    slow: false,
    failWrites: false,
    async readFile(path) {
      fs.reads += 1;
      if (fs.slow) return new Promise(() => {});
      if (fs.broken) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(path);
    },
    async writeFile(path, text) {
      if (fs.failWrites) throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
      fs.writes.push(text);
      files.set(path, text);
    },
    async rename(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    },
    state: () => JSON.parse(files.get('/data/state.json') ?? '{}'),
  };
  return fs;
}

export function memoryLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}`,
      );
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}
