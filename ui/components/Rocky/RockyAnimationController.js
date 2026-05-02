import * as THREE from 'three';

/**
 * RockyAnimationController: Maps agent states to specific transform behaviors
 * for the 5-limbed Eridian model.
 */
export default class RockyAnimationController {
  constructor(bodyMesh, glowMesh, limbs) {
    this.bodyMesh = bodyMesh;
    this.glowMesh = glowMesh;
    this.limbs = limbs;
    this.state = 'idle';
    this.time = 0;
  }

  setState(state) {
    this.state = state;
  }

  update(delta, movementDataRef) {
    this.time += delta;
    
    // Base resets for glow
    this.glowMesh.material.emissiveIntensity = THREE.MathUtils.lerp(this.glowMesh.material.emissiveIntensity, 0.5, 0.1);

    // Apply smooth direction rotation if moving
    if (movementDataRef && movementDataRef.current && movementDataRef.current.isMoving) {
      const rootGroup = this.bodyMesh.parent;
      if (rootGroup) {
        // Adjust DOM angle (atan2) to ThreeJS Y-axis rotation
        // DOM: Right is 0, Down is PI/2. ThreeJS: +Z is forward, +X is right
        const targetRotation = -movementDataRef.current.angle + Math.PI / 2;
        
        // Smooth rotation (slerp/lerp approach)
        // We use simple lerp but must handle wrap-around in a real game. 
        // For screen space, lerping raw angle is usually fine if we don't cross -PI/PI often.
        rootGroup.rotation.y = THREE.MathUtils.lerp(rootGroup.rotation.y, targetRotation, 0.1);
      }
    }

    // Determine effective state (override moving if target reached)
    let effectiveState = this.state;
    if (effectiveState === 'moving' && movementDataRef && movementDataRef.current && movementDataRef.current.reachedTarget) {
      effectiveState = 'idle';
    }

    switch (effectiveState) {
      case 'listening':
        this.animateListening();
        break;
      case 'thinking':
        this.animateThinking();
        break;
      case 'speaking':
        this.animateSpeaking();
        break;
      case 'moving':
        this.animateMoving();
        break;
      case 'idle':
      default:
        this.animateIdle();
        break;
    }
  }

  animateIdle() {
    // Subtle breathing: body moves up/down very slightly
    this.bodyMesh.position.y = Math.sin(this.time * 1.5) * 0.05;
    
    // Legs compress slightly (looking like a rock pile)
    this.limbs.forEach((limb) => {
      limb.upper.rotation.z = THREE.MathUtils.lerp(limb.upper.rotation.z, Math.PI / 3, 0.1);
      limb.lower.rotation.z = THREE.MathUtils.lerp(limb.lower.rotation.z, -Math.PI / 2.5, 0.1);
    });
  }

  animateListening() {
    this.bodyMesh.position.y = THREE.MathUtils.lerp(this.bodyMesh.position.y, 0.2, 0.1);

    this.limbs.forEach((limb, i) => {
      // Raise two front limbs to "point" or listen
      if (i === 0 || i === 4) {
        limb.upper.rotation.z = THREE.MathUtils.lerp(limb.upper.rotation.z, 0, 0.1);
        limb.lower.rotation.z = THREE.MathUtils.lerp(limb.lower.rotation.z, 0, 0.1);
      } else {
        // Other legs brace
        limb.upper.rotation.z = THREE.MathUtils.lerp(limb.upper.rotation.z, Math.PI / 4, 0.1);
        limb.lower.rotation.z = THREE.MathUtils.lerp(limb.lower.rotation.z, -Math.PI / 4, 0.1);
      }
    });
  }

  animateThinking() {
    // Body pulses or rotates slowly
    this.bodyMesh.rotation.y = Math.sin(this.time * 0.5) * 0.2;
    this.glowMesh.material.emissiveIntensity = 1.0 + Math.sin(this.time * 5.0) * 0.5;

    this.limbs.forEach((limb) => {
      limb.upper.rotation.z = THREE.MathUtils.lerp(limb.upper.rotation.z, Math.PI / 3.5, 0.1);
      limb.lower.rotation.z = THREE.MathUtils.lerp(limb.lower.rotation.z, -Math.PI / 3, 0.1);
    });
  }

  animateSpeaking() {
    // Body vibrates (speaking in chords)
    this.bodyMesh.position.x = Math.sin(this.time * 50.0) * 0.02;
    this.bodyMesh.position.z = Math.cos(this.time * 40.0) * 0.02;
    this.glowMesh.material.emissiveIntensity = 2.0 + Math.sin(this.time * 20.0) * 1.5;

    // "Jazz hands" or fast tapping with a couple of limbs
    this.limbs.forEach((limb, i) => {
      if (i === 1 || i === 3) {
        limb.upper.rotation.z = Math.PI / 4 + Math.sin(this.time * 15.0 + i) * 0.2;
      }
    });
  }

  animateMoving() {
    // Scurrying crab walk cycle (Forward Kinematics wave)
    const speed = 10.0;
    const stepHeight = 0.3;
    const stepLength = 0.2;

    this.bodyMesh.position.y = Math.abs(Math.sin(this.time * speed)) * 0.1;

    this.limbs.forEach((limb, i) => {
      // Phase offset for each leg to create alternating gait
      const phase = (i * Math.PI * 2) / 5;
      
      // Lift leg up and forward
      const lift = Math.max(0, Math.sin(this.time * speed + phase));
      const reach = Math.cos(this.time * speed + phase);

      // Apply math to upper and lower joints
      limb.upper.rotation.z = THREE.MathUtils.lerp(limb.upper.rotation.z, Math.PI / 4 - lift * stepHeight, 0.2);
      limb.lower.rotation.z = THREE.MathUtils.lerp(limb.lower.rotation.z, -Math.PI / 4 + reach * stepLength, 0.2);
    });
  }
}
