import * as THREE from 'three';

/**
 * RockyModelLoader: Responsible for creating the visual representation of Rocky.
 * Follows a TARS-style modular panel design.
 */
export default class RockyModelLoader {
  constructor() {
    this.panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, // Dark metallic/stone hybrid
      roughness: 0.3,
      metalness: 0.8,
    });
    
    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x00aaff, // Blue glow accent
      emissive: 0x00aaff,
      emissiveIntensity: 2,
    });
  }

  /**
   * Creates a TARS-style 4-panel robot group.
   * Each panel is a separate Mesh that can be animated independently.
   */
  createModel() {
    const group = new THREE.Group();
    const panels = [];

    // TARS has 4 distinct vertical panels
    const panelGeometry = new THREE.BoxGeometry(0.5, 2.5, 0.2);
    
    for (let i = 0; i < 4; i++) {
      const panel = new THREE.Mesh(panelGeometry, this.panelMaterial);
      
      // Position them side-by-side with a small gap
      panel.position.x = (i - 1.5) * 0.55;
      
      // Add a small "visor" or glowing strip to the center panels
      if (i === 1 || i === 2) {
        const visorGeo = new THREE.BoxGeometry(0.4, 0.1, 0.05);
        const visor = new THREE.Mesh(visorGeo, this.accentMaterial);
        visor.position.z = 0.11;
        visor.position.y = 0.8;
        panel.add(visor);
      }

      group.add(panel);
      panels.push(panel);
    }

    return { group, panels };
  }
}
