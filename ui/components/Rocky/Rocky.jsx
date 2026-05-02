import React, { useState, useEffect, useRef } from 'react';
import RockyCanvas from './RockyCanvas';
import useVoiceController from './useVoiceController';
import useRockyMovement from './useRockyMovement';
import '../../styles/rocky.css';

export default function Rocky() {
  const [agentState, setAgentState] = useState('idle');
  const [movementCommand, setMovementCommand] = useState(null);
  
  const containerRef = useRef(null);
  const movementDataRef = useRef({ angle: 0, isMoving: false, reachedTarget: false });

  // Initialize movement hook
  useRockyMovement(containerRef, agentState, movementCommand, movementDataRef);

  const { startBackgroundListening, stopBackgroundListening, speak, sttStatus, currentTranscript } = useVoiceController(
    () => {
      // Wake word detected
      if (window.electronAPI) {
        window.electronAPI.requestStateChange('listening');
      }
    },
    (transcript) => {
      // Speech recognized after wake word
      if (window.electronAPI) {
        window.electronAPI.sendUserInput(transcript);
      }
    }
  );

  useEffect(() => {
    startBackgroundListening();
    
    if (window.electronAPI) {
      window.electronAPI.ping('Rocky component mounted');
      window.electronAPI.onPong((msg) => console.log(msg));

      // Listen for state changes from the Main process (Controller)
      window.electronAPI.onStateChanged((newState) => {
        setAgentState(newState);
      });

      window.electronAPI.onAgentResponse((response) => {
        // Safety timeout: if speech takes too long or fails to trigger onEnd, return to idle
        const timeout = setTimeout(() => {
          window.electronAPI.speechEnded();
        }, 10000);

        // Use TTS to speak the response
        speak(response, () => {
          clearTimeout(timeout);
          window.electronAPI.speechEnded();
        });
      });

      window.electronAPI.onAgentMove((cmd) => {
        setMovementCommand(cmd);
      });
    } else {
      // Fallback for browser-only dev testing (no electron)
      const states = ['idle', 'listening', 'thinking', 'speaking', 'moving'];
      let idx = 0;
      const interval = setInterval(() => {
        idx = (idx + 1) % states.length;
        setAgentState(states[idx]);
      }, 4000);
      return () => {
        stopBackgroundListening();
        clearInterval(interval);
      };
    }
    return () => {
      stopBackgroundListening();
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.value.trim() !== '') {
      if (window.electronAPI) {
        window.electronAPI.sendUserInput(e.target.value);
      }
      e.target.value = ''; // clear input
    }
  };

  // Drag handler: manually move the window via IPC so we don't need -webkit-app-region:drag
  const handleMouseDown = (e) => {
    // Only drag if not clicking on the input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    let lastX = e.screenX;
    let lastY = e.screenY;
    const onMove = (moveEvent) => {
      const dx = moveEvent.screenX - lastX;
      const dy = moveEvent.screenY - lastY;
      lastX = moveEvent.screenX;
      lastY = moveEvent.screenY;
      if (window.electronAPI) window.electronAPI.dragWindow({ x: dx, y: dy });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={containerRef}
      className={`rocky-container state-${agentState}`}
      style={{ position: 'fixed', top: 0, left: 0 }}
      onMouseEnter={() => window.electronAPI && window.electronAPI.setIgnoreMouse(false)}
      onMouseLeave={() => window.electronAPI && window.electronAPI.setIgnoreMouse(true)}
      onMouseDown={handleMouseDown}
    >
      {/* Voice Diagnostic HUD */}
      <div style={{
        position: 'absolute',
        top: '-40px',
        width: '100%',
        textAlign: 'center',
        color: 'rgba(255,255,255,0.7)',
        fontSize: '12px',
        fontFamily: 'monospace',
        textShadow: '0 0 5px black'
      }}>
        <div>{sttStatus}</div>
        <div style={{ color: 'yellow' }}>{currentTranscript}</div>
      </div>

      <RockyCanvas agentState={agentState} movementDataRef={movementDataRef} />
      <div className="glow-effect"></div>
      
      {/* Debug text input for easy chatting without the console */}
      <input 
        type="text" 
        placeholder="Type a message & press Enter..." 
        onKeyDown={handleKeyDown}
        style={{
          pointerEvents: 'auto',
          WebkitAppRegion: 'no-drag',
          position: 'absolute',
          bottom: '-40px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '90%',
          padding: '8px',
          borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(0,0,0,0.5)',
          color: 'white',
          outline: 'none',
          textAlign: 'center',
          fontFamily: 'sans-serif'
        }}
      />
    </div>
  );
}
