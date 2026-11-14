/** A separate dialog so recovery can run before the vault UI is initialized. */
export function chooseBetaVault({ host = window, signal } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve('later');
    const doc = host.document;
    const previousFocus = doc.activeElement;
    const dialog = doc.createElement('dialog');
    dialog.className = 'modal__content';
    dialog.style.cssText = 'color:inherit;border:0;position:fixed;inset:0;margin:auto;height:fit-content;width:calc(100% - 32px);max-width:420px;box-sizing:border-box;';
    dialog.setAttribute('aria-labelledby', 'beta-recovery-title');
    dialog.setAttribute('aria-describedby', 'beta-recovery-description');
    const title = doc.createElement('h2');
    title.id = 'beta-recovery-title';
    title.className = 'modal__title';
    title.textContent = 'Two vaults found';
    const description = doc.createElement('p');
    description.id = 'beta-recovery-description';
    description.className = 'modal__body';
    description.textContent = 'This room has different vaults in the beta and the current version. Choose which one to use. If you use the beta vault, we will save a backup of your current vault. The beta original stays untouched.';
    const actions = doc.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    const finish = choice => {
      signal?.removeEventListener('abort', abort);
      dialog.close();
      dialog.remove();
      previousFocus?.focus();
      resolve(choice);
    };
    const abort = () => finish('later');
    for (const [choice, text, primary] of [
      ['keep', 'Keep current vault', true], ['import', 'Use beta vault', false], ['later', 'Decide later', false]
    ]) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'btn ' + (primary ? 'btn--primary' : 'btn--ghost');
      button.textContent = text;
      button.addEventListener('click', () => finish(choice), { once: true });
      actions.append(button);
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish('later'); });
    dialog.append(title, description, actions);
    doc.body.append(dialog);
    signal?.addEventListener('abort', abort, { once: true });
    dialog.showModal();
  });
}

export function betaRecoveryMessage(result) {
  if (['imported', 'identical'].includes(result.status)) {
    return result.tokenStatus === 'failed'
      ? 'Your beta vault is ready. The Notion token could not be saved; retry recovery or add it in Settings.'
      : 'Your beta vault is ready. The original beta copy has been kept.';
  }
  const messages = {
    kept: 'Your current vault is unchanged. You can recover the beta vault here later.',
    deferred: 'Recovery postponed. Your current vault is unchanged.',
    missing: 'No beta vault was found for this room in this browser. Open the beta in the same browser and profile. If recovery still finds nothing, use Backup GM Vault in the beta, then Import from file here.',
    unavailable: 'The beta storage could not be reached. Retry in this browser and profile, or use Backup GM Vault in the beta, then Import from file here.',
    invalid: 'The beta vault could not be validated. Its original data is unchanged. Export it from the beta to recover it manually.',
    'too-large': 'This beta vault needs a manual transfer. Use Backup GM Vault in the beta, then Import from file here.',
    'write-failed': 'Recovery could not finish saving. The beta original is safe. Free browser storage and retry, or use a JSON backup.',
    changed: 'The current vault changed during recovery. Retry to compare the latest copies.',
    ineligible: 'Only the active GM can recover the beta vault for this room.',
    done: 'Recovery has already been handled for this room.'
  };
  return messages[result.status] || messages.unavailable;
}
