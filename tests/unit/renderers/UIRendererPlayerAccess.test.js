import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function visibleRect(element) {
  element.getBoundingClientRect = () => ({
    left: 10,
    right: 42,
    top: 10,
    bottom: 42,
    width: 32,
    height: 32
  });
}

describe('UIRenderer player access actions', () => {
  it.each([
    ['partly visible', [true, false], 'Hide from 1 player', '1', false],
    ['visible', [true, true], 'Hide from 1 player', '1', false],
    ['hidden', [false, false], 'Show to 1 player', '1', true],
    ['empty', [], 'Show to all players', '', true]
  ])('offers a page-style eye for %s folders including nested pages', async (_state, visibility, label, count, nextVisible) => {
    const pages = visibility.map((visible, index) => new Page(`Page ${index}`, `https://example.com/${index}`, {
      sharedWithPlayerIds: ['player-1'], playerAccessEnabled: visible
    }));
    const folder = new Category('Folder', { categories: [new Category('Nested', { pages })] });
    const renderer = new UIRenderer();
    renderer.setConfig(new Config({ categories: [folder] }));
    const callback = jest.fn().mockResolvedValue(true);
    renderer.setCallbacks({ onCategoryVisibilityChange: callback });
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderer.renderCategory(folder, container, 0, 'room-1', [], true);
    const eye = container.querySelector('.category-visibility-button');
    expect(eye.classList.contains('page-visibility-button')).toBe(true);
    expect(eye.title).toBe(label);
    expect(eye.querySelector('.page-visibility-button__label').textContent).toBe(count);
    eye.click();
    expect(callback).toHaveBeenCalledWith(folder, [{ id: folder.id, name: folder.name }], nextVisible);
    expect(container.querySelector('.category-collapse-button').getAttribute('aria-expanded')).toBe('true');
  });

  it('adds the selected-player action to a page context menu', () => {
    const page = new Page('Secret', 'https://example.com/secret');
    const renderer = new UIRenderer();
    renderer.config = new Config({ pages: [page], categories: [] });
    renderer.onPageAccessManage = jest.fn();
    const row = renderer._createPageButton(page, 'room-1', [], 0, true);
    document.body.appendChild(row);
    const button = row.querySelector('.page-context-menu-button');
    visibleRect(button);

    button.click();
    const item = [...document.querySelectorAll('.context-menu__item')]
      .find(candidate => candidate.textContent.includes('Choose players'));
    expect(item).toBeDefined();
    item.click();
    expect(renderer.onPageAccessManage).toHaveBeenCalledWith(page, [], 0);
  });

  it('opens Choose players from the folder menu without the old bulk menu actions', () => {
    const folder = new Category('Secrets', { sharedWithPlayerIds: ['player-1'] });
    const config = new Config({ categories: [folder] });
    const renderer = new UIRenderer();
    renderer.setConfig(config);
    renderer.setCallbacks({ onCategoryAccessManage: jest.fn() });
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderer.renderCategory(folder, container, 0, 'room-1', [], true);
    const button = container.querySelector('.category-context-menu-button');
    visibleRect(button);

    button.click();
    const item = [...document.querySelectorAll('.context-menu__item')]
      .find(candidate => candidate.textContent.includes('Choose players'));
    expect(item).toBeDefined();
    expect(document.querySelector('#context-menu').textContent).not.toMatch(/(Show|Hide) all pages/);
    item.click();
    expect(renderer.onCategoryAccessManage).toHaveBeenCalledWith(folder, [{ id: folder.id, name: folder.name }]);
    expect(container.querySelector('.player-access-badge')).toBeNull();
  });

  it.each([{ isGM: false }, { isGM: true, isCoGM: true }])('keeps folder access controls limited to the owner: %j', options => {
    const renderer = new UIRenderer();
    const page = new Page('Public', 'https://example.com', { visibleToPlayers: true });
    const config = new Config({ categories: [new Category('Folder', { pages: [page] })] });
    const container = document.createElement('div');
    renderer.renderAllCategories(config, container, 'room-1', options);
    expect(container.querySelector('.category-visibility-button')).toBeNull();
    expect(container.querySelector('.category-context-menu-button')).toBeNull();
  });

  it('refreshes the folder eye when individual pages have different audiences', () => {
    const first = new Page('First', 'https://example.com/first', { sharedWithPlayerIds: ['one'] });
    const second = new Page('Second', 'https://example.com/second', { sharedWithPlayerIds: ['one'] });
    const folder = new Category('Folder', { pages: [first, second] });
    const renderer = new UIRenderer();
    renderer.setConfig(new Config({ categories: [folder] }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderer.renderCategory(folder, container, 0, 'room-1', [], true);
    const eye = container.querySelector('.category-visibility-button');
    expect(eye.title).toBe('Hide from 1 player');
    second.sharedWithPlayerIds = ['two'];
    renderer.updatePageVisibility(second, true);
    expect(eye.title).toBe('Hide from players');
    expect(eye.querySelector('.page-visibility-button__label').hidden).toBe(true);
  });

  it('combines the page visibility icon and audience count into one control', () => {
    const page = new Page('Secret', 'https://example.com/secret', {
      sharedWithPlayerIds: ['player-1', 'player-2']
    });
    const renderer = new UIRenderer();

    const row = renderer._createPageButton(page, 'room-1', [], 0, true);
    const visibility = row.querySelector('.page-visibility-button');

    expect(row.querySelector('.page-button-inner .player-access-badge')).toBeNull();
    expect(visibility.classList.contains('hidden')).toBe(false);
    expect(visibility.classList.contains('page-visibility-button--selected')).toBe(true);
    expect(visibility.querySelector('.icon').style.maskImage).toContain('icon-eye-open.svg');
    expect(visibility.querySelector('.page-visibility-button__label').textContent).toBe('2');
    expect(visibility.title).toBe('Hide from 2 players');
  });

  it('keeps the private eye available for row hover and keyboard focus', () => {
    const renderer = new UIRenderer();
    const row = renderer._createPageButton(
      new Page('GM notes', 'https://example.com/gm-notes'),
      'room-1',
      [],
      0,
      true
    );

    const visibility = row.querySelector('.page-visibility-button');
    expect(visibility.classList.contains('hidden')).toBe(false);
    expect(visibility.classList.contains('page-visibility-button--no-access')).toBe(true);
    expect(visibility.title).toBe('Show to all players');
  });

  it('keeps a disabled selected audience visible with its count', () => {
    const page = new Page('Paused secret', 'https://example.com/paused', {
      sharedWithPlayerIds: ['player-1'],
      playerAccessEnabled: false
    });
    const renderer = new UIRenderer();
    const row = renderer._createPageButton(page, 'room-1', [], 0, true);
    const visibility = row.querySelector('.page-visibility-button');

    expect(visibility.classList.contains('page-visibility-button--selected')).toBe(true);
    expect(visibility.classList.contains('page-visibility-button--no-access')).toBe(false);
    expect(visibility.querySelector('.icon').style.maskImage).toContain('icon-eye-close.svg');
    expect(visibility.querySelector('.page-visibility-button__label').textContent).toBe('1');
    expect(visibility.title).toBe('Show to 1 player');

    visibility.id = 'page-visibility-button-header';
    renderer._setVisibilityButtonState(visibility, page);
    expect(visibility.classList.contains('hidden')).toBe(false);
  });

  it('shows only the eye when the page is visible to everyone', () => {
    const renderer = new UIRenderer();
    const row = renderer._createPageButton(
      new Page('Public notes', 'https://example.com/public', { visibleToPlayers: true }),
      'room-1',
      [],
      0,
      true
    );
    const visibility = row.querySelector('.page-visibility-button');
    const label = visibility.querySelector('.page-visibility-button__label');

    expect(visibility.classList.contains('hidden')).toBe(false);
    expect(visibility.classList.contains('page-visibility-button--selected')).toBe(false);
    expect(visibility.querySelector('.icon').style.maskImage).toContain('icon-eye-open.svg');
    expect(label.textContent).toBe('');
    expect(label.hidden).toBe(true);
    expect(visibility.title).toBe('Hide from all players');
  });
});
