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

test('header search opens, survives rerender and closes with Escape or the close button', () => {
  document.body.innerHTML = '<div class="container"><header id="header"><h1 id="page-title">GM vault</h1><div class="button-container"></div></header><div id="page-list"></div></div>';
  const renderer = new UIRenderer();
  const container = document.getElementById('page-list');
  const config = { pages: [page('Waterdeep'), page('Neverwinter')], categories: [] };
  renderer.renderAllCategories(config, container, 'room', true);
  const header = document.getElementById('header');
  let toggle = header.querySelector('.page-search-open');
  toggle.click();
  let input = header.querySelector('.page-search');
  expect(document.activeElement).toBe(input);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  input.value = 'water';
  input.dispatchEvent(new Event('input'));
  renderer.renderAllCategories(config, container, 'room', true);
  input = header.querySelector('.page-search');
  toggle = header.querySelector('.page-search-open');
  expect(header.classList.contains('page-search-active')).toBe(true);
  expect(input.value).toBe('water');
  expect(container.querySelector('.page-search-results').textContent).toContain('Waterdeep');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(header.classList.contains('page-search-active')).toBe(false);
  expect(input.value).toBe('');
  expect(document.activeElement).toBe(toggle);
  expect(container.querySelector('.page-search-results').hidden).toBe(true);
  toggle.click();
  input.value = 'water';
  input.dispatchEvent(new Event('input'));
  header.querySelector('.page-search-close').click();
  expect(input.value).toBe('');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  document.body.innerHTML = '';
});
