/**
 * OCR integration test — needs Windows + a Windows OCR language pack (unlike smoke.mjs).
 *
 * Renders an image with known text at known positions, runs the real ocrSearch tool on it,
 * and checks the returned coordinates. Guards against the OCR script silently returning
 * nothing (it once failed on every call: broken AsTask call + clobbered $matches variable).
 *
 * Run with: node _tests/ocr_integration.mjs
 */

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execWithTimeout } from '../automation/system/execWithTimeout.js';

if (process.platform !== 'win32') {
  console.log('Skipped: Windows OCR is only available on Windows.');
  process.exit(0);
}

const { default: ocrSearch } = await import('../tools/system/ocrSearch.js');

const tag = `${process.pid}_${Date.now()}`;
const imgPath = path.join(os.tmpdir(), `rocky_ocr_fixture_${tag}.png`);
const psPath = path.join(os.tmpdir(), `rocky_ocr_fixture_${tag}.ps1`);
const marker = path.join(os.tmpdir(), `rocky_ocr_pwned_${tag}.txt`);

// Two lines of large black text on white, at known positions (image is 900x360).
const LINE1 = { text: 'Save Document', x: 60, y: 50 };
const LINE2 = { text: 'Rocky Cancel', x: 60, y: 200 };
fs.writeFileSync(psPath, `
param($out)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 900, 360
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = New-Object System.Drawing.Font('Arial', 48, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('${LINE1.text}', $font, [System.Drawing.Brushes]::Black, ${LINE1.x}, ${LINE1.y})
$g.DrawString('${LINE2.text}', $font, [System.Drawing.Brushes]::Black, ${LINE2.x}, ${LINE2.y})
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

try {
  const gen = await execWithTimeout(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psPath}" "${imgPath}"`,
    { timeoutMs: 20000 }
  );
  assert.ok(!gen.error && fs.existsSync(imgPath), `fixture image not created: ${gen.error?.message}`);

  console.log('\n── OCR: windows OCR script against a rendered image ──');

  const inLine = (hit, line) =>
    hit.x >= line.x && hit.x <= line.x + 700 && hit.y >= line.y && hit.y <= line.y + 70;

  await test('finds text on line 1 and returns coordinates inside it', async () => {
    const hit = await ocrSearch({ query: 'document', screenshotPath: imgPath });
    assert.ok(hit, 'expected a match for "document"');
    assert.equal(hit.source, 'OCR');
    assert.ok(inLine(hit, LINE1), `(${hit.x}, ${hit.y}) is not inside line 1`);
  });

  await test('finds text on line 2 and returns coordinates inside it', async () => {
    const hit = await ocrSearch({ query: 'cancel', screenshotPath: imgPath });
    assert.ok(hit, 'expected a match for "cancel"');
    assert.ok(inLine(hit, LINE2), `(${hit.x}, ${hit.y}) is not inside line 2`);
  });

  await test('match is case-insensitive', async () => {
    const hit = await ocrSearch({ query: 'ROCKY', screenshotPath: imgPath });
    assert.ok(hit, 'expected a match for "ROCKY"');
    assert.ok(inLine(hit, LINE2));
  });

  await test('missing text returns null', async () => {
    assert.equal(await ocrSearch({ query: 'zzzqqqxyz', screenshotPath: imgPath }), null);
  });

  await test('regex metacharacters are matched literally', async () => {
    assert.equal(await ocrSearch({ query: 'doc.*', screenshotPath: imgPath }), null);
    assert.equal(await ocrSearch({ query: '(((', screenshotPath: imgPath }), null);
  });

  await test('hostile query is inert (no command execution)', async () => {
    const hostile = `x"; New-Item -Path '${marker}' -Force; "`;
    assert.equal(await ocrSearch({ query: hostile, screenshotPath: imgPath }), null);
    assert.equal(fs.existsSync(marker), false, 'injected command ran!');
  });
} finally {
  for (const f of [imgPath, psPath, marker]) { try { fs.unlinkSync(f); } catch {} }
}

console.log(`\n${'─'.repeat(50)}\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
