import { AppCatalog } from '../../../resolver/appCatalog.js';
const APPS = [
  ['Notepad', '{F38BF404-1D43-42F2-9305-67DE0B28FC23}\\notepad.exe'],
  ['Spotify', 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'],
  ['Calculator', 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'],
  ['Google Chrome', 'Chrome'],
  ['Python 3.12 (64-bit)', '{X}\\Python312\\python.exe'],
  ['Python 3.11 (64-bit)', '{X}\\Python311\\python.exe'],
].map(([name, appId]) => ({ name, appId }));
export const appCatalog = new AppCatalog({ loader: async () => APPS, storePath: null });
const origRecord = appCatalog.recordLaunch.bind(appCatalog);
appCatalog.recordLaunch = (id) => { globalThis.__T?.side('catalog.recordLaunch', id); origRecord(id); };
await appCatalog.refresh();
export async function listWindowedProcesses() { return []; }
