import brain from './index.js';

async function verify() {
  console.log("--- Starting OS Tools Verification ---");
  
  const testInput = "Rocky, take a screenshot of my desktop.";
  console.log(`\nSimulating User Input: "${testInput}"`);
  
  try {
    const response = await brain.process(testInput);
    console.log(`\nRocky's Response: "${response}"`);
    
    if (response.includes("screenshot") && response.includes("Grace")) {
      console.log("\n✅ OS TOOLS SUCCESS: Rocky triggered the screenshot tool!");
    } else {
      console.log("\n❌ OS TOOLS FAIL: Response did not indicate tool execution.");
    }
  } catch (e) {
    console.error("Verification Error:", e);
  }

  process.exit(0);
}

verify();
