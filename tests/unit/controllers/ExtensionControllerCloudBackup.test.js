import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { StorageService } from '../../../js/services/StorageService.js';
import { runCloudBackup, applyLocalRestore, captureBackupContext, undoLocalRestore } from '../../../js/services/CloudBackupFlow.js';
import { prepareBackup } from '../../../js/utils/cloudBackup.js';

const source = { categories: [], pages: [{ id: 'page-new', name: 'Restored page', url: 'https://new.test', visibleToPlayers: true }] };
const original = { categories: [], pages: [{ id: 'page-old', name: 'Previous page', url: 'https://old.test' }] };
const session = { user: { id: 'user-a', email: 'a@example.test' } };

function controllerWith() {
  const controller = Object.create(ExtensionController.prototype);
  Object.assign(controller, {
    isGM: true, isCoGM: false, roomId: 'room-cloud', playerId: 'gm', connectionId: 'connection',
    configParser: new ConfigParser(), storageService: new StorageService(),
    _canRecoverBetaVault: jest.fn().mockResolvedValue(true), render: jest.fn().mockResolvedValue(undefined),
    _goBackToList: jest.fn(), _setupCloudSettings: jest.fn(),
    uiRenderer: { setConfig: jest.fn(), showErrorToast: jest.fn() }, notionRenderer: { setDependencies: jest.fn() },
    broadcastService: {
      broadcastVisiblePages: jest.fn().mockResolvedValue(undefined),
      notifyPlayerVaultUpdated: jest.fn().mockResolvedValue(undefined), notifyFullVaultUpdated: jest.fn().mockResolvedValue(undefined)
    }
  });
  controller.config = controller.configParser.parse(original);
  controller.storageService.setRoomId(controller.roomId);
  controller.storageService.saveLocalConfig(original);
  controller._cloudService = {
    storage: { persistent: true }, pendingWrite: null,
    session: jest.fn().mockResolvedValue(session), assertUser: jest.fn().mockResolvedValue(session.user),
    read: jest.fn().mockResolvedValue({ user_id: 'user-a', schema_version: 1, payload: source, revision: 1, updated_at: '2026-11-21T20:00:00Z' }),
    save: jest.fn().mockResolvedValue({ revision: 2 }), sendCode: jest.fn().mockResolvedValue(undefined),
    verifyCode: jest.fn().mockResolvedValue(session), signOut: jest.fn().mockResolvedValue(undefined)
  };
  return controller;
}
async function button(text) {
  for (let i = 0; i < 50; i++) {
    const found = [...document.querySelectorAll('dialog button')].find(element => element.textContent === text);
    if (found) return found;
    await Promise.resolve();
  }
  throw new Error(`Button not found: ${text}. Visible: ${document.body.textContent}`);
}
async function click(text) { (await button(text)).click(); }
beforeEach(() => {
  document.body.innerHTML = '';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

describe('cloud backup controller flows', () => {
  it('rejects an empty save before requesting email or contacting the cloud', async () => {
    const controller = controllerWith();
    controller.config = controller.configParser.parse({ categories: [] });
    const task = runCloudBackup(controller, 'save');
    await click('Done'); await task;
    expect(controller._cloudService.session).not.toHaveBeenCalled();
    expect(controller._cloudService.read).not.toHaveBeenCalled();
    expect(controller._cloudService.sendCode).not.toHaveBeenCalled();
  });
  it('reuses session, reviews first save, and never writes before confirmation', async () => {
    const controller = controllerWith();
    controller._cloudService.read.mockResolvedValue(null);
    const task = runCloudBackup(controller, 'save');
    await button('Save private backup');
    expect(controller._cloudService.sendCode).not.toHaveBeenCalled();
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    await click('Save private backup');
    await click('Done');
    await task;
    expect(controller._cloudService.save).toHaveBeenCalledWith('user-a', expect.objectContaining({ pages: [expect.objectContaining({ id: 'page-old' })] }), null, expect.any(Function));
    expect(controller.config.findPageById('page-old')).not.toBeNull();
  });
  it('requests email and code only after an action and resumes its review', async () => {
    const controller = controllerWith();
    controller._cloudService.session.mockResolvedValue(null);
    const task = runCloudBackup(controller, 'save');
    await button('Send code');
    document.querySelector('input').value = 'test@example.test';
    await click('Send code');
    await button('Verify code');
    document.querySelector('input').value = '123456';
    await click('Verify code');
    await button('Replace private backup');
    expect(controller._cloudService.sendCode).toHaveBeenCalledWith('test@example.test');
    expect(controller._cloudService.verifyCode).toHaveBeenCalledWith('test@example.test', '123456');
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    await click('Cancel'); await task;
  });
  it('cancels pending fetch and ignores a double action without touching data', async () => {
    const controller = controllerWith();
    let resolve;
    controller._cloudService.read.mockReturnValue(new Promise(done => { resolve = done; }));
    const before = controller.storageService.getLocalConfig();
    const task = runCloudBackup(controller, 'restore');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await runCloudBackup(controller, 'save');
    await click('Cancel');
    resolve({ user_id: 'user-a', payload: source });
    await task;
    expect(controller.storageService.getLocalConfig()).toEqual(before);
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('restores with all player access off, keeps token and original bytes, then undoes locally', async () => {
    const controller = controllerWith();
    localStorage.setItem('notion-global-token', 'only-here');
    const task = runCloudBackup(controller, 'restore');
    await click('Restore private backup');
    await click('Done'); await task;
    expect(controller.config.findPageById('page-new').playerAccessEnabled).toBe(false);
    expect(controller.broadcastService.broadcastVisiblePages).toHaveBeenCalledWith({ categories: [] });
    expect(localStorage.getItem('notion-global-token')).toBe('only-here');
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    const undo = undoLocalRestore(controller);
    await click('Use previous local vault'); await undo;
    expect(controller.config.findPageById('page-old')).not.toBeNull();
    expect(controller.config.findPageById('page-new')).toBeNull();
    expect(controller._cloudService.read).toHaveBeenCalledTimes(1);
  });
  it('rejects local edits made during the review', async () => {
    const controller = controllerWith();
    const task = runCloudBackup(controller, 'restore');
    await button('Restore private backup');
    controller.config.pages[0].name = 'Edited while reviewing';
    await click('Restore private backup');
    await click('Done'); await task;
    expect(controller.config.pages[0].name).toBe('Edited while reviewing');
    expect(controller.broadcastService.broadcastVisiblePages).not.toHaveBeenCalled();
    expect(localStorage.getItem('gm-vault-cloud-recovery-v1:room-cloud')).toBeNull();
  });
  it.each(['role', 'room', 'account'])('aborts restore after %s changes', async kind => {
    const controller = controllerWith();
    const context = captureBackupContext(controller);
    if (kind === 'role') controller.isCoGM = true;
    if (kind === 'room') controller.roomId = 'different-room';
    const authorize = kind === 'account' ? async () => { throw new Error('changed account'); } : undefined;
    await expect(applyLocalRestore(controller, context, source, { authorize })).rejects.toThrow();
    expect(controller.storageService.getLocalConfig()).toEqual(original);
    expect(controller.broadcastService.broadcastVisiblePages).not.toHaveBeenCalled();
  });
  it('does not change memory or notify players when retaining a recovery copy fails', async () => {
    const controller = controllerWith();
    const context = captureBackupContext(controller);
    localStorage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(applyLocalRestore(controller, context, source)).rejects.toThrow('could not be saved');
    expect(controller.config.findPageById('page-old')).not.toBeNull();
    expect(controller.broadcastService.broadcastVisiblePages).not.toHaveBeenCalled();
  });
  it('keeps a successful local restore when room delivery fails', async () => {
    const controller = controllerWith();
    controller.broadcastService.broadcastVisiblePages.mockRejectedValue(new Error('room disconnected'));
    const result = await applyLocalRestore(controller, captureBackupContext(controller), prepareBackup(source, controller.configParser, { restoring: true }).payload);
    expect(result).toBe(false);
    expect(controller.config.findPageById('page-new').playerAccessEnabled).toBe(false);
    expect(controller.storageService.getLocalConfig().pages[0].id).toBe('page-new');
  });
  it('recovers an interrupted journal before loading config with no cloud request', async () => {
    const controller = controllerWith();
    localStorage.setItem('gm-vault-cloud-recovery-v1:room-cloud', JSON.stringify({ version: 1, roomId: 'room-cloud', state: 'pending', beforeRaw: JSON.stringify(original), beforeLegacy: null, afterRaw: JSON.stringify(source) }));
    localStorage.setItem(controller.storageService.getStorageKey(), JSON.stringify(source));
    const task = undoLocalRestore(controller, { startup: true });
    await click('Use previous local vault'); await task;
    expect(controller.storageService.getLocalConfig()).toEqual(original);
    expect(controller._cloudService.read).not.toHaveBeenCalled();
  });
  it('signs out independently of whether a backup exists or the local vault is empty', async () => {
    const controller = controllerWith();
    const task = runCloudBackup(controller, 'signout');
    await click('Done'); await task;
    expect(controller._cloudService.signOut).toHaveBeenCalledTimes(1);
    expect(controller._cloudService.read).not.toHaveBeenCalled();
  });
  it('shows private backup controls only for active GMs', () => {
    const controller = controllerWith();
    controller._setupCloudSettings = ExtensionController.prototype._setupCloudSettings;
    document.body.innerHTML = '<div class="form"><button id="download-json-btn"></button></div>';
    controller._setupCloudSettings();
    expect(document.getElementById('cloud-backup-settings').hidden).toBe(false);
    controller.isCoGM = true; controller._setupCloudSettings();
    expect(document.getElementById('cloud-backup-settings').hidden).toBe(true);
    controller.isGM = false; controller._setupCloudSettings();
    expect(document.getElementById('cloud-backup-settings').hidden).toBe(true);
  });
});
