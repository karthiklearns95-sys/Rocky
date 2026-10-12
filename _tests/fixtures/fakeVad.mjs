// A stand-in voice process (tests only). Behaviour depends on how many times it has been started,
// tracked in a state file, so one test can script "crash, go silent, then behave".
//   node fakeVad.mjs <state-file> <script>   script: comma-separated per start: crash | silent | healthy
import fs from 'fs';
const [stateFile, script] = process.argv.slice(2);
const attempt = fs.existsSync(stateFile) ? Number(fs.readFileSync(stateFile, 'utf8')) + 1 : 1;
fs.writeFileSync(stateFile, String(attempt));
const plan = script.split(',');
const mode = plan[Math.min(attempt, plan.length) - 1];
const say = (l) => process.stdout.write(l + '\n');

say('[READY]');
if (mode === 'crash') setTimeout(() => process.exit(1), 40);
else if (mode === 'silent') setInterval(() => {}, 1000);          // alive, but no heartbeat and no audio
else {
  say('[AUDIO] utt-1.wav');
  setInterval(() => say('[HEARTBEAT]'), 100);
}
