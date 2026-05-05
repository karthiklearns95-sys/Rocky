import { exec } from 'child_process';

/**
 * GUI Control Tools - Uses PowerShell to simulate mouse and keyboard.
 */

export async function mouseClick(args) {
  let { x, y, fallbackKey } = args;
  if (x === undefined || y === undefined) return { success: false, error: "Missing coordinates" };
  
  // Add ±3px random offset to seem more human/dynamic
  const offsetX = Math.floor(Math.random() * 7) - 3;
  const offsetY = Math.floor(Math.random() * 7) - 3;
  const finalX = Math.round(x + offsetX);
  const finalY = Math.round(y + offsetY);

  console.log(`[Tool: mouseClick] Clicking at (${finalX}, ${finalY}) with offset (${offsetX}, ${offsetY})`);
  
  const psCommand = `powershell -Command "[Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${finalX}, ${finalY}); Start-Sleep -Milliseconds 50; $signature = '[DllImport(\\"user32.dll\\")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extraInfo);'; $type = Add-Type -MemberDefinition $signature -Name \\"Win32Mouse\\" -Namespace \\"Win32Utils\\" -PassThru; $type::mouse_event(0x0002, 0, 0, 0, 0); Start-Sleep -Milliseconds 50; $type::mouse_event(0x0004, 0, 0, 0, 0);"`;

  const attemptClick = () => new Promise((resolve) => {
    exec(psCommand, (error) => {
      if (error) resolve({ success: false });
      else resolve({ success: true, x: finalX, y: finalY });
    });
  });

  let result = await attemptClick();
  
  // Retry once if failed
  if (!result.success) {
    console.log(`[Tool: mouseClick] Click failed, retrying...`);
    result = await attemptClick();
  }

  // Fallback to keyboard if provided and mouse fails
  if (!result.success && fallbackKey) {
    console.log(`[Tool: mouseClick] Falling back to keyboard: ${fallbackKey}`);
    return pressKey({ key: fallbackKey });
  }

  if (result.success) {
    return { success: true, data: `Clicked at ${finalX}, ${finalY}` };
  } else {
    return { success: false, error: "Click failed after retries" };
  }
}

export async function typeText(args) {
  const { text } = args;
  if (!text) return { success: false, error: 'Grace, what should Rocky type?' };

  console.log(`[Tool: typeText] Typing: ${text}`);

  // SendKeys cannot handle raw newlines (\n) — replace with {ENTER}
  // Also escape single-quotes by doubling them for PS string safety
  const sanitized = text
    .replace(/'/g, "''")       // escape PS single-quote
    .replace(/\n/g, "{ENTER}"); // break on newlines

  const psCommand = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sanitized}')"`;

  return new Promise((resolve) => {
    exec(psCommand, (error) => {
      if (error) {
        console.error(`[Tool: typeText] Error:`, error.message);
        return resolve({ success: false, error: error.message });
      }
      resolve({ success: true, data: `Typed text.` });
    });
  });
}

/**
 * Virtual Key codes — SendKeys doesn't support these; use keybd_event instead.
 */
const VK_MAP = {
  '{MEDIA_PLAY_PAUSE}': '0xB3',
  '{MEDIA_STOP}':       '0xB2',
  '{MEDIA_NEXT}':       '0xB0',
  '{MEDIA_PREV}':       '0xB1',
  '{VOLUME_MUTE}':      '0xAD',
  '{VOLUME_DOWN}':      '0xAE',
  '{VOLUME_UP}':        '0xAF',
};

export async function pressKey(args) {
  const { key } = args;
  if (!key) return { success: false, error: 'Grace, which key should Rocky press?' };

  console.log(`[Tool: pressKey] Pressing: ${key}`);

  let psCommand;

  if (VK_MAP[key]) {
    // Media/system VK codes require keybd_event, not SendKeys
    const vk = VK_MAP[key];
    psCommand = `powershell -Command "$sig = '[DllImport(\\"user32.dll\\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);'; $t = Add-Type -MemberDefinition $sig -Name 'KbdEvent' -Namespace 'Win32' -PassThru -ErrorAction SilentlyContinue; if (!$t) { $t = [Win32.KbdEvent] }; $t::keybd_event(${vk}, 0, 0, 0); Start-Sleep -Milliseconds 50; $t::keybd_event(${vk}, 0, 2, 0)"`;
  } else {
    // Standard keys via SendKeys
    psCommand = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}')"`;
  }

  return new Promise((resolve) => {
    exec(psCommand, (error) => {
      if (error) {
        console.error(`[Tool: pressKey] Error:`, error.message);
        return resolve({ success: false, error: error.message });
      }
      resolve({ success: true, data: `Rocky pressed ${key}.` });
    });
  });
}


export async function scroll(args) {
  const { direction = 'down', amount = 3 } = args;
  console.log(`[Tool: scroll] Scrolling ${direction}`);

  const scrollKey = direction === 'up' ? '{PGUP}' : '{PGDN}';
  const psCommand = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; for($i=0; $i -lt ${amount}; $i++) { [System.Windows.Forms.SendKeys]::SendWait('${scrollKey}') }"`;

  return new Promise((resolve) => {
    exec(psCommand, (error) => {
      if (error) return resolve("Grace... Rocky cannot scroll.");
      resolve(`Rocky scrolled ${direction}. Amaze.`);
    });
  });
}

export async function focusWindow(args) {
  const { appName } = args;
  if (!appName) return "Grace, what app should Rocky focus?";

  console.log(`[Tool: focusWindow] Focusing: ${appName}`);

  const psCommand = `powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.AppActivate('${appName}')"`;

  return new Promise((resolve) => {
    exec(psCommand, (error) => {
      if (error) return resolve(`Grace... Rocky couldn't find "${appName}" to focus.`);
      resolve(`Rocky focused ${appName}. Amaze.`);
    });
  });
}
