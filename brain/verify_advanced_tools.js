import brain from './index.js';

async function verify() {
  console.log("--- Starting Chrome & CodeGen Verification ---");
  
  const testInputs = [
    "open chrome", // Should use default profile
    "open chrome with profile Personal", // Should use custom profile
    "create a python file for sorting" // Should generate code and create file
  ];

  for (const input of testInputs) {
    console.log(`\nSimulating User Input: "${input}"`);
    try {
      const response = await brain.process(input);
      console.log(`Rocky's Response: "${response}"`);
    } catch (e) {
      console.error("Error:", e);
    }
  }

  process.exit(0);
}

verify();
