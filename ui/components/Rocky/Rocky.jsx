import React, { useState, useEffect } from 'react';
import RockyCanvas from './RockyCanvas';
import '../../styles/rocky.css';

export default function Rocky() {
  const [agentState, setAgentState] = useState('idle');

  // Placeholder for controller hook connection
  // In Phase 3, this will listen to IPC events from the main process / eventBus
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.ping('Rocky component mounted');
      window.electronAPI.onPong((msg) => console.log(msg));

      // Listen for state changes from the Main process (Controller)
      window.electronAPI.onStateChanged((newState) => {
        setAgentState(newState);
      });
    } else {
      // Fallback for browser-only dev testing (no electron)
      const states = ['idle', 'listening', 'thinking', 'speaking', 'moving'];
      let idx = 0;
      const interval = setInterval(() => {
        idx = (idx + 1) % states.length;
        setAgentState(states[idx]);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, []);

  return (
    <div className={`rocky-container state-${agentState}`}>
      <RockyCanvas agentState={agentState} />
      <div className="glow-effect"></div>
    </div>
  );
}
