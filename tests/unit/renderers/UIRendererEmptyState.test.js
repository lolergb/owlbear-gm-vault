import { afterEach, describe, expect, it } from '@jest/globals';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function renderEmptyState(config, isGM) {
  const renderer = new UIRenderer();
  const container = document.createElement('div');

  renderer.renderAllCategories(config, container, 'room-1', { isGM });

  return container;
}

describe('UIRenderer empty states', () => {
  it('does not tell a player to use GM-only add controls when the config is empty', () => {
    const container = renderEmptyState({ pages: [], categories: [] }, false);

    expect(container.querySelector('.empty-state-text').textContent)
      .toBe('No content visible to players');
    expect(container.querySelector('.empty-state-hint').textContent)
      .toBe('The GM can share pages using the visibility control');
    expect(container.textContent).not.toContain('Click +');
  });

  it('keeps the add guidance for a GM with an empty config', () => {
    const container = renderEmptyState({ pages: [], categories: [] }, true);

    expect(container.querySelector('.empty-state-text').textContent)
      .toBe('No pages configured');
    expect(container.querySelector('.empty-state-hint').textContent)
      .toBe('Click + to add your first page or folder');
  });
});
