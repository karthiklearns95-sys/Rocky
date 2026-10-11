import { appCatalog } from './installedApps.js';
import { userTextOf } from '../brain/orchestrator/planUtils.js';

/**
 * What Grace actually said. Commands that went through the semantic interpreter arrive as its
 * JSON (ctx.rawInput is that JSON), with her words in the rawInput field.
 */
export function plainText(ctx) {
  return String(ctx?.userText ?? userTextOf(ctx?.rawInput)).toLowerCase().trim();
}

/**
 * A plain "open/launch/start <app>" for an app that is really installed becomes the standard
 * open -> wait -> focus plan. Anything with more in it ("open notepad and write hello") is left
 * to the normal routing, as are close calls between two apps.
 *
 * @returns {Array|null} plan steps, or null when this is not a simple launch of an installed app
 */
export function installedAppLaunchPlan(input, catalog = appCatalog) {
  const m = String(input || '').match(/^(?:please\s+)?(?:open|launch|start|run)\s+(?:up\s+)?(?:the\s+)?(.+?)(?:\s+app(?:lication)?)?$/);
  if (!m) return null;
  const found = catalog.lookup(m[1]);
  if (!found.best || found.ambiguous || found.score < 0.9) return null;
  const name = found.best.name;
  console.log(`[SemanticRouter] Installed-app launch: "${m[1]}" -> ${name} (${found.why})`);
  return [
    { tool: 'open_resource', input: { query: name } },
    { tool: 'waitForAppReady', input: { appName: name } },
    { tool: 'focusWindow', input: { appName: name } },
  ];
}
