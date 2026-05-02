import * as THREE from 'three';

/**
 * RockyModelLoader: Creates the Eridian (spider-rock) representation of Rocky.
 * 5 articulated limbs, central stone core, forward kinematics ready.
 */
export default class RockyModelLoader {
  constructor() {
    // --- BODY CORE: warm dark brown stone ---
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b3d2a,       // warm dark brown
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,     // faceted / cracked rock look
    });

    // --- LIMB UPPER SEGMENTS: clay brown ---
    this.limbMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a5a3b,       // earthy clay brown
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });

    // --- JOINT/LOWER SEGMENTS: darker burnt brown ---
    this.jointMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a2a18,       // deep shadow tone
      roughness: 0.98,
      metalness: 0.02,
      flatShading: true,
    });

    // --- GLOW FISSURES: faint inner heat ---
    this.glowMaterial = new THREE.MeshStandardMaterial({
      color: 0xcc5500,       // deep amber-orange
      emissive: 0xcc4400,
      emissiveIntensity: 0.4,
      roughness: 0.8,
      metalness: 0.0,
    });
  }

  createModel() {
    const group = new THREE.Group();
    
    // 1. Central Core Body (Icosahedron for irregular rock look)
    const bodyGeometry = new THREE.IcosahedronGeometry(1.2, 1);
    const bodyMesh = new THREE.Mesh(bodyGeometry, this.bodyMaterial);
    
    // Add subtle glowing fissures
    const glowGeo = new THREE.IcosahedronGeometry(1.15, 0);
    const glowMesh = new THREE.Mesh(glowGeo, this.glowMaterial);
    bodyMesh.add(glowMesh);

    group.add(bodyMesh);

    // 2. The 5 Limbs
    const limbs = [];
    const numLimbs = 5;
    const radius = 1.0; // Distance from center where legs attach

    for (let i = 0; i < numLimbs; i++) {
      const angle = (i / numLimbs) * Math.PI * 2;
      
      // Limb Root (Shoulder joint)
      const limbRoot = new THREE.Group();
      limbRoot.position.x = Math.cos(angle) * radius;
      limbRoot.position.z = Math.sin(angle) * radius;
      
      // Point the root outward
      limbRoot.rotation.y = -angle;

      // Upper Leg
      const upperLegGeo = new THREE.CylinderGeometry(0.2, 0.15, 1.5, 5);
      // Translate geometry so origin is at the top (shoulder)
      upperLegGeo.translate(0, -0.75, 0); 
      const upperLeg = new THREE.Mesh(upperLegGeo, this.limbMaterial);
      
      // Angle the upper leg out and down
      upperLeg.rotation.z = Math.PI / 4; 
      
      // Knee Joint (attached to bottom of upper leg)
      const knee = new THREE.Group();
      knee.position.y = -1.5;

      // Lower Leg — use darker joint material for color depth
      const lowerLegGeo = new THREE.CylinderGeometry(0.13, 0.04, 1.4, 5);
      lowerLegGeo.translate(0, -0.75, 0);
      const lowerLeg = new THREE.Mesh(lowerLegGeo, this.jointMaterial);
      
      // Angle lower leg straight down
      lowerLeg.rotation.z = -Math.PI / 4;

      knee.add(lowerLeg);
      upperLeg.add(knee);
      limbRoot.add(upperLeg);
      group.add(limbRoot);

      // Store references for the AnimationController
      limbs.push({
        root: limbRoot,
        upper: upperLeg,
        knee: knee,
        lower: lowerLeg,
        baseAngle: angle
      });
    }

    // Elevate the entire group so legs touch the "floor"
    group.position.y = 1.5;

    return { group, bodyMesh, glowMesh, limbs };
  }
}
