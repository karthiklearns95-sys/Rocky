const T = () => globalThis.__T;
export async function hoverAt(x, y) { T().main('hoverAt', [x, y]); return false; }
const noop = async () => ({ success: true });
export const mouseClick = noop, typeText = noop, pressKey = noop, scroll = noop;
