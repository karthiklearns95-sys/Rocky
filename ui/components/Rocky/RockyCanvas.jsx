import React from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Float } from '@react-three/drei';
import TarsAgent from './TarsAgent';

class CanvasErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', color: 'rgba(255,100,0,0.9)',
          fontSize: '11px', fontFamily: 'monospace', textAlign: 'center',
          textShadow: '0 0 8px black', padding: '8px'
        }}>
          <div style={{ fontSize: '28px', marginBottom: '4px' }}>🪨</div>
          <div>Rocky</div>
          <div style={{ opacity: 0.6, fontSize: '9px', marginTop: '4px' }}>
            WebGL unavailable
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function RockyCanvas({ agentState = 'idle', movementDataRef }) {
  return (
    <div className="rocky-canvas" style={{ pointerEvents: 'none' }}>
      <CanvasErrorBoundary>
        <Canvas
          camera={{ position: [0, 1, 6], fov: 40 }}
          gl={{ powerPreference: 'low-power', antialias: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0); // transparent background
          }}
        >
          {/* Warm ambient for earthy rock look */}
          <ambientLight intensity={0.5} color={0xfff0d0} />
          {/* Key light: warm directional from top-right */}
          <directionalLight position={[5, 8, 4]} intensity={1.8} color={0xffe8c0} castShadow />
          {/* Fill light: cool from below to add depth */}
          <directionalLight position={[-4, -2, -2]} intensity={0.3} color={0x8090a0} />

          {/* The new Modular Robot component handles its own animations based on agentState */}
          <Float speed={2} rotationIntensity={0.1} floatIntensity={0.2} floatingRange={[-0.05, 0.05]}>
            <TarsAgent state={agentState} position={[0, -0.5, 0]} scale={0.4} movementDataRef={movementDataRef} />
          </Float>

          {/* Environment reflection */}
          <Environment preset="city" />

          {/* Floor shadow */}
          <ContactShadows position={[0, -1.5, 0]} opacity={0.6} scale={5} blur={2} far={2} />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}

