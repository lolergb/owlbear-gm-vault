import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { Category } from '../../../js/models/Category.js';

afterEach(() => { document.body.innerHTML = ''; });

function createController() {
  const controller = new ExtensionController();
  controller.playerId = 'gm';
  controller.roomId = 'room';
  controller.config = new Config();
  controller.render = jest.fn();
  controller.broadcastService.broadcastVisiblePages = jest.fn();
  controller.broadcastService.notifyFullVaultUpdated = jest.fn();
  controller.openPage = jest.fn(async page => { controller.currentPage = page; });
  controller.analyticsService.trackPageAdded = jest.fn();
  controller.analyticsService.trackFirstUserContentCreated = jest.fn();
  controller.uiRenderer.showErrorToast = jest.fn();
  return controller;
}

describe('Empty-state activation paths', () => {
  it.each([
    ['cancel', true], ['submit', true], ['cancel', false], ['submit', false]
  ])('keeps the original banner outside the form on %s / open after save = %s', async (action, openAfterSave) => {
    const controller = createController();
    controller.analyticsService.showConsentBanner();
    const banner = document.getElementById('cookie-consent-banner');
    await controller._addPage({ openAfterSave });
    expect(banner.parentElement).toBe(document.body);
    expect(banner.className).toBe('cookie-consent-banner');
    expect(document.querySelectorAll('#cookie-consent-banner')).toHaveLength(1);
    expect(banner.closest('form')).toBeNull();
    document.getElementById('field-name').value = 'Handout';
    document.getElementById('field-url').value = 'https://example.com/handout.png';
    if (action === 'cancel') document.getElementById('modal-cancel').click();
    else document.getElementById('modal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(banner.parentElement).toBe(document.body);
    expect(controller.analyticsService.getConsent()).toBeNull();
    document.getElementById('cookie-reject').click();
    expect(controller.analyticsService.getConsent()).toBe(false);
    expect(document.getElementById('cookie-consent-banner')).toBeNull();
  });

  it('answers analytics above the form without submitting or discarding the page', async () => {
    const controller = createController();
    controller.analyticsService.showConsentBanner();
    await controller._addPage({ openAfterSave: true });
    document.getElementById('field-name').value = 'Unfinished page';
    document.getElementById('cookie-reject').click();
    expect(document.getElementById('field-name').value).toBe('Unfinished page');
    expect(document.activeElement).toBe(document.getElementById('field-name'));
    expect(document.getElementById('cookie-consent-banner')).toBeNull();
    expect(controller.analyticsService.trackPageAdded).not.toHaveBeenCalled();
    document.getElementById('modal-cancel').click();
    expect(document.getElementById('cookie-consent-banner')).toBeNull();
  });

  it.each([
    ['empty', true, false, false, true],
    ['demo', true, false, false, false],
    ['configured', true, false, false, false],
    ['empty', false, false, false, false],
    ['empty', true, true, false, false],
    ['empty', true, false, true, false]
  ])('gates %s / GM %s / coGM %s / player view %s', (state, isGM, isCoGM, playerViewMode, expected) => {
    const controller = createController();
    Object.assign(controller, { isGM, isCoGM, playerViewMode });
    if (state !== 'empty') controller.config.pages.push(new Page('Page', 'https://example.com/image.png', { origin: state === 'demo' ? 'demo' : 'user' }));
    expect(controller._canShowVaultEmptyState()).toBe(expected);
  });

  it.each([false, true])('saves then opens the correct page with nested folder = %s', async nested => {
    const controller = createController();
    if (nested) controller.config.categories.push(new Category('Session', { categories: [new Category('Handouts')] }));
    controller._showModalForm = jest.fn();
    await controller._addPage({ openAfterSave: true });
    const [, , submit, , formOptions] = controller._showModalForm.mock.calls[0];
    await submit({ name: 'New handout', url: 'https://example.com/handout.png', parentFolder: nested ? 'Session/Handouts' : '', visibleToPlayers: false });
    const savedPage = controller.config.getAllPages()[0];
    expect(formOptions.submitText).toBe('Save and open');
    expect(controller.openPage).toHaveBeenCalledWith(savedPage, nested ? ['Session', 'Handouts'] : [], 0);
    expect(savedPage.visibleToPlayers).toBe(false);
    expect(controller.analyticsService.trackFirstUserContentCreated).toHaveBeenCalledTimes(1);
  });

  it('does not open or report activation when local persistence fails', async () => {
    const controller = createController();
    controller.storageService.saveLocalConfig = jest.fn(() => false);
    controller._showModalForm = jest.fn();
    await controller._addPage({ openAfterSave: true });
    await controller._showModalForm.mock.calls[0][2]({ name: 'Page', url: 'https://example.com/image.png' });
    expect(controller.openPage).not.toHaveBeenCalled();
    expect(controller.analyticsService.trackFirstUserContentCreated).not.toHaveBeenCalled();
    expect(controller.uiRenderer.showErrorToast).toHaveBeenCalled();
  });
});

describe('Opt-in example vault', () => {
  const source = () => ({ categories: [{ name: 'Examples', pages: [
    { name: 'Handout', url: 'https://example.com/handout.png', visibleToPlayers: false }
  ] }] });
  const prepare = () => {
    const controller = createController();
    controller._fetchDefaultConfig = jest.fn().mockResolvedValue(source());
    controller._goBackToList = jest.fn();
    controller._scheduleAnnouncement = jest.fn();
    controller.analyticsService.getConsent = jest.fn(() => true);
    controller.analyticsService.trackEvent = jest.fn();
    return controller;
  };

  it('fetches only on request, saves demo origins, and restores the chosen vault after reload', async () => {
    const controller = prepare();
    expect(controller._fetchDefaultConfig).not.toHaveBeenCalled();
    expect(await controller._loadExampleVault()).toBe(true);
    expect(controller.config.getTotalPageCount()).toBe(1);
    expect(controller.config.getAllPages()[0].origin).toBe('demo');
    expect(controller.broadcastService.notifyFullVaultUpdated).toHaveBeenCalledTimes(1);
    expect(controller.analyticsService.trackEvent).toHaveBeenCalledWith('demo_vault_loaded');
    expect(controller.analyticsService.trackFirstUserContentCreated).not.toHaveBeenCalled();
    expect(controller.openPage).not.toHaveBeenCalled();
    const saved = controller.config.toJSON();
    await controller._loadConfig();
    expect(controller.config.toJSON()).toEqual(saved);
    expect(controller._fetchDefaultConfig).toHaveBeenCalledTimes(1);
    expect(await controller._loadExampleVault()).toBe(false);
  });

  it.each([null, { categories: [] }, { categories: 'broken' }])('keeps the empty vault after invalid demo data: %j', async data => {
    const controller = prepare();
    controller._fetchDefaultConfig.mockResolvedValue(data);
    const original = controller.config;
    await expect(controller._loadExampleVault()).rejects.toThrow('Try again');
    expect(controller.config).toBe(original);
    expect(controller.storageService.getLocalConfig()).toBeNull();
    expect(controller.analyticsService.trackEvent).not.toHaveBeenCalled();
  });

  it('allows retry after a failed network request', async () => {
    const controller = prepare();
    controller._fetchDefaultConfig.mockRejectedValueOnce(new Error('offline'));
    await expect(controller._loadExampleVault()).rejects.toThrow('Try again');
    expect(await controller._loadExampleVault()).toBe(true);
  });

  it('rolls back to empty when the demo cannot be persisted', async () => {
    const controller = prepare();
    const original = controller.config;
    controller.storageService.saveLocalConfig = jest.fn(() => false);
    await expect(controller._loadExampleVault()).rejects.toThrow('Free up local storage');
    expect(controller.config).toBe(original);
    expect(controller._canShowVaultEmptyState()).toBe(true);
    expect(controller.broadcastService.notifyFullVaultUpdated).not.toHaveBeenCalled();
    expect(controller.analyticsService.trackEvent).not.toHaveBeenCalled();
  });

  it.each(['page', 'folder', 'role', 'cleanup'])('does not overwrite a %s change made during the request', async change => {
    const controller = prepare();
    let resolveRequest;
    controller._fetchDefaultConfig.mockReturnValue(new Promise(resolve => { resolveRequest = resolve; }));
    const pending = controller._loadExampleVault();
    expect(await controller._loadExampleVault()).toBe(false);
    expect(controller._fetchDefaultConfig).toHaveBeenCalledTimes(1);
    if (change === 'page') controller.config.pages.push(new Page('My page', 'https://example.com/mine.png'));
    if (change === 'folder') controller.config.categories.push(new Category('My folder'));
    if (change === 'role') controller.isCoGM = true;
    if (change === 'cleanup') controller.announcementCancelled = true;
    const before = controller.config.toJSON();
    resolveRequest(source());
    expect(await pending).toBe(false);
    expect(controller.config.toJSON()).toEqual(before);
    expect(controller.storageService.getLocalConfig()).toBeNull();
  });

  it('retains empty state on cancel and replaces it after Save and open', async () => {
    document.body.innerHTML = '<div class="container"><header id="header"><h1 id="page-title">GM vault</h1></header><div id="page-list"></div></div>';
    const controller = prepare();
    controller.pagesContainer = document.getElementById('page-list');
    controller.render = ExtensionController.prototype.render.bind(controller);
    await controller.render();
    const add = document.querySelector('.vault-empty-state__add');
    add.click();
    expect(document.getElementById('modal-form')).not.toBeNull();
    document.getElementById('modal-cancel').click();
    expect(document.querySelector('.vault-empty-state__add')).toBe(add);
    expect(document.activeElement).toBe(add);
    expect(controller._fetchDefaultConfig).not.toHaveBeenCalled();
    controller._showModalForm = jest.fn();
    await controller._addPage({ openAfterSave: true });
    await controller._showModalForm.mock.calls[0][2]({ name: 'My handout', url: 'https://example.com/mine.png' });
    expect(document.querySelector('.vault-empty-state')).toBeNull();
    expect(controller.config.getAllPages().map(page => page.name)).toEqual(['My handout']);
    expect(controller.openPage).toHaveBeenCalledTimes(1);
    expect(controller._fetchDefaultConfig).not.toHaveBeenCalled();
    controller.vaultEmptyState.remove();
  });

  it('replaces the empty state with expanded examples and moves keyboard focus into the library', async () => {
    document.body.innerHTML = '<div class="container"><div id="page-list"></div><button id="collapse-all-button" data-collapsed="true"></button></div>';
    const controller = prepare();
    controller.pagesContainer = document.getElementById('page-list');
    controller.render = ExtensionController.prototype.render.bind(controller);
    await controller.render();
    expect(document.querySelector('.vault-empty-state')).not.toBeNull();
    await controller._loadExampleVault();
    expect(document.querySelector('.vault-empty-state')).toBeNull();
    expect(document.querySelector('.category-content').style.display).toBe('block');
    expect(document.activeElement).toBe(document.querySelector('.page-button'));
    expect(controller.openPage).not.toHaveBeenCalled();
    controller.vaultEmptyState.remove();
  });

  it('keeps manually created empty folders visible instead of replacing them with onboarding', () => {
    const controller = prepare();
    controller.config.categories.push(new Category('My folder'));
    expect(controller._canShowVaultEmptyState()).toBe(false);
  });
});
