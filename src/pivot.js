// -----------------------------------------------------------------------------
// A WeatherKit answer -> a trimmed snapshot (what the cache keeps) -> the
// pivot weather of Gladys in the requested unit system (pure).
//
// WeatherKit answers in metric only: °C, km/h, hPa (mb), m, mm, and 0-1
// fractions for humidity, cloud cover and precipitation chance.
// -----------------------------------------------------------------------------

import { MAX_ALERTS, MAX_DAYS, MAX_HOURS } from './constants.js';
import { SEVERITY_RANK, toAlertType, toCondition, toSeverity } from './conditions.js';

// Strict values: a missing, null, text or non-finite value stays unknown.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const fraction = (v) => (num(v) !== undefined && v >= 0 && v <= 1 ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const date = (v) => {
  if (typeof v !== 'string' || v.length > 40) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const str = (v, max) =>
  typeof v === 'string' ? v.replace(CONTROL, ' ').trim().slice(0, max) || undefined : undefined;
const code = (v) => (typeof v === 'string' && v.length <= 40 ? v : undefined);
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export class AnswerError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'AnswerError';
  }
}

/** Parse and trim an answer of /api/v1/weather; throws an AnswerError. */
export function parseWeather(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AnswerError('unreadable answer');
  }
  const cw = obj(obj(body).currentWeather);
  const current = {
    asOf: date(cw.asOf),
    temperature: num(cw.temperature),
    apparent: num(cw.temperatureApparent),
    dewPoint: num(cw.temperatureDewPoint),
    humidity: fraction(cw.humidity),
    pressure: num(cw.pressure),
    windSpeed: num(cw.windSpeed),
    windGust: num(cw.windGust),
    windDirection: num(cw.windDirection),
    visibility: num(cw.visibility),
    cloudCover: fraction(cw.cloudCover),
    uvIndex: num(cw.uvIndex),
    condition: code(cw.conditionCode),
    daylight: bool(cw.daylight),
  };
  if (current.asOf === undefined || current.temperature === undefined) {
    throw new AnswerError('answer without current weather');
  }
  const hours = list(obj(body.forecastHourly).hours)
    .slice(0, 48)
    .map((h) => ({
      start: date(h?.forecastStart),
      temperature: num(h?.temperature),
      apparent: num(h?.temperatureApparent),
      humidity: fraction(h?.humidity),
      pressure: num(h?.pressure),
      windSpeed: num(h?.windSpeed),
      windGust: num(h?.windGust),
      windDirection: num(h?.windDirection),
      cloudCover: fraction(h?.cloudCover),
      precipitation: num(h?.precipitationAmount),
      precipitationChance: fraction(h?.precipitationChance),
      uvIndex: num(h?.uvIndex),
      condition: code(h?.conditionCode),
      daylight: bool(h?.daylight),
    }))
    .filter((h) => h.start !== undefined && h.temperature !== undefined);
  const days = list(obj(body.forecastDaily).days)
    .slice(0, 12)
    .map((d) => {
      const daytime = obj(d?.daytimeForecast);
      return {
        start: date(d?.forecastStart),
        end: date(d?.forecastEnd),
        min: num(d?.temperatureMin),
        max: num(d?.temperatureMax),
        condition: code(d?.conditionCode),
        precipitation: num(d?.precipitationAmount),
        precipitationChance: fraction(d?.precipitationChance),
        uvIndex: num(d?.maxUvIndex),
        humidity: fraction(daytime.humidity),
        windSpeed: num(d?.windSpeedAvg) ?? num(daytime.windSpeed),
        windGust: num(d?.windGustSpeedMax),
        windDirection: num(daytime.windDirection),
        sunrise: date(d?.sunrise),
        sunset: date(d?.sunset),
      };
    })
    .filter((d) => d.start !== undefined && d.min !== undefined && d.max !== undefined);
  const seen = new Set();
  const alerts = list(obj(body.weatherAlerts).alerts)
    .slice(0, 50)
    .map((a) => ({
      id: str(a?.id, 100),
      title: str(a?.description, 100),
      area: str(a?.areaName, 200),
      source: str(a?.source, 200),
      severity: toSeverity(a?.severity),
      precedence: num(a?.precedence),
      start: date(a?.eventOnsetTime) ?? date(a?.effectiveTime),
      end: date(a?.eventEndTime) ?? date(a?.expireTime),
      expires: date(a?.expireTime),
    }))
    .filter((a) => {
      if (a.title === undefined) return false;
      const key = a.id ?? `${a.title}|${a.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { current, hours, days, alerts };
}

const round = (v, digits = 1) => (v === undefined ? undefined : Number(v.toFixed(digits)));
const percent = (v) => (v === undefined ? undefined : Math.round(v * 100));

function converters(units) {
  if (units === 'us') {
    return {
      temp: (c) => (c === undefined ? undefined : round((c * 9) / 5 + 32)),
      speed: (kmh) => (kmh === undefined ? undefined : round(kmh / 1.609344)),
      length: (mm) => (mm === undefined ? undefined : round(mm / 25.4, 2)),
      distance: (m) => (m === undefined ? undefined : round(m / 1609.344)),
    };
  }
  return {
    temp: (c) => round(c),
    speed: (kmh) => (kmh === undefined ? undefined : round(kmh / 3.6)),
    length: (mm) => round(mm),
    distance: (m) => (m === undefined ? undefined : round(m / 1000)),
  };
}

// Only the known fields: an unknown value is left out, never sent as 0.
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * The pivot weather. `nowMs` (wall clock) drops the past hours and days of a
 * kept copy; `serverNowMs` (Apple's Date header + the time elapsed since)
 * drops the expired alerts; without it no alert is called expired.
 */
export function toPivot(snapshot, { units, nowMs, serverNowMs, alerts: withAlerts }) {
  const u = converters(units);
  const c = snapshot.current;
  const pivot = defined({
    temperature: u.temp(c.temperature),
    weather: toCondition(c.condition),
    datetime: c.asOf,
    apparent_temperature: u.temp(c.apparent),
    dew_point: u.temp(c.dewPoint),
    humidity: percent(c.humidity),
    pressure: round(c.pressure),
    wind_speed: u.speed(c.windSpeed),
    wind_gust: u.speed(c.windGust),
    wind_direction: round(c.windDirection, 0),
    visibility: u.distance(c.visibility),
    cloud_cover: percent(c.cloudCover),
    uv_index: round(c.uvIndex, 0),
    is_day: c.daylight,
  });
  pivot.hours = snapshot.hours
    .filter((h) => Date.parse(h.start) + 3600_000 > nowMs)
    .slice(0, MAX_HOURS)
    .map((h) =>
      defined({
        temperature: u.temp(h.temperature),
        weather: toCondition(h.condition),
        datetime: h.start,
        apparent_temperature: u.temp(h.apparent),
        humidity: percent(h.humidity),
        pressure: round(h.pressure),
        wind_speed: u.speed(h.windSpeed),
        wind_gust: u.speed(h.windGust),
        wind_direction: round(h.windDirection, 0),
        cloud_cover: percent(h.cloudCover),
        precipitation: u.length(h.precipitation),
        precipitation_probability: percent(h.precipitationChance),
        uv_index: round(h.uvIndex, 0),
        is_day: h.daylight,
      }),
    );
  pivot.days = snapshot.days
    .filter((d) => (d.end ? Date.parse(d.end) : Date.parse(d.start) + 86_400_000) > nowMs)
    .slice(0, MAX_DAYS)
    .map((d) =>
      defined({
        temperature_min: u.temp(d.min),
        temperature_max: u.temp(d.max),
        datetime: d.start,
        weather: toCondition(d.condition),
        humidity: percent(d.humidity),
        wind_speed: u.speed(d.windSpeed),
        wind_gust: u.speed(d.windGust),
        wind_direction: round(d.windDirection, 0),
        precipitation: u.length(d.precipitation),
        precipitation_probability: percent(d.precipitationChance),
        uv_index: round(d.uvIndex, 0),
        sunrise: d.sunrise,
        sunset: d.sunset,
      }),
    );
  // The sun of the current conditions: the day that holds `asOf`.
  const asOf = Date.parse(c.asOf);
  const today = snapshot.days.find(
    (d) => d.end && Date.parse(d.start) <= asOf && asOf < Date.parse(d.end),
  );
  if (today?.sunrise) pivot.sunrise = today.sunrise;
  if (today?.sunset) pivot.sunset = today.sunset;
  if (withAlerts) {
    pivot.alerts = snapshot.alerts
      .filter(
        (a) => !(serverNowMs !== undefined && a.expires && Date.parse(a.expires) <= serverNowMs),
      )
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          (a.precedence ?? 99) - (b.precedence ?? 99),
      )
      .slice(0, MAX_ALERTS)
      .map((a) =>
        defined({
          severity: a.severity,
          event: a.title,
          type: toAlertType(a.title),
          description: [a.area, a.source].filter(Boolean).join(' - ') || undefined,
          start: a.start,
          end: a.end,
        }),
      );
  }
  return pivot;
}

/** Parse an answer of /api/v1/availability: the list of data sets. */
export function parseAvailability(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AnswerError('unreadable answer');
  }
  if (!Array.isArray(body)) throw new AnswerError('unreadable answer');
  return body.filter((s) => typeof s === 'string' && /^[A-Za-z]{1,40}$/.test(s)).slice(0, 20);
}
