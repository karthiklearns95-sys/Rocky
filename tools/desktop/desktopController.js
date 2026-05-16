import { uiaManager } from './uiaManager.js';
import { typeText, pressKey } from '../system/guiControl.js';

/**
 * desktopController.js
 * 
 * Provides native desktop automation tools for Rocky's planner via UIA.
 */

export async function desktopClick(args) {
  const { query, roleHint, _signal } = args;
  if (!query) return { success: false, error: 'query is required' };

  console.log(`[Tool: desktopClick] Searching UIA for: "${query}"`);
  const result = await uiaManager.runCommand('invoke', query, roleHint || "", "", _signal);

  if (result.success) {
    if (result.method === 'focus') {
       // Sometimes invoke pattern isn't available, but it set focus. 
       // We can hit ENTER or SPACE to trigger it.
       await pressKey({ key: '{ENTER}', _signal });
       return { success: true, data: `Focused and triggered ${query}` };
    }
    return { success: true, data: `Clicked on ${query} natively via UIA.` };
  }
  
  return { success: false, error: result.error || `Could not find UI element matching "${query}"` };
}

export async function desktopType(args) {
  const { query, text, roleHint, pressEnter, _signal } = args;
  if (!text) return { success: false, error: 'text is required' };

  if (query) {
    console.log(`[Tool: desktopType] Searching UIA for: "${query}"`);
    const result = await uiaManager.runCommand('setValue', query, roleHint || "", text, _signal);
    
    if (result.success) {
      if (result.method === 'focus_for_typing') {
        // Fallback: it focused the field, now we use traditional robotjs to type
        await typeText({ text, _signal });
      }
      
      if (pressEnter) {
        await pressKey({ key: '{ENTER}', _signal });
      }
      return { success: true, data: `Typed into ${query} natively.` };
    }
    return { success: false, error: result.error || `Could not find input element matching "${query}"` };
  } else {
    // Just type generically if no query
    await typeText({ text, _signal });
    if (pressEnter) {
      await pressKey({ key: '{ENTER}', _signal });
    }
    return { success: true, data: `Typed text globally.` };
  }
}
