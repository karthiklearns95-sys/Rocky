import { mouse, keyboard, Point, Key } from '@nut-tree-fork/nut-js';

/**
 * GUI Control Tools - Uses Native Nut.js to simulate mouse and keyboard instantly.
 * No more PowerShell child_process spawning!
 */

// We disable the default artificial delays in nut.js to make it blazing fast.
mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

export async function mouseClick(args) {
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
    
    await mouse.setPosition(new Point(finalX, finalY));
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

export async function typeText(args) {
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

export async function pressKey(args) {
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


export async function scroll(args) {
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

export async function focusWindow(args) {
  const { appName } = args;
  if (!appName) return { success: false, error: "focusWindow requires appName." };

  console.log(`[Tool: focusWindow] Focus is currently disabled in native mode as it requires OS-specific window handles. Click the app icon first instead.`);
  
  // Nut.js doesn't natively focus windows by name out of the box (it only clicks/types).
  // For now, we will just return a message telling Rocky to visually click the app on the taskbar.
  return { success: false, error: `Native focus unavailable. Please use desktopClick to visually find and click the '${appName}' icon instead.` };
}
