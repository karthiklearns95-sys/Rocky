const T = () => globalThis.__T;
const ONE = [{ index: 0, name: 'primary', primary: true, x: 0, y: 0, width: 1920, height: 1080, work: { x: 0, y: 0, width: 1920, height: 1040 } }];
export async function loadDisplays() { T().main('loadDisplays'); return ONE; }
export function displayAt(displays) { return displays[0]; }
export function resetDisplayCache() {}
