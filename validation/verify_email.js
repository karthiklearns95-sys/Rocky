import brain from './index.js';

async function verify() {
  console.log("--- Starting Email Tool Verification ---");
  
  const testInput = "Rocky, write an email to john@example.com about the meeting tomorrow.";
  console.log(`\nSimulating User Input: "${testInput}"`);
  
  try {
    const response = await brain.process(testInput);
    console.log(`\nRocky's Response: "${response}"`);
    
    if (response.toLowerCase().includes("email") && response.includes("Grace")) {
      console.log("\n✅ EMAIL TOOL SUCCESS: Rocky prepared the email!");
    } else {
      console.log("\n❌ EMAIL TOOL FAIL: Response did not indicate email preparation.");
    }
  } catch (e) {
    console.error("Verification Error:", e);
  }

  process.exit(0);
}

verify();
