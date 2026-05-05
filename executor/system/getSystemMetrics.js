import { exec } from 'child_process';

/**
 * Gets screen resolution and other system metrics.
 */
export default async function getSystemMetrics() {
  const psCommand = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height"`;

  return new Promise((resolve) => {
    exec(psCommand, (error, stdout) => {
      if (error) {
        return resolve({ width: 1920, height: 1080 }); // fallback
      }
      const [width, height] = stdout.trim().split(/\s+/).map(Number);
      resolve({ width, height });
    });
  });
}
