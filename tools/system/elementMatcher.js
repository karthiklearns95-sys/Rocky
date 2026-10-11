/**
 * elementMatcher - pick the right on-screen element for a spoken description.
 *
 * Pure functions (no OS calls) so the matching rules are testable and shared by
 * the UI Automation tier and the OCR tier of locateUIElement.
 */

// Words that describe the action or the kind of control, not the target itself.
const FILLER = new Set(['click', 'press', 'tap', 'hit', 'select', 'choose', 'open', 'launch', 'go', 'show', 'goto', 'the', 'a', 'an', 'on', 'to', 'at', 'button', 'icon', 'option', 'tab', 'link', 'menu', 'item', 'please', 'rocky']);

// Controls people actually click, and ones that are usually just labels or containers.
const CLICKABLE = /(Button|MenuItem|Hyperlink|TabItem|CheckBox|RadioButton|ListItem|SplitButton|ComboBox|Edit|TreeItem|DataItem)$/;
const CONTAINER = /(Pane|Window|Group|Text|Image|Custom|Document|Header|ToolBar|StatusBar|TitleBar|ScrollBar)$/;

export const normalize = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** "click the Send button" -> "send". Falls back to the full text if everything is filler. */
export function cleanQuery(query) {
  const words = normalize(query).split(' ').filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w));
  return (kept.length ? kept : words).join(' ');
}

const tokens = (s) => normalize(s).split(' ').filter((w) => w.length >= 2 && !FILLER.has(w));

/** Parse "x,y,w,h" (as the worker and the old script emit) into numbers, or null. */
export function parseRect(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n));
  if (parts.length < 4) return null;
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h, cx: Math.round(x + w / 2), cy: Math.round(y + h / 2) };
}

function textScore(q, qTokens, name) {
  const n = normalize(name);
  if (!n) return 0;
  if (n === q) return 1;
  const padded = ` ${n} `;
  if (n.startsWith(`${q} `) || n.endsWith(` ${q}`) || padded.includes(` ${q} `)) return 0.82; // the target is a whole word/phrase in the name
  if (q.length >= 3 && q.includes(n) && n.length >= 3) return 0.62;                            // name is a clear part of what was asked
  if (n.length >= 3 && n.includes(q) && q.length >= 3) return 0.55;                           // substring only (e.g. "set" in "settings")
  // Word-level match. Either everything in the name was asked for ("New Tab" for "open a new tab"),
  // or everything asked for is in the name. One shared word out of several is not a match: it is how
  // "open settings" used to land on a button called "Open file".
  const nTokens = tokens(name);
  if (qTokens.length === 0 || nTokens.length === 0) return 0;
  const shared = qTokens.filter((t) => nTokens.includes(t)).length;
  if (shared === 0) return 0;
  if (shared !== nTokens.length && shared !== qTokens.length) return 0;
  return 0.6 + 0.2 * (shared / Math.max(qTokens.length, nTokens.length));
}

/**
 * Rank UI Automation elements for a description.
 * @param {Array} elements objects with Name, AutomationId, ControlType, BoundingRectangle ("x,y,w,h"), IsOffscreen
 * @returns {Array<{element, x, y, score}>} best first; only plausible matches (score >= minScore)
 */
export function rankElements(elements, query, { minScore = 0.5 } = {}) {
  const q = cleanQuery(query);
  if (!q || !Array.isArray(elements)) return [];
  const qTokens = tokens(q);
  const ranked = [];

  for (const element of elements) {
    const rect = parseRect(element.BoundingRectangle);
    if (!rect || element.IsOffscreen === true) continue;           // can't click what isn't visible

    let score = Math.max(
      textScore(q, qTokens, element.Name),
      normalize(element.AutomationId) === q ? 0.85 : 0,
    );
    if (score === 0) continue;

    const type = String(element.ControlType || '');
    if (CLICKABLE.test(type)) score += 0.05;
    else if (CONTAINER.test(type)) score -= score < 1 ? 0.1 : 0.05;

    if (score >= minScore) ranked.push({ element, x: rect.cx, y: rect.cy, score, area: rect.w * rect.h });
  }

  // Best score first; between equals prefer the smaller (more specific) control.
  ranked.sort((a, b) => b.score - a.score || a.area - b.area);
  return ranked.map(({ area, score, ...rest }) => ({ ...rest, score: Math.min(1, Math.round(score * 100) / 100) }));
}

/**
 * Find text in OCR output. `lines` are [{ text, words: [{ t, x, y, w, h }] }].
 * Clicks the matched words only, not the middle of the whole line: in
 * "Home Settings About" the target "settings" is one word, not the line centre.
 */
export function matchOcrLines(lines, query) {
  const q = normalize(cleanQuery(query));
  if (!q || !Array.isArray(lines)) return null;
  const hits = [];

  for (const line of lines) {
    const words = (line.words || []).filter((w) => w && typeof w.x === 'number');
    if (words.length === 0) continue;

    // Normalised words with their original index, so a phrase can span words.
    const norm = words.map((w) => normalize(w.t));
    const joined = norm.join(' ');
    const at = (` ${joined} `).indexOf(` ${q} `);
    let first = -1, last = -1, score = 0;

    if (at >= 0) {
      // Map the character offset back to word indexes.
      const before = joined.slice(0, at).split(' ').filter(Boolean).length;
      const span = q.split(' ').length;
      first = before; last = before + span - 1; score = 1;
    } else if (joined.includes(q)) {
      const idx = norm.findIndex((w) => w.includes(q));
      if (idx >= 0) { first = last = idx; score = 0.7; }
    }
    if (first < 0 || last >= words.length) continue;

    const used = words.slice(first, last + 1);
    const x0 = Math.min(...used.map((w) => w.x)), y0 = Math.min(...used.map((w) => w.y));
    const x1 = Math.max(...used.map((w) => w.x + w.w)), y1 = Math.max(...used.map((w) => w.y + w.h));
    hits.push({ text: used.map((w) => w.t).join(' '), x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits[0] || null;
}
