/**
 * SessionMemory
 * 
 * Maintains the conversational context engine for Rocky.
 * Stores recent interactions to resolve vague instructions and pronouns.
 */

const sessionState = {
  lastApp: null,
  lastTarget: null, // Person, contact, or file
  lastAction: null,
  lastUIReference: null,
  lastConfidence: 1.0,
  history: []
};

export function getSessionContext() {
  return { ...sessionState };
}

export function updateSessionContext(updates) {
  if (updates.lastApp) sessionState.lastApp = updates.lastApp;
  if (updates.lastTarget) sessionState.lastTarget = updates.lastTarget;
  if (updates.lastAction) sessionState.lastAction = updates.lastAction;
  if (updates.lastUIReference) sessionState.lastUIReference = updates.lastUIReference;
  
  // Keep a rolling history of the last 10 actions
  sessionState.history.push({
    timestamp: Date.now(),
    ...updates
  });
  
  if (sessionState.history.length > 10) {
    sessionState.history.shift();
  }
}

export function clearSessionContext() {
  sessionState.lastApp = null;
  sessionState.lastTarget = null;
  sessionState.lastAction = null;
  sessionState.lastUIReference = null;
  sessionState.history = [];
}
