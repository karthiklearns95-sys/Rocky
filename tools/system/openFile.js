import open from 'open';
import path from 'path';
import fs from 'fs';

/**
 * Tool to open an existing file on the desktop.
 * @param {Object} args - { fileName: string }
 */
export default async function openFile(args) {
  const { fileName } = args;
  if (!fileName) return "Grace, what file should Rocky open?";
  
  console.log(`[Tool: openFile] Opening file: ${fileName}`);
  
  // Robust Desktop detection (handles OneDrive)
  let desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
  if (!fs.existsSync(desktopPath)) {
    const oneDrivePath = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop');
    if (fs.existsSync(oneDrivePath)) {
      desktopPath = oneDrivePath;
    }
  }

  const filePath = path.join(desktopPath, fileName);
  
  if (!fs.existsSync(filePath)) {
    return `Grace, Rocky cannot find "${fileName}" on your desktop. Rocky is sad.`;
  }
  
  try {
    await open(filePath);
    return `Grace, Rocky opened "${fileName}" for you. Amaze.`;
  } catch (error) {
    console.error(`[Tool: openFile] Error:`, error);
    return `Grace, Rocky failed to open "${fileName}". The system is resisting.`;
  }
}
