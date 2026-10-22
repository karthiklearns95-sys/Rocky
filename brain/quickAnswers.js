import { normalizeSpoken } from '../resolver/appLaunchPlan.js';

/**
 * Questions Rocky can answer himself, instantly, without the model or any tool: the time, the date,
 * simple arithmetic. Before this, "what time is it" went to the automation planner, which made up a
 * plan to search Google.
 *
 * @returns {string|null} Rocky's answer, or null when this is not such a question
 */
export function quickAnswer(input, { now = new Date(), locale = undefined } = {}) {
  const q = normalizeSpoken(input).replace(/\b(please|rocky|right now|now|currently|exactly)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;

  if (/^(?:what(?:'?s| is) the time|what time is it|tell me the time|the time|time|what(?:'?s| is) the current time|current time|do you know (?:the|what) time(?: it is)?)$/.test(q)) {
    const t = now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    return `Grace, it is ${t}.`;
  }

  if (/^(?:what(?:'?s| is) (?:the |today's )?date(?: today)?|what(?:'?s| is) today(?:'s date)?|what day is (?:it|today)|which day is (?:it|today)|today's date|date|what is the day today)$/.test(q)) {
    const d = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `Grace, today is ${d}.`;
  }

  const m = q.match(/^(?:what(?:'?s| is)|calculate|compute|how much is|solve)\s+(.+)$/);
  if (m) {
    const expr = toSymbols(m[1]);
    if (/^[\d\s.+\-*/%()]+$/.test(expr) && /\d\s*[-+*/%]\s*[\d(]/.test(expr)) {
      const value = evaluate(expr);
      if (value !== null) return `Grace, ${m[1].trim()} is ${formatNumber(value)}.`;
    }
  }
  return null;
}

/** "12 times 4", "10 divided by 4", "15 percent of 200", "3 x 5" -> symbols. */
function toSymbols(text) {
  return text.toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)/g, '($1/100*$2)')
    .replace(/\bplus\b|\band\b/g, '+')
    .replace(/\bminus\b|\bless\b/g, '-')
    .replace(/\btimes\b|\bmultiplied by\b|\binto\b|(?<=\d)\s*x\s*(?=\d)|×/g, '*')
    .replace(/\bdivided by\b|\bover\b|÷/g, '/')
    .replace(/\bmod(?:ulo)?\b/g, '%')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/[?=]/g, '')
    .trim();
}

/**
 * A tiny arithmetic parser (+ - * / % and parentheses). Nothing from the sentence is ever executed as
 * code. Returns null for anything malformed or not finite.
 */
export function evaluate(expr) {
  const tokens = expr.match(/\d+(?:\.\d+)?|[-+*/%()]/g) || [];
  if (tokens.join('') !== expr.replace(/\s+/g, '')) return null;
  let i = 0;
  const peek = () => tokens[i];
  const factor = () => {
    const t = tokens[i++];
    if (t === '-') { const v = factor(); return v === null ? null : -v; }
    if (t === '+') return factor();
    if (t === '(') { const v = sum(); if (tokens[i++] !== ')') return null; return v; }
    return t !== undefined && /^\d/.test(t) ? Number(t) : null;
  };
  const product = () => {
    let v = factor();
    while (v !== null && ['*', '/', '%'].includes(peek())) {
      const op = tokens[i++], r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const sum = () => {
    let v = product();
    while (v !== null && ['+', '-'].includes(peek())) {
      const op = tokens[i++], r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return i === tokens.length && v !== null && Number.isFinite(v) ? v : null;
}

const formatNumber = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6));
