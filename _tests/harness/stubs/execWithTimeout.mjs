const T = () => globalThis.__T;
export async function execWithTimeout(cmd, opts = {}) {
  T()?.main('exec', [String(cmd).slice(0, 40), opts.env ? Object.keys(opts.env) : null]);
  return { stdout: '', stderr: '', timedOut: false, error: null };
}
export function killProcessTree() {}
