import brain from './index.js';
import memoryManager from '../memory/index.js';

async function verify() {
  console.log("--- Starting Hybrid Memory Verification ---");
  
  // 1. Store a specific memory
  console.log("\n1. Storing a specific secret memory...");
  await memoryManager.remember("Grace's favorite color is starlight blue.", ["secret"]);
  
  // 2. Process an input that should trigger recall
  console.log("\n2. Processing a question about the secret...");
  const response = await brain.process("Rocky, do you remember my favorite color?");
  
  console.log(`\nRocky's Response: "${response}"`);
  
  // 3. Verify semantic search directly
  console.log("\n3. Testing direct semantic recall...");
  const memories = await memoryManager.recall("color");
  console.log("Recalled Memories:", memories.map(m => m.text));

  if (memories.some(m => m.text.includes("starlight blue"))) {
    console.log("\n✅ HYBRID MEMORY SUCCESS: Rocky remembered the favorite color!");
  } else {
    console.log("\n❌ HYBRID MEMORY FAIL: Memory not retrieved.");
  }

  process.exit(0);
}

verify();
