import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Which local files may go to a website, and how a spoken name becomes a real file.
 *
 * An upload sends a file off this computer, and the path comes from a language model that heard a
 * sentence. So: it must be a real file Grace named (or an exact path), never a secret or Rocky's own
 * memory, and when a name matches several files Rocky asks instead of picking one.
 */

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;

const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();

// Credentials, keys, browser profiles (cookies and saved passwords), system secrets.
const SENSITIVE = [
  /\/\.(ssh|aws|gnupg|azure|kube|gcloud|npm|config\/gcloud)(\/|$)/,
  /\/\.docker\/config\.json$/,
  /(^|\/)\.env(\.[\w.-]+)?$/,
  /(^|\/)(\.netrc|\.pgpass|\.git-credentials|credentials\.json|client_secret[\w.-]*\.json|secrets?\.(json|ya?ml|txt))$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|key|pfx|p12|ppk|kdbx|keystore|jks|asc)$/,
  /(^|\/)wallet\.dat$/,
  /(^|\/)(passwords?|logins?)[\w .-]*\.(csv|json|txt|xlsx?)$/,
  /\/appdata\/(local|roaming)\/(google\/chrome|microsoft\/edge|mozilla|brave-?software|opera|vivaldi|1password|bitwarden|keepass)/,
  /\/user data\//,
  /(^|\/)(login data|web data|cookies|local state|key[34]\.db|logins\.json)$/,
  /\/microsoft\/(credentials|protect|vault)\//,
  /\/windows\/system32\/config(\/|$)/,
  /(^|\/)ntds\.dit$/,
];

/** A path that must never be uploaded. `protectedDirs` are folders (such as Rocky's own data/) that are off limits entirely. */
export function isSensitivePath(file, { protectedDirs = [] } = {}) {
  const p = norm(file);
  if (SENSITIVE.some((re) => re.test(p))) return true;
  return protectedDirs.some((d) => { const n = norm(d).replace(/\/$/, ''); return p === n || p.startsWith(`${n}/`); });
}

/** Rocky's own folders: knowledge graph, memories, browser profile, vector database. */
export function rockyDataDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
}

/**
 * Check one file for upload. Returns { ok: true, file, size } or { ok: false, error }.
 * Symlinks are followed first, so a harmless-looking link cannot point at a secret.
 */
export function checkUploadable(file, { fsApi = fs, protectedDirs = [rockyDataDir()], maxBytes = MAX_UPLOAD_BYTES } = {}) {
  let real;
  try { real = fsApi.realpathSync(file); } catch { return { ok: false, error: `"${file}" does not exist.` }; }
  let st;
  try { st = fsApi.statSync(real); } catch { return { ok: false, error: `Rocky cannot read "${file}".` }; }
  if (!st.isFile()) return { ok: false, error: `"${path.basename(file)}" is a folder, not a file. Rocky only uploads single files.` };
  if (isSensitivePath(file, { protectedDirs }) || isSensitivePath(real, { protectedDirs })) {
    return { ok: false, error: `Rocky will not upload "${path.basename(file)}": it looks like a private key, password store, browser profile or Rocky's own memory.` };
  }
  if (st.size === 0) return { ok: false, error: `"${path.basename(file)}" is empty.` };
  if (st.size > maxBytes) return { ok: false, error: `"${path.basename(file)}" is ${(st.size / 1048576).toFixed(0)} MB; Rocky's limit for uploads is ${Math.round(maxBytes / 1048576)} MB.` };
  return { ok: true, file: real, size: st.size };
}

/** The folders a spoken file name is looked for in (OneDrive-redirected ones included). */
export function defaultSearchRoots({ home = os.homedir(), downloadDir = null, fsApi = fs } = {}) {
  const names = ['Desktop', 'Documents', 'Downloads', 'Pictures'];
  const roots = [];
  if (downloadDir) roots.push(downloadDir);
  for (const n of names) {
    roots.push(path.join(home, n));
    const oneDrive = path.join(home, 'OneDrive', n);
    if (fsApi.existsSync(oneDrive)) roots.push(oneDrive);
  }
  return [...new Set(roots)].filter((r) => fsApi.existsSync(r));
}

function walk(dir, depth, out, fsApi, limit = 5000) {
  let entries;
  try { entries = fsApi.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isFile()) out.push(full);
    else if (e.isDirectory() && depth > 0) walk(full, depth - 1, out, fsApi, limit);
  }
}

/**
 * Turn what Grace said ("my resume", "invoice.pdf", a full path) into one file.
 * @returns {{ file: string } | { error: string, candidates?: string[] }}
 */
export function resolveUserFile(spec, { roots = defaultSearchRoots(), fsApi = fs, home = os.homedir(), depth = 2 } = {}) {
  let s = String(spec ?? '').trim().replace(/^["']|["']$/g, '');
  if (!s) return { error: 'Which file? Rocky needs a file name or path.' };
  if (s.startsWith('~')) s = path.join(home, s.slice(1));

  if (path.isAbsolute(s) || /^[a-z]:[\\/]/i.test(s)) {
    return fsApi.existsSync(s) ? { file: s } : { error: `There is no file at "${s}".` };
  }

  const words = s.toLowerCase().replace(/^(my|the|a)\s+/, '').replace(/[^\p{L}\p{N}.\s_-]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.join('').length < 2) return { error: 'Which file? Rocky needs more of the file name than that.' };
  const wanted = words.join(' ');
  const wantedCompact = wanted.replace(/[\s_-]+/g, '');

  const files = [];
  for (const r of roots) walk(r, depth, files, fsApi);

  const scored = [];
  for (const f of files) {
    const base = path.basename(f).toLowerCase();
    const stem = base.replace(/\.[^.]+$/, '');
    const stemCompact = stem.replace(/[\s_-]+/g, '');
    let tier = 0;
    if (base === wanted || stem === wanted) tier = 4;
    else if (stemCompact === wantedCompact) tier = 4;
    else if (stem.startsWith(wanted) || stemCompact.startsWith(wantedCompact)) tier = 3;
    else if (words.every((w) => base.includes(w))) tier = 2;
    if (tier) {
      let mtime = 0;
      try { mtime = fsApi.statSync(f).mtimeMs; } catch { /* vanished */ }
      scored.push({ f, tier, mtime });
    }
  }
  if (!scored.length) return { error: `Rocky cannot find a file called "${s}" in Desktop, Documents, Downloads or Pictures.` };

  const top = Math.max(...scored.map((x) => x.tier));
  const best = scored.filter((x) => x.tier === top).sort((a, b) => b.mtime - a.mtime);
  if (best.length === 1) return { file: best[0].f };
  // Several files fit equally well. Say so rather than guess which one leaves the computer.
  return { error: `More than one file matches "${s}": ${best.slice(0, 5).map((x) => path.basename(x.f)).join(', ')}. Which one?`, candidates: best.slice(0, 5).map((x) => x.f) };
}
