import fs from 'fs';
import path from 'path';

/**
 * Tool to create a file with specific content on the user's desktop.
 * @param {Object} args - { fileName: string, content: string }
 */
export default async function createFileWithContent(args) {
  const { fileName, content } = args;
  
  if (!fileName) return { success: false, error: "Grace, Rocky needs a file name to create something." };
  
  console.log(`[Tool: createFileWithContent] Creating file: ${fileName}`);
  
  // Robust Desktop detection (handles OneDrive)
  let desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
  if (!fs.existsSync(desktopPath)) {
    const oneDrivePath = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop');
    if (fs.existsSync(oneDrivePath)) {
      desktopPath = oneDrivePath;
    }
  }

  const filePath = path.join(desktopPath, fileName);
  
  try {
    const body = content == null ? '' : String(content);
    fs.writeFileSync(filePath, body);

    // Check the file is really there with everything written, rather than assuming.
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== Buffer.byteLength(body)) {
      return { success: false, error: `Grace, Rocky wrote "${fileName}" but it is not complete on disk.` };
    }

    // Automatically open the file after creation (best effort; the file exists either way)
    import('open').then(module => module.default(filePath)).catch(() => {});

    return `Grace, Rocky created "${fileName}" on your desktop and opened it for you. Amaze.`;
  } catch (error) {
    console.error(`[Tool: createFileWithContent] Error:`, error);
    return { success: false, error: `Grace, Rocky failed to create the file "${fileName}". The system is being stubborn.` };
  }
}
