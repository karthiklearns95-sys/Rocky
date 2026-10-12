import { playwrightManager as defaultManager } from './playwrightManager.js';
import { DomResolver } from './domResolver.js';

/**
 * browserController.js
 *
 * Rocky's browser tools, driven over the DevTools protocol (see playwrightManager.js).
 * Every tool takes an optional `manager` (tests pass a fake) as its second argument.
 */

const MAX_READ = 3000;

/** Only web addresses: the planner's text must never become javascript:, file: or chrome: navigation. */
export function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : /^(about:blank)$/i.test(raw) ? raw : `https://${raw}`;
  if (/^about:blank$/i.test(withScheme)) return withScheme;
  let url;
  try { url = new URL(withScheme); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || /\s/.test(raw)) return null;       // "youtube cats" is a search, not an address
  return url.href;
}

/** What the page offers right now: its accessible structure (roles and names), or plain text. */
export async function pageOutline(page, limit = MAX_READ) {
  let text;
  try {
    text = await page.locator('body').ariaSnapshot({ timeout: 3000 });
  } catch {
    try { text = await page.evaluate(() => document.body?.innerText || ''); } catch { text = ''; }
  }
  return text.length > limit ? `${text.slice(0, limit)}\n… (cut)` : text;
}

/** A cheap fingerprint of the page, to tell whether something changed after a click. */
export async function pageSignature(page) {
  let body = '';
  try { body = await page.locator('body').ariaSnapshot({ timeout: 2000 }); } catch { /* use url/title only */ }
  let h = 0;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) | 0;
  return `${page.url()}|${await page.title().catch(() => '')}|${body.length}|${h}`;
}

/** Wait (up to timeoutMs) for the page to differ from `before`. Returns true when it did. */
async function waitForChange(page, before, { timeoutMs = 1500, intervalMs = 150 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (await pageSignature(page) !== before) {
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

const aborted = (signal) => signal?.aborted;

export async function openURL(args, manager = defaultManager) {
  const { url, _signal } = args;
  if (!url) return { success: false, error: 'URL is required' };
  if (aborted(_signal)) return { success: false, error: 'Aborted' };
  const target = normalizeUrl(url);
  if (!target) return { success: false, error: `"${url}" is not a web address Rocky can open.` };

  try {
    const page = await manager.getActivePage();
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.bringToFront().catch(() => {});
    return { success: true, data: `Navigated to ${page.url()} ("${await page.title().catch(() => '')}")` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function browserClick(args, manager = defaultManager) {
  const { query, roleHint, _signal } = args;
  if (!query) return { success: false, error: 'query is required' };
  if (aborted(_signal)) return { success: false, error: 'Aborted' };

  try {
    const page = await manager.getActivePage();
    const locator = await new DomResolver(page).resolve(query, roleHint);
    if (!locator) return { success: false, error: `Could not find "${query}" on this page.` };

    if (aborted(_signal)) return { success: false, error: 'Aborted' };
    const before = await pageSignature(page);
    const known = new Set((await manager.listTabs?.() || []).map((t) => t.url));
    await locator.click({ timeout: 5000 });

    if (aborted(_signal)) return { success: false, error: 'Aborted' };
    const changed = await waitForChange(page, before);
    const now = manager.getActivePage ? await manager.getActivePage() : page;   // a click may open a new tab
    const title = await now.title().catch(() => '');
    const openedTab = now !== page || (await manager.listTabs?.() || []).some((t) => !known.has(t.url));
    return {
      success: true,
      verdict: changed || openedTab ? 'changed' : 'unchanged',
      data: `Clicked "${query}". ${changed || openedTab ? '' : 'The page did not visibly change. '}Current page: ${title} (${now.url()})`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function browserType(args, manager = defaultManager) {
  const { query, text, roleHint, pressEnter, _signal } = args;
  if (text === undefined || text === null || text === '') return { success: false, error: 'text is required' };
  if (aborted(_signal)) return { success: false, error: 'Aborted' };

  try {
    const page = await manager.getActivePage();
    let target = page.keyboard;
    if (query) {
      const locator = await new DomResolver(page).resolve(query, roleHint || 'textbox');
      if (!locator) return { success: false, error: `Could not find an input matching "${query}"` };
      await locator.fill(String(text), { timeout: 5000 });
      target = locator;
    } else {
      await page.keyboard.type(String(text));
    }
    if (pressEnter) {
      if (aborted(_signal)) return { success: false, error: 'Aborted' };
      const before = await pageSignature(page);
      await target.press('Enter');
      await waitForChange(page, before, { timeoutMs: 2500 });
    }
    return { success: true, data: `Typed ${query ? `into ${query}` : 'text'}${pressEnter ? ' and pressed Enter' : ''}. Page: ${await page.title().catch(() => '')} (${page.url()})` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** Read the page: its title, address and what is on it (controls and text). */
export async function browserRead(args = {}, manager = defaultManager) {
  const { _signal } = args;
  if (aborted(_signal)) return { success: false, error: 'Aborted' };
  try {
    const page = await manager.getActivePage();
    const outline = await pageOutline(page);
    return { success: true, data: `Page: ${await page.title().catch(() => '')}\nAddress: ${page.url()}\n${outline}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Tabs: { action: 'list' | 'switch' | 'close' | 'new', query?, index?, url? }.
 * 'switch'/'close' pick a tab by index, or by words from its title or address.
 */
export async function browserTabs(args = {}, manager = defaultManager) {
  const { action = 'list', query, index, url, _signal } = args;
  if (aborted(_signal)) return { success: false, error: 'Aborted' };
  try {
    if (action === 'new') {
      const target = url ? normalizeUrl(url) : 'about:blank';
      if (!target) return { success: false, error: `"${url}" is not a web address Rocky can open.` };
      const context = await manager.getContext();
      const page = await context.newPage();
      if (target !== 'about:blank') await page.goto(target, { waitUntil: 'domcontentloaded' });
      await page.bringToFront().catch(() => {});
      return { success: true, data: `Opened a new tab: ${await page.title().catch(() => '')} (${page.url()})` };
    }

    const tabs = await manager.listTabs();
    if (action === 'list') {
      if (!tabs.length) return { success: true, data: 'No tabs are open.' };
      return { success: true, data: tabs.map((t) => `${t.active ? '*' : ' '} ${t.index + 1}. ${t.title || '(untitled)'} - ${t.url}`).join('\n') };
    }

    if (action !== 'switch' && action !== 'close') return { success: false, error: `Unknown tab action "${action}".` };
    const tab = pickTab(tabs, { query, index });
    if (!tab) return { success: false, error: `No open tab matches ${query ? `"${query}"` : `number ${Number(index) + 1}`}.` };

    if (action === 'switch') {
      await tab.page.bringToFront();
      manager.store.setActivePage(tab.page);
      return { success: true, data: `Switched to "${tab.title}" (${tab.url})` };
    }
    await tab.page.close();
    return { success: true, data: `Closed "${tab.title}".` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** A tab by 0-based index, or the best title/address match for the words. */
export function pickTab(tabs, { query, index }) {
  if (Number.isInteger(Number(index)) && index !== undefined && index !== null && index !== '') {
    return tabs[Number(index)] || null;
  }
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let best = null, bestScore = 0;
  for (const t of tabs) {
    const hay = `${t.title} ${t.url}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length / words.length;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}
