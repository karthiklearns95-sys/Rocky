import React, { useState, useEffect } from 'react';
import RockyCanvas from './RockyCanvas';
import useVoiceController from './useVoiceController';
import '../../styles/rocky.css';

export default function Rocky() {
  const [agentState, setAgentState] = useState('idle');

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
        // Use TTS to speak the response
        speak(response, () => {
          window.electronAPI.speechEnded();
        });
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

  return (
    <div className={`rocky-container state-${agentState}`}>
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

      <RockyCanvas agentState={agentState} />
      <div className="glow-effect"></div>
      
      {/* Debug text input for easy chatting without the console */}
      <input 
        type="text" 
        placeholder="Type a message & press Enter..." 
        onKeyDown={handleKeyDown}
        style={{
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
