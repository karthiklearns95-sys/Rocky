import { perceptionEngine } from '../../vision/perceptionEngine.js';
import { mouseClick, typeText, pressKey } from '../system/guiControl.js';

/**
 * desktopController.js
 * 
 * Provides native desktop automation tools using Vision (OCR) + Nut.js.
 */

export async function desktopClick(args) {
  const { query, _signal } = args;
  if (!query) return { success: false, error: 'query is required' };

  console.log(`[Tool: desktopClick] Asking Vision layer to locate: "${query}"`);
  const bbox = await perceptionEngine.locateTextOnScreen(query);

  if (bbox) {
    // Click the center of the bounding box
    const targetX = Math.floor(bbox.x + bbox.width / 2);
    const targetY = Math.floor(bbox.y + bbox.height / 2);
    
    console.log(`[Tool: desktopClick] Vision found it at (${targetX}, ${targetY}). Clicking natively.`);
    const result = await mouseClick({ x: targetX, y: targetY, _signal });
    
    if (result.success) {
       return { success: true, data: `Clicked on "${query}" via Vision + Nut.js.` };
    }
  }
  
  return { success: false, error: `Could not visually locate "${query}" on the screen.` };
}

export async function desktopType(args) {
  const { query, text, pressEnter, _signal } = args;
  if (!text) return { success: false, error: 'text is required' };

  if (query) {
    console.log(`[Tool: desktopType] Asking Vision layer to locate input field near: "${query}"`);
    const bbox = await perceptionEngine.locateTextOnScreen(query);
    
    if (bbox) {
      // Click slightly to the right or below the label to hit the input field
      // Assuming a standard layout where the input is below or right of the label
      const targetX = Math.floor(bbox.x + bbox.width / 2);
      const targetY = Math.floor(bbox.y + bbox.height + 15); // Click 15px below the label
      
      console.log(`[Tool: desktopType] Vision found label at (${targetX}, ${targetY}). Clicking to focus.`);
      await mouseClick({ x: targetX, y: targetY, _signal });
      
      // Give the OS 100ms to focus the field
      await new Promise(r => setTimeout(r, 100));
    } else {
      console.warn(`[Tool: desktopType] Could not find label "${query}", typing globally anyway.`);
    }
  }

  // Type the text natively
  await typeText({ text, _signal });
  
  if (pressEnter) {
    await pressKey({ key: 'ENTER', _signal });
  }
  
  return { success: true, data: `Typed text successfully.` };
}
