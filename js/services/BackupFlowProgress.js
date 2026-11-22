/** One explicit save/restore attempt, independent of dialog text and form data. */
export class BackupFlowProgress {
  constructor(analytics, operation) {
    try {
      this.report = analytics?.privateBackupReporter?.(operation);
    } catch { /* A backup can run without telemetry. */ }
    this.step = 'open';
    this.emit('started');
  }

  enter(step) {
    if (step === this.step || this.ended) return;
    this.step = step;
    this.emit('entered');
  }

  emit(outcome, terminal = false, errorCode) {
    if (this.ended) return;
    this.ended = terminal;
    try {
      this.report?.(this.step, outcome, terminal, errorCode);
    } catch { /* Reporting must never interrupt the GM's action. */ }
  }

  fail(code, terminal = true) {
    this.emit('failed', terminal, code);
  }

  finish(outcome = 'completed') {
    this.emit(outcome, true);
  }

  dismiss() {
    // A write already dispatched can still succeed after the UI closes.
    if (['save', 'restore_local', 'sync_room'].includes(this.step)) return;
    this.finish(this.step === 'retry_sync' ? 'local_only' : 'cancelled');
  }
}
