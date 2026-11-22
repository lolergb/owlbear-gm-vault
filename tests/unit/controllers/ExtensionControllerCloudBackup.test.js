import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { StorageService } from '../../../js/services/StorageService.js';
import { CloudBackupService } from '../../../js/services/CloudBackupService.js';
import { runCloudBackup, applyLocalRestore, captureBackupContext, undoLocalRestore } from '../../../js/services/CloudBackupFlow.js';
import { BackupError, prepareBackup } from '../../../js/utils/cloudBackup.js';

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
    watchSession: jest.fn(listener => { listener(session); return () => {}; }),
    session: jest.fn().mockResolvedValue(session), assertUser: jest.fn().mockResolvedValue(session.user),
    list: jest.fn().mockResolvedValue([{ id: 'backup-a', user_id: 'user-a', name: 'Campaign A', revision: 1, updated_at: '2026-11-21T20:00:00Z' }]),
    read: jest.fn().mockResolvedValue({ id: 'backup-a', name: 'Campaign A', user_id: 'user-a', schema_version: 1, payload: source, revision: 1, updated_at: '2026-11-21T20:00:00Z' }),
    save: jest.fn(async (_user, _payload, _previous, authorize) => { await authorize(); return { revision: 2 }; }), sendCode: jest.fn().mockResolvedValue(undefined),
    verifyCode: jest.fn().mockResolvedValue(session), signOut: jest.fn().mockResolvedValue(undefined)
  };
  return controller;
}
async function button(text) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const found = [...document.querySelectorAll('dialog button')].find(element => element.textContent === text);
    if (found) return found;
    // Lazy imports also need a turn of the event loop before the dialog renders.
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Button not found: ${text}. Visible: ${document.body.textContent}`);
}
async function click(text) { (await button(text)).click(); }
async function nameBackup(name) {
  await button('Review backup');
  document.querySelector('dialog input').value = name;
  await click('Review backup');
}
async function selectBackup(id = 'backup-a') {
  const review = await button('Review backup');
  expect(review.disabled).toBe(true);
  const trigger = document.querySelector('dialog button[role="combobox"]');
  trigger.click();
  document.querySelector(`dialog [role="option"][data-value="${id}"]`).click();
  expect(review.disabled).toBe(false);
  review.click();
}
beforeEach(() => {
  document.body.innerHTML = '';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

describe('cloud backup controller flows', () => {
  function observe(controller) {
    const record = jest.fn();
    controller.analyticsService = { privateBackupReporter: jest.fn(() => record) };
    return record.mock.calls;
  }

  it('records the rejected OTP step and an explicit Escape at the retry prompt', async () => {
    const controller = controllerWith();
    const events = observe(controller);
    controller._cloudService.session.mockResolvedValue(null);
    controller._cloudService.verifyCode.mockRejectedValue(new BackupError('code'));
    const task = runCloudBackup(controller, 'restore');
    await button('Send code');
    await click('Send code');
    expect(events).toContainEqual(['email', 'failed', false, 'input_invalid']);
    document.querySelector('dialog input').value = 'test@example.test';
    await click('Send code'); await button('Verify code');
    document.querySelector('dialog input').value = '000000';
    await click('Verify code'); await button('Verify code');
    document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    await task;
    expect(events).toContainEqual(['verify_code', 'failed', false, 'code']);
    expect(events.filter(([, , terminal]) => terminal)).toEqual([['enter_code', 'cancelled', true, undefined]]);
    expect(controller.analyticsService.privateBackupReporter).toHaveBeenCalledWith('restore');
    expect(JSON.stringify(events)).not.toMatch(/000000|example\.test/);
  });

  it('records the real result of a write already dispatched after Close', async () => {
    const controller = controllerWith();
    const events = observe(controller);
    let dispatch, finishWrite;
    const dispatched = new Promise(resolve => { dispatch = resolve; });
    controller._cloudService.save.mockImplementation(async (_user, _payload, _previous, authorize) => {
      await authorize(); dispatch();
      await new Promise(resolve => { finishWrite = resolve; });
    });
    const task = runCloudBackup(controller, 'save');
    await nameBackup('Another copy');
    await click('Save private backup'); await dispatched;
    await click('Close'); finishWrite(); await task;
    expect(events.filter(([, , terminal]) => terminal)).toEqual([['save', 'completed', true, undefined]]);
  });

  it('separates a persisted restore from a failed room sync', async () => {
    const controller = controllerWith();
    const events = observe(controller);
    controller.broadcastService.broadcastVisiblePages.mockRejectedValue(new Error('private room name'));
    const task = runCloudBackup(controller, 'restore');
    await selectBackup(); await click('Restore private backup'); await button('Retry room update');
    await click('Cancel'); await task;
    expect(events).toContainEqual(['sync_room', 'failed', false, 'room_sync']);
    expect(events.filter(([, , terminal]) => terminal)).toEqual([['retry_sync', 'local_only', true, undefined]]);
  });

  it('reports the confirmed result after an uncertain save without counting two attempts', async () => {
    const controller = controllerWith();
    const events = observe(controller);
    const service = controller._cloudService;
    service.save.mockImplementation(async (userId, _payload, _previous, authorize) => {
      await authorize();
      service.pendingWrite = { userId };
      throw new BackupError('uncertain');
    });
    service.checkWrite = jest.fn().mockResolvedValue({ matched: true });
    const task = runCloudBackup(controller, 'save');
    await nameBackup('New copy'); await click('Save private backup');
    await click('Check backup'); await click('Done'); await task;
    expect(events).toContainEqual(['save', 'failed', false, 'uncertain']);
    expect(events.filter(([, , terminal]) => terminal)).toEqual([['check_save', 'completed', true, undefined]]);
    expect(controller.analyticsService.privateBackupReporter).toHaveBeenCalledTimes(1);
  });
  it('rejects an empty save before requesting email or contacting the cloud', async () => {
    const controller = controllerWith();
    const events = observe(controller);
    controller.config = controller.configParser.parse({ categories: [] });
    const task = runCloudBackup(controller, 'save');
    await click('Done'); await task;
    expect(events.filter(([, , terminal]) => terminal)).toEqual([['prepare', 'failed', true, 'empty']]);
    expect(controller._cloudService.session).not.toHaveBeenCalled();
    expect(controller._cloudService.read).not.toHaveBeenCalled();
    expect(controller._cloudService.sendCode).not.toHaveBeenCalled();
  });
  it('reuses session, reviews first save, and never writes before confirmation', async () => {
    const controller = controllerWith();
    controller._cloudService.list.mockResolvedValue([]);
    controller._cloudService.read.mockResolvedValue(null);
    const task = runCloudBackup(controller, 'save');
    await nameBackup('Session 1');
    await button('Save private backup');
    expect(controller._cloudService.sendCode).not.toHaveBeenCalled();
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    await click('Save private backup');
    await click('Done');
    await task;
    expect(controller._cloudService.save).toHaveBeenCalledWith('user-a', expect.objectContaining({ pages: [expect.objectContaining({ id: 'page-old' })] }), null, expect.any(Function), { name: 'Session 1' });
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
    await nameBackup('Campaign A');
    await button('Replace private backup');
    expect(controller._cloudService.sendCode).toHaveBeenCalledWith('test@example.test');
    expect(controller._cloudService.verifyCode).toHaveBeenCalledWith('test@example.test', '123456');
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    await click('Cancel'); await task;
  });
  it('creates a different named copy without reading or replacing an existing one', async () => {
    const controller = controllerWith();
    const task = runCloudBackup(controller, 'save');
    await nameBackup('Campaign B');
    await button('Save private backup');
    expect(document.body.textContent).toContain('Backup: Campaign B');
    expect(controller._cloudService.read).not.toHaveBeenCalled();
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    await click('Save private backup'); await click('Done'); await task;
    expect(controller._cloudService.save.mock.calls[0][2]).toBeNull();
    expect(controller._cloudService.save.mock.calls[0][4]).toEqual({ name: 'Campaign B' });
  });
  it('fills the editable backup name from the picker and allows a new name before review', async () => {
    const controller = controllerWith();
    const task = runCloudBackup(controller, 'save');
    await button('Review backup');
    document.querySelector('dialog button[role="combobox"]').click();
    document.querySelector('dialog [role="option"][data-value="Campaign A"]').click();
    expect(document.getElementById('cloud-backup-input').value).toBe('Campaign A');
    await nameBackup('Campaign B');
    await button('Save private backup');
    expect(controller._cloudService.read).not.toHaveBeenCalled();
    await click('Cancel'); await task;
  });
  it('restores only the selected named copy and can cancel the selection without fetching payloads', async () => {
    const controller = controllerWith();
    controller._cloudService.list.mockResolvedValue([
      { id: 'backup-a', name: 'Campaign A', updated_at: '2026-11-21T20:00:00Z' },
      { id: 'backup-b', name: '<img src=x onerror=alert(1)>', updated_at: '2026-11-22T20:00:00Z' }
    ]);
    let task = runCloudBackup(controller, 'restore');
    await button('Review backup');
    expect(document.querySelector('select').value).toBe('');
    expect(document.querySelector('select img')).toBeNull();
    expect(document.querySelector('select').textContent).toContain('<img src=x onerror=alert(1)>');
    await click('Cancel'); await task;
    expect(controller._cloudService.read).not.toHaveBeenCalled();
    task = runCloudBackup(controller, 'restore');
    await selectBackup('backup-b');
    await button('Restore private backup');
    expect(controller._cloudService.read).toHaveBeenCalledWith('user-a', 'backup-b');
    await click('Cancel'); await task;
    expect(controller.config.findPageById('page-old')).not.toBeNull();
  });
  it('rejects invalid backup names before any save and preserves the entered name for correction', async () => {
    const controller = controllerWith();
    const task = runCloudBackup(controller, 'save');
    await nameBackup('bad\u0007name');
    await button('Review backup');
    expect(document.body.textContent).toContain('1 to 80 characters');
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    await click('Cancel'); await task;
  });
  it.each(['save', 'restore'])('keeps loading cancellable while reading a selected %s target', async operation => {
    const controller = controllerWith();
    const events = observe(controller);
    let finishRead;
    controller._cloudService.read.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
    const before = controller.storageService.getLocalConfig();
    const task = runCloudBackup(controller, operation);
    if (operation === 'save') await nameBackup('Campaign A');
    else await selectBackup();
    await button('Cancel');
    expect(document.querySelector('dialog h2').textContent).toBe('Loading your private backup');
    await click('Cancel');
    finishRead({ id: 'backup-a', name: 'Campaign A', user_id: 'user-a', schema_version: 1, payload: source });
    await task;
    expect(events.filter(([, , terminal]) => terminal)).toEqual([['read', 'cancelled', true, undefined]]);
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    expect(controller.storageService.getLocalConfig()).toEqual(before);
    expect(controller.broadcastService.broadcastVisiblePages).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('cancels pending fetch and ignores a double action without touching data', async () => {
    const controller = controllerWith();
    let resolve;
    controller._cloudService.list.mockReturnValue(new Promise(done => { resolve = done; }));
    const before = controller.storageService.getLocalConfig();
    const task = runCloudBackup(controller, 'restore');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await runCloudBackup(controller, 'save');
    await click('Cancel');
    resolve([]);
    await task;
    expect(controller.storageService.getLocalConfig()).toEqual(before);
    expect(controller._cloudService.save).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('restores with all player access off, keeps token and original bytes, then undoes locally', async () => {
    const controller = controllerWith();
    const events = observe(controller);
    localStorage.setItem('notion-global-token', 'only-here');
    const task = runCloudBackup(controller, 'restore');
    await selectBackup();
    await click('Restore private backup');
    await click('Done'); await task;
    expect(events.filter(([, , terminal]) => terminal)).toEqual([['sync_room', 'completed', true, undefined]]);
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
    await selectBackup();
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

  it('checks a remembered session on Settings open and uses an SDK sign-out event to update the buttons', async () => {
    const controller = controllerWith();
    const service = controller._cloudService;
    delete controller._cloudService;
    controller._setupCloudSettings = ExtensionController.prototype._setupCloudSettings;
    document.body.innerHTML = '<div class="form"><button id="download-json-btn"></button></div>';
    const create = jest.spyOn(CloudBackupService, 'create').mockResolvedValue(service);
    try {
      await controller._setupCloudSettings();
      expect(create).not.toHaveBeenCalled();
      localStorage.setItem(`gm-vault-cloud-auth-v1:project:${location.hostname}`, 'stored');
      await controller._setupCloudSettings();
      expect(create).toHaveBeenCalledTimes(1);
      expect(document.getElementById('cloud-signin-btn').hidden).toBe(true);
      service.watchSession.mock.calls[0][0](null);
      expect(document.getElementById('cloud-signin-btn').hidden).toBe(false);
      expect(document.getElementById('cloud-signout-btn').hidden).toBe(true);
    } finally {
      create.mockRestore();
      controller._cloudSettingsListeners.abort();
    }
  });

  it('switches Settings from sign-out to OTP sign-in and back without reading or writing copies', async () => {
    const controller = controllerWith();
    controller._setupCloudSettings = ExtensionController.prototype._setupCloudSettings;
    const service = controller._cloudService;
    let authChanged;
    service.watchSession.mockImplementation(listener => {
      authChanged = listener;
      listener(session);
      return () => {};
    });
    service.signOut.mockImplementation(async () => {
      service.session.mockResolvedValue(null);
      authChanged(null);
    });
    service.verifyCode.mockImplementation(async () => { authChanged(session); return session; });
    controller.config = controller.configParser.parse({ categories: [] });
    localStorage.setItem('gm-vault-cloud-recovery-v1:room-cloud', 'local recovery');
    document.body.innerHTML = '<div class="form"><button id="download-json-btn"></button></div>';
    await controller._setupCloudSettings();
    const action = name => document.getElementById(`cloud-${name}-btn`);
    const runAction = jest.spyOn(controller, '_runCloudAction');
    expect(document.querySelector('#cloud-backup-settings-title span').textContent).toBe('Beta');
    expect(action('save').classList.contains('btn--primary')).toBe(true);
    expect(action('signin').hidden).toBe(true);
    action('signout').focus();
    action('signout').click();
    await click('Done');
    await runAction.mock.results[0].value;
    expect(action('signin').hidden).toBe(false);
    expect(action('signin').classList.contains('btn--primary')).toBe(true);
    expect(action('undo').hidden).toBe(false);
    for (const name of ['signout', 'save', 'restore']) expect(action(name).hidden).toBe(true);
    expect(document.activeElement).toBe(action('signin'));
    action('signin').click();
    await button('Send code');
    document.querySelector('dialog input').value = 'a@example.test';
    await click('Send code');
    await button('Verify code');
    document.querySelector('dialog input').value = '123456';
    await click('Verify code');
    await runAction.mock.results[1].value;
    expect(action('signin').hidden).toBe(true);
    for (const name of ['signout', 'save', 'restore']) expect(action(name).hidden).toBe(false);
    expect(action('signout').classList.contains('btn--ghost')).toBe(true);
    expect(document.activeElement).toBe(action('save'));
    expect(service.watchSession).toHaveBeenCalledTimes(1);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
    expect(service.read).not.toHaveBeenCalled();
    controller._cloudSettingsListeners.abort();
  });
});
