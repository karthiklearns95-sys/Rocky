import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_FILE = path.join(__dirname, '..', 'data', 'ui_maps.json');
const STORE_VERSION = 1;

export const UI_MAP_THRESHOLDS = {
  saveConfidence: 0.65,
  minUseConfidence: 0.45,
  boundsTolerance: 0.10,
  structureSimilarity: 0.35,
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  maxMapsPerApp: 12
};

function emptyStore() {
  return { version: STORE_VERSION, maps: {} };
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    return {
      version: parsed.version || STORE_VERSION,
      maps: parsed.maps && typeof parsed.maps === 'object' ? parsed.maps : {}
    };
  } catch (error) {
    console.warn('[UIMapStore] Could not read UI map store:', error.message);
    return emptyStore();
  }
}

function writeStore(store) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.warn('[UIMapStore] Could not write UI map store:', error.message);
  }
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeAppName(app) {
  return String(app || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function normalizeTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeLabel(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = asNumber(bounds.x);
  const y = asNumber(bounds.y);
  const width = asNumber(bounds.width);
  const height = asNumber(bounds.height);

  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function elementFromObject(label, value) {
  if (Array.isArray(value)) {
    const x = asNumber(value[0]);
    const y = asNumber(value[1]);
    if (x === null || y === null) return null;
    return {
      label,
      x,
      y,
      width: 0,
      height: 0,
      confidence: 0.5
    };
  }

  if (!value || typeof value !== 'object') return null;

  const x = asNumber(value.x ?? value.centerX ?? value.cx ?? value.left);
  const y = asNumber(value.y ?? value.centerY ?? value.cy ?? value.top);
  const width = asNumber(value.width ?? value.w) ?? 0;
  const height = asNumber(value.height ?? value.h) ?? 0;

  if (x === null || y === null) return null;

  return {
    label: value.label || value.name || label,
    x,
    y,
    width,
    height,
    confidence: clamp(asNumber(value.confidence) ?? 0.5)
  };
}

function normalizeElements(rawMap) {
  const rawElements = rawMap?.elements ?? rawMap?.uiElements ?? rawMap;
  const elements = [];

  if (Array.isArray(rawElements)) {
    for (const item of rawElements) {
      const element = elementFromObject(item?.label || item?.name, item);
      if (element) elements.push(element);
    }
  } else if (rawElements && typeof rawElements === 'object') {
    for (const [label, value] of Object.entries(rawElements)) {
      const element = elementFromObject(label, value);
      if (element) elements.push(element);
    }
  }

  return elements
    .filter((element) => normalizeLabel(element.label))
    .map((element) => ({
      label: String(element.label),
      x: element.x,
      y: element.y,
      width: Math.max(0, element.width || 0),
      height: Math.max(0, element.height || 0),
      confidence: clamp(element.confidence)
    }));
}

function scaleNormalizedElements(elements, bounds) {
  if (!bounds || elements.length === 0) return elements;
  const looksNormalized = elements.every((element) => (
    element.x >= 0 && element.x <= 1 &&
    element.y >= 0 && element.y <= 1
  ));

  if (!looksNormalized) return elements;

  return elements.map((element) => ({
    ...element,
    x: Math.round(bounds.x + element.x * bounds.width),
    y: Math.round(bounds.y + element.y * bounds.height),
    width: element.width > 0 && element.width <= 1
      ? Math.round(element.width * bounds.width)
      : element.width,
    height: element.height > 0 && element.height <= 1
      ? Math.round(element.height * bounds.height)
      : element.height
  }));
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

export function normalizeUIMap(rawMap = {}, currentWindow = {}) {
  const source = rawMap?.uiMap || rawMap?.data?.uiMap || rawMap || {};
  const bounds = normalizeBounds(source.bounds || currentWindow?.bounds);
  const elements = scaleNormalizedElements(normalizeElements(source), bounds).map((element) => ({
    ...element,
    x: Math.round(element.x),
    y: Math.round(element.y),
    width: Math.max(0, Math.round(element.width || 0)),
    height: Math.max(0, Math.round(element.height || 0))
  }));
  const avgElementConfidence = average(elements.map((element) => element.confidence));
  const confidence = clamp(
    asNumber(source.confidence ?? source.detectionConfidence) ?? avgElementConfidence ?? 0
  );

  return {
    app: normalizeAppName(source.app || currentWindow?.appName),
    windowTitle: String(source.windowTitle || currentWindow?.windowTitle || ''),
    bounds,
    elements,
    visualSignature: Array.isArray(source.visualSignature) ? source.visualSignature : null,
    timestamp: asNumber(source.timestamp) || Date.now(),
    confidence
  };
}

function titleMatches(currentTitle, cachedTitle) {
  const current = normalizeTitle(currentTitle);
  const cached = normalizeTitle(cachedTitle);
  if (!current || !cached || current === 'unknown' || cached === 'unknown') return false;
  return current === cached;
}

function appMatches(currentApp, cachedApp) {
  const current = normalizeAppName(currentApp);
  const cached = normalizeAppName(cachedApp);
  if (!current || !cached || current === 'unknown' || cached === 'unknown') return true;
  return current === cached || current.includes(cached) || cached.includes(current);
}

export function boundsAreSimilar(currentBounds, cachedBounds, tolerance = UI_MAP_THRESHOLDS.boundsTolerance) {
  const current = normalizeBounds(currentBounds);
  const cached = normalizeBounds(cachedBounds);
  if (!current || !cached) return false;

  const widthDiff = Math.abs(current.width - cached.width) / Math.max(cached.width, 1);
  const heightDiff = Math.abs(current.height - cached.height) / Math.max(cached.height, 1);
  const xDiff = Math.abs(current.x - cached.x);
  const yDiff = Math.abs(current.y - cached.y);
  const maxXDrift = Math.max(48, cached.width * tolerance);
  const maxYDrift = Math.max(48, cached.height * tolerance);

  return (
    widthDiff <= tolerance &&
    heightDiff <= tolerance &&
    xDiff <= maxXDrift &&
    yDiff <= maxYDrift
  );
}

function controlText(element) {
  if (!element || typeof element !== 'object') return normalizeLabel(element);
  return normalizeLabel([
    element.label,
    element.name,
    element.Name,
    element.AutomationId,
    element.automationId,
    element.ControlType,
    element.controlType
  ].filter(Boolean).join(' '));
}

function tokenOverlapScore(target, candidate) {
  const targetTokens = normalizeLabel(target).split(' ').filter(Boolean);
  const candidateTokens = normalizeLabel(candidate).split(' ').filter(Boolean);
  if (targetTokens.length === 0 || candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  const matched = targetTokens.filter((token) => candidateSet.has(token)).length;
  return matched / targetTokens.length;
}

export function calculateStructureSimilarity(currentElements = [], cachedElements = []) {
  if (!Array.isArray(currentElements) || !Array.isArray(cachedElements)) return 0;
  if (currentElements.length === 0 || cachedElements.length === 0) return 0;

  const currentTexts = currentElements.map(controlText).filter(Boolean);
  if (currentTexts.length === 0) return 0;

  let matched = 0;
  for (const cachedElement of cachedElements) {
    const label = normalizeLabel(cachedElement.label);
    if (!label) continue;

    const hasMatch = currentTexts.some((text) => (
      text.includes(label) ||
      label.includes(text) ||
      tokenOverlapScore(label, text) >= 0.5
    ));

    if (hasMatch) matched++;
  }

  const labelScore = matched / cachedElements.length;
  const countScore = Math.min(currentTexts.length, cachedElements.length) /
    Math.max(currentTexts.length, cachedElements.length);

  return clamp((labelScore * 0.8) + (countScore * 0.2));
}

export function calculateVisualSignatureSimilarity(currentSignature = [], cachedSignature = []) {
  if (!Array.isArray(currentSignature) || !Array.isArray(cachedSignature)) return 0;
  if (currentSignature.length === 0 || cachedSignature.length === 0) return 0;

  const currentByLabel = new Map(
    currentSignature.map((item) => [normalizeLabel(item.label), item])
  );

  const scores = [];
  for (const cachedItem of cachedSignature) {
    const currentItem = currentByLabel.get(normalizeLabel(cachedItem.label));
    if (!currentItem) continue;

    const cachedSamples = Array.isArray(cachedItem.samples) ? cachedItem.samples : [];
    const currentSamples = Array.isArray(currentItem.samples) ? currentItem.samples : [];
    const sampleCount = Math.min(cachedSamples.length, currentSamples.length);
    if (sampleCount === 0) continue;

    let diffTotal = 0;
    for (let i = 0; i < sampleCount; i++) {
      const cached = cachedSamples[i];
      const current = currentSamples[i];
      const channelDiff = (
        Math.abs((Number(cached.r) || 0) - (Number(current.r) || 0)) +
        Math.abs((Number(cached.g) || 0) - (Number(current.g) || 0)) +
        Math.abs((Number(cached.b) || 0) - (Number(current.b) || 0))
      ) / (255 * 3);
      diffTotal += channelDiff;
    }

    scores.push(1 - Math.min(1, diffTotal / sampleCount));
  }

  return clamp(average(scores) ?? 0);
}

function calculateCoordinateFit(bounds, elements = []) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds || !Array.isArray(elements) || elements.length === 0) return 0;

  const marginX = Math.max(32, normalizedBounds.width * 0.08);
  const marginY = Math.max(32, normalizedBounds.height * 0.08);
  const minX = normalizedBounds.x - marginX;
  const maxX = normalizedBounds.x + normalizedBounds.width + marginX;
  const minY = normalizedBounds.y - marginY;
  const maxY = normalizedBounds.y + normalizedBounds.height + marginY;

  const fitted = elements.filter((element) => (
    element.x >= minX &&
    element.x <= maxX &&
    element.y >= minY &&
    element.y <= maxY
  )).length;

  return fitted / elements.length;
}

export function validateUIMap(currentWindow, cachedMap, options = {}) {
  const thresholds = { ...UI_MAP_THRESHOLDS, ...options };
  const reasons = [];

  if (!currentWindow || !cachedMap) {
    return { valid: false, reasons: ['missing_window_or_map'], structureSimilarity: 0 };
  }

  if (cachedMap.confidence < thresholds.minUseConfidence) reasons.push('low_confidence');
  if (Date.now() - (cachedMap.timestamp || 0) > thresholds.maxAgeMs) reasons.push('expired');
  if (!appMatches(currentWindow.appName, cachedMap.app)) reasons.push('app_mismatch');
  if (!titleMatches(currentWindow.windowTitle, cachedMap.windowTitle)) reasons.push('title_mismatch');
  if (!boundsAreSimilar(currentWindow.bounds, cachedMap.bounds, thresholds.boundsTolerance)) {
    reasons.push('bounds_mismatch');
  }
  if (calculateCoordinateFit(currentWindow.bounds, cachedMap.elements || []) < 0.75) {
    reasons.push('coordinate_mismatch');
  }

  const currentElements = currentWindow.uiElements || currentWindow.elements || [];
  const semanticSimilarity = calculateStructureSimilarity(currentElements, cachedMap.elements || []);
  const visualSimilarity = calculateVisualSignatureSimilarity(
    currentWindow.visualSignature,
    cachedMap.visualSignature
  );
  const structureSimilarity = Math.max(semanticSimilarity, visualSimilarity);
  if (structureSimilarity < thresholds.structureSimilarity) reasons.push('structure_mismatch');

  return {
    valid: reasons.length === 0,
    reasons,
    structureSimilarity,
    semanticSimilarity,
    visualSimilarity
  };
}

export function isMapValid(currentWindow, cachedMap) {
  return validateUIMap(currentWindow, cachedMap).valid;
}

export function getUIMapCandidates(app, windowTitle) {
  const appKey = normalizeAppName(app);
  const store = readStore();
  const maps = Array.isArray(store.maps[appKey]) ? store.maps[appKey] : [];
  const title = normalizeTitle(windowTitle);

  return maps
    .filter((map) => !title || titleMatches(title, map.windowTitle))
    .sort((a, b) => (b.confidence - a.confidence) || (b.timestamp - a.timestamp));
}

export function getUIMap(app, windowTitle) {
  return getUIMapCandidates(app, windowTitle)[0] || null;
}

export function getValidUIMap(currentWindow, options = {}) {
  const candidates = getUIMapCandidates(currentWindow?.appName, currentWindow?.windowTitle);
  let bestInvalid = null;

  for (const candidate of candidates) {
    const validation = validateUIMap(currentWindow, candidate, options);
    if (validation.valid) {
      return { ...candidate, validation };
    }
    if (!bestInvalid || validation.structureSimilarity > bestInvalid.validation.structureSimilarity) {
      bestInvalid = { ...candidate, validation };
    }
  }

  return null;
}

function mapId(app, windowTitle, bounds) {
  const b = normalizeBounds(bounds) || { x: 0, y: 0, width: 0, height: 0 };
  return [
    normalizeAppName(app),
    normalizeTitle(windowTitle).replace(/[^a-z0-9]+/g, '_'),
    b.x,
    b.y,
    b.width,
    b.height
  ].join(':');
}

export function saveUIMap(app, windowTitle, map, options = {}) {
  const executionSucceeded = options.executionSucceeded ?? map?.executionSucceeded ?? true;
  if (!executionSucceeded) return { saved: false, reason: 'execution_failed' };

  const normalized = normalizeUIMap({
    ...map,
    app,
    windowTitle
  }, options.currentWindow);

  const threshold = options.saveConfidence ?? UI_MAP_THRESHOLDS.saveConfidence;
  if (!normalized.bounds) return { saved: false, reason: 'missing_bounds' };
  if (normalized.elements.length === 0) return { saved: false, reason: 'missing_elements' };
  if (normalized.confidence < threshold) return { saved: false, reason: 'low_confidence' };

  const store = readStore();
  const appKey = normalizeAppName(app);
  const maps = Array.isArray(store.maps[appKey]) ? store.maps[appKey] : [];

  const candidateIndex = maps.findIndex((candidate) => (
    titleMatches(normalized.windowTitle, candidate.windowTitle) &&
    boundsAreSimilar(normalized.bounds, candidate.bounds, UI_MAP_THRESHOLDS.boundsTolerance) &&
    calculateStructureSimilarity(normalized.elements, candidate.elements || []) >= UI_MAP_THRESHOLDS.structureSimilarity
  ));

  const now = Date.now();
  const existing = candidateIndex >= 0 ? maps[candidateIndex] : null;
  const entry = {
    id: existing?.id || mapId(app, windowTitle, normalized.bounds),
    app: appKey,
    windowTitle: normalized.windowTitle,
    bounds: normalized.bounds,
    elements: normalized.elements,
    visualSignature: normalized.visualSignature,
    timestamp: now,
    confidence: clamp(existing ? Math.max(existing.confidence, normalized.confidence) + 0.08 : normalized.confidence),
    successes: (existing?.successes || 0) + 1,
    failures: existing?.failures || 0
  };

  if (candidateIndex >= 0) maps[candidateIndex] = entry;
  else maps.push(entry);

  store.maps[appKey] = maps
    .sort((a, b) => (b.confidence - a.confidence) || (b.timestamp - a.timestamp))
    .slice(0, UI_MAP_THRESHOLDS.maxMapsPerApp);

  writeStore(store);
  console.log(`[UIMapStore] Saved UI map for ${appKey} (${entry.elements.length} elements, confidence ${entry.confidence.toFixed(2)}).`);
  return { saved: true, map: entry };
}

function adjustUIMapConfidence(mapOrId, delta) {
  const id = typeof mapOrId === 'string' ? mapOrId : mapOrId?.id;
  if (!id) return null;

  const store = readStore();
  for (const [appKey, maps] of Object.entries(store.maps)) {
    if (!Array.isArray(maps)) continue;
    const index = maps.findIndex((map) => map.id === id);
    if (index < 0) continue;

    const current = maps[index];
    const updated = {
      ...current,
      confidence: clamp((current.confidence || 0) + delta),
      timestamp: Date.now(),
      successes: delta > 0 ? (current.successes || 0) + 1 : (current.successes || 0),
      failures: delta < 0 ? (current.failures || 0) + 1 : (current.failures || 0)
    };

    maps[index] = updated;
    store.maps[appKey] = maps.sort((a, b) => (b.confidence - a.confidence) || (b.timestamp - a.timestamp));
    writeStore(store);
    return updated;
  }

  return null;
}

export function recordUIMapSuccess(mapOrId) {
  return adjustUIMapConfidence(mapOrId, 0.08);
}

export function recordUIMapFailure(mapOrId) {
  return adjustUIMapConfidence(mapOrId, -0.18);
}

export function findElementInMap(map, targetLabel) {
  if (!map || !Array.isArray(map.elements) || !targetLabel) return null;
  const target = normalizeLabel(targetLabel);
  if (!target) return null;

  let best = null;
  let bestScore = 0;

  for (const element of map.elements) {
    const label = normalizeLabel(element.label);
    const score = label === target
      ? 1
      : Math.max(
          label.includes(target) ? 0.85 : 0,
          target.includes(label) ? 0.75 : 0,
          tokenOverlapScore(target, label)
        );

    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }

  if (!best || bestScore < 0.45 || best.confidence < 0.35) return null;
  return best;
}

export function hasElement(map, targetLabel) {
  return Boolean(findElementInMap(map, targetLabel));
}
