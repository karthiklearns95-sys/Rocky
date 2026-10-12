const T = () => globalThis.__T;
export async function beginClickVerification(point, opts) {
  T().main('verify.begin', [point, opts && opts.display]);
  return { fake: true };
}
export async function finishClickVerification(session, opts) {
  const v = T().verdicts && T().verdicts.length ? T().verdicts.shift() : { verdict: 'unknown', reason: 'scripted' };
  T().main('verify.finish', [!!session, v.verdict]);
  if (opts && opts.windowChanged) await opts.windowChanged();
  return v;
}
export async function validateExecutionState() { return { changed: true }; }
