import eventBus from '#services/eventBus.js';

class StateManager {
  constructor() {
    this.currentState = 'idle';
    this.validStates = ['idle', 'listening', 'thinking', 'speaking', 'moving'];
  }

  getState() {
    return this.currentState;
  }

  setState(newState) {
    if (this.validStates.includes(newState)) {
      if (this.currentState !== newState) {
        this.currentState = newState;
        console.log(`[StateManager] Transition to: ${newState}`);
        eventBus.emit('STATE_CHANGE', this.currentState);
      }
    } else {
      console.warn(`[StateManager] Invalid state transition attempted: ${newState}`);
    }
  }
}

const stateManager = new StateManager();

export default stateManager;
