// Local QA only: dev-server maps /__dev/cloud here. No real email is sent.
import './welcome-preview.js';
import { BackupError } from '../js/utils/cloudBackup.js';

const controller = window.welcomePreview;
const profile = new URLSearchParams(location.search).get('profile') || 'a';
controller.roomId = `cloud-qa-${profile}`;
controller.OBR.room.id = controller.roomId;
controller.storageService.setRoomId(controller.roomId);
const sessionKey = `cloud-qa-session-${profile}`;
const readSession = () => JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
const copyKey = userId => `cloud-qa-copy-${userId}`;
const readCopy = userId => JSON.parse(localStorage.getItem(copyKey(userId)) || 'null');
controller._cloudService = {
  storage: { persistent: true }, pendingWrite: null,
  session: async () => readSession(),
  async assertUser(id) { if (readSession()?.user.id !== id) throw new BackupError('auth'); },
  async sendCode() {},
  async verifyCode(email, token) {
    if (token !== '123456') throw new BackupError('code');
    const session = { user: { id: email.toLowerCase(), email } };
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    return session;
  },
  async signOut() { sessionStorage.removeItem(sessionKey); },
  async read(id) { await this.assertUser(id); return readCopy(id); },
  async save(id, payload, previous, authorize) {
    await this.assertUser(id); await authorize?.();
    const current = readCopy(id);
    if ((previous?.revision ?? null) !== (current?.revision ?? null)) throw new BackupError('conflict');
    const row = { user_id: id, schema_version: 1, payload, revision: (current?.revision || 0) + 1, updated_at: new Date().toISOString() };
    localStorage.setItem(copyKey(id), JSON.stringify(row));
    return row;
  }
};
const stored = controller.storageService.getLocalConfig();
if (stored) controller.config = controller.configParser.parse(stored);
controller.notionRenderer.setDependencies({ config: controller.config });
controller.uiRenderer.setConfig(controller.config);
await controller.render();
document.title = 'GM Vault cloud QA — simulated email, code 123456';
