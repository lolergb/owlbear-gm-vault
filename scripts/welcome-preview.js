// Served by the local development server, never loaded by the extension entry point.
import { ExtensionController } from '/js/controllers/ExtensionController.js';
import { Config } from '/js/models/Config.js';
import { Page } from '/js/models/Page.js';
import { applyOBRTheme } from '/js/utils/themeManager.js';
import { getVaultState } from '/js/utils/activationAnalytics.js';

const params = new URLSearchParams(location.search);
const roomId = `welcome-preview-${params.get('state') || 'empty'}`;
const userId = 'local-preview-gm';
const controller = new ExtensionController();
controller.roomId = roomId;
controller.playerId = userId;
controller.isGM = params.get('role') !== 'player';
controller.isCoGM = params.get('role') === 'cogm';
controller.OBR = {
  player: {
    getId: async () => userId,
    getRole: async () => controller.isGM ? 'GM' : 'PLAYER'
  },
  party: { getPlayers: async () => [] },
  broadcast: { sendMessage: async () => {} },
  room: { getMetadata: async () => ({}) },
  modal: { open: async ({ url }) => window.open(url, '_blank', 'noopener') }
};
controller._setupServices();
controller.storageService.setRoomId(roomId);

if (params.has('reset')) {
  localStorage.removeItem(controller.storageService.getStorageKey());
  params.delete('reset');
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

const stored = controller.storageService.getLocalConfig();
if (stored) {
  controller.config = controller.configParser.parse(stored);
} else if (params.get('state') === 'empty') {
  controller.config = new Config();
} else if (params.get('state') === 'configured') {
  controller.config = new Config({ pages: [new Page('My encounter', `${location.origin}/content-demo/img/encuentro-1.png`)] });
} else {
  await controller._loadConfig();
}

const light = params.get('theme') === 'light';
applyOBRTheme({
  mode: light ? 'LIGHT' : 'DARK',
  primary: { main: '#967acc', light: '#bb99ff', dark: '#603ea2', contrastText: '#ffffff' },
  secondary: { main: '#ce93d8', light: '#f3e5f5', dark: '#ab47bc' },
  background: { default: light ? '#f5f5f7' : '#1e2131', paper: light ? '#ffffff' : '#222639' },
  text: { primary: light ? '#202331' : '#ffffff', secondary: light ? '#555766' : 'rgba(255,255,255,0.7)', disabled: '#999999' }
});
controller._setupUI({ pagesContainer: '#page-list', contentContainer: '#notion-content' });
controller._setupEventHandlers();
controller.analyticsService.setVaultContext({ roomId, vaultState: getVaultState(controller.config) });
if (params.get('consent') === 'pending') {
  // Exercise real consent UI without changing the user's localhost preference.
  let previewConsent = null;
  controller.analyticsService.getConsent = () => previewConsent;
  controller.analyticsService.setConsent = accepted => { previewConsent = accepted; };
  await controller.analyticsService.init();
}
await controller.render();
if (params.get('state') === 'demo' && !stored) await controller._loadExampleVault();
document.title = 'GM Vault — Local start preview';
window.welcomePreview = controller;
