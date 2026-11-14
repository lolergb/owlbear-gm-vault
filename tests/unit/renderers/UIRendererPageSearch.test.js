import { jest } from '@jest/globals';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

const page = (name, visibleToPlayers = true) => ({ name, url: 'https://example.com', visibleToPlayers });

test('searches nested page names, preserves paths and clears back to navigation', () => {
  const renderer = new UIRenderer();
  const open = jest.fn();
  renderer.setCallbacks({ onPageClick: open });
  const config = { pages: [page('Root')], categories: [{ id: 'a', name: 'Places', pages: [], categories: [{ id: 'b', name: 'Towns', pages: [page('Waterdeep')], categories: [] }] }] };
  const container = document.createElement('div');
  renderer.renderAllCategories(config, container, 'room', true);
  const input = container.querySelector('.page-search');
  input.value = 'DEEP';
  input.dispatchEvent(new Event('input'));
  expect(container.querySelector('.page-search-results').textContent).toContain('Places / Towns');
  expect(container.querySelector('.page-search-results').textContent).toContain('Waterdeep');
  expect(container.querySelector('.category-group').hidden).toBe(true);
  input.value = 'missing';
  input.dispatchEvent(new Event('input'));
  expect(container.querySelector('.page-search-results').textContent).toContain('No pages found');
  input.value = '';
  input.dispatchEvent(new Event('input'));
  expect(container.querySelector('.category-group').hidden).toBe(false);
  expect(container.querySelector('.page-search-results').hidden).toBe(true);
});

test('does not expose pages unavailable to players', () => {
  const renderer = new UIRenderer();
  const container = document.createElement('div');
  renderer.renderAllCategories({ pages: [page('Secret', false), page('Public')], categories: [] }, container, 'room', false);
  const input = container.querySelector('.page-search');
  input.value = 'secret';
  input.dispatchEvent(new Event('input'));
  expect(container.querySelector('.page-search-results').textContent).toContain('No pages found');
  expect(container.querySelector('.page-search-results').textContent).not.toContain('Secret');
});
