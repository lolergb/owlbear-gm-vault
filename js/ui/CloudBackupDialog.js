import { ModalSelect } from './ModalSelect.js';
import { createModalShell } from './ModalShell.js';

// Native dialog supplies focus containment and Escape handling inside Owlbear.
export class CloudBackupDialog {
  constructor() {
    this.previousFocus = document.activeElement;
    this.dialog = createModalShell('cloud-backup-title', { native: true }).root;
    this.dialog.classList.add('cloud-backup-dialog');
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    document.body.append(this.dialog);
    this.dialog.showModal();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.resolve?.(null);
    this.picker?.destroy();
    this.dialog.close();
    this.dialog.remove();
    this.previousFocus?.focus();
  }

  render(title, paragraphs = [], account) {
    this.picker?.destroy();
    this.picker = null;
    clearInterval(this.timer);
    this.dialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.id = 'cloud-backup-title';
    heading.className = 'modal__title';
    heading.textContent = title;
    this.dialog.append(heading);
    if (account) {
      const context = document.createElement('div');
      context.className = 'modal__context';
      const identity = document.createElement('span');
      identity.textContent = `Account: ${account}`;
      context.append(identity);
      this.dialog.append(context);
    }
    for (const text of paragraphs.filter(Boolean)) {
      const paragraph = document.createElement('p');
      paragraph.className = 'modal__text';
      paragraph.textContent = text;
      this.dialog.append(paragraph);
    }
  }

  loading(text, { committing = false } = {}) {
    if (this.closed) return;
    this.render(text);
    const status = document.createElement('p');
    status.className = 'modal__text';
    status.setAttribute('role', 'status');
    status.textContent = committing ? 'Please wait. The operation may finish if you close this dialog.' : 'Please wait…';
    this.dialog.append(status);
    const cancel = this.button(committing ? 'Close' : 'Cancel');
    cancel.addEventListener('click', () => this.close());
    const actions = document.createElement('div');
    actions.className = 'form__actions';
    actions.append(cancel);
    this.dialog.append(actions);
  }

  button(label, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--flex ${primary ? 'btn--primary' : 'btn--ghost'}`;
    button.textContent = label;
    return button;
  }

  choose({ title, account, paragraphs = [], error, field, actions = [], resendAt = 0 }) {
    if (this.closed) return Promise.resolve(null);
    this.render(title, paragraphs, account);
    const form = document.createElement('form');
    form.className = 'form';
    let input;
    if (field) {
      const label = document.createElement('label');
      label.className = 'form__label';
      label.htmlFor = 'cloud-backup-input';
      label.textContent = field.label;
      input = document.createElement(field.options ? 'select' : 'input');
      input.id = label.htmlFor;
      input.className = field.options ? 'select' : 'input';
      if (!field.options) {
        input.type = field.type || 'text';
        input.autocomplete = field.autocomplete || 'off';
        if (field.maxLength) input.maxLength = field.maxLength;
      }
      input.value = field.value || '';
      input.required = true;
      if (field.code) { input.inputMode = 'numeric'; input.pattern = '[0-9]{6,10}'; input.maxLength = 10; }
      const group = document.createElement('div');
      group.className = 'form__field';
      group.append(label, input);
      form.append(group);
    }
    if (error) {
      const message = document.createElement('p');
      message.className = 'form__error form__error--visible';
      message.setAttribute('role', 'alert');
      message.textContent = error;
      form.append(message);
    }
    const buttons = document.createElement('div');
    buttons.className = 'form__actions';
    const utilities = document.createElement('div');
    utilities.className = 'modal__utilities';
    const cancel = this.button('Cancel');
    cancel.addEventListener('click', () => this.close());
    if (!(actions.length === 1 && actions[0].id === 'done')) buttons.append(cancel);
    const promise = new Promise(resolve => { this.resolve = resolve; });
    const finish = action => {
      if (!this.resolve) return;
      if (field?.options && action.primary && !input.value) { this.picker.trigger.focus(); return; }
      if (field && action.primary && !form.reportValidity()) return;
      const value = input?.value.trim();
      const resolve = this.resolve;
      this.resolve = null;
      // Prevent double clicks while the caller performs its asynchronous step.
      clearInterval(this.timer);
      for (const button of this.dialog.querySelectorAll('button')) button.disabled = true;
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
      if (action.primary) {
        button.type = 'submit';
        buttons.append(button);
      } else {
        button.className = 'modal__utility';
        button.addEventListener('click', () => finish(action));
        const context = action.id === 'account' && this.dialog.querySelector('.modal__context');
        (context || utilities).append(button);
      }
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const primary = actions.find(action => action.primary);
      if (primary) finish(primary);
    });
    if (utilities.childElementCount) form.append(utilities);
    form.append(buttons);
    this.dialog.append(form);
    if (field?.options) {
      this.picker = new ModalSelect(input, {
        options: field.options, label: field.label, resultLabel: 'backup', placeholder: 'Choose a backup…'
      });
      const submit = buttons.querySelector('[type="submit"]');
      const update = () => { submit.disabled = !input.value; };
      input.addEventListener('change', update);
      update();
    } else if (field?.suggestions?.length) {
      const source = document.createElement('select');
      source.id = 'cloud-backup-existing-name';
      input.after(source);
      this.picker = new ModalSelect(source, {
        options: field.suggestions.map(name => ({ value: name, label: name })),
        label: 'Existing backup', resultLabel: 'backup', placeholder: 'Choose an existing backup', editableInput: input
      });
    }
    let focusTarget = (field?.options ? this.picker.trigger : input) || buttons.querySelector('.btn--primary') || cancel;
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
