import LocalProvider from './aiProvider/localProvider.js';

async function test() {
  console.log("--- Starting Ollama Verification ---");
  
  const provider = new LocalProvider('llama3');
  
  const testPrompts = [
    "Say hello to Grace.",
    "Tell Grace that the task is finished and it was a success."
  ];

  for (const p of testPrompts) {
    console.log(`\nInput: "${p}"`);
    try {
      const response = await provider.generate(p);
      console.log(`Output: "${response}"`);
    } catch (e) {
      console.error("Error during test:", e.message);
    }
  }

  console.log("\n--- Verification Finished ---");
}

test();
