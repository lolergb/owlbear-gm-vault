// Native dialog supplies focus containment and Escape handling inside Owlbear.
export class CloudBackupDialog {
  constructor() {
    this.previousFocus = document.activeElement;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'modal__content cloud-backup-dialog';
    this.dialog.setAttribute('aria-labelledby', 'cloud-backup-title');
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    document.body.append(this.dialog);
    this.dialog.showModal();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.resolve?.(null);
    this.dialog.close();
    this.dialog.remove();
    this.previousFocus?.focus();
  }

  render(title, paragraphs = []) {
    clearInterval(this.timer);
    this.dialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.id = 'cloud-backup-title';
    heading.className = 'modal__title';
    heading.textContent = title;
    this.dialog.append(heading);
    for (const text of paragraphs.filter(Boolean)) {
      const paragraph = document.createElement('p');
      paragraph.className = 'cloud-backup-copy';
      paragraph.textContent = text;
      this.dialog.append(paragraph);
    }
  }

  loading(text, { committing = false } = {}) {
    if (this.closed) return;
    this.render(text);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = committing ? 'Please wait. The operation may finish if you close this dialog.' : 'Please wait…';
    this.dialog.append(status);
    const cancel = this.button(committing ? 'Close' : 'Cancel');
    cancel.addEventListener('click', () => this.close());
    this.dialog.append(cancel);
  }

  button(label, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${primary ? 'btn--primary' : 'btn--ghost'}`;
    button.textContent = label;
    return button;
  }

  choose({ title, paragraphs = [], error, field, actions = [], resendAt = 0 }) {
    if (this.closed) return Promise.resolve(null);
    this.render(title, paragraphs);
    const form = document.createElement('form');
    let input;
    if (field) {
      const label = document.createElement('label');
      label.className = 'form__label';
      label.htmlFor = 'cloud-backup-input';
      label.textContent = field.label;
      input = document.createElement(field.options ? 'select' : 'input');
      input.id = label.htmlFor;
      input.className = 'input';
      if (field.options) {
        for (const item of [{ value: '', label: field.placeholder || 'Choose a backup…' }, ...field.options]) {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          input.append(option);
        }
      } else {
        input.type = field.type || 'text';
        input.autocomplete = field.autocomplete || 'off';
        if (field.maxLength) input.maxLength = field.maxLength;
        if (field.suggestions?.length) {
          const suggestions = document.createElement('datalist');
          suggestions.id = 'cloud-backup-names';
          for (const name of field.suggestions) {
            const option = document.createElement('option');
            option.value = name;
            suggestions.append(option);
          }
          input.setAttribute('list', suggestions.id);
          form.append(suggestions);
        }
      }
      input.value = field.value || '';
      input.required = true;
      if (field.code) { input.inputMode = 'numeric'; input.pattern = '[0-9]{6,10}'; input.maxLength = 10; }
      form.append(label, input);
    }
    if (error) {
      const message = document.createElement('p');
      message.className = 'cloud-backup-error';
      message.setAttribute('role', 'alert');
      message.textContent = error;
      form.append(message);
    }
    const buttons = document.createElement('div');
    buttons.className = 'cloud-backup-actions';
    const cancel = this.button('Cancel');
    cancel.addEventListener('click', () => this.close());
    if (!(actions.length === 1 && actions[0].id === 'done')) buttons.append(cancel);
    const promise = new Promise(resolve => { this.resolve = resolve; });
    const finish = action => {
      if (field && action.primary && !form.reportValidity()) return;
      const value = input?.value.trim();
      const resolve = this.resolve;
      this.resolve = null;
      // Prevent double clicks while the caller performs its asynchronous step.
      for (const button of buttons.children) button.disabled = true;
      resolve?.({ action: action.id, value });
    };
    for (const action of actions) {
      const button = this.button(action.label, action.primary);
      if (action.id === 'resend') {
        const tick = () => {
          const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
          button.disabled = seconds > 0;
          button.textContent = seconds ? `Resend in ${seconds}s` : action.label;
        };
        tick(); this.timer = setInterval(tick, 1000);
      }
      button.addEventListener('click', () => finish(action));
      buttons.append(button);
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const primary = actions.find(action => action.primary);
      if (primary) finish(primary);
    });
    form.append(buttons);
    this.dialog.append(form);
    let focusTarget = input || buttons.querySelector('.btn--primary') || cancel;
    if (!input && this.dialog.scrollHeight > this.dialog.clientHeight) {
      // Start a long review at its name and summary, not scrolled down to the
      // destructive confirmation. The heading remains outside the tab order.
      focusTarget = this.dialog.querySelector('h2');
      focusTarget.tabIndex = -1;
    }
    focusTarget.focus({ preventScroll: true });
    this.dialog.scrollTop = 0;
    return promise;
  }
}

export function backupSummary(summary) {
  return `${summary.pageCount} page${summary.pageCount === 1 ? '' : 's'}, ${summary.categoryCount} folder${summary.categoryCount === 1 ? '' : 's'}`;
}
