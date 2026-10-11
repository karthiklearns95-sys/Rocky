import process from 'process';

/** The five states of the agent loop. */
export const STATE = {
  PLAN: 'PLAN',
  EXECUTE: 'EXECUTE',
  VALIDATE: 'VALIDATE',
  RECOVER: 'RECOVER',
  COMPLETE: 'COMPLETE'
};

// Facts whose relation describes something that happened (kept as shared memories).
export const EVENT_RELATION = /^(fixed|finished|completed|solved|built|launched|started|met|visited|won|passed|shipped)$/i;

export const DEBUG_MODE = process.env.NODE_ENV !== 'production';

/** Which tools each domain may use. Anything else is refused before it runs. */
export const DOMAIN_TOOLS = {
  automation: [
    "open_resource",
    "waitForAppReady",
    "typeText",
    "mouseClick",
    "pressKey",
    "scroll",
    "locateUIElement",
    "analyze_ui",
    "calculate",
    "systemControl",
    "focusWindow",
    "ocrSearch",
    "browserOpen",
    "browserClick",
    "browserType",
    "browserRead",
    "desktopClick",
    "desktopType"
  ],
  research: [
    "webSearch",
    "fetchAPI",
    "openURL"
  ],
  conversation: []
};
