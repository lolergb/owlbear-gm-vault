import { describe, expect, it, jest } from '@jest/globals';
import { Page } from '../../../js/models/Page.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

const PAGE_URL = 'https://www.notion.so/123456781234123412341234567890ab';

describe('saved page icons', () => {
  it.each(['external', 'file'])('renders a shared %s icon without a Notion request', (type) => {
    const renderer = new UIRenderer();
    const fetchPageInfo = jest.fn();
    renderer.setDependencies({ notionService: { fetchPageInfo } });
    const page = new Page('Image icon', PAGE_URL, {
      visibleToPlayers: true,
      icon: { type, [type]: { url: 'https://example.com/icon.png' } }
    });
    const row = renderer._createPageButton(page, 'room', [], 0, false);
    expect(row.querySelector('.page-icon-image').src).toBe('https://example.com/icon.png');
    expect(row.querySelector('.page-icon-placeholder')).toBeNull();
    expect(fetchPageInfo).not.toHaveBeenCalled();
  });

  it('uses the initial when no icon has been shared yet', () => {
    const renderer = new UIRenderer();
    const fetchPageInfo = jest.fn();
    renderer.setDependencies({ notionService: { fetchPageInfo } });
    const row = renderer._createPageButton(new Page('Magistrada', PAGE_URL), 'room', [], 0, false);
    expect(row.querySelector('.page-icon-placeholder').textContent).toBe('M');
    expect(fetchPageInfo).not.toHaveBeenCalled();
  });

  it('escapes saved emoji markup and rejects unsafe image URLs', () => {
    const renderer = new UIRenderer();
    const emoji = '<img src=x onerror="alert(1)">';
    const page = new Page('Page', PAGE_URL, { icon: { type: 'emoji', emoji } });
    const row = renderer._createPageButton(page, 'room', [], 0, false);
    expect(row.querySelector('.page-icon-emoji').textContent).toBe(emoji);
    expect(row.querySelector('img')).toBeNull();

    page.icon = { type: 'external', external: { url: 'javascript:alert(1)' } };
    const unsafeRow = renderer._createPageButton(page, 'room', [], 0, false);
    expect(unsafeRow.querySelector('.page-icon-image')).toBeNull();
    expect(unsafeRow.querySelector('.page-icon-placeholder')).not.toBeNull();
  });

  it('keeps the saved icon if the GM metadata refresh fails', async () => {
    const renderer = new UIRenderer();
    const icon = { type: 'emoji', emoji: '⚖️' };
    const page = new Page('Magistrada', PAGE_URL, { icon });
    const row = renderer._createPageButton(page, 'room', [], 0, true);
    renderer.setDependencies({ notionService: {
      fetchPageInfo: jest.fn().mockResolvedValue({ icon: null })
    } });
    renderer.onPageIconLoaded = jest.fn();
    await renderer._loadPageIcon(row, 'page-id', page, '');
    expect(row.querySelector('.page-icon-emoji').textContent).toBe('⚖️');
    expect(renderer.onPageIconLoaded).not.toHaveBeenCalled();
  });

  it('ignores an icon that arrives after the page URL was edited', async () => {
    const renderer = new UIRenderer();
    const page = new Page('Page', PAGE_URL);
    const row = renderer._createPageButton(page, 'room', [], 0, true);
    let finishFetch;
    renderer.setDependencies({ notionService: {
      fetchPageInfo: () => new Promise(resolve => { finishFetch = resolve; })
    } });
    renderer.onPageIconLoaded = jest.fn();
    const loading = renderer._loadPageIcon(row, 'page-id', page, '');
    page.url = 'https://example.com/replacement';
    finishFetch({ icon: { type: 'emoji', emoji: '⚖️' } });
    await loading;
    expect(row.querySelector('.page-icon-placeholder')).not.toBeNull();
    expect(renderer.onPageIconLoaded).not.toHaveBeenCalled();
  });
});
