import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FolderSelect } from '../../../js/ui/FolderSelect.js';

const options = [
  { value: 'root', label: 'Root level' },
  { value: 'campaign-a', label: 'Campaign A', path: ['Campaign A'], depth: 0 },
  { value: 'encounters-a', label: 'Encuentros', path: ['Campaign A', 'Encuentros'], depth: 1 },
  { value: 'campaign-b', label: 'Campaign B', path: ['Campaign B'], depth: 0 },
  { value: 'encounters-b', label: 'Encuentros', path: ['Campaign B', 'Encuentros'], depth: 1 },
  { value: 'angel', label: 'Ángel', path: ['Campaign B', 'Ángel'], depth: 1 }
];
let picker;
let select;
const key = (target, value) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
const search = value => {
  picker.search.value = value;
  picker.search.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = '<div class="modal"><form><label for="folder">Folder</label><select id="folder" name="folder"><option value="encounters-b" selected>Encuentros</option></select><button id="save">Save</button></form></div>';
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ top: 200, bottom: 244, left: 100, right: 400, width: 300, height: 44 }]);
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 244, left: 100, right: 400, width: 300, height: 44 });
  select = document.getElementById('folder');
  picker = new FolderSelect(select, { options });
});
afterEach(() => { picker?.destroy(); jest.restoreAllMocks(); document.body.innerHTML = ''; });

describe('FolderSelect', () => {
  it('starts collapsed with the complete selected path and opens search and hierarchy', () => {
    expect(picker.value.textContent).toBe('Campaign B / Encuentros');
    expect(picker.popup.hidden).toBe(true);
    expect(picker.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(select.hidden).toBe(true);
    picker.trigger.click();
    expect(picker.popup.hidden).toBe(false);
    expect(document.activeElement).toBe(picker.search);
    expect(picker.list.children).toHaveLength(6);
    expect(picker.list.children[2].style.getPropertyValue('--folder-depth')).toBe('1');
    expect(picker.list.querySelector('[aria-selected="true"]').dataset.value).toBe('encounters-b');
  });

  it('searches accents and parent paths without altering the submitted selection or option IDs', () => {
    const change = jest.fn();
    select.addEventListener('change', change);
    picker.open();
    search('ANGEL');
    expect(picker.list.children).toHaveLength(1);
    expect(picker.list.firstElementChild.dataset.value).toBe('angel');
    expect(select.value).toBe('encounters-b');
    expect(select.options).toHaveLength(6);
    search('Campaign A');
    expect(Array.from(picker.list.children, row => row.dataset.value)).toEqual(['campaign-a', 'encounters-a']);
    expect(change).not.toHaveBeenCalled();
  });

  it('distinguishes duplicate names with their parent paths and commits only the chosen ID', () => {
    picker.open();
    search('encuentros');
    expect(Array.from(picker.list.querySelectorAll('.folder-select__path'), el => el.textContent)).toEqual(['Campaign A', 'Campaign B']);
    picker.list.firstElementChild.click();
    expect(select.value).toBe('encounters-a');
    expect(new FormData(select.form).get('folder')).toBe('encounters-a');
    expect(picker.value.textContent).toBe('Campaign A / Encuentros');
    expect(picker.popup.hidden).toBe(true);
    expect(document.activeElement).toBe(picker.trigger);
  });

  it('preserves the selection when there are no results, on Escape, and on outside clicks', () => {
    const modalEscape = jest.fn();
    document.querySelector('.modal').addEventListener('keydown', modalEscape);
    picker.open();
    search('missing');
    expect(picker.list.children).toHaveLength(0);
    expect(picker.status.textContent).toContain('No folders found');
    expect(select.disabled).toBe(false);
    key(picker.search, 'Escape');
    expect(modalEscape).not.toHaveBeenCalled();
    expect(select.value).toBe('encounters-b');
    picker.open();
    search('angel');
    document.getElementById('save').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(picker.popup.hidden).toBe(true);
    expect(select.value).toBe('encounters-b');
  });

  it('supports arrows and Enter without submitting the surrounding form', () => {
    const submit = jest.fn(event => event.preventDefault());
    select.form.addEventListener('submit', submit);
    key(picker.trigger, 'ArrowDown');
    key(picker.search, 'ArrowDown');
    expect(select.value).toBe('encounters-b');
    expect(picker.search.getAttribute('aria-activedescendant')).toBe(picker.list.lastElementChild.id);
    key(picker.search, 'Enter');
    expect(select.value).toBe('angel');
    expect(submit).not.toHaveBeenCalled();
    expect(picker.popup.hidden).toBe(true);
  });

  it('returns to the trigger on Tab without committing the highlighted result', () => {
    picker.open();
    search('angel');
    key(picker.search, 'Tab');
    expect(document.activeElement).toBe(picker.trigger);
    expect(select.value).toBe('encounters-b');
    expect(picker.popup.hidden).toBe(true);
  });

  it('keeps an empty-string root value valid and selectable', () => {
    picker.destroy();
    picker = new FolderSelect(select, { options: [{ value: '', label: 'Root level' }, options[1]] });
    picker.open();
    picker.list.firstElementChild.click();
    expect(select.value).toBe('');
    expect(picker.value.textContent).toBe('Root level');
    expect(picker.trigger.disabled).toBe(false);
  });

  it('renders folder names as text, including HTML-like names', () => {
    picker.destroy();
    const name = '<img src=x onerror=alert(1)>';
    picker = new FolderSelect(select, { options: [{ value: 'unsafe-name', label: name, path: [name] }] });
    picker.open();
    expect(picker.list.querySelector('img')).toBeNull();
    expect(picker.list.textContent).toContain(name);
    expect(picker.value.textContent).toBe(name);
  });

  it('removes the popup and global listeners when the owning form disappears', async () => {
    picker.open();
    document.querySelector('form').remove();
    await Promise.resolve();
    expect(picker.popup.isConnected).toBe(false);
    expect(picker.openListeners).toHaveLength(0);
  });
});
