import { uiaManager } from '../tools/desktop/uiaManager.js';

async function run() {
  console.log("=== PROJECT ROCKY: UIA IPC BRIDGE TEST ===");
  console.log("Booting uiaManager (will compile C# daemon if missing)...");
  
  // Wait a brief moment to ensure IPC connection is established
  await new Promise(r => setTimeout(r, 2000));
  
  if (!uiaManager.connected) {
    console.error("❌ FAILED: IPC Bridge is not connected.");
    process.exit(1);
  }
  console.log("✅ IPC Bridge Connected Successfully!");

  console.log("\nSending 'focus' command targeting 'Start' or 'Taskbar'...");
  const t1 = Date.now();
  
  // A safe test: attempting to focus the Windows taskbar or Start button.
  // It shouldn't be destructive and proves the UIA tree search and interaction works.
  const result = await uiaManager.runCommand('focus', 'Start', '', '');
  
  const t2 = Date.now();
  
  console.log("\nDaemon Response:");
  console.log(result);
  console.log(`\n⚡ Total Roundtrip Latency (Node -> C# IPC -> Node): ${t2 - t1}ms`);
  
  // Since the daemon process is detached, we can safely exit.
  process.exit(0);
}

run();
