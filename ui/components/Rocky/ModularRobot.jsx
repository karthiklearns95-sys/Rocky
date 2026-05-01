import React, { useRef, useEffect } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';

export default function ModularRobot({ state = 'idle', ...props }) {
  const group = useRef();
  
  // Load the model using Drei's wrapper around GLTFLoader
  const { scene, animations } = useGLTF('/tars.glb'); 
  
  // Set up the AnimationMixer automatically
  const { actions, names } = useAnimations(animations, group);

  // Switch animations based on the agent's state
  useEffect(() => {
    if (!actions) return;
    
    // Debug info: check console to see available animation names inside the GLB
    // console.log("Available Animations in GLB:", names);

    // Gently fade out all currently playing animations over 0.3 seconds
    Object.values(actions).forEach((action) => action?.fadeOut(0.3));

    // Map your app's agent state to the exact names of your Blender clips
    let clipToPlay = 'Idle'; 
    
    switch(state) {
      case 'moving': 
        clipToPlay = 'Walk'; 
        break;
      case 'listening': 
      case 'thinking': 
        clipToPlay = 'Turn'; 
        break;
      case 'speaking': 
        clipToPlay = 'Gesture'; 
        break;
      case 'idle':
      default:
        clipToPlay = 'Idle'; 
        break;
    }

    // Play the new animation with a smooth 0.3s crossfade
    if (actions[clipToPlay]) {
      actions[clipToPlay].reset().fadeIn(0.3).play();
    } else if (names.length > 0) {
      // Fallback: If exact name not found, try to play the first animation available
      // console.warn(`Animation "${clipToPlay}" not found. Falling back to "${names[0]}".`);
      // actions[names[0]]?.reset().fadeIn(0.3).play();
    }
  }, [state, actions, names]);

  return (
    <group ref={group} {...props} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}

// Preload the model so there is no delay when the component mounts
useGLTF.preload('/tars.glb');
