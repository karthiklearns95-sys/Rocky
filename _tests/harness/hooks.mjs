// Module loader hooks for the AgentLoop characterization tests.
//
//  * resolve: swaps the heavy / native / OS-bound modules (vector DB, microphone, Windows APIs,
//    worker threads) for scripted stand-ins from ./stubs, so the real AgentLoop, ClickResolver,
//    UIMapCoordinator, event bus, personality and plan helpers run unchanged on any machine.
//  * load: points the two modules that persist to data/ at a temp directory.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const stubDir = path.join(here, 'stubs');

const STUBS = new Map([
  ['brain/orchestrator/semanticRouter.js', 'semanticRouter.mjs'],
  ['brain/orchestrator/delegationManager.js', 'delegationManager.mjs'],
  ['brain/orchestrator/initiativeEngine.js', 'initiativeEngine.mjs'],
  ['voice/voiceController.js', 'voiceController.mjs'],
  ['memory/userMemory.js', 'userMemory.mjs'],
  ['memory/contextManager.js', 'contextManager.mjs'],
  ['memory/graphManager.js', 'graphManager.mjs'],
  ['memory/factExtractor.js', 'factExtractor.mjs'],
  ['automation/system/getActiveWindow.js', 'getActiveWindow.mjs'],
  ['automation/system/getSystemMetrics.js', 'getSystemMetrics.mjs'],
  ['automation/system/displays.js', 'displays.mjs'],
  ['automation/system/execWithTimeout.js', 'execWithTimeout.mjs'],
  ['tools/system/guiControl.js', 'guiControl.mjs'],
  ['tools/system/verifyExecution.js', 'verifyExecution.mjs'],
  ['tools/system/uiVisualSignature.js', 'uiVisualSignature.mjs'],
  ['tools/system/getUIElements.js', 'getUIElements.mjs'],
  ['resolver/installedApps.js', 'installedApps.mjs'],
]);

export async function resolve(specifier, context, nextResolve) {
  const r = await nextResolve(specifier, context);
  if (r.url.startsWith('file://')) {
    const rel = path.relative(root, fileURLToPath(r.url)).split(path.sep).join('/');
    const stub = STUBS.get(rel);
    if (stub) return { url: pathToFileURL(path.join(stubDir, stub)).href, shortCircuit: true };
  }
  return r;
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (/\/memory\/(uiMapStore|workflowCache)\.js$/.test(url)) {
    let src = String(loaded.source);
    src = src.replace("path.join(__dirname, '..', 'data', 'ui_maps.json')", "path.join(process.env.ROCKY_TEST_DATA_DIR, 'ui_maps.json')");
    src = src.replace("path.join(__dirname, '..', 'data', 'workflow_cache.json')", "path.join(process.env.ROCKY_TEST_DATA_DIR, 'workflow_cache.json')");
    return { ...loaded, source: src };
  }
  return loaded;
}
