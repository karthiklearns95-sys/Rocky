import { formatResponse } from '#brain/personality/rockyPersonality.js';
import eventBus from '#services/eventBus.js';
import getActiveWindow from '../../../automation/system/getActiveWindow.js';
import { userTextOf } from '../planUtils.js';
import { DEBUG_MODE } from './constants.js';

/**
 * Commands that need no planning at all (volume, screenshot, close window, media keys, move the
 * avatar, hand a coding task to a background worker). Pure: looks at the text only.
 * @returns {object|null} what to do, or null if this is not a fast-path command
 */
export function fastIntentHandler(input) {
  // Match on what she said, not on the interpreter's JSON (which would match its keys and entity values).
  const lower = userTextOf(input).toLowerCase().trim();
  // No chaining allowed in fast path
  if (lower.includes(' and ') || lower.includes(' then ')) return null;

  if (lower.includes('write a ') && (lower.includes('script') || lower.includes('program') || lower.includes('code'))) {
      return { delegateTask: true };
  }

  // Parse goal from JSON rawInput if present
  let goal;
  try { goal = JSON.parse(input)?.goal || ''; } catch { goal = lower; }

  if (lower.includes('volume up') || goal === 'volume_up')    return { tool: 'systemControl', args: { action: 'volume up' } };
  if (lower.includes('volume down') || goal === 'volume_down') return { tool: 'systemControl', args: { action: 'volume down' } };
  if (lower.includes('mute') || goal === 'mute')              return { tool: 'systemControl', args: { action: 'mute' } };
  if (lower.includes('screenshot') || goal === 'take_screenshot') return { tool: 'takeScreenshot', args: {} };
  if (/\b(close|exit)\s+(this\s+)?(window|app)\b/.test(lower) || goal === 'close_app') {
    return { tool: 'pressKey', args: { key: '%{F4}' }, moveNearActiveClose: true };
  }

  const moveMatch = lower.match(/\bmove\s+(?:to\s+)?(top left|top right|bottom left|bottom right|center)\b/);
  if (moveMatch) return { moveCommand: moveMatch[1] };

  const mediaCommands = ['play', 'pause', 'next', 'previous', 'skip', 'resume'];
  const isDirectMediaGoal = ['pause_music', 'resume_music', 'next_track', 'previous_track', 'play_pause'].includes(goal);
  if (mediaCommands.includes(lower) || lower === 'play music' || lower === 'pause music' || isDirectMediaGoal) {
     const key = (lower.includes('next') || goal === 'next_track') ? '{MEDIA_NEXT}'
       : (lower.includes('prev') || goal === 'previous_track') ? '{MEDIA_PREV}'
       : '{MEDIA_PLAY_PAUSE}';
     return { tool: 'pressKey', args: { key } };
  }

  return null;
}

/** Carry out a fast-path action and return Rocky's reply. */
export async function runFastPath(loop, fastAction, rawInput) {
  if (DEBUG_MODE) console.log(`[AgentLoop] ⚡ Fast Path Hit:`, fastAction);

  if (fastAction.delegateTask) {
     loop.handleProactiveTrigger({ trigger: 'code_generation', prompt: userTextOf(rawInput) });
     return formatResponse(`I'm assigning a background worker to code that for you right now. You can keep talking to me while it finishes.`);
  }

  if (fastAction.moveCommand) {
    eventBus.emit('MOVE_AGENT', fastAction.moveCommand);
    return formatResponse(`Rocky moved ${fastAction.moveCommand}.`);
  }
  if (fastAction.moveNearActiveClose) {
    const active = await getActiveWindow();
    if (active?.bounds) {
      loop.clickResolver.moveNearPoint(
        active.bounds.x + active.bounds.width - 16,
        active.bounds.y + 16,
        'close_button'
      );
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  }
  await loop.toolManager.execute(fastAction.tool, fastAction.args);
  return formatResponse(`Rocky executed ${fastAction.tool}. Amaze.`);
}
