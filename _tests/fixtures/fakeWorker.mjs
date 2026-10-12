// A stand-in for rockyWorker.ps1 that can misbehave on request. Speaks the same protocol.
import readline from 'readline';
const P = '@@ROCKY@@';
const send = (o) => process.stdout.write(P + JSON.stringify(o) + '\n');
const counts = {};

if (process.env.FAKE_MODE === 'die-at-start') process.exit(3);
if (process.env.FAKE_MODE === 'never-ready') setInterval(() => {}, 1000);
else {
  process.stdout.write('some PowerShell banner noise\n');
  send({ ready: true, ps: 'fake' });
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const { id, cmd, args } = JSON.parse(line);
    if (cmd === 'echo') return send({ id, ok: true, result: args });
    if (cmd === 'pid') return send({ id, ok: true, result: process.pid });
    if (cmd === 'fail') return send({ id, ok: false, error: 'it broke' });
    if (cmd === 'crash') process.exit(1);
    if (cmd === 'hang') return;                       // never answers
    if (cmd === 'slow') return setTimeout(() => send({ id, ok: true, result: 'done' }), args.ms);
    if (cmd === 'chunks') {                           // one reply split over several writes
      const text = P + JSON.stringify({ id, ok: true, result: 'x'.repeat(50000) }) + '\n';
      for (let i = 0; i < text.length; i += 4096) process.stdout.write(text.slice(i, i + 4096));
      return;
    }
    counts[cmd] = (counts[cmd] || 0) + 1;
    if (cmd === 'stats') return send({ id, ok: true, result: counts });
    if (cmd === 'window') return send({ id, ok: true, result: { appName: 'notepad', windowTitle: 'Untitled - Notepad', bounds: { x: 0, y: 0, width: 800, height: 600 }, isMinimized: false, success: true } });
    if (cmd === 'screen') return send({ id, ok: true, result: { width: 1920, height: 1080 } });
    if (cmd === 'uia') {
      // The desktop root only lists top-level windows; the foreground app has the real controls.
      const topLevel = [{ Name: 'Untitled - Notepad', AutomationId: '', ClassName: 'Notepad', ControlType: 'ControlType.Window', BoundingRectangle: '0,0,800,600', IsOffscreen: false }];
      const inApp = [
        ...topLevel,
        { Name: 'File', AutomationId: 'FileMenu', ClassName: '', ControlType: 'ControlType.MenuItem', BoundingRectangle: '10,30,40,20', IsOffscreen: false },
        { Name: 'Save', AutomationId: 'SaveBtn', ClassName: '', ControlType: 'ControlType.Button', BoundingRectangle: '100,60,60,30', IsOffscreen: false },
        { Name: 'Save As', AutomationId: '', ClassName: '', ControlType: 'ControlType.Button', BoundingRectangle: '200,60,60,30', IsOffscreen: false },
      ];
      return send({ id, ok: true, result: args.foregroundOnly ? inApp : topLevel });
    }
    if (cmd === 'displays') return send({ id, ok: true, result: [
      { name: '\\\\.\\DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080, workX: 0, workY: 0, workWidth: 1920, workHeight: 1040 },
    ] });
    if (cmd === 'cursor') return send({ id, ok: true, result: { x: 100, y: 100 } });
    if (cmd === 'ocr') return send({ id, ok: true, result: [
      { text: 'Home Settings About', words: [{ t: 'Home', x: 0, y: 500, w: 60, h: 20 }, { t: 'Settings', x: 100, y: 500, w: 60, h: 20 }, { t: 'About', x: 400, y: 500, w: 60, h: 20 }] },
    ] });
    if (cmd === 'signature') return send({ id, ok: true, result: args.elements.map((e) => ({ label: e.label, samples: [{ r: 1, g: 2, b: 3 }] })) });
    send({ id, ok: false, error: `unknown command: ${cmd}` });
  });
}
