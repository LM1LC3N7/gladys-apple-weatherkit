// -----------------------------------------------------------------------------
// Real clock, sped up 100 times: the /data re-read period is measured on real
// timers (late under load, never early), and stop() leaves nothing running.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WeatherKitApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { CONFIG, memoryFs, memoryLogger } from './helpers/fixtures.js';

const SPEED = 100;

function realClock() {
  const origin = performance.now();
  const live = new Set();
  return {
    live,
    now: () => Date.parse('2026-11-11T10:00:00Z') + (performance.now() - origin) * SPEED,
    monotonic: () => (performance.now() - origin) * SPEED,
    timers: {
      setTimeout(fn, ms) {
        const id = setTimeout(() => {
          live.delete(id);
          fn();
        }, ms / SPEED);
        live.add(id);
        return id;
      },
      clearTimeout(id) {
        live.delete(id);
        clearTimeout(id);
      },
    },
  };
}

test('/data unreadable: read again every 10 s (measured), stop leaves no timer', async (t) => {
  const clock = realClock();
  const fs = memoryFs();
  fs.broken = true;
  const reads = [];
  const readFile = fs.readFile;
  fs.readFile = (...args) => {
    reads.push(clock.monotonic());
    return readFile(...args);
  };
  const gladys = createFakeGladys({ selector: 'apple-weatherkit', config: CONFIG });
  const app = new WeatherKitApp({
    gladys,
    logger: memoryLogger(),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: new Store({ fs }),
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.onConnected();
  const deadline = Date.now() + 10_000;
  while (reads.length < 4) {
    if (Date.now() > deadline) assert.fail(`only ${reads.length} reads`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const gaps = reads.slice(1).map((r, i) => r - reads[i]);
  for (const gap of gaps) {
    // 10 s plus the 2 s read timeout never applies here (the read fails fast)
    assert.ok(gap >= 9_000 && gap <= 25_000, `gaps ${gaps.map(Math.round)}`);
  }
  await app.stop();
  assert.equal(clock.live.size, 0);
  const count = reads.length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(reads.length, count);
});
