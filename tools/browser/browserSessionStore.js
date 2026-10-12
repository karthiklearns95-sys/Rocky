/**
 * browserSessionStore.js
 * 
 * Manages active browser sessions, tabs, and page context.
 */

class BrowserSessionStore {
  constructor() {
    this.context = null;
    this.activePage = null;
    this.browser = null;
    this.pages = new Map(); // id -> page
  }

  setContext(browser, context) {
    this.browser = browser;
    this.context = context;
  }

  setActivePage(page) {
    this.activePage = page;
  }

  addPage(id, page) {
    this.pages.set(id, page);
  }

  removePage(id) {
    this.pages.delete(id);
  }

  hasActiveContext() {
    return this.context !== null && this.browser !== null;
  }

  async closeAll() {
    // Only disconnect: the browser is Rocky's visible window and keeps running.
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    this.context = null;
    this.browser = null;
    this.activePage = null;
    this.pages.clear();
  }
}

export const sessionStore = new BrowserSessionStore();
