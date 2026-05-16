import { playwrightManager } from './playwrightManager.js';
import { DomResolver } from './domResolver.js';

/**
 * browserController.js
 * 
 * Provides Playwright automation tools for Rocky's planner.
 */

export async function openURL(args) {
  const { url, _signal } = args;
  if (!url) return { success: false, error: 'URL is required' };
  if (_signal?.aborted) return { success: false, error: 'Aborted' };

  try {
    const page = await playwrightManager.getActivePage();
    let finalUrl = url.toLowerCase();
    if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
    
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
    return { success: true, data: `Navigated to ${finalUrl}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function browserClick(args) {
  const { query, roleHint, _signal } = args;
  if (!query) return { success: false, error: 'query is required' };
  if (_signal?.aborted) return { success: false, error: 'Aborted' };

  try {
    const page = await playwrightManager.getActivePage();
    const resolver = new DomResolver(page);
    const locator = await resolver.resolve(query, roleHint);

    if (locator) {
      if (_signal?.aborted) return { success: false, error: 'Aborted' };
      await locator.click();
      
      // Validation: Wait for potential DOM updates
      if (_signal?.aborted) return { success: false, error: 'Aborted' };
      await page.waitForTimeout(1000); 
      
      if (_signal?.aborted) return { success: false, error: 'Aborted' };
      const newTitle = await page.title();
      
      return { success: true, data: `Clicked on ${query}. Current page: ${newTitle}` };
    } else {
      return { success: false, error: `Could not find element matching "${query}" in DOM` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function browserType(args) {
  const { query, text, roleHint, pressEnter, _signal } = args;
  if (!text) return { success: false, error: 'text is required' };
  if (_signal?.aborted) return { success: false, error: 'Aborted' };

  try {
    const page = await playwrightManager.getActivePage();
    
    if (query) {
      const resolver = new DomResolver(page);
      const locator = await resolver.resolve(query, roleHint || 'textbox');
      
      if (locator) {
        if (_signal?.aborted) return { success: false, error: 'Aborted' };
        await locator.fill(text);
        if (pressEnter) {
          if (_signal?.aborted) return { success: false, error: 'Aborted' };
          await locator.press('Enter');
          await page.waitForTimeout(1000);
        }
        return { success: true, data: `Typed into ${query}. Page title: ${await page.title()}` };
      } else {
        return { success: false, error: `Could not find input matching "${query}"` };
      }
    } else {
      if (_signal?.aborted) return { success: false, error: 'Aborted' };
      await page.keyboard.type(text);
      if (pressEnter) {
        if (_signal?.aborted) return { success: false, error: 'Aborted' };
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
      }
      return { success: true, data: `Typed text. Page title: ${await page.title()}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function browserRead(args) {
  const { _signal } = args;
  if (_signal?.aborted) return { success: false, error: 'Aborted' };
  try {
    const page = await playwrightManager.getActivePage();
    const text = await page.evaluate(() => document.body.innerText);
    return { success: true, data: text.substring(0, 2000) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
