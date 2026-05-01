import brain from './index.js';

async function verify() {
  console.log("--- Starting Multi-Tool Verification ---");
  
  const testInput = "Rocky, search for the current weather in New York and create a file called weather.txt with that info.";
  console.log(`\nSimulating User Input: "${testInput}"`);
  
  try {
    const response = await brain.process(testInput);
    console.log(`\nRocky's Response: "${response}"`);
    
    if (response.includes("weather.txt") && response.includes("Grace")) {
      console.log("\n✅ MULTI-TOOL SUCCESS: Rocky searched and created the file!");
    } else {
      console.log("\n❌ MULTI-TOOL FAIL: Response did not indicate correct chain execution.");
    }
  } catch (e) {
    console.error("Verification Error:", e);
  }

  process.exit(0);
}

verify();
