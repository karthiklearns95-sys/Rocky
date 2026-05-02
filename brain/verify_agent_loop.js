/**
 * Full Unified Agent Loop Verification
 * Tests: conversation, movement, app launch, chrome, file creation, multi-step
 */
import brain from './index.js';

const tests = [
  { label: 'Greeting (conversation)',             input: 'Hello Rocky' },
  { label: 'Movement (fast-path)',                input: 'move to top right' },
  { label: 'Open App (fast-path)',                input: 'open notepad' },
  { label: 'Chrome default profile (fast-path)',  input: 'open chrome' },
  { label: 'Chrome custom profile (fast-path)',   input: 'open chrome with profile Default' },
  { label: 'Create Python file',                  input: 'create a python file called hello.py that prints hello world' },
  { label: 'Web search',                          input: 'search for what is the capital of France' },
  { label: 'Multi-step: search + save',           input: 'search for today is a good day and save it to today.txt' },
];

async function run() {
  console.log('='.repeat(60));
  console.log('  Unified Agent Loop Verification');
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const test of tests) {
    console.log(`\n▶ [${test.label}]`);
    console.log(`  Input: "${test.input}"`);
    try {
      const response = await brain.process(test.input);
      const pass = response && response.length > 5 && !response.includes('hiccup');
      console.log(`  Response: "${response}"`);
      console.log(`  Status: ${pass ? '✅ PASS' : '❌ FAIL'}`);
      results.push({ label: test.label, pass, response });
    } catch (e) {
      console.error(`  Status: ❌ ERROR — ${e.message}`);
      results.push({ label: test.label, pass: false, response: e.message });
    }
    // Small delay between tests to avoid overwhelming Mistral
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.pass).length;
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.label}`);
  }
  console.log(`\n  ${passed}/${results.length} tests passed`);
  process.exit(0);
}

run();
