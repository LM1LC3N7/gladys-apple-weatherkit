// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, a fake WeatherKit, a memory
// /data and a clock that advances.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WeatherKitApp } from '../src/app.js';
import { ACTIONS } from '../src/constants.js';
import { Store } from '../src/store.js';
import { testClock } from './helpers/clock.js';
import {
  CONFIG,
  HOME,
  KEY,
  KEY_BODY,
  REQUEST,
  installFetch,
  json,
  makeKey,
  memoryFs,
  memoryLogger,
  weatherBody,
} from './helpers/fixtures.js';

const MIN = 60_000;
let fake;
const apps = [];
afterEach(async () => {
  fake?.restore();
  for (const app of apps.splice(0)) await app.stop();
});

async function setup({
  config = CONFIG,
  initial,
  fs,
  houses = [HOME],
  handler,
  clock,
  autoStart = true,
} = {}) {
  clock ??= testClock();
  fs ??= memoryFs(initial);
  const state = { handler: handler ?? (() => json(weatherBody())) };
  fake?.restore();
  fake = installFetch((call) => state.handler(call));
  const gladys = createFakeGladys({ selector: 'apple-weatherkit', config, houses });
  const logger = memoryLogger();
  const app = new WeatherKitApp({
    gladys,
    logger,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: new Store({ fs }),
  });
  apps.push(app);
  gladys.onWeatherGet((options) => app.getWeather(options));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  await gladys.connect();
  if (autoStart) await app.onConnected();
  await clock.settle();
  return { app, gladys, clock, fs, logger, state };
}

const weatherCalls = () => fake.calls.filter((c) => c.url.pathname.startsWith('/api/v1/weather/'));
// The status leaves through the host API: let it arrive.
const status = async (gladys) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return gladys.fake.connectionStatus;
};
const statuses = (gladys) => gladys.fake.connectionStatuses;

test('not configured: nothing sent, the status says what to enter', async () => {
  const { gladys } = await setup({ config: {} });
  const ack = await gladys.fake.weatherGet(REQUEST);
  assert.equal(ack.success, false);
  assert.equal(fake.calls.length, 0);
  assert.equal((await status(gladys)).connected, false);
  assert.match((await status(gladys)).message.en, /Team ID, Key ID, Service ID and private key/);
});

test('an invalid key is named, never repeated; nothing sent', async () => {
  const { gladys, logger } = await setup({
    config: { ...CONFIG, private_key: 'MIIBnotakey==', team_id: 'short' },
  });
  const ack = await gladys.fake.weatherGet(REQUEST);
  assert.equal(ack.success, false);
  assert.equal(fake.calls.length, 0);
  assert.match((await status(gladys)).message.en, /Team ID, private key \(\.p8\)/);
  assert.doesNotMatch((await status(gladys), JSON.stringify(statuses(gladys))), /MIIBnotakey/);
  assert.doesNotMatch(logger.lines.join('\n'), /MIIBnotakey/);
});

test('the weather: one signed call, metric conversions, alerts typed, copy reused', async () => {
  const { gladys, clock } = await setup();
  const ack = await gladys.fake.weatherGet(REQUEST);
  assert.equal(ack.success, true, ack.error);
  const w = ack.data.weather;
  assert.equal(w.temperature, 11.6);
  assert.equal(w.weather, 'cloud');
  assert.equal(w.datetime, '2026-11-11T10:00:00.000Z');
  assert.equal(w.humidity, 81);
  assert.equal(w.cloud_cover, 62);
  assert.equal(w.wind_speed, 5); // 18 km/h
  assert.equal(w.wind_gust, 10); // 36 km/h
  assert.equal(w.visibility, 23.5);
  assert.equal(w.pressure, 1012.4);
  assert.equal(w.is_day, true);
  assert.equal(w.sunrise, '2026-11-11T07:00:00.000Z');
  assert.equal(w.hours.length, 24);
  assert.equal(w.hours[3].weather, 'pouring');
  assert.equal(w.hours[3].precipitation, 4.2);
  assert.equal(w.hours[3].precipitation_probability, 90);
  assert.equal(w.hours[3].wind_speed, 4);
  assert.equal(w.days.length, 8);
  assert.equal(w.days[1].weather, 'snow');
  // the expired alert (09:00 < server Date 10:00) is dropped; "unknown" kept as minor
  assert.deepEqual(
    w.alerts.map((a) => [a.severity, a.type ?? null, a.event]),
    [
      ['severe', 'thunderstorm', 'Orange vigilance for thunderstorms'],
      ['minor', null, 'Special notice'],
    ],
  );
  assert.equal(w.alerts[0].description, 'Paris - Météo-France');
  assert.equal(w.alerts[0].start, '2026-11-11T12:00:00.000Z');

  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.url.origin, 'https://weatherkit.apple.com');
  assert.equal(call.url.pathname, '/api/v1/weather/fr/48.857/2.352');
  assert.equal(
    call.url.searchParams.get('dataSets'),
    'currentWeather,forecastHourly,forecastDaily,weatherAlerts',
  );
  assert.equal(call.url.searchParams.get('countryCode'), 'FR');
  assert.equal(call.init.redirect, 'manual');
  assert.match(call.init.headers['User-Agent'], /^gladys-apple-weatherkit\/0\.1\.0 \(\+https:/);
  const token = call.init.headers.Authorization.replace(/^Bearer /, '');
  const [h, p, s] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual(header, {
    alg: 'ES256',
    kid: '9Z8Y7X6W5V',
    id: 'A1B2C3D4E5.com.example.weather',
  });
  assert.equal(payload.iss, 'A1B2C3D4E5');
  assert.equal(payload.sub, 'com.example.weather');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: KEY.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    ),
  );
  assert.equal((await status(gladys)).connected, true);

  // Within the refresh interval: the copy, no call.
  await clock.advance(14 * MIN);
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal(fake.calls.length, 1);
  await clock.advance(1 * MIN);
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal(fake.calls.length, 2);
});

test('us units: °F, mph, inches, miles; hPa kept', async () => {
  const { gladys } = await setup();
  const w = (await gladys.fake.weatherGet({ ...REQUEST, units: 'us' })).data.weather;
  assert.equal(w.temperature, 52.9);
  assert.equal(w.wind_speed, 11.2);
  assert.equal(w.visibility, 14.6);
  assert.equal(w.pressure, 1012.4);
  assert.equal(w.hours[3].precipitation, 0.17);
  assert.equal(w.days[0].temperature_max, 55.4);
});

test('unknown values stay unknown: never sent as 0', async () => {
  const { gladys } = await setup({
    handler: () =>
      json(
        weatherBody(undefined, {
          current: { humidity: null, windSpeed: '12', uvIndex: undefined, cloudCover: 1.7 },
        }),
      ),
  });
  const w = (await gladys.fake.weatherGet(REQUEST)).data.weather;
  for (const field of ['humidity', 'wind_speed', 'uv_index', 'cloud_cover']) {
    assert.ok(!(field in w), field);
  }
});

test('no country: no alerts asked, none answered', async () => {
  const { gladys } = await setup({ config: { ...CONFIG, country: '' } });
  const w = (await gladys.fake.weatherGet(REQUEST)).data.weather;
  assert.ok(!('alerts' in w));
  assert.equal(fake.calls[0].url.searchParams.get('dataSets').includes('weatherAlerts'), false);
  assert.equal(fake.calls[0].url.searchParams.get('countryCode'), null);
});

test('alerts turned off: not asked even with a country', async () => {
  const { gladys } = await setup({ config: { ...CONFIG, alerts: false } });
  await gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls[0].url.searchParams.get('dataSets').includes('weatherAlerts'), false);
});

test('without a readable Date header, no alert is called expired', async () => {
  const { gladys } = await setup({
    handler: () => json(weatherBody(), { headers: { date: 'nope' } }),
  });
  const w = (await gladys.fake.weatherGet(REQUEST)).data.weather;
  assert.equal(w.alerts.length, 3);
});

test('two requests at once: one call', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { gladys } = await setup({ handler: async () => (await gate, json(weatherBody())) });
  const both = Promise.all([gladys.fake.weatherGet(REQUEST), gladys.fake.weatherGet(REQUEST)]);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const acks = await both;
  assert.deepEqual(
    acks.map((a) => a.success),
    [true, true],
  );
  assert.equal(fake.calls.length, 1);
});

test('a 401 once is not a refusal: one new token, then the answer', async () => {
  let n = 0;
  const { gladys, fs } = await setup({
    handler: () =>
      n++ === 0 ? json({ reason: 'NOT_ENABLED' }, { status: 401 }) : json(weatherBody()),
  });
  const ack = await gladys.fake.weatherGet(REQUEST);
  assert.equal(ack.success, true);
  assert.equal(fake.calls.length, 2);
  const auth = fake.calls.map((c) => c.init.headers.Authorization);
  assert.notEqual(auth[0], auth[1]);
  assert.equal(fs.state().refused, null);
  assert.equal(fs.state().calls, 2);
});

test('refused twice in a row: recorded (salted hash), never sent again on its own', async () => {
  const { gladys, fs, clock, logger } = await setup({ handler: () => json({}, { status: 401 }) });
  const ack = await gladys.fake.weatherGet(REQUEST);
  assert.equal(ack.success, false);
  assert.equal(fake.calls.length, 2);
  assert.match((await status(gladys)).message.en, /refused these credentials twice/);
  const saved = fs.state();
  assert.match(saved.refused.id, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(saved), new RegExp(KEY_BODY.slice(0, 20)));

  // Hours later, a restart: still nothing sent with them.
  await clock.advance(5 * 3600_000);
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, false);
  assert.equal(fake.calls.length, 2);
  const again = await setup({ fs, clock, handler: () => json({}, { status: 401 }) });
  assert.equal((await again.gladys.fake.weatherGet(REQUEST)).success, false);
  assert.equal(fake.calls.length, 0);
  assert.match((await status(again.gladys)).message.en, /refused these credentials/);

  // New credentials (another key): always tried.
  const other = makeKey();
  const fixed = await setup({ fs, clock, config: { ...CONFIG, private_key: other.pem } });
  assert.equal((await fixed.gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal(fake.calls.length, 1);
  assert.doesNotMatch(logger.lines.join('\n'), new RegExp(KEY_BODY.slice(0, 20)));
});

test('the test button tries refused credentials (a click) and lifts the refusal', async () => {
  const { gladys, fs, state } = await setup({ handler: () => json({}, { status: 403 }) });
  await gladys.fake.weatherGet(REQUEST);
  assert.ok(fs.state().refused);
  state.handler = (call) =>
    call.url.pathname.startsWith('/api/v1/availability/')
      ? json(['currentWeather', 'forecastDaily', 'forecastHourly', 'weatherAlerts'])
      : json(weatherBody());
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.match(ack.data.message.en, /accepted the credentials/);
  assert.match(ack.data.message.en, /Alerts available for FR/);
  assert.equal(fake.calls.at(-1).url.pathname, '/api/v1/availability/48.857/2.352');
  assert.equal(fake.calls.at(-1).url.searchParams.get('country'), 'FR');
  assert.equal(fs.state().refused, null);
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal((await status(gladys)).connected, true);
});

test('the test button: once per 30 s, and never during a pause', async () => {
  const { gladys, clock, state } = await setup({ houses: [] });
  state.handler = () => json(['currentWeather']);
  const first = await gladys.fake.action(ACTIONS.TEST);
  assert.match(first.data.message.en, /accepted/);
  assert.match(first.data.message.en, /No alerts from WeatherKit for FR/);
  // no located house: Apple Park, no personal data
  assert.equal(fake.calls[0].url.pathname, '/api/v1/availability/37.335/-122.009');
  const second = await gladys.fake.action(ACTIONS.TEST);
  assert.match(second.data.message.en, /less than 30 s ago/);
  assert.equal(fake.calls.length, 1);
  await clock.advance(31_000);
  state.handler = () => json({}, { status: 429, headers: { 'retry-after': '600' } });
  await gladys.fake.action(ACTIONS.TEST);
  await clock.advance(31_000);
  const houseReads = () => gladys.fake.requests.filter((r) => r.path.startsWith('/house')).length;
  const before = houseReads();
  const paused = await gladys.fake.action(ACTIONS.TEST);
  assert.match(paused.data.message.en, /HTTP 429/);
  assert.equal(fake.calls.length, 2);
  // refused before anything: no house read, the 30 s spacing not used up
  assert.equal(houseReads(), before);
  await clock.advance(600_000 - 31_000 + 1_000);
  state.handler = () => json(['currentWeather']);
  assert.match((await gladys.fake.action(ACTIONS.TEST)).data.message.en, /accepted/);
});

test('429: Retry-After followed, bounded to 6 hours, kept across a restart', async () => {
  const { gladys, clock, fs, state } = await setup({
    handler: () => json({}, { status: 429, headers: { 'retry-after': '120' } }),
  });
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, false);
  assert.match((await status(gladys)).message.en, /HTTP 429/);
  await clock.advance(119_000);
  await gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls.length, 1);
  await clock.advance(2_000);
  state.handler = () => json({}, { status: 429, headers: { 'retry-after': '99999999' } });
  await gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls.length, 2);
  const left = fs.state().pause.untilWall - clock.now();
  assert.ok(left <= 6 * 3600_000 && left > 6 * 3600_000 - 1000, String(left));

  // After a restart: still paused, nothing sent.
  const again = await setup({ fs, clock });
  assert.equal((await again.gladys.fake.weatherGet(REQUEST)).success, false);
  assert.equal(fake.calls.length, 0);
  await clock.advance(6 * 3600_000);
  assert.equal((await again.gladys.fake.weatherGet(REQUEST)).success, true);
});

test('429 with an HTTP date: compared with the server Date, not the local clock', async () => {
  const { gladys, clock } = await setup({
    handler: () =>
      json(
        {},
        {
          status: 429,
          headers: {
            date: 'Wed, 11 Nov 2026 03:00:00 GMT',
            'retry-after': 'Wed, 11 Nov 2026 03:05:00 GMT',
          },
        },
      ),
  });
  await gladys.fake.weatherGet(REQUEST);
  await clock.advance(4.9 * MIN);
  await gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls.length, 1);
  await clock.advance(0.2 * MIN);
  await gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls.length, 2);
});

test('a pause date from the future in /data is ignored', async () => {
  const clock = testClock();
  const { gladys } = await setup({
    clock,
    initial: {
      salt: '0123456789abcdef0123456789abcdef',
      pause: { kind: 'error', reason: 'HTTP 500', untilWall: clock.now() + 30 * 86_400_000 },
    },
  });
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
});

test('5xx: pause doubling from 60 s; the last copy served with its own date, an hour at most', async () => {
  const { gladys, clock, state } = await setup();
  await gladys.fake.weatherGet(REQUEST);
  state.handler = () => json('oops', { status: 503 });
  await clock.advance(15 * MIN);
  const stale = await gladys.fake.weatherGet(REQUEST);
  assert.equal(stale.success, true);
  assert.equal(stale.data.weather.datetime, '2026-11-11T10:00:00.000Z');
  assert.equal(fake.calls.length, 2);
  assert.match((await status(gladys)).message.en, /HTTP 503.*1 min/);
  await clock.advance(61_000);
  await gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls.length, 3);
  assert.match((await status(gladys)).message.en, /2 min/);
  await clock.advance(61_000);
  await gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls.length, 3);
  await clock.advance(60 * MIN);
  const old = await gladys.fake.weatherGet(REQUEST);
  assert.equal(old.success, false);
});

test('an answer too large is cut before it is read whole, and pauses', async () => {
  const big = JSON.stringify({ pad: 'x'.repeat(1_100_000) });
  const { gladys, fs } = await setup({ handler: () => ({ status: 200, body: big }) });
  const ack = await gladys.fake.weatherGet(REQUEST);
  assert.equal(ack.success, false);
  assert.match(ack.error ?? JSON.stringify(ack), /too large/);
  assert.equal(fs.state().pause.kind, 'error');
});

test('an answer without current weather is not a refusal', async () => {
  const { gladys, fs } = await setup({ handler: () => json({ forecastDaily: {} }) });
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, false);
  assert.equal(fs.state().refused, null);
  assert.equal(fs.state().pause.reason, 'answer without current weather');
});

test('the monthly budget: reached, nothing sent until the next month (UTC)', async () => {
  const clock = testClock();
  const { gladys } = await setup({
    clock,
    config: { ...CONFIG, monthly_budget: 1000 },
    initial: { salt: '0123456789abcdef0123456789abcdef', month: '2026-11', calls: 1000 },
  });
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, false);
  assert.equal(fake.calls.length, 0);
  assert.match((await status(gladys)).message.en, /Monthly budget reached \(1000 calls\)/);
  clock.jumpWall(20 * 86_400_000);
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal(fake.calls.length, 1);
});

test('every call is counted in /data before it leaves', async () => {
  let savedBefore;
  const fs = memoryFs();
  await setup({
    fs,
    handler: () => {
      savedBefore = fs.state().calls;
      return json(weatherBody());
    },
  }).then(({ gladys }) => gladys.fake.weatherGet(REQUEST));
  assert.equal(savedBefore, 1);
});

test('a restart serves the kept copy (its own date), no call within the interval', async () => {
  const { gladys, fs, clock } = await setup();
  await gladys.fake.weatherGet(REQUEST);
  const saved = JSON.stringify(fs.state());
  assert.doesNotMatch(saved, /48\.85|2\.35/); // no coordinates in /data
  await clock.advance(5 * MIN);
  const again = await setup({ fs, clock });
  const ack = await again.gladys.fake.weatherGet(REQUEST);
  assert.equal(ack.success, true);
  assert.equal(ack.data.weather.datetime, '2026-11-11T10:00:00.000Z');
  assert.equal(fake.calls.length, 0);
});

test('a kept copy dated in the future is dropped at restart', async () => {
  const { gladys, fs, clock } = await setup();
  await gladys.fake.weatherGet(REQUEST);
  const saved = fs.state();
  saved.cache[0].fetchedWall = clock.now() + 3600_000;
  const again = await setup({ initial: saved, clock });
  await again.gladys.fake.weatherGet(REQUEST);
  assert.equal(fake.calls.length, 1);
});

test('/data unreadable is not empty: nothing sent, read again every 10 s', async () => {
  const clock = testClock();
  const fs = memoryFs({ salt: '0123456789abcdef0123456789abcdef', refused: null });
  fs.broken = true;
  const { gladys } = await setup({ fs, clock });
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, false);
  assert.equal(fake.calls.length, 0);
  assert.match((await status(gladys)).message.en, /unreadable/);
  const reads = fs.reads;
  await clock.advance(9_000);
  assert.equal(fs.reads, reads);
  fs.broken = false;
  await clock.advance(1_500);
  assert.equal(fs.reads, reads + 1);
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal(fs.state().salt, '0123456789abcdef0123456789abcdef');
});

test('/data that hangs: the request fails within its bound, one read at a time', async () => {
  const clock = testClock();
  const fs = memoryFs();
  fs.slow = true;
  const { app } = await setup({ fs, clock, autoStart: false });
  const starting = app.start(CONFIG);
  await clock.advance(2_100);
  await starting;
  const pending = app.getWeather(REQUEST).then(
    () => 'ok',
    (e) => e.message,
  );
  await clock.advance(2_100);
  assert.match(await pending, /unreadable/);
  await clock.advance(60_000);
  assert.equal(fs.reads, 1);
  assert.equal(fake.calls.length, 0);
});

test('/data not writable: the weather still works, logged once', async () => {
  const fs = memoryFs();
  fs.failWrites = true;
  const { gladys, logger, clock } = await setup({ fs });
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  await clock.advance(16 * MIN);
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal(logger.lines.filter((l) => /not written/.test(l)).length, 1);
});

test('getConfig failing in connected: retried, spaced, until it works', async () => {
  const { app, gladys, clock } = await setup({ config: {} });
  const real = gladys.getConfig.bind(gladys);
  let fails = 2;
  gladys.getConfig = async () => {
    if (fails > 0) {
      fails -= 1;
      throw new Error('socket hang up');
    }
    return { ...CONFIG };
  };
  await app.onConnected();
  await clock.settle();
  assert.match((await status(gladys)).message.en, /new try in 5 s/);
  await clock.advance(5_000);
  assert.match((await status(gladys)).message.en, /new try in 10 s/);
  await clock.advance(9_000);
  assert.equal(app.config.value, null);
  await clock.advance(1_000);
  assert.ok(app.config.value);
  assert.equal((await status(gladys)).connected, true);
  gladys.getConfig = real;
});

test('a disconnection cancels the configuration retry; stop leaves no timer', async () => {
  const { app, gladys, clock } = await setup();
  gladys.getConfig = async () => {
    throw new Error('down');
  };
  await app.onConnected();
  assert.equal(clock.pending.size, 1);
  app.onDisconnected();
  assert.equal(clock.pending.size, 0);
  await app.onConnected();
  await app.stop();
  assert.equal(clock.pending.size, 0);
});

test('a configuration saved again keeps the pause and the copies', async () => {
  const { app, gladys, state } = await setup();
  await gladys.fake.weatherGet(REQUEST);
  state.handler = () => json({}, { status: 500 });
  await app.start({ ...CONFIG });
  assert.equal((await gladys.fake.weatherGet(REQUEST)).success, true);
  assert.equal(fake.calls.length, 1);
});

test('invalid coordinates are refused before any call', async () => {
  const { gladys } = await setup();
  for (const bad of [{ latitude: 91 }, { longitude: '2' }, { latitude: NaN }]) {
    assert.equal((await gladys.fake.weatherGet({ ...REQUEST, ...bad })).success, false);
  }
  assert.equal(weatherCalls().length, 0);
});

test('the secret never shows: logs, statuses, /data, errors', async () => {
  const { gladys, logger, fs, state, clock } = await setup();
  await gladys.fake.weatherGet(REQUEST);
  const token = fake.calls[0].init.headers.Authorization.slice(7);
  state.handler = () => json({}, { status: 401 });
  await clock.advance(16 * MIN);
  const ack = await gladys.fake.weatherGet(REQUEST);
  const everything = [
    logger.lines.join('\n'),
    (await status(gladys), JSON.stringify(statuses(gladys))),
    [...fs.files.values()].join('\n'),
    JSON.stringify(ack),
  ].join('\n');
  assert.doesNotMatch(everything, new RegExp(KEY_BODY.slice(0, 20)));
  assert.ok(!everything.includes(token.split('.')[2]));
});
