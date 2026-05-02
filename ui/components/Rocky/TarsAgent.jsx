import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import RockyModelLoader from './RockyModelLoader';
import RockyAnimationController from './RockyAnimationController';

/**
 * TarsAgent: React-Three-Fiber component that bridges the 
 * modular loader and controller into the scene.
 */
export default function TarsAgent({ state = 'idle', movementDataRef, ...props }) {
  const groupRef = useRef();
  
  // Initialize loader and controller once
  const { model, controller } = useMemo(() => {
    const loader = new RockyModelLoader();
    const { group, bodyMesh, glowMesh, limbs } = loader.createModel();
    const animationController = new RockyAnimationController(bodyMesh, glowMesh, limbs);
    return { model: group, controller: animationController };
  }, []);

  // Sync React state to our controller
  useEffect(() => {
    controller.setState(state);
  }, [state, controller]);

  // Update animation every frame
  useFrame((_, delta) => {
    controller.update(delta, movementDataRef);
  });

  return (
    <primitive ref={groupRef} object={model} {...props} />
  );
}
