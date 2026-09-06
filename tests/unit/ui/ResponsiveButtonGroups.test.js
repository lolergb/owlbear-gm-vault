import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { watchResponsiveButtonGroups } from '../../../js/ui/ResponsiveButtonGroups.js';

let layout;
let stop;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const names = selector => Array.from(document.querySelector(selector).children, el => el.textContent);
const setMobile = matches => {
  layout.matches = matches;
  layout.dispatchEvent(new Event('change'));
};

beforeEach(() => {
  layout = new EventTarget();
  layout.matches = true;
  window.matchMedia = jest.fn(() => layout);
  document.body.innerHTML = `
    <header><button class="btn--ghost">Back</button><button class="btn--primary">Add</button></header>
    <div class="form__actions"><button>Cancel</button><button class="btn--primary">Save</button></div>`;
});
afterEach(() => {
  stop?.();
  delete window.matchMedia;
  document.body.innerHTML = '';
});

describe('Responsive action groups', () => {
  it('keeps primary-first mobile and primary-last desktop in keyboard order, without touching navigation', () => {
    stop = watchResponsiveButtonGroups(document.body);
    expect(names('.form__actions')).toEqual(['Save', 'Cancel']);
    expect(names('header')).toEqual(['Back', 'Add']);
    const save = document.querySelector('.form__actions .btn--primary');
    const onSave = jest.fn();
    save.addEventListener('click', onSave);
    save.focus();
    setMobile(false);
    expect(names('.form__actions')).toEqual(['Cancel', 'Save']);
    expect(document.activeElement).toBe(save);
    save.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    setMobile(true);
    expect(names('.form__actions')).toEqual(['Save', 'Cancel']);
    expect(document.activeElement).toBe(save);
  });

  it('orders newly opened dialogs and consent banners, preserving all event handlers', async () => {
    stop = watchResponsiveButtonGroups(document.body);
    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <div class="modal-buttons"><button class="modal-button-cancel">Cancel</button><button class="modal-button-danger">Delete</button></div>
      <div class="cookie-consent-actions"><button>Decline</button><button class="btn--primary">Accept</button></div>`;
    document.body.append(overlay);
    await flush();
    expect(names('.modal-buttons')).toEqual(['Delete', 'Cancel']);
    expect(names('.cookie-consent-actions')).toEqual(['Accept', 'Decline']);
    setMobile(false);
    expect(names('.modal-buttons')).toEqual(['Cancel', 'Delete']);
    expect(names('.cookie-consent-actions')).toEqual(['Decline', 'Accept']);
  });

  it('stops observing viewport and dynamic content when disposed', async () => {
    stop = watchResponsiveButtonGroups(document.body);
    stop();
    setMobile(false);
    expect(names('.form__actions')).toEqual(['Save', 'Cancel']);
    document.body.insertAdjacentHTML('beforeend', '<div class="modal-buttons"><button>Cancel</button><button class="modal-button-submit">Save</button></div>');
    await flush();
    expect(names('.modal-buttons')).toEqual(['Cancel', 'Save']);
  });
});
