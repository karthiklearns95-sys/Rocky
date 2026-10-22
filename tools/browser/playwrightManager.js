import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionStore } from './browserSessionStore.js';
import { ensureBrowser } from './chromeLauncher.js';
import { DownloadTracker, defaultDownloadDir } from './downloadTracker.js';
import config from '../../config/app.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Chrome keeps internal "pages" (new-tab footer, extension and DevTools windows, omnibox popup) that
 * show up next to real tabs over CDP. They are not tabs Grace can see, so Rocky never works in them.
 */
export function isRealTab(page) {
  let url = '';
  try { url = page.url(); } catch { return false; }
  return !/^(chrome-extension|devtools|chrome-untrusted|chrome-search):/i.test(url)
    && !/^chrome:\/\/(newtab-footer|omnibox-popup|tab-search|tabstrip|webui-)/i.test(url);
}

/**
 * PlaywrightManager - Rocky's connection to his browser.
 *
 * The browser is a normal Chrome/Edge window started with a DevTools port (see chromeLauncher.js),
 * and Playwright attaches to it over CDP. So it keeps running if Rocky restarts, it keeps its logins
 * (its own profile folder), and tabs that are already open are visible to Rocky.
 */
export class PlaywrightManager {
  constructor({ store = sessionStore, driver = chromium, ensure = ensureBrowser, settings = config.browser, userDataDir = null, extraArgs = [], downloads = null } = {}) {
    this.store = store;
    this.driver = driver;
    this.ensure = ensure;
    this.settings = settings;
    this.extraArgs = extraArgs;
    this.downloads = downloads || new DownloadTracker({ dir: defaultDownloadDir(settings?.downloadDir) });
    this.userDataDir = userDataDir || path.join(__dirname, '..', '..', 'data', 'browser_profile');
    this._connecting = null;
  }

  /** The browser context (the window's default one), starting/attaching the browser if needed. */
  async getContext() {
    if (this.store.hasActiveContext() && this.store.browser.isConnected()) return this.store.context;
    // Two tools asking at once must not start two browsers.
    this._connecting ||= this._connect().finally(() => { this._connecting = null; });
    return this._connecting;
  }

  async _connect() {
    this._forget();
    const { endpoint, launched } = await this.ensure({
      port: this.settings.debugPort, userDataDir: this.userDataDir,
      executable: this.settings.executable, startTimeoutMs: this.settings.startTimeoutMs, extraArgs: this.extraArgs,
    });
    console.log(`[Browser] ${launched ? 'Started' : 'Found'} Rocky's browser at ${endpoint}`);

    const browser = await this.driver.connectOverCDP(endpoint);
    const context = browser.contexts()[0] || await browser.newContext();
    this.store.setContext(browser, context);
    await this.downloads.attach(browser).catch((e) => console.warn(`[Browser] Could not watch downloads: ${e.message}`));
    browser.on('disconnected', () => { if (this.store.browser === browser) this._forget(); });

    const track = (page) => {
      // The address of a brand-new tab is often still blank here; internal pages are filtered on use too.
      if (isRealTab(page)) this.store.setActivePage(page);
      page.on('close', () => { if (this.store.activePage === page) this.store.setActivePage(null); });
    };
    context.on('page', track);              // a tab opened by a click or by Rocky becomes the one in use
    const open = context.pages().filter(isRealTab);
    if (open.length) this.store.setActivePage(open[open.length - 1]);
    return context;
  }

  _forget() {
    this.store.context = null;
    this.store.browser = null;
    this.store.activePage = null;
    this.store.pages.clear();
  }

  /** The tab Rocky is working in. If it was closed, the newest open tab; if none, a new one. */
  async getActivePage() {
    const context = await this.getContext();
    let page = this.store.activePage;
    if (!page || page.isClosed() || !isRealTab(page)) {
      const open = context.pages().filter((p) => !p.isClosed() && isRealTab(p));
      page = open[open.length - 1] || await context.newPage();
      this.store.setActivePage(page);
    }
    return page;
  }

  /** Open tabs as [{ index, title, url, active }]. */
  async listTabs() {
    const context = await this.getContext();
    const active = this.store.activePage;
    const tabs = [];
    for (const [index, page] of context.pages().filter((p) => !p.isClosed() && isRealTab(p)).entries()) {
      tabs.push({ index, title: await page.title().catch(() => ''), url: page.url(), active: page === active, page });
    }
    return tabs;
  }

  /** Disconnect Rocky from the browser. The browser itself keeps running. */
  async disconnect() {
    const browser = this.store.browser;
    this._forget();
    try { await browser?.close(); } catch { /* already gone */ }
  }
}

export const playwrightManager = new PlaywrightManager();
