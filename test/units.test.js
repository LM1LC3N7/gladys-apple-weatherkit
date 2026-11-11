// -----------------------------------------------------------------------------
// The pure parts: configuration, key and token, conditions, alerts, /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import { createServer } from 'node:http';
import { normalizeConfig } from '../src/config.js';
import { toAlertType, toCondition, toSeverity } from '../src/conditions.js';
import { get, setFetch } from '../src/http.js';
import { parsePrivateKey, signToken } from '../src/jwt.js';
import { parseAvailability, parseWeather, toPivot } from '../src/pivot.js';
import { Store, UnreadableStateError } from '../src/store.js';
import { availabilityUrl, retryAfterMs, weatherUrl } from '../src/weatherkit.js';
import { CONFIG, KEY, KEY_BODY, makeKey, memoryFs, weatherBody } from './helpers/fixtures.js';
import { generateKeyPairSync } from 'node:crypto';

test('the key is read as pasted: file, one line, literal \\n, body only', () => {
  const oneLine = KEY.pem.replace(/\n/g, ' ');
  const escaped = KEY.pem.replace(/\n/g, '\\n');
  const body = KEY.pem.split('\n').slice(1, -2).join('');
  for (const text of [KEY.pem, oneLine, escaped, body, `  ${KEY.pem}  `]) {
    assert.ok(parsePrivateKey(text), JSON.stringify(text.slice(0, 40)));
  }
});

test('anything else is refused: RSA, P-384, garbage, too long', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  });
  for (const text of [rsa, makeKey('secp384r1').pem, 'hello', 'A'.repeat(5000), undefined, '']) {
    assert.equal(parsePrivateKey(text), null);
  }
});

test('the token verifies with the public key (ES256, JOSE signature)', () => {
  const key = parsePrivateKey(KEY.pem);
  const token = signToken({ teamId: 'T', keyId: 'K', serviceId: 'S', key }, 1_800_000_000, 3600);
  const [h, p, s] = token.split('.');
  assert.equal(Buffer.from(s, 'base64url').length, 64);
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: KEY.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    ),
  );
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), {
    iss: 'T',
    iat: 1_800_000_000,
    exp: 1_800_003_600,
    sub: 'S',
  });
});

test('configuration: defaults, bounds, names of the invalid fields only', () => {
  const ok = normalizeConfig(CONFIG);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.refreshMs, 15 * 60_000);
  assert.equal(ok.value.monthlyBudget, 50_000);
  assert.equal(ok.value.alerts, true);
  assert.equal(normalizeConfig({ ...CONFIG, country: '' }).value.alerts, false);
  assert.equal(normalizeConfig({ ...CONFIG, country: 'be' }).value.country, 'BE');
  assert.equal(normalizeConfig({ ...CONFIG, team_id: 'a1b2c3d4e5' }).value.teamId, 'A1B2C3D4E5');
  assert.equal(normalizeConfig({}).configured, false);
  const cases = [
    [{ team_id: 'A1B2C3D4E' }, 'team_id'],
    [{ key_id: 'ABCDEFGHIJK' }, 'key_id'],
    [{ service_id: 'nodot' }, 'service_id'],
    [{ service_id: 'com.example\r\nX: y' }, 'service_id'],
    [{ private_key: 'nope' }, 'private_key'],
    [{ country: 'FRA' }, 'country'],
    [{ alerts: 'yes' }, 'alerts'],
    [{ refresh_minutes: 5 }, 'refresh_minutes'],
    [{ refresh_minutes: 15.5 }, 'refresh_minutes'],
    [{ monthly_budget: 999 }, 'monthly_budget'],
    [{ monthly_budget: 600_000 }, 'monthly_budget'],
  ];
  for (const [patch, field] of cases) {
    const result = normalizeConfig({ ...CONFIG, ...patch });
    assert.deepEqual(result.errors, [field], JSON.stringify(patch));
    assert.equal(result.value, null);
    assert.equal(result.configured, true);
  }
  assert.ok(!JSON.stringify(normalizeConfig({ ...CONFIG, team_id: 'x' })).includes(KEY_BODY));
});

test('the credentials id changes with any of the four fields', () => {
  const base = normalizeConfig(CONFIG).value.credentialsId;
  for (const patch of [
    { team_id: 'B1B2C3D4E5' },
    { key_id: 'AZ8Y7X6W5V' },
    { service_id: 'com.example.other' },
    { private_key: makeKey().pem },
  ]) {
    assert.notEqual(normalizeConfig({ ...CONFIG, ...patch }).value.credentialsId, base);
  }
  assert.equal(normalizeConfig({ ...CONFIG, country: 'BE' }).value.credentialsId, base);
});

test('conditions: every WeatherKit code mapped, the rest unknown', () => {
  assert.equal(toCondition('Clear'), 'clear');
  assert.equal(toCondition('PartlyCloudy'), 'partly-cloudy');
  assert.equal(toCondition('HeavyRain'), 'pouring');
  assert.equal(toCondition('FreezingDrizzle'), 'freezing-rain');
  assert.equal(toCondition('WintryMix'), 'sleet');
  assert.equal(toCondition('Blizzard'), 'snow');
  assert.equal(toCondition('Hail'), 'hail');
  assert.equal(toCondition('IsolatedThunderstorms'), 'thunderstorm');
  assert.equal(toCondition('BlowingDust'), 'sandstorm');
  assert.equal(toCondition('Tornado'), 'tornado');
  assert.equal(toCondition('TropicalStorm'), 'hurricane');
  assert.equal(toCondition('Breezy'), 'wind');
  for (const odd of ['NewCode', '', null, 42, '__proto__', 'constructor', 'toString']) {
    assert.equal(toCondition(odd), 'unknown', String(odd));
  }
});

test('alerts: severity kept or lowest, phenomenon from the title', () => {
  assert.equal(toSeverity('Extreme'), 'extreme');
  assert.equal(toSeverity('unknown'), 'minor');
  assert.equal(toSeverity(undefined), 'minor');
  const cases = [
    ['Severe Thunderstorm Warning', 'thunderstorm'],
    ['Vigilance orange orages', 'thunderstorm'],
    ['Flood Watch', 'flood'],
    ['Wind Chill Advisory', 'cold'],
    ['Freezing Rain Advisory', 'snow'],
    ['Vigilance jaune neige-verglas', 'snow'],
    ['Excessive Heat Warning', 'heat'],
    ['Vigilance canicule', 'heat'],
    ['High Wind Warning', 'wind'],
    ['Vigilance jaune vent violent', 'wind'],
    ['Vigilance pluie-inondation', 'flood'],
    ['Heavy rain', 'rain'],
    ['Dense Fog Advisory', 'fog'],
    ['Avalanche Warning', 'avalanche'],
    ['Coastal Flood Warning', 'flood'],
    ['High Surf Advisory', 'coastal'],
    ['Air Quality Alert', undefined],
  ];
  for (const [title, type] of cases) assert.equal(toAlertType(title), type, title);
});

test('the answer: past hours and days dropped from a kept copy', () => {
  const snapshot = parseWeather(JSON.stringify(weatherBody()));
  const later = Date.parse('2026-11-12T03:30:00Z');
  const pivot = toPivot(snapshot, { units: 'metric', nowMs: later, alerts: false });
  assert.equal(pivot.hours[0].datetime, '2026-11-12T03:00:00.000Z');
  assert.equal(pivot.days[0].datetime, '2026-11-12T00:00:00.000Z');
  assert.ok(!('alerts' in pivot));
});

test('the answer: duplicate alerts once, ten at most, strings bounded and cleaned', () => {
  const alerts = Array.from({ length: 14 }, (_, i) => ({
    id: `x${i % 12}`,
    description: `Alert\u0007 ${i} ${'y'.repeat(200)}`,
    severity: 'moderate',
  }));
  const snapshot = parseWeather(JSON.stringify(weatherBody(undefined, { alerts: { alerts } })));
  assert.equal(snapshot.alerts.length, 12);
  const pivot = toPivot(snapshot, { units: 'metric', nowMs: 0, alerts: true });
  assert.equal(pivot.alerts.length, 10);
  assert.ok(
    pivot.alerts.every((a) => a.event.length <= 100 && !a.event.includes(String.fromCharCode(7))),
  );
});

test('unreadable answers are AnswerErrors', () => {
  for (const text of ['', 'not json', '[]', '{}', '{"currentWeather":{"temperature":"12"}}']) {
    assert.throws(() => parseWeather(text), { name: 'AnswerError' }, text);
  }
  assert.throws(() => parseAvailability('{}'), { name: 'AnswerError' });
  assert.deepEqual(parseAvailability('["currentWeather", 3, "bad value"]'), ['currentWeather']);
});

test('URLs: rounded coordinates, bounded windows; Retry-After forms', () => {
  const url = new URL(
    weatherUrl({
      latitude: 48.85661,
      longitude: -2.35222,
      language: 'en',
      country: 'FR',
      alerts: true,
      nowMs: Date.parse('2026-11-11T10:42:00Z'),
    }),
  );
  assert.equal(url.pathname, '/api/v1/weather/en/48.857/-2.352');
  assert.equal(url.searchParams.get('hourlyStart'), '2026-11-11T10:00:00Z');
  assert.equal(url.searchParams.get('hourlyEnd'), '2026-11-12T11:00:00Z');
  assert.equal(url.searchParams.get('dailyEnd'), '2026-11-20T10:00:00Z');
  assert.equal(
    availabilityUrl({ latitude: 1.23456, longitude: 2, country: null }),
    'https://weatherkit.apple.com/api/v1/availability/1.235/2',
  );
  assert.equal(retryAfterMs('30'), 30_000);
  assert.equal(
    retryAfterMs('Wed, 11 Nov 2026 10:02:00 GMT', 'Wed, 11 Nov 2026 10:00:00 GMT'),
    120_000,
  );
  assert.equal(retryAfterMs('Wed, 11 Nov 2026 10:02:00 GMT', undefined), undefined);
  assert.equal(retryAfterMs('soon'), undefined);
  assert.equal(retryAfterMs(null), undefined);
});

test('/data: missing is empty, garbage is unreadable, writes queued and atomic', async () => {
  const fs = memoryFs();
  const store = new Store({ fs });
  assert.deepEqual(await store.read(), {});
  fs.files.set('/data/state.json', '{"calls":');
  await assert.rejects(store.read(), UnreadableStateError);
  fs.files.set('/data/state.json', '[]');
  await assert.rejects(store.read(), UnreadableStateError);
  fs.broken = true;
  await assert.rejects(store.read(), UnreadableStateError);
  fs.broken = false;
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(await store.read(), { a: 2 });
  assert.ok(!fs.files.has('/data/state.json.tmp'));
});

test('http: a silent server ends on the timeout, never hangs; no redirect followed', async (t) => {
  const previous = setFetch((...args) => globalThis.fetch(...args));
  t.after(() => setFetch(previous));
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/x' });
      res.end();
    }
    // else: never answers
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const started = performance.now();
  await assert.rejects(get(`${base}/silent`, 'token', { timeout: 200 }), {
    name: 'NetworkError',
    message: 'timeout',
  });
  assert.ok(performance.now() - started < 5_000);
  const redirect = await get(`${base}/redirect`, 'token', { timeout: 2_000 });
  assert.equal(redirect.status, 302);
});
