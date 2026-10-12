/**
 * domResolver.js
 *
 * Turns "search bar" / "Play button" / "video link" into one element on the page, using what the
 * page itself says about its controls (accessible roles and names, placeholders, labels, titles).
 *
 * Careful about what it will NOT do: it never guesses an unrelated control. If nothing matches the
 * words, it returns null and the tool says so, instead of clicking whichever input came first.
 */

const FILLER = new Set(['the', 'a', 'an', 'my', 'this', 'that']);
// Words that describe the KIND of control, not its name: "search bar" is a control named "search".
const KIND_WORDS = {
  button: ['button'], link: ['link'], tab: ['tab'], checkbox: ['checkbox', 'checkboxes', 'tickbox'],
  textbox: ['bar', 'box', 'field', 'input', 'textbox'], menuitem: ['menu', 'item'],
};
const KIND_ROLES = {
  button: ['button'], link: ['link'], tab: ['tab'], checkbox: ['checkbox', 'switch'],
  textbox: ['searchbox', 'textbox', 'combobox'], menuitem: ['menuitem', 'option'],
};
const ALL_ROLES = ['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'option', 'switch'];

/** Split "search bar" into { name: 'search', kinds: ['textbox'] }. */
export function parseQuery(query, roleHint = null) {
  const words = String(query || '').toLowerCase().replace(/[^\p{L}\p{N}\s'+#&.-]/gu, ' ').split(/\s+/).filter(Boolean);
  const kinds = new Set();
  const nameWords = [];
  for (const w of words) {
    const kind = Object.keys(KIND_WORDS).find((k) => KIND_WORDS[k].includes(w));
    if (kind) kinds.add(kind);
    else if (!FILLER.has(w)) nameWords.push(w);
  }
  if (roleHint && KIND_ROLES[roleHint]) kinds.add(roleHint);
  return { raw: String(query || '').trim(), name: nameWords.join(' '), kinds: [...kinds] };
}

export class DomResolver {
  constructor(page) {
    this.page = page;
  }

  /**
   * Find one visible element. `roleHint` is a Playwright role ('textbox', 'button', ...) when the
   * caller knows what kind of control it needs. Waits up to `timeoutMs` for the page to produce it.
   */
  async resolve(query, roleHint = null, { timeoutMs = 2000, intervalMs = 250 } = {}) {
    const q = parseQuery(query, roleHint);
    if (!q.raw) return null;
    const deadline = Date.now() + timeoutMs;
    do {
      const hit = await this._attempt(q, roleHint);
      if (hit) return hit;
      if (Date.now() + intervalMs >= deadline) break;
      await new Promise((r) => setTimeout(r, intervalMs));
    } while (true);
    return null;
  }

  async _visible(locator) {
    try {
      const shown = locator.filter({ visible: true }).first();
      return (await shown.count()) > 0 ? shown : null;
    } catch { return null; }
  }

  async _attempt(q, roleHint) {
    const page = this.page;
    // The names to try: what she said, then without the "bar/button/link" words.
    const names = [...new Set([q.raw, q.name].filter(Boolean))];
    const roles = q.kinds.length ? q.kinds.flatMap((k) => KIND_ROLES[k]) : ALL_ROLES;
    if (roleHint && !roles.includes(roleHint)) roles.unshift(roleHint);

    for (const exact of [true, false]) {
      for (const name of names) {
        for (const role of roles) {
          const hit = await this._visible(page.getByRole(role, { name, exact }));
          if (hit) return hit;
        }
      }
    }
    for (const name of names) {
      for (const make of [
        () => page.getByPlaceholder(name),
        () => page.getByLabel(name),
        () => page.getByTitle(name),
        () => page.getByAltText(name),
      ]) {
        const hit = await this._visible(make());
        if (hit) return hit;
      }
    }
    // Plain visible text, but only for controls that are clickable: a paragraph that merely
    // mentions the words is not what she asked to press.
    if (!q.kinds.includes('textbox')) {
      for (const name of names) {
        const hit = await this._visible(page.getByText(name, { exact: false }));
        if (hit) return hit;
      }
    }
    // "search bar" on a page whose search box has no name at all: the first visible text input is a
    // fair guess for typing, and only for a search box (never as a guess for anything else).
    if ((q.kinds.includes('textbox') || roleHint === 'textbox') && /\b(search|find)\b/i.test(q.raw)) {
      return this._visible(page.locator('input[type="search"], input[type="text"], input:not([type]), textarea, [role="searchbox"], [role="combobox"]'));
    }
    return null;
  }
}
