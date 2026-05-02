import React from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Float } from '@react-three/drei';
import TarsAgent from './TarsAgent';

export default function RockyCanvas({ agentState = 'idle', movementDataRef }) {
  return (
    <div className="rocky-canvas" style={{ pointerEvents: 'none' }}>
      <Canvas camera={{ position: [0, 1, 6], fov: 40 }}>
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
        
        {/* Environment reflection (makes the metal look shiny!) */}
        <Environment preset="city" />
        
        {/* Floor shadow to ground the robot */}
        <ContactShadows position={[0, -1.5, 0]} opacity={0.6} scale={5} blur={2} far={2} />
      </Canvas>
    </div>
  );
}
