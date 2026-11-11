// -----------------------------------------------------------------------------
// A test clock that advances: wall and monotonic time move together, every
// read moves 1 µs (a decision reading twice sees it move), `advance(ms)`
// fires the due timers in order, one event-loop turn between two.
// -----------------------------------------------------------------------------

export function testClock({ start = Date.parse('2026-11-11T10:00:00Z') } = {}) {
  let elapsed = 0;
  let nextId = 1;
  const pending = new Map();
  const tick = () => (elapsed += 0.001);
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  const clock = {
    now: () => start + Math.floor(tick()),
    monotonic: () => 1_000_000 + tick(),
    /** Move the wall clock only (a clock jump, a new month). */
    jumpWall(ms) {
      start += ms;
    },
    pending,
    timers: {
      setTimeout(fn, ms) {
        const id = nextId++;
        pending.set(id, { at: elapsed + Math.max(0, ms ?? 0), fn });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    async advance(ms) {
      const end = elapsed + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        elapsed = Math.max(elapsed, due[1].at);
        due[1].fn();
        await turn();
      }
      elapsed = end;
      await turn();
    },
    settle: async (n = 5) => {
      for (let i = 0; i < n; i += 1) await turn();
    },
  };
  return clock;
}
