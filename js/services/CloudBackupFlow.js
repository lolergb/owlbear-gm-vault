import { BackupError, prepareBackup, backupName, MAX_BACKUP_NAME_LENGTH } from '../utils/cloudBackup.js';
import { LocalVaultRecovery } from './LocalVaultRecovery.js';
import { ConfigBuilder } from '../builders/ConfigBuilder.js?v=2.2.0';
import { filterVisiblePages } from '../utils/helpers.js?v=2.2.0';
import { CloudBackupDialog, backupSummary } from '../ui/CloudBackupDialog.js';
import { BackupFlowProgress } from './BackupFlowProgress.js';

const jsonOf = controller => JSON.stringify(controller.config?.toJSON ? controller.config.toJSON() : controller.config);

export function captureBackupContext(controller) {
  const local = new LocalVaultRecovery(localStorage, controller.roomId);
  return {
    roomId: controller.roomId, playerId: controller.playerId, connectionId: controller.connectionId,
    local, stored: local.capture(), model: jsonOf(controller)
  };
}

export async function assertBackupContext(controller, context) {
  if (!controller.isGM || controller.isCoGM || controller.roomId !== context.roomId ||
      controller.playerId !== context.playerId || controller.connectionId !== context.connectionId ||
      new URLSearchParams(location.search).get('modal') === 'true' ||
      !await controller._canRecoverBetaVault(context.roomId)) throw new BackupError('permission');
  assertLocalContext(controller, context);
}

function assertLocalContext(controller, context) {
  if (!controller.isGM || controller.isCoGM || controller.roomId !== context.roomId ||
      controller.playerId !== context.playerId || controller.connectionId !== context.connectionId) throw new BackupError('changed');
  context.local.assertUnchanged(context.stored);
  if (jsonOf(controller) !== context.model) throw new BackupError('changed');
}

async function publishRestoredVault(controller) {
  await assertBackupContext(controller, captureBackupContext(controller));
  const config = controller.config.toJSON();
  await controller.broadcastService.broadcastVisiblePages(filterVisiblePages(config));
  await controller.broadcastService.notifyPlayerVaultUpdated?.();
  await controller.broadcastService.notifyFullVaultUpdated?.();
}

export async function applyLocalRestore(controller, context, payload, { undo = false, interrupted = false, authorize, onSync } = {}) {
  await assertBackupContext(controller, context);
  if (authorize) await authorize();
  assertLocalContext(controller, context);
  const candidate = payload ? controller.configParser.parse(payload) : null;
  let persisted = false;
  controller._cloudCommit = true;
  try {
    if (undo) context.local.undo(context.stored, { interrupted });
    else context.local.replace(payload, context.stored);
    persisted = true;
    if (undo) await controller._loadConfig();
    else {
      controller.config = candidate;
      controller.configBuilder = new ConfigBuilder(candidate);
      controller.uiRenderer?.setConfig?.(candidate);
      controller.notionRenderer?.setDependencies?.({ config: candidate });
    }
    controller._goBackToList?.();
    await controller.render();
  } catch (error) {
    throw persisted ? new BackupError('view') : error;
  } finally { controller._cloudCommit = false; }
  // This stage never retries a restore or rolls back persisted data.
  onSync?.();
  try { await publishRestoredVault(controller); return true; }
  catch { return false; }
}

async function authenticate(service, dialog, progress) {
  progress.enter('session');
  let session = await service.session();
  let email = '';
  let error = '';
  let resendAt = 0;
  while (!session && !dialog.closed) {
    progress.enter('email');
    const entered = await dialog.choose({
      title: 'Your private backups',
      paragraphs: ['Enter your email to save or restore your named private backups. We will send a one-time sign-in code. Your local vault works without signing in.'],
      error, field: { label: 'Email', type: 'email', autocomplete: 'email', value: email },
      actions: [{ id: 'send', label: 'Send code', primary: true }]
    });
    if (!entered) return null;
    email = entered.value;
    progress.enter('send_code');
    dialog.loading('Sending your code');
    try { await service.sendCode(email); resendAt = Date.now() + 60000; error = ''; }
    catch (cause) { progress.fail(cause.code, false); error = cause.message; continue; }
    while (!session && !dialog.closed) {
      progress.enter('enter_code');
      const code = await dialog.choose({
        title: 'Check your email', paragraphs: [`Enter the code sent to ${email}. Check spam if it has not arrived.`], error,
        field: { label: 'One-time code', autocomplete: 'one-time-code', code: true }, resendAt,
        actions: [{ id: 'email', label: 'Change email' }, { id: 'resend', label: 'Resend code' }, { id: 'verify', label: 'Verify code', primary: true }]
      });
      if (!code) return null;
      if (code.action === 'email') { error = ''; break; }
      if (code.action === 'resend') {
        if (Date.now() < resendAt) continue;
        progress.enter('send_code');
        dialog.loading('Sending another code');
        try { await service.sendCode(email); resendAt = Date.now() + 60000; error = ''; }
        catch (cause) { progress.fail(cause.code, false); error = cause.message; resendAt = Date.now() + 60000; }
      } else {
        progress.enter('verify_code');
        dialog.loading('Verifying your code');
        try { session = await service.verifyCode(email, code.value); error = ''; }
        catch (cause) { progress.fail(cause.code, false); error = cause.message; }
      }
    }
  }
  return dialog.closed ? null : session;
}

async function chooseNamedBackup(service, dialog, session, operation, localPrepared, selection, progress) {
  const userId = session.user.id;
  progress.enter('list');
  const rows = await service.list(userId);
  if (dialog.closed) return null;
  const accountAction = { id: 'account', label: 'Sign out / change account' };
  if (operation === 'save') {
    let name = selection.name || `Backup ${new Date().toLocaleString()}`;
    let error = '';
    while (!dialog.closed) {
      progress.enter('name');
      const entered = await dialog.choose({
        title: 'Name your backup',
        account: session.user.email || 'Signed in', paragraphs: [`Saving: ${backupSummary(localPrepared.summary)} (${Math.ceil(localPrepared.bytes / 1024)} KiB).`, 'A new name keeps a separate copy. Reusing a name asks you to confirm replacing only that copy.'],
        field: { label: 'Backup name', value: name, maxLength: MAX_BACKUP_NAME_LENGTH, suggestions: rows.map(row => row.name) },
        error, actions: [accountAction, { id: 'continue', label: 'Review backup', primary: true }]
      });
      if (!entered || entered.action === 'account') return entered;
      name = entered.value;
      try { name = backupName(name); }
      catch (cause) { progress.fail(cause.code, false); error = cause.message; continue; }
      const existing = rows.find(row => row.name === name);
      if (existing) {
        progress.enter('read');
        dialog.loading('Loading your private backup');
      }
      const row = existing ? await service.read(userId, existing.id) : null;
      if (existing && !row) throw new BackupError('missing');
      return { row, name };
    }
    return null;
  }
  if (!rows.length) {
    progress.enter('no_backups');
    return dialog.choose({ title: 'No private backups found', account: session.user.email || 'Signed in', paragraphs: [selection.notice, 'This account has no saved copies. Your local vault is unchanged.'], actions: [accountAction, { id: 'done', label: 'Done', primary: true }] });
  }
  progress.enter('select');
  const selected = await dialog.choose({
    title: 'Choose a backup to restore', account: session.user.email || 'Signed in',
    paragraphs: [selection.notice, 'Choose a saved copy to review or delete.'],
    field: { label: 'Saved backup', value: selection.id, options: rows.map(row => ({ value: row.id, label: row.name, detail: new Date(row.updated_at).toLocaleString() })) },
    actions: [accountAction, { id: 'delete', label: 'Delete selected backup', requiresSelection: true }, { id: 'review', label: 'Review backup', primary: true }]
  });
  if (!selected || selected.action === 'account') return selected;
  const row = rows.find(item => item.id === selected.value);
  if (!row) throw new BackupError('missing');
  return { action: selected.action, row, name: row.name };
}

async function confirmBackupDeletion(controller, context, service, dialog, session, row) {
  const choice = await dialog.choose({
    title: `Delete “${row.name}”?`, account: session.user.email || 'Signed in',
    paragraphs: ['This permanently deletes this saved copy from your account. Your current vault and other backups are kept.'],
    field: { label: 'Type the backup name to confirm', confirmName: row.name },
    cancelAction: 'back', actions: [{ id: 'delete', label: 'Delete backup', primary: true, danger: true }]
  });
  if (choice?.action !== 'delete') return { id: row.id };
  dialog.loading('Deleting your private backup', { committing: true });
  try {
    await service.deleteBackup(session.user.id, row, async () => {
      await assertBackupContext(controller, context);
      if (dialog.closed) throw new BackupError('changed');
    });
  } catch (error) {
    if (error.code === 'conflict' || error.code === 'delete_uncertain') return { notice: error.message };
    throw error;
  }
  return { notice: `“${row.name}” was deleted.` };
}

export async function runCloudBackup(controller, operation, progress) {
  if (controller._cloudFlowRunning) return;
  progress ??= new BackupFlowProgress(controller.analyticsService, operation);
  const finishSave = (outcome) => {
    progress.finish(outcome);
    controller.analyticsService?.trackPrivateBackupAdoption?.('backup_saved');
  };
  const dialog = new CloudBackupDialog(() => progress.dismiss(), () => progress.fail('input_invalid', false));
  controller._cloudFlowRunning = true;
  controller._cloudDialog = dialog;
  try {
    progress.enter('prepare');
    const context = captureBackupContext(controller);
    await assertBackupContext(controller, context);
    const localPrepared = operation === 'save' ? prepareBackup(controller.config, controller.configParser) : null;
    progress.enter('connect');
    dialog.loading('Connecting to private backups');
    const service = await controller._getCloudBackupService();
    let selection = {};
    if (operation === 'signout') {
      await service.signOut();
      if (!dialog.closed) await dialog.choose({ title: 'Signed out on this device', paragraphs: ['Your local vault and private backups have been kept.'], actions: [{ id: 'done', label: 'Done', primary: true }] });
      return;
    }
    while (!dialog.closed) {
      let session;
      try { session = await authenticate(service, dialog, progress); }
      catch (error) {
        if (error.code !== 'auth') throw error;
        progress.fail('auth', false);
        await service.signOut();
        session = await authenticate(service, dialog, progress);
      }
      if (!session || dialog.closed) return;
      if (operation === 'signin') return;
      const userId = session.user.id;
      if (selection.userId && selection.userId !== userId) throw new BackupError('changed');
      dialog.loading('Checking your private backup');
      if (service.pendingWrite && service.pendingWrite.userId !== userId) service.pendingWrite = null;
      if (service.pendingWrite) {
        progress.enter('check_save');
        selection.name = service.pendingWrite.name || selection.name;
        const choice = await dialog.choose({ title: 'Check the previous save', paragraphs: [new BackupError('uncertain').message], actions: [{ id: 'check', label: 'Check backup', primary: true }] });
        if (!choice) return;
        const result = await service.checkWrite(userId);
        if (result.matched) {
          finishSave('previous_save_confirmed');
          await dialog.choose({ title: 'Private backup saved', paragraphs: ['The previous save was confirmed.'], actions: [{ id: 'done', label: 'Done', primary: true }] });
          return;
        }
        // A mismatch cannot establish that our timed-out save failed: a newer
        // save may exist. Require a new review before any further write.
        service.pendingWrite = null;
      }
      const target = await chooseNamedBackup(service, dialog, session, operation, localPrepared, selection, progress);
      if (dialog.closed) return;
      if (!target) return;
      if (target.action === 'done') { progress.finish('no_backups'); return; }
      if (target.action === 'account') {
        progress.enter('change_account');
        await service.signOut();
        selection = {};
        continue;
      }
      if (target.action === 'delete') {
        // Managing saved copies is a different intent from restoring a vault.
        progress.finish('manage_backups');
        selection = { userId, ...await confirmBackupDeletion(controller, context, service, dialog, session, target.row) };
        continue;
      }
      let { row, name } = target;
      if (target.action === 'review') {
        if (progress.ended) progress = new BackupFlowProgress(controller.analyticsService, operation);
        progress.enter('read');
        dialog.loading('Loading your private backup');
        row = await service.read(userId, row.id);
        if (dialog.closed) return;
        if (!row) throw new BackupError('missing');
        name = row.name;
      }
      selection = { name, userId };
      const remote = row ? prepareBackup(row.payload, controller.configParser, { schema: row.schema_version, restoring: operation === 'restore' }) : null;
      const actionLabel = operation === 'restore' ? 'Restore private backup' : row ? 'Replace private backup' : 'Save private backup';
      const paragraphs = [
        `Backup: ${name}`,
        !service.storage?.persistent ? 'This browser cannot remember your session. You will need a new code next time.' : '',
        row ? `Private copy: ${backupSummary(remote.summary)}. Saved ${new Date(row.updated_at).toLocaleString()}.` : 'No private copy exists yet.',
        operation === 'save' ? `Saving: ${backupSummary(localPrepared.summary)} (${Math.ceil(localPrepared.bytes / 1024)} KiB).` : `Local vault: ${backupSummary(controller.configParser.preflight(JSON.parse(context.model)).summary)}. This replaces the local vault in the current Owlbear room. The previous local copy will be kept for Undo restore.`,
        operation === 'save' ? (row ? 'Only this named copy will be replaced. Your other saved copies are kept.' : 'This creates a separate named copy. Your other saved copies are kept.') : 'Player access will be turned off until you review and enable it. Your Notion token stays on this device and is not included in the backup.',
        ...(operation === 'restore' ? remote.warnings : localPrepared.warnings)
      ];
      progress.enter('review');
      const choice = await dialog.choose({ title: actionLabel, account: session.user.email || 'Signed in', paragraphs, actions: [{ id: 'back', label: operation === 'save' ? 'Change name' : 'Choose another backup' }, { id: 'confirm', label: actionLabel, primary: true }] });
      if (!choice) return;
      if (choice.action === 'back') continue;
      progress.enter('authorize');
      dialog.loading(operation === 'save' ? 'Saving your private backup' : 'Restoring your vault', { committing: true });
      await service.assertUser(userId);
      await assertBackupContext(controller, context);
      if (dialog.closed) return;
      if (operation === 'save') {
        await service.save(userId, localPrepared.payload, row, async () => {
          await assertBackupContext(controller, context);
          if (dialog.closed) throw new BackupError('changed');
          progress.enter('save');
        }, { name });
        finishSave();
        if (dialog.closed) return;
        await dialog.choose({ title: 'Private backup saved', paragraphs: [`“${name}” is saved. Local edits will be backed up only when you choose Save private backup again.`], actions: [{ id: 'done', label: 'Done', primary: true }] });
      } else {
        const synced = await applyLocalRestore(controller, context, remote.payload, { authorize: async () => {
          await service.assertUser(userId);
          if (dialog.closed) throw new BackupError('changed');
          progress.enter('restore_local');
        }, onSync: () => progress.enter('sync_room') });
        if (!synced) {
          progress.fail('room_sync', false);
          if (dialog.closed) { progress.finish('local_only'); return; }
          progress.enter('retry_sync');
          const retry = await dialog.choose({ title: 'Vault restored locally', paragraphs: ['The room update failed. Your restored vault and previous local copy are safe. Retry the room update without restoring again.'], actions: [{ id: 'retry', label: 'Retry room update', primary: true }] });
          if (!retry) { progress.finish('local_only'); return; }
          progress.enter('sync_room');
          await assertBackupContext(controller, captureBackupContext(controller));
          await publishRestoredVault(controller);
        }
        progress.finish();
        if (dialog.closed) return;
        await dialog.choose({ title: 'Private backup restored', paragraphs: ['Player access is off until you enable it. Use Undo restore in Settings to return to the previous local vault. Add your Notion token in Settings if needed.'], actions: [{ id: 'done', label: 'Done', primary: true }] });
      }
      return;
    }
  } catch (error) {
    const uncertain = error instanceof BackupError && error.code === 'uncertain';
    const syncFailure = progress.step === 'sync_room';
    if (syncFailure) {
      progress.fail(error?.code || 'room_sync', false);
      progress.finish('local_only');
    } else {
      progress.fail(error?.code, !uncertain || dialog.closed === true);
    }
    if (!dialog.closed) {
      const safe = error instanceof BackupError ? error : new BackupError('network');
      if (safe.code === 'auth') { try { await controller._cloudService?.signOut(); } catch { /* Retry remains explicit. */ } }
      if (uncertain) progress.enter('check_save');
      const choice = await dialog.choose({ title: uncertain ? 'Check your private backup' : 'Private backup could not finish', error: safe.message, actions: [{ id: uncertain ? 'check' : 'done', label: uncertain ? 'Check backup' : 'Done', primary: true }] });
      if (choice?.action === 'check') {
        try {
          const service = controller._cloudService;
          const { matched } = await service.checkWrite(service.pendingWrite.userId);
          if (matched) finishSave();
          else progress.fail('uncertain');
          await dialog.choose({ title: matched ? 'Private backup saved' : 'Save could not be confirmed', paragraphs: [matched ? 'Your save was confirmed.' : 'Close this dialog and review the current private copy before saving again.'], actions: [{ id: 'done', label: 'Done', primary: true }] });
        } catch (checkError) {
          progress.fail(checkError.code);
          await dialog.choose({ title: 'Save could not be confirmed', paragraphs: ['Check your connection, then choose Save private backup to check the previous save.'], actions: [{ id: 'done', label: 'Done', primary: true }] });
        }
      }
    }
  } finally {
    dialog.close();
    controller._cloudDialog = null;
    controller._cloudFlowRunning = false;
    controller._setupCloudSettings?.();
  }
}

export async function undoLocalRestore(controller, { startup = false } = {}) {
  if (controller._cloudFlowRunning) return;
  const context = captureBackupContext(controller);
  const journal = context.local.journal();
  if (!journal || (startup && journal.state !== 'pending')) return;
  controller._cloudFlowRunning = true;
  const dialog = new CloudBackupDialog();
  controller._cloudDialog = dialog;
  try {
    const choice = await dialog.choose({
      title: startup ? 'Finish interrupted restore' : 'Undo restore',
      paragraphs: [startup ? 'The last restore did not finish. Return to the previous local vault, or keep the current copy after checking it.' : 'Return to the local vault kept before the last restore. Edits made since restoring prevent this action to protect your work.'],
      actions: [...(startup ? [{ id: 'keep', label: 'Keep current copy' }] : []), { id: 'undo', label: 'Use previous local vault', primary: true }]
    });
    if (!choice) { if (startup) throw new BackupError('recovery'); return; }
    await assertBackupContext(controller, context);
    if (choice.action === 'keep') {
      // Validate the actual destination, not the pre-startup empty model.
      const raw = context.stored.raw ?? context.stored.legacy;
      try {
        if (raw !== null && !controller.configParser.validate(JSON.parse(raw)).valid) throw new BackupError('invalid');
      } catch { throw new BackupError('invalid'); }
      context.local.keepCurrent(context.stored);
    } else if (startup) context.local.undo(context.stored, { interrupted: true });
    else {
      const synced = await applyLocalRestore(controller, context, null, { undo: true });
      if (!synced) controller.uiRenderer?.showErrorToast('Previous vault restored locally', 'The room update failed. Reopen the extension to send the current vault.');
    }
  } finally {
    dialog.close(); controller._cloudFlowRunning = false; controller._cloudDialog = null; controller._setupCloudSettings?.();
  }
}
