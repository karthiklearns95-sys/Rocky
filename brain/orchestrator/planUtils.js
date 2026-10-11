/**
 * planUtils.js
 *
 * Pure utility helpers extracted from AgentLoop.
 * These functions have no dependency on agent state and can be unit-tested independently.
 */

import { appCatalog } from '../../resolver/installedApps.js';

/**
 * What Grace actually said. Commands that went through the semantic interpreter arrive as its JSON
 * ({ goal, entities, domain, ..., rawInput }) with her words in the rawInput field; plain text is
 * returned as is. Everything that looks at the sentence (searching, regexes, prompts, memory) must
 * use this, not the JSON, or it ends up matching JSON keys ("goal") instead of her words.
 */
export function userTextOf(rawInput) {
  const raw = String(rawInput ?? '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.rawInput === 'string' && parsed.rawInput.trim()) return parsed.rawInput;
        if (typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text;
      }
    } catch { /* not JSON after all: it is her sentence */ }
  }
  return raw;
}

/** The user's words for a context (set when the run starts; derived from rawInput otherwise). */
export function ctxText(ctx) {
  return ctx?.userText ?? userTextOf(ctx?.rawInput);
}

/**
 * Unwrap an entity value that may be an array (take first element) or a scalar.
 */
export function asEntityValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Infer the target application name from intent entities or the raw input string.
 * @param {object} ctx - Agent context object.
 * @returns {string|null}
 */
export function inferAppName(ctx) {
  const entities = ctx.intentData?.entities || {};
  const direct = asEntityValue(
    entities.app ||
    entities.application ||
    entities.appName ||
    entities.software ||
    entities.program
  );

  if (direct) return String(direct).toLowerCase();

  const lower = String(ctxText(ctx)).toLowerCase();
  const knownApps = ['spotify', 'notepad', 'calculator', 'chrome', 'edge', 'slack', 'whatsapp', 'vscode'];
  const fixed = knownApps.find((app) => lower.includes(app));
  if (fixed) return fixed;
  // Any other installed app named in the sentence (from the catalog of what is really installed).
  return appCatalog.findMentioned(lower)?.name.toLowerCase() || null;
}

/**
 * Extract literal text to type from the raw user input.
 * Looks for quoted strings or "write/type <text>" patterns.
 * @param {string} rawInput
 * @returns {string|null}
 */
export function extractTextToType(rawInput) {
  const text = String(rawInput || '');
  const quoted = text.match(/["'""](.+?)["'""]/) ;
  if (quoted) return quoted[1];

  const writeMatch = text.match(/\b(?:write|type)\s+(.+)$/i);
  if (writeMatch) return writeMatch[1].trim();

  if (/drink water/i.test(text)) return 'Reminder: drink water.';
  return null;
}

/**
 * Extract a search query string from intent entities or raw input.
 * @param {object} ctx - Agent context object.
 * @returns {string|null}
 */
export function extractSearchText(ctx) {
  const entities = ctx.intentData?.entities || {};
  const direct = asEntityValue(
    entities.song ||
    entities.artist ||
    entities.query ||
    entities.search ||
    entities.object_of_interest
  );
  if (direct) return String(direct);

  const raw = String(ctxText(ctx));
  const searchMatch = raw.match(/\bsearch\s+(?:for\s+)?(.+?)(?:,?\s+and\s+play|,?\s+and\s+open|$)/i);
  if (searchMatch) return searchMatch[1].trim();

  const playMatch = raw.match(/\bplay\s+(.+?)(?:\s+on\s+\w+|$)/i);
  if (playMatch) return playMatch[1].trim();

  return null;
}

/**
 * Extract a math expression from intent entities or raw input.
 * @param {object} ctx - Agent context object.
 * @returns {string}
 */
export function extractMathExpression(ctx) {
  const entities = ctx.intentData?.entities || {};
  if (entities.expression) return String(entities.expression);
  if (entities.number1 !== undefined && entities.number2 !== undefined) {
    const operator = entities.operator ||
      (entities.operation === 'multiply' ? '*' : null) ||
      (entities.operation === 'divide' ? '/' : null) ||
      (entities.operation === 'add' ? '+' : null) ||
      (entities.operation === 'subtract' ? '-' : null);
    if (operator) return `${entities.number1} ${operator} ${entities.number2}`;
  }

  return String(ctxText(ctx))
    .toLowerCase()
    .replace(/times|multiplied by/g, '*')
    .replace(/plus/g, '+')
    .replace(/minus/g, '-')
    .replace(/divided by|over/g, '/')
    .replace(/[^0-9+\-*\\/().%\s]/g, ' ')   // keep * (it was stripped, so "12 times 3" became "12 3")
    .replace(/\s+/g, ' ')
    .trim();
}
