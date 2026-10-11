const T = () => globalThis.__T;
export default async function getActiveWindow() {
  const list = T().windows || [{ appName: 'explorer', windowTitle: 'Desktop', bounds: { x: 0, y: 0, width: 800, height: 600 }, isMinimized: false, success: true }];
  const idx = T().winIdx++;
  const w = T().windowAt ? T().windowAt(idx) : list[Math.min(idx, list.length - 1)];
  T().main('getActiveWindow', w.appName);
  return w;
}
