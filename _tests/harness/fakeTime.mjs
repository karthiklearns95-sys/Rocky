// A manual clock for testing timers without waiting.
//   advance(ms) runs every timer due within the next ms, in order, as time passes
//   jump(ms)    time passes while NO timer runs (a laptop asleep): the next tick sees a big gap
export function fakeTime(start = 1_000_000) {
  let now = start, seq = 0;
  const items = new Map();
  const timers = {
    setTimeout: (fn, ms) => { const id = ++seq; items.set(id, { fn, at: now + ms, every: null }); return id; },
    clearTimeout: (id) => { items.delete(id); },
    setInterval: (fn, ms) => { const id = ++seq; items.set(id, { fn, at: now + ms, every: ms }); return id; },
    clearInterval: (id) => { items.delete(id); },
  };
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      const due = [...items.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, t] = due;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every; else items.delete(id);
      t.fn();
      await Promise.resolve();
    }
    now = target;
  }
  return { now: () => now, timers, advance, jump: (ms) => { now += ms; }, pending: () => items.size };
}
