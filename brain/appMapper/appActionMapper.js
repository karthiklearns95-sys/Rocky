import path from 'path';
import fs from 'fs';

/**
 * AppActionMapper - The dynamic intelligence layer.
 * Maps User Intent + Active Window Context -> Executable Tool Actions.
 */
export default class AppActionMapper {
  constructor(baseDir) {
    this.profilesPath = path.join(baseDir, 'memory', 'appProfiles');
    if (!fs.existsSync(this.profilesPath)) {
      fs.mkdirSync(this.profilesPath, { recursive: true });
    }
    
    // Default system-wide generic mappings
    this.defaultMappings = {
      'media_pause': { tool: 'pressKey', args: { key: ' ' } }, // Space is universal for pause
      'media_next': { tool: 'pressKey', args: { key: '^{RIGHT}' } }, // Ctrl + Right
      'media_prev': { tool: 'pressKey', args: { key: '^{LEFT}' } },  // Ctrl + Left
      'save': { tool: 'pressKey', args: { key: '^s' } },            // Ctrl + S
      'undo': { tool: 'pressKey', args: { key: '^z' } },            // Ctrl + Z
    };
  }

  async mapIntentToAction(intent, context) {
    const appName = (context.appName || 'generic').toLowerCase();
    console.log(`[AppActionMapper] Mapping intent "${intent}" for app "${appName}"`);

    // 1. Check for specific app profile in memory
    const profile = await this._loadProfile(appName);
    if (profile && profile[intent]) {
      return profile[intent];
    }

    // 2. App-specific hardcoded overrides (Dynamic behavior base)
    if (appName.includes('chrome') || appName.includes('browser')) {
      if (intent === 'new_tab') return { tool: 'pressKey', args: { key: '^t' } };
      if (intent === 'close_tab') return { tool: 'pressKey', args: { key: '^w' } };
      if (intent === 'refresh') return { tool: 'pressKey', args: { key: '{F5}' } };
    }

    if (appName.includes('spotify')) {
      if (intent === 'media_pause') return { tool: 'pressKey', args: { key: ' ' } };
    }

    // 3. Fallback to default generic mappings
    if (this.defaultMappings[intent]) {
      return this.defaultMappings[intent];
    }

    // 4. If unknown, return null (triggers Planner/Vision fallback)
    return null;
  }

  async _loadProfile(appName) {
    const filePath = path.join(this.profilesPath, `${appName}.json`);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async saveLearnedMapping(appName, intent, action) {
    const profile = (await this._loadProfile(appName)) || {};
    profile[intent] = action;
    const filePath = path.join(this.profilesPath, `${appName.toLowerCase()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
    console.log(`[AppActionMapper] Learned new mapping for ${appName}: ${intent} -> ${action.tool}`);
  }
}
