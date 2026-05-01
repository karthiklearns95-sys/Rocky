import React from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Float } from '@react-three/drei';
import ModularRobot from './ModularRobot';

export default function RockyCanvas({ agentState = 'idle' }) {
  return (
    <div className="rocky-canvas" style={{ pointerEvents: 'none' }}>
      <Canvas camera={{ position: [0, 1, 6], fov: 40 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow />
        
        {/* The new Modular Robot component handles its own animations based on agentState */}
        <Float speed={2} rotationIntensity={0.1} floatIntensity={0.2} floatingRange={[-0.05, 0.05]}>
           <ModularRobot state={agentState} position={[0, -1, 0]} />
        </Float>
        
        {/* Environment reflection (makes the metal look shiny!) */}
        <Environment preset="city" />
        
        {/* Floor shadow to ground the robot */}
        <ContactShadows position={[0, -1.5, 0]} opacity={0.6} scale={5} blur={2} far={2} />
      </Canvas>
    </div>
  );
}
