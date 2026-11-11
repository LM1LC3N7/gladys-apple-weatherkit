// -----------------------------------------------------------------------------
// WeatherKitApp: the weather provider. Answers Gladys from a per-location
// copy (never read faster than the refresh interval), counts the calls of
// the month, pauses after 429/5xx, stops after credentials refused twice in
// a row, and keeps all of it in /data across restarts.
//
// Clocks: `monotonic` decides (cache age, pauses, token reuse, test spacing);
// `now` (wall) only signs the token, names the month, dates /data and drops
// the past hours of a kept copy.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  FALLBACK_POINT,
  MAX_CACHE_ENTRIES,
  PAUSE_MAX_429,
  PAUSE_MAX_ERROR,
  PAUSE_MIN,
  STALE_LIMIT,
  STATE_READ_TIMEOUT,
  STATE_RETRY,
  STATE_WAIT,
  TEST_SPACING,
  TOKEN_LIFETIME_S,
  TOKEN_REUSE,
} from './constants.js';
import { normalizeConfig } from './config.js';
import { NetworkError, get } from './http.js';
import { T, en } from './i18n.js';
import { signToken } from './jwt.js';
import { AnswerError, parseAvailability, parseWeather, toPivot } from './pivot.js';
import { Store } from './store.js';
import { availabilityUrl, retryAfterMs, round3, weatherUrl } from './weatherkit.js';

/** An error whose text exists in English and French. */
export class TextError extends Error {
  constructor(text) {
    super(en(text));
    this.name = 'TextError';
    this.text = text;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);
const sha = (...parts) => createHash('sha256').update(parts.join('\n')).digest('hex');

export class WeatherKitApp {
  constructor({
    gladys,
    logger = sdkLogger,
    now = () => Date.now(),
    monotonic = () => performance.now(),
    timers = globalThis,
    store = new Store(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.closed = false;
    this.gen = 0; // configuration generation
    this.connGen = 0; // connection generation (getConfig retries)
    this.config = normalizeConfig({});
    this.state = null; // null while /data is not read
    this.rawRead = null; // the pending read of /data (one at a time)
    this.stateWaiters = [];
    this.stateTimer = null;
    this.stateBroken = false;
    this.configTimer = null;
    this.configDelay = CONFIG_RETRY_MIN;
    this.cache = new Map();
    this.inflight = new Map();
    this.token = null;
    this.pause = null;
    this.backoff = 0;
    this.lastTest = -Infinity;
    this.lastStatus = null;
    this.saveFailed = false;
    this.everAnswered = false;
  }

  // --- lifecycle ---------------------------------------------------------------

  /** Gladys (re)connected: read the configuration, retried without end. */
  async onConnected() {
    this.cancelConfigRetry();
    const gen = ++this.connGen;
    let config;
    try {
      config = await this.gladys.getConfig();
    } catch (err) {
      if (gen !== this.connGen || this.closed) return;
      const delay = this.configDelay;
      this.configDelay = Math.min(delay * 2, CONFIG_RETRY_MAX);
      this.logger.warn(`getConfig failed (${err?.message}): new try in ${delay / 1000} s`);
      this.lastStatus = null;
      this.setStatus(false, T.configUnread(delay));
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = null;
        this.onConnected();
      }, delay);
      return;
    }
    if (gen !== this.connGen || this.closed) return;
    this.configDelay = CONFIG_RETRY_MIN;
    await this.start(config);
  }

  onDisconnected() {
    this.connGen += 1;
    this.cancelConfigRetry();
  }

  cancelConfigRetry() {
    if (this.configTimer) this.timers.clearTimeout(this.configTimer);
    this.configTimer = null;
  }

  /** (Re)start with a configuration. Pauses, refusals and the copies stay. */
  async start(config) {
    if (this.closed) return;
    const gen = ++this.gen;
    this.config = normalizeConfig(config);
    this.token = null;
    this.lastStatus = null;
    this.loadState();
    await this.waitState(STATE_WAIT);
    if (gen !== this.gen || this.closed) return;
    this.publishStatus();
  }

  async stop() {
    this.closed = true;
    this.gen += 1;
    this.connGen += 1;
    this.cancelConfigRetry();
    if (this.stateTimer) this.timers.clearTimeout(this.stateTimer);
    this.stateTimer = null;
    for (const resolve of this.stateWaiters.splice(0)) resolve();
    await this.store.flush();
  }

  // --- /data -------------------------------------------------------------------

  /** Start a read of /data unless one is pending or the state is known. */
  loadState() {
    if (this.state || this.rawRead || this.closed) return;
    const read = this.store.read();
    this.rawRead = read;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), STATE_READ_TIMEOUT);
    });
    const settle = read.then(
      (raw) => ({ raw }),
      (err) => ({ err }),
    );
    settle.then(() => {
      if (this.rawRead === read) this.rawRead = null;
    });
    Promise.race([settle, timeout]).then((outcome) => {
      this.timers.clearTimeout(timer);
      if (this.closed || this.state) return;
      if (outcome !== 'timeout' && !outcome.err) {
        this.applyState(outcome.raw);
        this.stateBroken = false;
        for (const resolve of this.stateWaiters.splice(0)) resolve();
        return;
      }
      this.logger.warn(
        `/data/state.json not read (${outcome === 'timeout' ? 'slow' : outcome.err.message}): again in 10 s`,
      );
      this.stateBroken = true;
      this.setStatus(false, T.stateUnreadable);
      // The waiters learn now that it failed (they never wait for nothing).
      for (const resolve of this.stateWaiters.splice(0)) resolve();
      if (!this.stateTimer) {
        this.stateTimer = this.timers.setTimeout(() => {
          this.stateTimer = null;
          if (this.rawRead) {
            // The previous read still hangs: never two at a time.
            settle.then(() => this.loadState());
          } else {
            this.loadState();
          }
        }, STATE_RETRY);
      }
    });
  }

  /** Resolves when the state is known or after `ms` (bounded, never hangs). */
  waitState(ms) {
    if (this.state || this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(done, ms);
      const waiters = this.stateWaiters;
      function done() {
        const i = waiters.indexOf(done);
        if (i >= 0) waiters.splice(i, 1);
        resolve();
      }
      waiters.push(() => {
        this.timers.clearTimeout(timer);
        done();
      });
    });
  }

  applyState(raw) {
    const wall = this.now();
    const mono = this.monotonic();
    const saltOk = typeof raw.salt === 'string' && /^[0-9a-f]{32}$/.test(raw.salt);
    const state = {
      salt: saltOk ? raw.salt : randomBytes(16).toString('hex'),
      month: typeof raw.month === 'string' && /^\d{4}-\d{2}$/.test(raw.month) ? raw.month : null,
      calls: Number.isInteger(raw.calls) && raw.calls >= 0 ? raw.calls : 0,
      refused:
        typeof raw.refused?.id === 'string' && HEX64.test(raw.refused.id) ? raw.refused.id : null,
    };
    // A pause runs on after a restart, from its wall-clock end; an end
    // further than the longest pause is invalid (clock jump, edited file).
    const p = raw.pause;
    if (p && Number.isFinite(p.untilWall) && ['429', 'error'].includes(p.kind)) {
      const left = p.untilWall - wall;
      const max = p.kind === '429' ? PAUSE_MAX_429 : PAUSE_MAX_ERROR;
      if (left > 0 && left <= max) {
        this.pause = {
          kind: p.kind,
          reason: typeof p.reason === 'string' ? p.reason.slice(0, 40) : 'error',
          untilMono: mono + left,
          untilWall: p.untilWall,
        };
        this.backoff = Number.isFinite(p.step) ? Math.min(p.step, max) : 0;
      }
    }
    // The copies: dated by the wall clock, never from the future, never
    // older than the stale limit.
    for (const entry of Array.isArray(raw.cache) ? raw.cache.slice(0, MAX_CACHE_ENTRIES) : []) {
      const age = wall - entry?.fetchedWall;
      const s = entry?.snapshot;
      if (
        typeof entry?.key !== 'string' ||
        !HEX64.test(entry.key) ||
        !Number.isFinite(age) ||
        age < 0 ||
        age > STALE_LIMIT ||
        typeof s?.current?.asOf !== 'string' ||
        typeof s?.current?.temperature !== 'number' ||
        !Array.isArray(s.hours) ||
        !Array.isArray(s.days) ||
        !Array.isArray(s.alerts)
      ) {
        continue;
      }
      this.cache.set(entry.key, {
        snapshot: s,
        fetchedMono: mono - age,
        fetchedWall: entry.fetchedWall,
        serverDateMs: Number.isFinite(entry.serverDateMs) ? entry.serverDateMs : undefined,
        alerts: entry.alerts === true,
      });
    }
    this.state = state;
    if (!saltOk) this.persist();
  }

  /** Write the state; resolves true when written, false otherwise (logged). */
  async persist() {
    if (!this.state) return false;
    const value = {
      version: 1,
      salt: this.state.salt,
      month: this.state.month,
      calls: this.state.calls,
      refused: this.state.refused ? { id: this.state.refused } : null,
      pause: this.pause
        ? {
            kind: this.pause.kind,
            reason: this.pause.reason,
            untilWall: this.pause.untilWall,
            step: this.backoff,
          }
        : null,
      cache: [...this.cache.entries()].map(([key, e]) => ({
        key,
        fetchedWall: e.fetchedWall,
        serverDateMs: e.serverDateMs,
        alerts: e.alerts,
        snapshot: e.snapshot,
      })),
    };
    try {
      await this.store.save(value);
      this.saveFailed = false;
      return true;
    } catch (err) {
      if (!this.saveFailed) this.logger.warn(`/data/state.json not written: ${err?.code ?? err}`);
      this.saveFailed = true;
      return false;
    }
  }

  /** Persist, waiting at most `ms` (a slow /data never holds a request). */
  persistWithin(ms) {
    let timer;
    return Promise.race([
      this.persist(),
      new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve(false), ms);
      }),
    ]).finally(() => this.timers.clearTimeout(timer));
  }

  // --- status ------------------------------------------------------------------

  setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus || this.closed) return;
    this.lastStatus = key;
    Promise.resolve()
      .then(() => this.gladys.setConnectionStatus(connected, message))
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err?.message}`));
  }

  publishStatus() {
    const cfg = this.config;
    if (!cfg.value) {
      this.setStatus(false, cfg.configured ? T.invalid(cfg.errors) : T.notConfigured);
      return;
    }
    if (!this.state) {
      if (this.stateBroken) this.setStatus(false, T.stateUnreadable);
      return;
    }
    const gate = this.gate(cfg, { test: false });
    if (gate) {
      this.setStatus(false, gate);
      return;
    }
    this.setStatus(true, this.everAnswered ? T.ok : T.ready);
  }

  // --- gates ---------------------------------------------------------------------

  credentialsHash(cfg) {
    return sha(this.state.salt, cfg.value.credentialsId);
  }

  rollMonth() {
    const month = monthKey(this.now());
    if (this.state.month !== month) {
      this.state.month = month;
      this.state.calls = 0;
    }
  }

  /** Why no request may leave now (a text), or null. The test ignores a refusal. */
  gate(cfg, { test }) {
    if (!test && this.state.refused && this.state.refused === this.credentialsHash(cfg)) {
      return T.refused;
    }
    this.rollMonth();
    if (this.state.calls >= cfg.value.monthlyBudget) return T.budget(cfg.value.monthlyBudget);
    const left = this.pause ? this.pause.untilMono - this.monotonic() : 0;
    if (left > 0) {
      return this.pause.kind === '429' ? T.paused429(left) : T.pausedError(this.pause.reason, left);
    }
    return null;
  }

  setPause(kind, ms, reason) {
    const max = kind === '429' ? PAUSE_MAX_429 : PAUSE_MAX_ERROR;
    const duration = Math.min(Math.max(ms, PAUSE_MIN), max);
    this.pause = {
      kind,
      reason,
      untilMono: this.monotonic() + duration,
      untilWall: this.now() + duration,
    };
    this.persist();
  }

  /** The next doubling step: 60 s, 2 min, 4 min... up to `max`. */
  nextBackoff(max) {
    this.backoff = this.backoff ? Math.min(this.backoff * 2, max) : PAUSE_MIN;
    return this.backoff;
  }

  tokenFor(cfg) {
    const mono = this.monotonic();
    const id = cfg.value.credentialsId;
    if (this.token && this.token.id === id && mono - this.token.mono < TOKEN_REUSE) {
      return this.token.value;
    }
    // Issued 30 s in the past: a clock slightly ahead of Apple's is accepted.
    const value = signToken(cfg.value, Math.floor(this.now() / 1000) - 30, TOKEN_LIFETIME_S);
    this.token = { id, mono, value };
    return value;
  }

  /**
   * One call to WeatherKit, counted before it leaves. A 401/403 is tried once
   * more with a new token; refused twice in a row, the credentials are
   * recorded as refused (a salted hash) and never sent again on their own.
   */
  async call(url, cfg, gen, { test = false, retried = false } = {}) {
    const gate = this.gate(cfg, { test: test || retried });
    if (gate) throw new TextError(gate);
    this.state.calls += 1;
    await this.persistWithin(1000);
    const token = this.tokenFor(cfg);
    let res;
    try {
      res = await get(url, token);
    } catch (err) {
      const reason = err instanceof NetworkError ? err.message : 'no answer';
      this.setPause('error', this.nextBackoff(PAUSE_MAX_ERROR), reason);
      if (gen === this.gen) this.publishStatus();
      throw new TextError(T.pausedError(reason, this.backoff));
    }
    if (res.status === 200) {
      this.backoff = 0;
      const hash = this.credentialsHash(cfg);
      const changed = this.pause !== null || this.state.refused === hash;
      this.pause = null;
      if (this.state.refused === hash) this.state.refused = null;
      if (changed) this.persist();
      return res;
    }
    if (res.status === 401 || res.status === 403) {
      this.token = null;
      if (!retried) return this.call(url, cfg, gen, { test, retried: true });
      this.state.refused = this.credentialsHash(cfg);
      this.persist();
      this.logger.warn(`WeatherKit refused the credentials (HTTP ${res.status}, twice)`);
      if (gen === this.gen) this.publishStatus();
      throw new TextError(T.refused);
    }
    if (res.status === 429) {
      const asked = retryAfterMs(res.retryAfter, res.date);
      const ms = asked ?? this.nextBackoff(PAUSE_MAX_429);
      this.setPause('429', ms, 'HTTP 429');
      if (gen === this.gen) this.publishStatus();
      throw new TextError(T.paused429(this.pause.untilMono - this.monotonic()));
    }
    const reason = `HTTP ${res.status}`;
    this.setPause('error', this.nextBackoff(PAUSE_MAX_ERROR), reason);
    if (gen === this.gen) this.publishStatus();
    throw new TextError(T.pausedError(reason, this.backoff));
  }

  // --- the weather -------------------------------------------------------------

  async ensureReady() {
    const cfg = this.config;
    if (!cfg.value) throw new TextError(cfg.configured ? T.invalid(cfg.errors) : T.notConfigured);
    if (!this.state) {
      this.loadState();
      await this.waitState(STATE_WAIT);
      if (!this.state) throw new TextError(T.stateUnreadable);
    }
    return cfg;
  }

  /** onWeatherGet: answered from the copy, or after one call (under 15 s). */
  async getWeather({ latitude, longitude, language, units } = {}) {
    const cfg = await this.ensureReady();
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !(Math.abs(latitude) <= 90) ||
      !(Math.abs(longitude) <= 180)
    ) {
      throw new TextError(T.badLocation);
    }
    const lang = typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : 'en';
    const point = { latitude: round3(latitude), longitude: round3(longitude) };
    const { country, alerts } = cfg.value;
    const key = sha(this.state.salt, point.latitude, point.longitude, lang, country, alerts);
    const entry = this.cache.get(key);
    if (entry && this.monotonic() - entry.fetchedMono < cfg.value.refreshMs) {
      return this.answer(entry, units);
    }
    let fresh;
    try {
      let pending = this.inflight.get(key);
      if (!pending) {
        pending = this.fetchWeather(key, { ...point, language: lang, country, alerts }, cfg);
        this.inflight.set(key, pending);
        pending.finally(() => this.inflight.delete(key)).catch(() => {});
      }
      fresh = await pending;
    } catch (err) {
      // WeatherKit unavailable: the last copy, if under an hour old, with its
      // own date (never presented as new); else the error, and Gladys falls
      // back to its next provider.
      const kept = this.cache.get(key);
      if (kept && this.monotonic() - kept.fetchedMono <= STALE_LIMIT)
        return this.answer(kept, units);
      throw err;
    }
    return this.answer(fresh, units);
  }

  async fetchWeather(key, params, cfg) {
    const gen = this.gen;
    const url = weatherUrl({ ...params, nowMs: this.now() });
    const res = await this.call(url, cfg, gen);
    let snapshot;
    try {
      snapshot = parseWeather(res.text);
    } catch (err) {
      if (!(err instanceof AnswerError)) throw err;
      this.setPause('error', this.nextBackoff(PAUSE_MAX_ERROR), err.message);
      if (gen === this.gen) this.publishStatus();
      throw new TextError(T.pausedError(err.message, this.backoff));
    }
    const serverDateMs = Date.parse(res.date ?? '');
    const entry = {
      snapshot,
      fetchedMono: this.monotonic(),
      fetchedWall: this.now(),
      serverDateMs: Number.isFinite(serverDateMs) ? serverDateMs : undefined,
      alerts: params.alerts,
    };
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.persist();
    this.everAnswered = true;
    if (gen === this.gen) this.publishStatus();
    return entry;
  }

  answer(entry, units) {
    const elapsed = this.monotonic() - entry.fetchedMono;
    return toPivot(entry.snapshot, {
      units: units === 'us' ? 'us' : 'metric',
      nowMs: this.now(),
      serverNowMs: entry.serverDateMs === undefined ? undefined : entry.serverDateMs + elapsed,
      alerts: entry.alerts,
    });
  }

  // --- the test button -----------------------------------------------------------

  /** One call to the availability endpoint; a success lifts a refusal. */
  async testConnection() {
    let cfg;
    try {
      cfg = await this.ensureReady();
    } catch (err) {
      return err.text ?? { en: err.message, fr: err.message };
    }
    const since = this.monotonic() - this.lastTest;
    if (since < TEST_SPACING) return T.testWait(TEST_SPACING - since);
    const gate = this.gate(cfg, { test: true });
    if (gate) return gate;
    this.lastTest = this.monotonic();
    const gen = this.gen;
    const houses = await Promise.resolve()
      .then(() => this.gladys.getHouses())
      .catch(() => []);
    const house = (Array.isArray(houses) ? houses : []).find(
      (h) => typeof h?.latitude === 'number' && typeof h?.longitude === 'number',
    );
    const point = house ?? FALLBACK_POINT;
    try {
      const res = await this.call(
        availabilityUrl({ ...point, country: cfg.value.country }),
        cfg,
        gen,
        { test: true },
      );
      const sets = parseAvailability(res.text);
      if (gen === this.gen) {
        this.lastStatus = null;
        this.publishStatus();
      }
      return T.testOk({
        sets,
        calls: this.state.calls,
        budget: cfg.value.monthlyBudget,
        country: cfg.value.country,
        alerts: cfg.value.alerts,
      });
    } catch (err) {
      return err.text ?? { en: err.message, fr: err.message };
    }
  }
}
