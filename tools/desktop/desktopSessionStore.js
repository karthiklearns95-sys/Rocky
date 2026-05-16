/**
 * desktopSessionStore.js
 * 
 * Manages active desktop contexts, tracked windows, and recently accessed UI elements.
 */

class DesktopSessionStore {
  constructor() {
    this.activeHwnd = null;
    this.trackedWindows = new Map(); // hwnd -> { title, processName, processId }
    this.elementCache = new Map(); // searchHash -> { runtimeId, boundingRectangle }
  }

  setActiveWindow(hwnd, info) {
    this.activeHwnd = hwnd;
    if (info) this.trackedWindows.set(hwnd, info);
  }

  getActiveWindow() {
    return this.activeHwnd ? this.trackedWindows.get(this.activeHwnd) : null;
  }

  cacheElement(query, elementData) {
    this.elementCache.set(query, {
      ...elementData,
      timestamp: Date.now()
    });
  }

  getCachedElement(query) {
    const cached = this.elementCache.get(query);
    if (cached && (Date.now() - cached.timestamp < 30000)) { // 30 second cache invalidation
      return cached;
    }
    return null;
  }

  clearCache() {
    this.elementCache.clear();
  }
}

export const desktopSession = new DesktopSessionStore();
