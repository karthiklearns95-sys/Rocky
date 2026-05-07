import brain from './index.js';

async function verify() {
  console.log("--- Starting Developer Workflow Verification ---");
  
  const testInput = "Rocky, write a node.js script called sum.js that prints the sum of numbers from 1 to 100, then run it.";
  console.log(`\nSimulating User Input: "${testInput}"`);
  
  try {
    const response = await brain.process(testInput);
    console.log(`\nRocky's Response: "${response}"`);
    
    if (response.includes("sum.js") && response.includes("5050")) {
      console.log("\n✅ DEVELOPER WORKFLOW SUCCESS: Rocky wrote and executed the code!");
    } else {
      console.log("\n❌ DEVELOPER WORKFLOW FAIL: Execution result not found in response.");
    }
  } catch (e) {
    console.error("Verification Error:", e);
  }

  process.exit(0);
}

verify();
