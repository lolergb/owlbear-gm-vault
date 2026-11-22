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
let notifySession;
const copyKey = userId => `cloud-qa-copy-${userId}`;
const readCopy = userId => JSON.parse(localStorage.getItem(copyKey(userId)) || 'null');
const copiesKey = userId => `cloud-qa-copies-v2-${userId}`;
const readCopies = userId => {
  const saved = localStorage.getItem(copiesKey(userId));
  if (saved) return JSON.parse(saved);
  const legacy = readCopy(userId);
  return legacy ? [{ ...legacy, id: 'previous-copy', name: 'Previous backup', created_at: legacy.updated_at }] : [];
};
controller._cloudService = {
  storage: { persistent: true }, pendingWrite: null,
  session: async () => readSession(),
  watchSession(listener) {
    notifySession = listener;
    listener(readSession());
    return () => { notifySession = null; };
  },
  async assertUser(id) { if (readSession()?.user.id !== id) throw new BackupError('auth'); },
  async sendCode() {},
  async verifyCode(email, token) {
    if (token !== '123456') throw new BackupError('code');
    const session = { user: { id: email.toLowerCase(), email } };
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    notifySession?.(session);
    return session;
  },
  async signOut() { sessionStorage.removeItem(sessionKey); notifySession?.(null); },
  async list(id) {
    await this.assertUser(id);
    return readCopies(id).map(({ payload, ...metadata }) => metadata).sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async read(id, backupId) { await this.assertUser(id); return readCopies(id).find(row => row.id === backupId) || null; },
  async deleteBackup(id, row, authorize) {
    await this.assertUser(id); await authorize(); await this.assertUser(id);
    const copies = readCopies(id);
    const matches = copy => copy.id === row.id && copy.revision === row.revision && copy.name === row.name;
    if (!copies.some(matches)) throw new BackupError('conflict');
    localStorage.setItem(copiesKey(id), JSON.stringify(copies.filter(copy => !matches(copy))));
    if (row.id === 'previous-copy') localStorage.removeItem(copyKey(id));
  },
  async save(id, payload, previous, authorize, { name }) {
    await this.assertUser(id); await authorize?.();
    const copies = readCopies(id);
    const current = previous ? copies.find(row => row.id === previous.id) : null;
    if (previous ? !current || previous.revision !== current.revision : copies.some(row => row.name === name)) throw new BackupError('conflict');
    const row = { id: current?.id || crypto.randomUUID(), name, user_id: id, schema_version: 1, payload, revision: (current?.revision || 0) + 1, created_at: current?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    localStorage.setItem(copiesKey(id), JSON.stringify([...copies.filter(copy => copy.id !== row.id), row]));
    return row;
  }
};
const stored = controller.storageService.getLocalConfig();
if (stored) controller.config = controller.configParser.parse(stored);
controller.notionRenderer.setDependencies({ config: controller.config });
controller.uiRenderer.setConfig(controller.config);
await controller.render();
document.title = 'GM Vault cloud QA — simulated email, code 123456';
