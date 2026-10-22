import path from 'path';
import { playwrightManager as defaultManager } from './playwrightManager.js';
import { DomResolver } from './domResolver.js';
import { normalizeUrl } from './browserController.js';
import { isRiskyFile, formatBytes } from './downloadTracker.js';
import { resolveUserFile, checkUploadable, MAX_UPLOAD_FILES, defaultSearchRoots } from './fileSafety.js';

/**
 * transferController.js - files going down from and up to websites, in Rocky's browser.
 *
 *   browserDownload  click a control (or open an address) that downloads a file, wait for it to finish,
 *                    and report where it was saved. Also lists recent downloads. Never opens the file.
 *   browserUpload    attach files to a page's upload control. Never presses the site's Send/Submit.
 */

const aborted = (s) => s?.aborted;

export async function browserDownload(args = {}, manager = defaultManager) {
  const { query, url, action, _signal } = args;
  const tracker = manager.downloads;

  try {
    await manager.getContext();                  // makes sure the browser is up and the tracker attached

    if (action === 'list') {
      const recent = tracker.recent(8);
      if (!recent.length) return { success: true, data: 'Nothing has been downloaded in this session.' };
      return { success: true, data: recent.map((r) => `${r.state === 'completed' ? '✓' : r.state === 'canceled' ? '✗' : '…'} ${r.name} (${formatBytes(r.received)}) ${r.path || ''}`.trim()).join('\n') };
    }
    if (aborted(_signal)) return { success: false, error: 'Aborted' };

    const timeoutMs = Math.min(600, Math.max(1, Number(args.timeoutSec) || 60)) * 1000;
    const since = Date.now();
    let opened = null;                            // a tab we opened for an address, so a non-download is explained

    if (url) {
      const target = normalizeUrl(url);
      if (!target) return { success: false, error: `"${url}" is not a web address Rocky can open.` };
      const context = await manager.getContext();
      opened = await context.newPage();
      // A download makes goto "fail" (the navigation is cancelled by the download): expected, not an error.
      opened.goto(target, { waitUntil: 'commit' }).catch(() => {});
    } else if (query) {
      const page = await manager.getActivePage();
      const locator = await new DomResolver(page).resolve(query);
      if (!locator) return { success: false, error: `Could not find "${query}" on this page to download from.` };
      await locator.click({ timeout: 5000 });
    } else {
      const running = tracker.records.find((r) => r.state === 'inProgress');
      if (!running) return { success: false, error: 'Tell Rocky what to download: the name of the link or button, or an address.' };
    }

    const rec = (!url && !query) ? tracker.records.find((r) => r.state === 'inProgress') : await tracker.waitForStart(since, 10000);
    if (!rec) {
      const what = url ? 'that address opened a page, not a download (the tab is left open)' : `clicking "${query}" did not start a download`;
      return { success: false, error: `Nothing downloaded: ${what}.` };
    }
    if (opened && !opened.isClosed() && opened.url() === 'about:blank') await opened.close().catch(() => {});

    await tracker.waitForDone(rec, timeoutMs, _signal);
    if (aborted(_signal)) return { success: false, error: 'Aborted' };

    if (rec.state === 'canceled') return { success: false, error: `The download of "${rec.name}" ${rec.error ? `failed: ${rec.error}` : 'was cancelled by the browser (blocked or interrupted)'}.` };
    if (rec.state !== 'completed') {
      return { success: false, error: `"${rec.name}" is still downloading (${formatBytes(rec.received)}${rec.total ? ` of ${formatBytes(rec.total)}` : ''}). It will finish on its own; ask again later.` };
    }
    const risky = isRiskyFile(rec.name) ? ' Careful: this type of file can run code. Rocky has not opened it.' : '';
    return { success: true, path: rec.path, data: `Downloaded "${path.basename(rec.path)}" (${formatBytes(rec.received)}) to ${rec.path}.${risky}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const isFileInput = (locator) => locator.evaluate((el) => el.tagName === 'INPUT' && el.type === 'file').catch(() => false);
const filesIn = (handleOrLocator) => handleOrLocator.evaluate((el) => [...el.files].map((f) => f.name));

/** { query?, path | file | files } -> attaches the files; does not submit anything. */
export async function browserUpload(args = {}, manager = defaultManager, { roots = null } = {}) {
  const { query, _signal } = args;
  const specs = [args.files, args.paths, args.path, args.file].flat().filter((x) => x !== undefined && x !== null && x !== '');
  if (!specs.length) return { success: false, error: 'Which file should Rocky upload? Give a file name or path.' };
  if (specs.length > MAX_UPLOAD_FILES) return { success: false, error: `Rocky uploads at most ${MAX_UPLOAD_FILES} files at once.` };
  if (aborted(_signal)) return { success: false, error: 'Aborted' };

  // Every file must pass before anything is attached: all or nothing.
  const files = [];
  for (const spec of specs) {
    const found = resolveUserFile(spec, { roots: roots || defaultSearchRoots({ downloadDir: manager.downloads?.dir }) });
    if (found.error) return { success: false, error: found.error };
    const ok = checkUploadable(found.file);
    if (!ok.ok) return { success: false, error: ok.error };
    files.push(ok.file);
  }

  try {
    const page = await manager.getActivePage();
    const host = (() => { try { return new URL(page.url()).host; } catch { return 'this page'; } })();
    let names = null;

    const attachTo = async (input) => {
      if (files.length > 1 && !(await input.evaluate((el) => el.multiple))) {
        throw Object.assign(new Error('That upload control accepts only one file.'), { friendly: true });
      }
      await input.setInputFiles(files, { timeout: 8000 });
      return filesIn(input);
    };

    if (query) {
      const control = await new DomResolver(page).resolve(query, 'button');
      if (control) {
        if (await isFileInput(control)) {
          names = await attachTo(control);
        } else {
          // A styled button that opens the file dialog: intercept the dialog instead of showing it.
          const chooser = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
          await control.click({ timeout: 5000 });
          const fc = await chooser;
          if (fc) {
            if (files.length > 1 && !fc.isMultiple()) return { success: false, error: 'That upload control accepts only one file.' };
            await fc.setFiles(files);
            names = await filesIn(fc.element());
          }
        }
      }
    }

    if (!names) {
      // No (working) control named: the page's file input, even a hidden one, if there is exactly one.
      const inputs = page.locator('input[type="file"]');
      const count = await inputs.count();
      if (count === 1) names = await attachTo(inputs.first());
      else if (count === 0) return { success: false, error: query ? `Could not find an upload control "${query}" on this page.` : 'There is no upload control on this page.' };
      else return { success: false, error: `This page has ${count} upload controls; tell Rocky which one (for example "Upload resume").` };
    }

    if (!names.length) return { success: false, error: 'The page did not accept the file.' };
    return {
      success: true,
      data: `Attached ${names.map((n) => `"${n}"`).join(', ')} to the upload on ${host}. It is not sent yet: the page's own Submit/Send/Upload button still has to be pressed.`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
