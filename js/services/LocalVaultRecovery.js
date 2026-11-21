import { BackupError, RECOVERY_PREFIX } from '../utils/cloudBackup.js';

// All mutations here are synchronous: no UI/broadcast changes precede readback.
export class LocalVaultRecovery {
  constructor(storage, roomId) {
    this.storage = storage;
    this.roomId = roomId;
    this.key = `notion-pages-json-${roomId}`;
    this.recoveryKey = RECOVERY_PREFIX + roomId;
  }

  capture() {
    try {
      return { raw: this.storage.getItem(this.key), legacy: this.storage.getItem('notion-pages-json-default') };
    } catch { throw new BackupError('storage'); }
  }

  assertUnchanged(expected) {
    const actual = this.capture();
    if (actual.raw !== expected.raw || actual.legacy !== expected.legacy) throw new BackupError('changed');
  }

  journal() {
    try {
      const raw = this.storage.getItem(this.recoveryKey);
      if (raw === null) return null;
      const value = JSON.parse(raw);
      if (value.version !== 1 || value.roomId !== this.roomId ||
          !['pending', 'applied'].includes(value.state) ||
          !(value.beforeRaw === null || typeof value.beforeRaw === 'string') ||
          !(value.beforeLegacy === null || typeof value.beforeLegacy === 'string') || typeof value.afterRaw !== 'string') throw new Error();
      return value;
    } catch { throw new BackupError('storage'); }
  }

  writeVerified(key, raw) {
    if (raw === null) this.storage.removeItem(key);
    else this.storage.setItem(key, raw);
    if (this.storage.getItem(key) !== raw) throw new BackupError('storage');
  }

  replace(payload, expected) {
    this.assertUnchanged(expected);
    if (this.journal()?.state === 'pending') throw new BackupError('recovery');
    const journal = { version: 1, roomId: this.roomId, state: 'pending', beforeRaw: expected.raw, beforeLegacy: expected.raw === null ? expected.legacy : null, afterRaw: JSON.stringify(payload) };
    try {
      this.writeVerified(this.recoveryKey, JSON.stringify(journal));
      this.assertUnchanged(expected);
      this.writeVerified(this.key, journal.afterRaw);
      // Failure to mark completion is recoverable from the pending journal.
      this.writeVerified(this.recoveryKey, JSON.stringify({ ...journal, state: 'applied' }));
    } catch (error) {
      if (error instanceof BackupError && error.code === 'changed') throw error;
      try {
        // Only roll back our own write; never overwrite an intervening edit.
        if (this.storage.getItem(this.key) === journal.afterRaw) this.writeVerified(this.key, journal.beforeRaw);
      } catch { /* The journal retains the exact original bytes for recovery. */ }
      throw new BackupError('storage');
    }
  }

  undo(expected, { interrupted = false } = {}) {
    const journal = this.journal();
    if (!journal) throw new BackupError('recovery');
    this.assertUnchanged(expected);
    // Ordinary undo must not discard edits made since the restore.
    if (!interrupted && expected.raw !== journal.afterRaw) throw new BackupError('changed');
    if (journal.beforeRaw === null && expected.legacy !== journal.beforeLegacy) throw new BackupError('changed');
    try {
      this.writeVerified(this.key, journal.beforeRaw);
      this.writeVerified(this.recoveryKey, null);
    } catch { throw new BackupError('storage'); }
  }

  keepCurrent(expected) {
    this.assertUnchanged(expected);
    try { this.writeVerified(this.recoveryKey, null); }
    catch { throw new BackupError('storage'); }
  }
}
