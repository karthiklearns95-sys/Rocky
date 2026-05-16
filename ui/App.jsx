import { useState, useEffect } from 'react'
import './App.css'
import Rocky from './components/Rocky/Rocky.jsx'

function App() {
  const [mailHistory, setMailHistory] = useState([]);
  const [rockyResponse, setRockyResponse] = useState("Grace... I am here.");
  const [rockyState, setRockyState] = useState("idle");

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onStateChanged((state) => {
        setRockyState(state);
      });

      window.electronAPI.onAgentResponse((response) => {
        setRockyResponse(response);
      });

      window.electronAPI.onMailSent((mail) => {
        setMailHistory((prev) => [mail, ...prev].slice(0, 5));
      });
    }
  }, []);

  return (
    <div id="rocky-hud">
      {/* The 3D Avatar Area */}
      <div className="avatar-container">
        <Rocky />
      </div>

      {/* Rocky's Voice / Response Bubble */}
      <div className={`glass-panel response-bubble ${rockyState}`}>
        <div className="status-header">
          <span className={`status-dot ${rockyState}`}></span>
          <span className="status-text">
            {rockyState === 'listening' ? 'Hearing you...' : rockyState.toUpperCase()}
          </span>
        </div>
        <p className="rocky-text">{rockyResponse}</p>
      </div>

      {/* The Activity Feed (where your mails will show up!) */}
      <div className="activity-feed">
        <h3 className="section-title">Sent Activities</h3>
        {mailHistory.length === 0 ? (
          <p className="empty-msg">No sent messages! Send one now!</p>
        ) : (
          mailHistory.map((mail, idx) => (
            <div key={idx} className="mail-item glass-panel">
              <div className="recipient">To: {mail.recipient}</div>
              <div className="subject">{mail.subject}</div>
              <div className="time">{new Date(mail.timestamp).toLocaleTimeString()}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App

