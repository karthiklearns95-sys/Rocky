import brain from './index.js';

async function verify() {
  console.log("--- Starting OS Task Verification ---");
  
  const testInputs = [
    "Rocky, open Notepad",
    "Rocky, take a screenshot",
    "Rocky, volume up"
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
