import { mouse, keyboard, Point, Key } from '@nut-tree-fork/nut-js';
import { screenChanged } from './screenCache.js';
import { movePointer } from '../../automation/system/pointer.js';

const nutMove = (x, y) => mouse.setPosition(new Point(x, y));

/**
 * GUI Control Tools - Uses Native Nut.js to simulate mouse and keyboard instantly.
 * No more PowerShell child_process spawning!
 */

// We disable the default artificial delays in nut.js to make it blazing fast.
mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

/**
 * Park the cursor on a point without clicking. Used before verifying a click so
 * the hover highlight is already in the "before" picture and is not mistaken
 * for the click's effect. Best effort: returns false instead of throwing.
 */
export async function hoverAt(x, y) {
  try {
    return (await movePointer(x, y, { nutMove })).ok;
  } catch {
    return false;
  }
}

async function mouseClickImpl(args) {
  let { x, y, fallbackKey } = args;
  if (x === undefined || y === undefined) return { success: false, error: "Missing coordinates" };
  
  // Add ±3px random offset to seem more human/dynamic
  const offsetX = Math.floor(Math.random() * 7) - 3;
  const offsetY = Math.floor(Math.random() * 7) - 3;
  const finalX = Math.round(x + offsetX);
  const finalY = Math.round(y + offsetY);

  console.log(`[Tool: mouseClick] Instantly moving mouse to (${finalX}, ${finalY}) and clicking natively.`);
  
  try {
    if (args._signal && args._signal.aborted) return { success: false, error: 'Aborted' };
    
    // The pointer is placed by the DPI-aware worker (see pointer.js); the click happens where it is.
    const moved = await movePointer(finalX, finalY, { nutMove });
    if (!moved.ok) throw new Error(`could not put the pointer on (${finalX}, ${finalY}): ${moved.error}`);
    await mouse.leftClick();
    
    return { success: true, data: `Clicked at ${finalX}, ${finalY}` };
  } catch (error) {
    console.error(`[Tool: mouseClick] Nut.js mouse error:`, error.message);
    
    // Fallback to keyboard if provided and mouse fails
    if (fallbackKey && (!args._signal || !args._signal.aborted)) {
      console.log(`[Tool: mouseClick] Falling back to keyboard: ${fallbackKey}`);
      return pressKey({ key: fallbackKey, _signal: args._signal });
    }
    return { success: false, error: `Click failed: ${error.message}` };
  }
}

async function typeTextImpl(args) {
  const { text } = args;
  if (!text) return { success: false, error: 'Grace, what should Rocky type?' };

  console.log(`[Tool: typeText] Typing: ${text}`);

  try {
    if (args._signal && args._signal.aborted) return { success: false, error: 'Aborted' };
    
    await keyboard.type(text);
    return { success: true, data: `Typed text.` };
  } catch (error) {
    console.error(`[Tool: typeText] Nut.js keyboard error:`, error.message);
    return { success: false, error: error.message };
  }
}

async function pressKeyImpl(args) {
  const { key } = args;
  if (!key) return { success: false, error: 'Grace, which key should Rocky press?' };

  console.log(`[Tool: pressKey] Pressing: ${key}`);

  try {
    if (args._signal && args._signal.aborted) return { success: false, error: 'Aborted' };
    
    // Map string representations to nut.js Key enums
    const keyMap = {
      'ENTER': Key.Enter,
      '{ENTER}': Key.Enter,
      'SPACE': Key.Space,
      '{SPACE}': Key.Space,
      'TAB': Key.Tab,
      '{TAB}': Key.Tab,
      'ESCAPE': Key.Escape,
      '{ESC}': Key.Escape,
      'BACKSPACE': Key.Backspace,
      '{BACKSPACE}': Key.Backspace,
      '{PGUP}': Key.PageUp,
      '{PGDN}': Key.PageDown,
      '{MEDIA_PLAY_PAUSE}': Key.AudioPlay,
      '{MEDIA_STOP}': Key.AudioStop,
      '{MEDIA_NEXT}': Key.AudioNext,
      '{MEDIA_PREV}': Key.AudioPrev,
      '{VOLUME_MUTE}': Key.AudioMute,
      '{VOLUME_DOWN}': Key.AudioVolDown,
      '{VOLUME_UP}': Key.AudioVolUp,
    };

    const targetKey = keyMap[key.toUpperCase()] || Key[key] || null;

    if (targetKey !== null) {
       await keyboard.type(targetKey);
    } else {
       // Just type it as a string if we don't have an enum
       await keyboard.type(key);
    }
    
    return { success: true, data: `Rocky pressed ${key}.` };
  } catch (error) {
    console.error(`[Tool: pressKey] Error:`, error.message);
    return { success: false, error: error.message };
  }
}


async function scrollImpl(args) {
  const { direction = 'down', amount = 3 } = args;
  console.log(`[Tool: scroll] Scrolling ${direction} by ${amount}`);

  try {
    if (args._signal && args._signal.aborted) return { success: false, error: 'Aborted' };
    
    if (direction === 'down') {
       await mouse.scrollDown(amount * 100);
    } else {
       await mouse.scrollUp(amount * 100);
    }
    
    return { success: true, data: `Rocky scrolled ${direction}. Amaze.` };
  } catch (error) {
    console.error(`[Tool: scroll] Error:`, error.message);
    return { success: false, error: `Rocky cannot scroll: ${error.message}` };
  }
}


// Anything that clicks, types, presses or scrolls can change the screen, so cached
// UI-tree / OCR reads are dropped afterwards (even when the action failed part-way).
const invalidating = (fn) => async (...args) => {
  try { return await fn(...args); } finally { screenChanged(); }
};
export const mouseClick = invalidating(mouseClickImpl);
export const typeText = invalidating(typeTextImpl);
export const pressKey = invalidating(pressKeyImpl);
export const scroll = invalidating(scrollImpl);
