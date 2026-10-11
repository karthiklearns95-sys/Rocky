import { exec, execFile } from 'child_process';

/**
 * Kill `child` and everything it spawned. On Windows exec() runs the command via cmd.exe,
 * and child.kill() only terminates that cmd.exe — the PowerShell it launched keeps running.
 * taskkill /T walks the tree.
 */
export function killProcessTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      return;
    }
  } catch (_) { /* fall through to plain kill */ }
  try { child.kill('SIGKILL'); } catch (_) {}
}

/**
 * execWithTimeout
 *
 * A safe wrapper around child_process.exec that enforces a hard deadline.
 * If the command does not complete within `timeoutMs`, the child process is
 * killed and the promise resolves with { timedOut: true } instead of hanging
 * the caller forever.
 *
 * @param {string} command - The shell command to execute.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000] - Kill deadline in milliseconds.
 * @param {string} [opts.encoding='utf8'] - Output encoding.
 * @param {object} [opts.env] - Extra environment variables, merged over process.env.
 *   Use this to hand untrusted values (LLM output, user text) to PowerShell as
 *   $env:NAME instead of interpolating them into the command string, where quotes,
 *   `$(...)` or cmd.exe `%VAR%` expansion could break out of the argument.
 * @returns {Promise<{ stdout: string, stderr: string, timedOut: boolean, error: Error|null }>}
 */
export function execWithTimeout(command, { timeoutMs = 10000, encoding = 'utf8', env } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const execOpts = env ? { encoding, env: { ...process.env, ...env } } : { encoding };
    const child = exec(command, execOpts, (err, stdout, stderr) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: false,
        error: err || null,
      });
    });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      resolve({
        stdout: '',
        stderr: '',
        timedOut: true,
        error: new Error(`Command timed out after ${timeoutMs}ms: ${command.substring(0, 80)}`),
      });
    }, timeoutMs);
  });
}
