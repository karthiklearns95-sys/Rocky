import { exec } from 'child_process';

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
 * @returns {Promise<{ stdout: string, stderr: string, timedOut: boolean, error: Error|null }>}
 */
export function execWithTimeout(command, { timeoutMs = 10000, encoding = 'utf8' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const child = exec(command, { encoding }, (err, stdout, stderr) => {
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
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      resolve({
        stdout: '',
        stderr: '',
        timedOut: true,
        error: new Error(`Command timed out after ${timeoutMs}ms: ${command.substring(0, 80)}`),
      });
    }, timeoutMs);
  });
}
