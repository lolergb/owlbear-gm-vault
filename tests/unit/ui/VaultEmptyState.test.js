import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { VaultEmptyState } from '../../../js/ui/VaultEmptyState.js';

let empty;
let layout;
let container;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const show = (overrides = {}) => empty.show({ container, canShow: () => true, ...overrides });

beforeEach(() => {
  document.body.innerHTML = '<button id="settings">Settings</button><div id="page-list"></div>';
  document.documentElement.className = '';
  container = document.getElementById('page-list');
  layout = new EventTarget();
  layout.matches = false;
  window.matchMedia = jest.fn(() => layout);
  empty = new VaultEmptyState({ analyticsService: { getConsent: jest.fn(() => true), trackEvent: jest.fn() } });
});
afterEach(() => { empty.remove(); delete window.matchMedia; });

describe('Vault empty state', () => {
  it('renders an ordinary page with two actions, no dismissal, and no remembered welcome flag', () => {
    localStorage.setItem('gm_vault_welcome_v1_gm_room', 'dismiss');
    expect(show()).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(container.querySelector('[aria-label*="Close"]')).toBeNull();
    expect(document.getElementById('settings').disabled).toBe(false);
    expect(empty.analyticsService.trackEvent).toHaveBeenCalledWith('vault_empty_viewed');
    empty.remove();
    expect(show()).toBe(true);
  });

  it('leaves the empty state available after choosing Add page', () => {
    const onAddPage = jest.fn();
    show({ onAddPage });
    container.querySelector('.vault-empty-state__add').click();
    expect(onAddPage).toHaveBeenCalledTimes(1);
    expect(empty.element.isConnected).toBe(true);
    expect(empty.analyticsService.trackEvent).toHaveBeenCalledWith('vault_empty_action', { action: 'add_page' });
  });

  it('prevents duplicate example requests, reports failure inline and allows retry', async () => {
    let rejectLoad;
    const onLoadExamples = jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectLoad = reject; }))
      .mockResolvedValueOnce(true);
    show({ onLoadExamples });
    const example = container.querySelector('.vault-empty-state__example');
    const primary = container.querySelector('.vault-empty-state__add');
    example.click();
    example.click();
    expect(onLoadExamples).toHaveBeenCalledTimes(1);
    expect(example.textContent).toBe('Loading example…');
    expect(primary.disabled).toBe(true);
    rejectLoad(new Error('The example vault could not be loaded. Try again.'));
    await flush();
    expect(container.querySelector('[role="alert"]').hidden).toBe(false);
    expect(primary.disabled).toBe(false);
    expect(example.disabled).toBe(false);
    example.click();
    await flush();
    expect(onLoadExamples).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]').hidden).toBe(true);
  });

  it('keeps DOM and visual order aligned across widths without losing focus or handlers', () => {
    const onAddPage = jest.fn();
    show({ onAddPage });
    const actions = container.querySelector('.vault-empty-state__actions');
    const primary = actions.querySelector('.vault-empty-state__add');
    const secondary = actions.querySelector('.vault-empty-state__example');
    expect([...actions.children]).toEqual([secondary, primary]);
    primary.focus();
    layout.matches = true;
    layout.dispatchEvent(new Event('change'));
    expect([...actions.children]).toEqual([primary, secondary]);
    expect(document.activeElement).toBe(primary);
    layout.matches = false;
    layout.dispatchEvent(new Event('change'));
    expect([...actions.children]).toEqual([secondary, primary]);
    expect(document.activeElement).toBe(primary);
    primary.click();
    expect(onAddPage).toHaveBeenCalledTimes(1);
  });

  it('starts primary-first on narrow screens and cleans up layout listeners', () => {
    layout.matches = true;
    const removeListener = jest.spyOn(layout, 'removeEventListener');
    show();
    expect(container.querySelector('.vault-empty-state__actions').firstElementChild)
      .toBe(container.querySelector('.vault-empty-state__add'));
    const handler = empty.onActionLayoutChanged;
    empty.remove();
    expect(removeListener).toHaveBeenCalledWith('change', handler);
    expect(container.classList.contains('page-list--empty')).toBe(false);
    expect(() => layout.dispatchEvent(new Event('change'))).not.toThrow();
  });

  it('keeps the same consent banner on the body through mounting and unmounting', () => {
    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    document.body.appendChild(banner);
    empty.analyticsService.getConsent.mockReturnValue(null);
    show();
    expect(banner.parentElement).toBe(document.body);
    expect(empty.analyticsService.trackEvent).not.toHaveBeenCalled();
    empty.remove();
    expect(banner.parentElement).toBe(document.body);
    empty.analyticsService.getConsent.mockReturnValue(true);
    banner.dispatchEvent(new Event('analytics-consent-changed'));
    expect(empty.analyticsService.trackEvent).not.toHaveBeenCalled();
  });

  it('does not report an empty-state view behind a form when consent is accepted', () => {
    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    document.body.appendChild(banner);
    empty.analyticsService.getConsent.mockReturnValue(null);
    show();
    const overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    document.body.appendChild(overlay);
    empty.analyticsService.getConsent.mockReturnValue(true);
    banner.dispatchEvent(new Event('analytics-consent-changed'));
    expect(empty.analyticsService.trackEvent).not.toHaveBeenCalled();
  });

  it('does not offer creation after editing permissions change', () => {
    let eligible = true;
    const onAddPage = jest.fn();
    show({ canShow: () => eligible, onAddPage });
    eligible = false;
    container.querySelector('.vault-empty-state__add').click();
    expect(onAddPage).not.toHaveBeenCalled();
  });

  it('never appears in auxiliary content viewers', () => {
    document.documentElement.classList.add('modal-mode');
    expect(show()).toBe(false);
  });
});
