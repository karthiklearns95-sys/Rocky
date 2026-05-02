import fs from 'fs';
import path from 'path';

/**
 * Tool to create a file with specific content on the user's desktop.
 * @param {Object} args - { fileName: string, content: string }
 */
export default async function createFileWithContent(args) {
  const { fileName, content } = args;
  
  if (!fileName) return "Grace, Rocky needs a file name to create something.";
  
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
    fs.writeFileSync(filePath, content || '');
    
    // Automatically open the file after creation
    import('open').then(module => {
      module.default(filePath);
    });

    return `Grace, Rocky created "${fileName}" on your desktop and opened it for you. Amaze.`;
  } catch (error) {
    console.error(`[Tool: createFileWithContent] Error:`, error);
    return `Grace, Rocky failed to create the file "${fileName}". The system is being stubborn.`;
  }
}
