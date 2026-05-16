import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionStore } from './browserSessionStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * PlaywrightManager
 * Handles launching and connecting to the browser.
 */
class PlaywrightManager {
  constructor() {
    this.userDataDir = path.join(__dirname, '..', '..', 'data', 'browser_profile');
    this.executablePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
  }

  _findExecutable() {
    for (const p of this.executablePaths) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error('No compatible Chrome/Edge executable found on system.');
  }

  /**
   * Initializes or returns the existing browser context.
   */
  async getContext() {
    if (sessionStore.hasActiveContext()) {
      return sessionStore.context;
    }

    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    const execPath = this._findExecutable();
    console.log(`[PlaywrightManager] Launching persistent context using: ${execPath}`);

    const context = await chromium.launchPersistentContext(this.userDataDir, {
      executablePath: execPath,
      headless: false,
      viewport: null, // use default window size
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });

    sessionStore.setContext(context.browser(), context);

    // Track pages
    context.on('page', (page) => {
      const id = Date.now().toString();
      sessionStore.addPage(id, page);
      sessionStore.setActivePage(page);
      
      page.on('close', () => {
        sessionStore.removePage(id);
        if (sessionStore.activePage === page) {
          sessionStore.setActivePage(null);
        }
      });
    });

    // Populate initial pages
    const pages = context.pages();
    if (pages.length > 0) {
      sessionStore.setActivePage(pages[0]);
      pages.forEach(p => sessionStore.addPage(Date.now().toString() + Math.random(), p));
    }

    return context;
  }

  async getActivePage() {
    await this.getContext();
    if (!sessionStore.activePage) {
      const context = sessionStore.context;
      const page = await context.newPage();
      sessionStore.setActivePage(page);
    }
    return sessionStore.activePage;
  }
}

export const playwrightManager = new PlaywrightManager();
