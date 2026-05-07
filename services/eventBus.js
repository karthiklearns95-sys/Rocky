import { EventEmitter } from 'events';

class EventBus extends EventEmitter {}

const eventBus = new EventBus();

export default eventBus;

// Example Events:
// 'STATE_CHANGE': (newState) -> Update stateManager
// 'USER_INPUT': (text) -> Trigger brain processing
// 'ACTION_REQUEST': (tool, args) -> Trigger executor
// 'RESPONSE_READY': (text) -> Trigger TTS / UI
