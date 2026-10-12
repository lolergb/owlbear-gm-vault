import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('UIRenderer HTML security', () => {
  it('renders page names and toast content as text', () => {
    const renderer = new UIRenderer();
    const maliciousName = '<img src=x onerror="globalThis.__xss = true">';
    const pageButton = renderer._createPageButton({
      id: 'page-1',
      name: maliciousName,
      url: 'https://example.com/page',
      visibleToPlayers: false
    }, 'room-1', [], 0, true);

    document.body.appendChild(pageButton);
    renderer.showToast({
      type: 'info" onmouseover="globalThis.__xss = true',
      title: maliciousName,
      message: '<svg onload="globalThis.__xss = true"></svg>'
    });

    expect(pageButton.querySelector('.page-name-text').textContent).toBe(maliciousName);
    expect(pageButton.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('.gm-toast').className).toBe('gm-toast gm-toast--info');
    expect(document.querySelector('.gm-toast__title').textContent).toBe(maliciousName);
    expect(document.querySelector('.gm-toast__message').textContent).toBe(
      '<svg onload="globalThis.__xss = true"></svg>'
    );
    expect(document.querySelector('.gm-toast svg')).toBeNull();
  });

  it('escapes emoji markup and rejects executable Notion icon URLs', async () => {
    const renderer = new UIRenderer();
    const button = document.createElement('button');
    button.innerHTML = '<div class="page-button-inner"></div>';
    renderer.notionService = {
      fetchPageInfo: jest.fn().mockResolvedValue({
        icon: { type: 'emoji', emoji: '<img src=x onerror="globalThis.__xss = true">' }
      })
    };

    await renderer._loadPageIcon(button, 'page-1', 'Unsafe page', '');

    expect(button.querySelector('.page-icon-emoji').textContent).toBe(
      '<img src=x onerror="globalThis.__xss = true">'
    );
    expect(button.querySelector('img')).toBeNull();

    renderer.notionService.fetchPageInfo.mockResolvedValue({
      icon: { type: 'external', external: { url: 'javascript:alert(1)' } }
    });
    await renderer._loadPageIcon(button, 'page-1', 'Unsafe page', '');

    expect(button.querySelector('img')).toBeNull();
  });
});

describe('Notion import page list security', () => {
  it('uses text nodes for titles and emojis and only loads HTTP(S) icons', () => {
    const controller = Object.create(ExtensionController.prototype);
    const container = document.createElement('div');
    const onSelect = jest.fn();
    const maliciousTitle = '<img src=x onerror="globalThis.__xss = true">';

    controller._renderNotionPagesList([
      {
        id: 'emoji-page',
        title: maliciousTitle,
        icon: { type: 'emoji', emoji: '<svg onload="globalThis.__xss = true"></svg>' }
      },
      {
        id: 'bad-url-page',
        title: 'Bad URL',
        icon: { type: 'file', file: { url: 'javascript:alert(1)' } }
      },
      {
        id: 'safe-url-page',
        title: 'Safe URL',
        icon: { type: 'external', external: { url: 'https://example.com/icon.png' } }
      }
    ], container, onSelect, new Map([['emoji-page', true]]));

    const items = container.querySelectorAll('.notion-page-item');
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('.notion-page-item__title').textContent).toBe(maliciousTitle);
    expect(items[0].querySelector('.notion-page-item__icon').textContent).toBe(
      '<svg onload="globalThis.__xss = true"></svg>'
    );
    expect(items[0].querySelector('input').checked).toBe(true);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(items[1].querySelector('img')).toBeNull();
    expect(items[2].querySelector('img').src).toBe('https://example.com/icon.png');

    items[0].click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'emoji-page' }), false);
  });
});
