import * as THREE from 'three';

/**
 * RockyAnimationController: Maps agent states to specific transform behaviors.
 * Updates the TARS-style panels every frame.
 */
export default class RockyAnimationController {
  constructor(panels) {
    this.panels = panels;
    this.state = 'idle';
    this.time = 0;
  }

  setState(state) {
    this.state = state;
  }

  /**
   * Called every frame to update panel transforms.
   * @param {number} delta Time since last frame
   */
  update(delta) {
    this.time += delta;
    
    switch (this.state) {
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
    // Subtle slow rotation/bobbing
    this.panels.forEach((panel, i) => {
      panel.rotation.x = Math.sin(this.time * 0.5 + i) * 0.05;
      panel.position.y = Math.sin(this.time * 1.0) * 0.05;
    });
  }

  animateListening() {
    // Slight forward tilt of all panels
    this.panels.forEach((panel) => {
      panel.rotation.x = THREE.MathUtils.lerp(panel.rotation.x, 0.2, 0.1);
      panel.position.y = THREE.MathUtils.lerp(panel.position.y, 0, 0.1);
    });
  }

  animateThinking() {
    // Gentle oscillation (panels move slightly in/out)
    this.panels.forEach((panel, i) => {
      panel.position.z = Math.sin(this.time * 3.0 + i) * 0.1;
      panel.rotation.y = Math.sin(this.time * 2.0 + i) * 0.05;
    });
  }

  animateSpeaking() {
    // Rhythmic panel movement (like talking)
    this.panels.forEach((panel, i) => {
      if (i === 1 || i === 2) { // Middle panels "talk"
        panel.position.y = Math.abs(Math.sin(this.time * 10.0)) * 0.1;
      }
      panel.rotation.x = Math.sin(this.time * 5.0) * 0.02;
    });
  }

  animateMoving() {
    // Stable orientation + slight lean into direction
    this.panels.forEach((panel) => {
      panel.rotation.z = THREE.MathUtils.lerp(panel.rotation.z, -0.1, 0.1);
      panel.rotation.x = 0;
    });
  }
}
