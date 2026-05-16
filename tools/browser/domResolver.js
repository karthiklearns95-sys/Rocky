/**
 * domResolver.js
 * 
 * Semantic DOM resolution using Playwright locators.
 * Translates intent (like "search bar" or "play button") into robust selectors.
 */

export class DomResolver {
  constructor(page) {
    this.page = page;
  }

  /**
   * Attempts to find an element using multiple semantic strategies.
   */
  async resolve(query, roleHint = null) {
    const q = query.toLowerCase();

    // 1. Explicit Role-based strategy (e.g. searching for a button)
    if (roleHint) {
      try {
        const locator = this.page.getByRole(roleHint, { name: new RegExp(query, 'i') }).first();
        if (await locator.isVisible({ timeout: 500 })) return locator;
      } catch (e) {}
    }

    // 2. Placeholder strategy (often used for search bars/inputs)
    try {
      const locator = this.page.getByPlaceholder(new RegExp(query, 'i')).first();
      if (await locator.isVisible({ timeout: 500 })) return locator;
    } catch (e) {}

    // 3. Label/Text strategy
    try {
      const locator = this.page.getByText(new RegExp(query, 'i')).first();
      if (await locator.isVisible({ timeout: 500 })) return locator;
    } catch (e) {}
    
    // 4. Title/Aria-label fallback (using css locators for attributes)
    try {
      const locator = this.page.locator(`[title*="${query}" i], [aria-label*="${query}" i]`).first();
      if (await locator.isVisible({ timeout: 500 })) return locator;
    } catch (e) {}

    // 5. General generic fallback (try to match anything actionable)
    try {
      const locator = this.page.locator(`button:has-text("${query}"), input[type="text"], input[type="search"]`).first();
      if (await locator.isVisible({ timeout: 500 })) return locator;
    } catch (e) {}

    return null; // Resolution failed
  }
}
