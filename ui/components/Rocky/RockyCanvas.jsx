import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, ContactShadows, Environment, MeshWobbleMaterial } from '@react-three/drei';

function PlaceholderRocky({ state }) {
  const meshRef = useRef();

  // Basic animation based on state
  useFrame((stateObj, delta) => {
    if (meshRef.current) {
      // Idle bobbing is handled by Float, but we can add spin or jitter for other states
      if (state === 'thinking') {
        meshRef.current.rotation.y += delta * 2;
      } else if (state === 'listening') {
        meshRef.current.scale.setScalar(1 + Math.sin(stateObj.clock.elapsedTime * 5) * 0.05);
      } else if (state === 'speaking') {
        meshRef.current.scale.y = 1 + Math.sin(stateObj.clock.elapsedTime * 15) * 0.1;
      } else {
        // Reset scale for idle/moving
        meshRef.current.scale.setScalar(1);
      }
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={1} floatingRange={[-0.1, 0.1]}>
      <mesh ref={meshRef} position={[0, 0, 0]} castShadow>
        {/* Placeholder: A capsule for the body */}
        <capsuleGeometry args={[0.5, 1, 4, 16]} />
        {/* Wobble material to make it feel alive */}
        <MeshWobbleMaterial factor={0.2} speed={1} color={getColorForState(state)} />
        
        {/* Eyes */}
        <mesh position={[-0.2, 0.4, 0.4]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={0.5} />
        </mesh>
        <mesh position={[0.2, 0.4, 0.4]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={0.5} />
        </mesh>
      </mesh>
    </Float>
  );
}

function getColorForState(state) {
  switch(state) {
    case 'idle': return '#555555';
    case 'listening': return '#00ff88';
    case 'thinking': return '#ffcc00';
    case 'speaking': return '#00aaff';
    case 'moving': return '#ff6600';
    default: return '#555555';
  }
}

export default function RockyCanvas({ agentState = 'idle' }) {
  return (
    <div className="rocky-canvas" style={{ pointerEvents: 'none' }}>
      <Canvas camera={{ position: [0, 0, 4], fov: 40 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
        
        <PlaceholderRocky state={agentState} />
        
        {/* Environment reflection */}
        <Environment preset="city" />
        
        {/* Floor shadow */}
        <ContactShadows position={[0, -1.5, 0]} opacity={0.5} scale={5} blur={2} far={2} />
      </Canvas>
    </div>
  );
}
