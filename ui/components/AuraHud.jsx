import { useState, useEffect } from 'react';
import './AuraHud.css';

export default function AuraHud() {
  const [telemetry, setTelemetry] = useState({ status: 'idle' });

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onAuraTelemetry) {
      window.electronAPI.onAuraTelemetry((payload) => {
        setTelemetry(payload);
      });
    }
  }, []);

  return (
    <div className={`aura-container ${telemetry.status}`}>
      <div className="aura-core">
        {telemetry.status === 'background_processing' && (
          <div className="orbiting-node"></div>
        )}
      </div>
      <div className="aura-readout">
        <span className="aura-status">{telemetry.status.toUpperCase().replace(/_/g, ' ')}</span>
        {telemetry.source && <span className="aura-detail">Source: {telemetry.source}</span>}
        {telemetry.target && <span className="aura-detail">Target: {telemetry.target}</span>}
        {telemetry.reason && <span className="aura-detail">Reason: {telemetry.reason}</span>}
        {telemetry.active_workers > 0 && <span className="aura-detail">Threads: {telemetry.active_workers}</span>}
      </div>
    </div>
  );
}
