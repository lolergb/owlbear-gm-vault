import { describe, expect, it, jest } from '@jest/globals';
import { Category } from '../../../js/models/Category.js';
import { Page } from '../../../js/models/Page.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

function renderFolder(isGM = true) {
  const renderer = new UIRenderer();
  const parent = document.createElement('div');
  const folder = new Category('PNJ', {
    pages: [new Page('Magistrada', 'https://example.com', { visibleToPlayers: true })]
  });
  renderer.renderCategory(folder, parent, 0, 'room', [], isGM);
  return { renderer, parent, folder };
}

describe('folder collapse button', () => {
  it.each([true, false])('toggles from the icon, button and title with isGM=%s', (isGM) => {
    const { parent } = renderFolder(isGM);
    const button = parent.querySelector('.category-collapse-button');
    const icon = button.querySelector('.icon');
    const content = parent.querySelector('.category-content');
    const title = parent.querySelector('.category-title');

    icon.click();
    expect(content.style.display).toBe('none');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(icon.getAttribute('aria-label')).toBe('Expand');
    expect(icon.style.maskImage).toContain('folder-close.svg');
    expect(localStorage.getItem('category-collapsed-PNJ-level-0')).toBe('true');

    button.click();
    expect(content.style.display).toBe('block');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(icon.getAttribute('aria-label')).toBe('Collapse');

    title.click();
    expect(content.style.display).toBe('none');
    icon.click();
    expect(content.style.display).toBe('block');
    expect(localStorage.getItem('category-collapsed-PNJ-level-0')).toBe('false');
  });

  it('restores a collapsed folder and opens it from the icon', () => {
    localStorage.setItem('category-collapsed-PNJ-level-0', 'true');
    const { parent } = renderFolder();
    const button = parent.querySelector('.category-collapse-button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(parent.querySelector('.category-content').style.display).toBe('none');
    button.querySelector('.icon').click();
    expect(parent.querySelector('.category-content').style.display).toBe('block');
  });

  it('keeps the folder open when opening its context menu', () => {
    const { parent, renderer } = renderFolder();
    renderer._showCategoryContextMenu = jest.fn();
    parent.querySelector('.category-context-menu-button').click();
    expect(renderer._showCategoryContextMenu).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('.category-content').style.display).toBe('block');
  });

  it('toggles a nested folder without closing its parent', () => {
    const { parent, renderer, folder } = renderFolder();
    const parentContent = parent.querySelector('.category-content');
    renderer.renderCategory(new Category('Nested', { pages: folder.pages }), parentContent, 1, 'room');
    const nested = parentContent.querySelector('.category-group');
    nested.querySelector('.category-collapse-button .icon').click();
    expect(nested.querySelector('.category-content').style.display).toBe('none');
    expect(parentContent.style.display).toBe('block');
  });
});
