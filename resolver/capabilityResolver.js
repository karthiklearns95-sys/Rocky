/**
 * Capability Resolver
 * Determines what actions are structurally possible on a given resource.
 */
export default function resolveCapabilities(resource) {
  const capabilities = {
    canOpen: true,
    canClick: true,
    canType: true,
    canControlMedia: false,
    preferredInterface: 'Vision'
  };

  if (resource.type === 'desktop') {
    capabilities.preferredInterface = 'UIA';
    // Media apps
    if (['spotify', 'itunes', 'vlc'].some(m => resource.target.toLowerCase().includes(m))) {
      capabilities.canControlMedia = true;
    }
  } else if (resource.type === 'web') {
    // For web, we prefer DOM if we have a CDP connection, otherwise UIA/Vision fallback.
    // Assuming CDP is future implemented, we tag it DOM.
    capabilities.preferredInterface = 'DOM';
    
    if (resource.target.includes('youtube') || resource.target.includes('netflix')) {
      capabilities.canControlMedia = true;
    }
  } else if (resource.type === 'hybrid') {
    capabilities.preferredInterface = 'UIA'; // Electron apps usually expose UIA
  }

  return capabilities;
}
