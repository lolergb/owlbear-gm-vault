import { describe, expect, it, jest } from '@jest/globals';
import { NotionRenderer } from '../../../js/renderers/NotionRenderer.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';

const PAGE_ID = '12345678-1234-1234-1234-1234567890ab';
const PAGE_URL = `https://app.notion.com/p/Internal-page-${PAGE_ID.replace(/-/g, '')}`;

function mention(plainText) {
  return {
    type: 'mention',
    plain_text: plainText,
    mention: { type: 'page', page: { id: PAGE_ID } }
  };
}

function rendererWithPage(page, options = {}) {
  const renderer = new NotionRenderer();
  renderer.setDependencies({
    config: { findPageByNotionId: () => page },
    isGM: options.isGM ?? true,
    isPageVisibleCallback: options.isPageVisibleCallback
  });
  renderer.setRenderingOptions({ isInModal: options.isInModal ?? false });
  return renderer;
}

describe('NotionRenderer page mentions', () => {
  it('prefiere el texto real de la mention si el vault conserva Untitled', () => {
    const renderer = rendererWithPage({ name: 'Untitled', url: 'https://notion.so/page' });
    const html = renderer._renderPageMention(mention('Goblin Ambush'));

    expect(html).toContain('data-mention-page-name="Goblin Ambush"');
    expect(html).toContain('>Goblin Ambush</span>');
    expect(html).not.toContain('>Untitled</span>');
  });

  it('usa el título del vault si Notion devuelve Untitled', () => {
    const renderer = rendererWithPage({ name: 'Cragmaw Castle', url: 'https://notion.so/page' });
    const html = renderer._renderPageMention(mention(' untitled '));

    expect(html).toContain('data-mention-page-name="Cragmaw Castle"');
    expect(html).toContain('>Cragmaw Castle</span>');
  });

  it('usa Page si ambos títulos son placeholders', () => {
    const renderer = rendererWithPage({ name: 'UNTITLED', url: '' });
    const html = renderer._renderPageMention(mention('Page'));

    expect(html).toContain('data-mention-page-name="Page"');
    expect(html).toContain('>Page</span>');
  });

  it('resuelve el título también dentro de un modal', () => {
    const renderer = rendererWithPage(
      { name: 'Wave Echo Cave', url: 'https://notion.so/page' },
      { isInModal: true }
    );

    expect(renderer._renderPageMention(mention('Untitled')))
      .toBe('<span class="notion-mention notion-mention--disabled" aria-disabled="true">Wave Echo Cave</span>');
  });

  it('escapa el título antes de insertarlo en HTML y atributos', () => {
    const renderer = rendererWithPage({ name: 'Untitled', url: '' });
    const html = renderer._renderPageMention(mention('A <B> & "C"'));

    expect(html).toContain('A &lt;B&gt; &amp; &quot;C&quot;');
    expect(html).not.toContain('A <B>');
  });

  it('mantiene el estado bloqueado para jugadores sin acceso', () => {
    const renderer = rendererWithPage(
      { name: 'Secret', url: '' },
      { isGM: false, isPageVisibleCallback: () => false }
    );

    expect(renderer._renderPageMention(mention('Secret'))).toContain('notion-mention--locked');
  });

  it('convierte rich_text.href de Notion en navegación interna del vault', () => {
    const renderer = rendererWithPage({ name: 'Internal page', url: PAGE_URL });
    const html = renderer.renderRichText([{
      type: 'text',
      text: { content: 'Open page', link: { url: PAGE_URL } },
      plain_text: 'Open page',
      href: PAGE_URL,
      annotations: {}
    }]);

    expect(html).toContain('class="notion-mention notion-mention--link"');
    expect(html).toContain(`data-mention-page-id="${PAGE_ID}"`);
    expect(html).toContain('data-mention-page-name="Open page"');
    expect(html).not.toContain('target="_blank"');
  });

  it('deja como texto un href de Notion cuyo destino no está en el vault', () => {
    const renderer = rendererWithPage(null);
    const html = renderer.renderRichText([{
      type: 'text',
      text: { content: 'Missing page', link: { url: PAGE_URL } },
      plain_text: 'Missing page',
      href: PAGE_URL,
      annotations: {}
    }]);

    expect(html).toContain('class="notion-mention notion-mention--plain"');
    expect(html).not.toContain('notion-mention--link');
    expect(html).not.toContain('target="_blank"');
  });

  it('mantiene como enlace web los href que no apuntan a Notion', () => {
    const renderer = rendererWithPage(null);
    const html = renderer.renderRichText([{
      type: 'text',
      text: { content: 'External', link: { url: 'https://example.com' } },
      plain_text: 'External',
      href: 'https://example.com',
      annotations: {}
    }]);

    expect(html).toContain('class="notion-text-link"');
    expect(html).toContain('target="_blank"');
  });

  it('renderiza link_to_page como navegación sin crear un nodo estructural', () => {
    const renderer = rendererWithPage({ name: 'Internal page', url: PAGE_URL });
    const html = renderer.renderBlock({
      type: 'link_to_page',
      link_to_page: { type: 'page_id', page_id: PAGE_ID }
    });

    expect(html).toContain('class="notion-mention notion-mention--link"');
    expect(html).toContain(`data-mention-page-id="${PAGE_ID}"`);
    expect(html).toContain('data-mention-page-name="Internal page"');
  });

  it('deja link_to_page como texto si el destino no está en el vault', () => {
    const renderer = rendererWithPage(null);
    const html = renderer.renderBlock({
      type: 'link_to_page',
      link_to_page: { type: 'page_id', page_id: PAGE_ID }
    });

    expect(html).toContain('notion-mention--plain');
    expect(html).not.toContain('notion-mention--link');
  });

  it('encuentra destinos importados como páginas raíz', () => {
    const page = new Page('Root destination', PAGE_URL);
    const renderer = new NotionRenderer();
    renderer.setDependencies({
      config: new Config({ pages: [page] }),
      isGM: true
    });

    const html = renderer.renderRichText([{
      type: 'mention',
      mention: { type: 'page', page: { id: PAGE_ID } },
      plain_text: 'Root destination'
    }]);

    expect(html).toContain('notion-mention--link');
    expect(html).toContain('data-mention-page-name="Root destination"');
  });
});

function richText(plainText) {
  return [{
    type: 'text',
    plain_text: plainText,
    href: null,
    text: { content: plainText, link: null },
    annotations: {}
  }];
}

describe('NotionRenderer nested block content', () => {
  it.each(['child_page', 'link_to_page'])('keeps %s as navigation without fetching its page content', async type => {
    const renderer = rendererWithPage({ name: 'Internal page', url: PAGE_URL });
    const fetchChildBlocks = jest.fn().mockResolvedValue([{
      id: 'other-page-content', type: 'paragraph', has_children: false,
      paragraph: { rich_text: richText('This belongs to a different page') }
    }]);
    renderer.setDependencies({ notionService: { fetchChildBlocks } });

    const html = await renderer.renderBlocks([{
      id: PAGE_ID, type, has_children: true,
      child_page: { title: 'Internal page' },
      link_to_page: { type: 'page_id', page_id: PAGE_ID }
    }]);

    expect(html).toContain('notion-mention--link');
    expect(html).toContain(`data-mention-page-id="${PAGE_ID}"`);
    expect(html).not.toContain('This belongs to a different page');
    expect(fetchChildBlocks).not.toHaveBeenCalled();
  });

  it('renders an unimported child page as escaped text without loading it', async () => {
    const renderer = rendererWithPage(null);
    const fetchChildBlocks = jest.fn().mockResolvedValue([]);
    renderer.setDependencies({ notionService: { fetchChildBlocks } });
    const html = await renderer.renderBlocks([{
      id: PAGE_ID, type: 'child_page', has_children: true,
      child_page: { title: 'A <B> & "C"' }
    }]);
    expect(html).toContain('notion-mention--plain');
    expect(html).toContain('A &lt;B&gt; &amp; &quot;C&quot;');
    expect(fetchChildBlocks).not.toHaveBeenCalled();
  });

  it('keeps a child page locked when the player cannot access its destination', async () => {
    const renderer = rendererWithPage({ name: 'Secret', url: PAGE_URL }, {
      isGM: false, isPageVisibleCallback: () => false
    });
    const html = await renderer.renderBlocks([{
      id: PAGE_ID, type: 'child_page', has_children: false, child_page: { title: 'Secret' }
    }]);
    expect(html).toContain('notion-mention--locked');
  });

  it.each(['child_page', 'child_database', 'link_to_page'])('does not inherit visibility tags from a nested %s', async type => {
    const renderer = rendererWithPage({ name: 'Internal page', url: PAGE_URL });
    const fetchChildBlocks = jest.fn(async id => id === 'toggle-1' ? [{
      id: PAGE_ID, type, has_children: true,
      child_page: { title: 'Internal page' }, child_database: { title: 'Database' },
      link_to_page: { type: 'page_id', page_id: PAGE_ID }
    }] : [{
      id: 'private-content', type: 'paragraph', has_children: false,
      paragraph: { rich_text: richText('Other page: 🔒 GM 🔒 HIDDEN') }
    }]);
    renderer.setDependencies({ notionService: {
      fetchChildBlocks, fetchDatabasePages: jest.fn().mockResolvedValue([])
    } });
    const html = await renderer.renderBlocks([{
      id: 'toggle-1', type: 'toggle', has_children: true,
      toggle: { rich_text: richText('Public section') }
    }]);
    expect(html).toContain('Public section');
    expect(html).not.toContain('notion-gm-only');
    expect(html).not.toContain('notion-hidden');
    expect(html).not.toContain('Other page:');
    expect(fetchChildBlocks.mock.calls.map(([id]) => id)).toEqual(['toggle-1']);
  });

  it.each([null, ['image']])('keeps real nested content without crossing a child page boundary (filter: %j)', async filter => {
    const renderer = rendererWithPage({ name: 'Internal page', url: PAGE_URL });
    const image = {
      id: 'image-1', type: 'image', has_children: false,
      image: { type: 'external', external: { url: 'https://example.com/map.png' }, caption: [] }
    };
    const fetchChildBlocks = jest.fn(async id => id === 'quote-1' ? [image, {
      id: PAGE_ID, type: 'child_page', has_children: true, child_page: { title: 'Internal page' }
    }] : [{ ...image, id: 'other-image', image: {
      ...image.image, external: { url: 'https://example.com/other-page.png' }
    } }]);
    renderer.setDependencies({ notionService: { fetchChildBlocks } });
    renderer.setRenderingOptions({ useCache: false });
    const html = await renderer.renderBlocks([{
      id: 'quote-1', type: 'quote', has_children: true,
      quote: { rich_text: richText('Quote heading') }
    }], filter);
    expect(html).toContain('https://example.com/map.png');
    expect(html).not.toContain('https://example.com/other-page.png');
    expect(fetchChildBlocks.mock.calls).toEqual([['quote-1', false]]);
    if (filter) expect(html).not.toContain('Internal page');
    else expect(html).toContain('notion-mention--link');
  });

  it.each(['🔒 GM', '🔒 HIDDEN'])('still inherits %s from content within the current page', async tag => {
    const renderer = new NotionRenderer();
    renderer.setDependencies({ notionService: {
      fetchChildBlocks: async id => id === 'toggle-1' ? [{
        id: 'quote-1', type: 'quote', has_children: true, quote: { rich_text: richText('Notes') }
      }] : [{
        id: 'tag-1', type: 'paragraph', has_children: false, paragraph: { rich_text: richText(tag) }
      }]
    } });
    const html = await renderer.renderBlocks([{
      id: 'toggle-1', type: 'toggle', has_children: true, toggle: { rich_text: richText('Section') }
    }]);
    const element = document.createElement('div');
    element.innerHTML = html;
    expect(element.querySelector('details').classList.contains(tag === '🔒 GM' ? 'notion-gm-only' : 'notion-hidden')).toBe(true);
  });

  it('still expands a synced block while keeping its child pages as navigation', async () => {
    const renderer = rendererWithPage({ name: 'Internal page', url: PAGE_URL });
    const fetchChildBlocks = jest.fn().mockResolvedValue([
      { id: 'synced-text', type: 'paragraph', has_children: false, paragraph: { rich_text: richText('Synced content') } },
      { id: PAGE_ID, type: 'child_page', has_children: true, child_page: { title: 'Internal page' } }
    ]);
    renderer.setDependencies({ notionService: { fetchChildBlocks } });
    const html = await renderer.renderBlocks([{
      id: 'synced-copy', type: 'synced_block', has_children: false,
      synced_block: { synced_from: { block_id: 'synced-original' } }
    }]);
    expect(html).toContain('Synced content');
    expect(html).toContain('notion-mention--link');
    expect(fetchChildBlocks.mock.calls).toEqual([['synced-original', true]]);
  });

  it('renders children nested inside a quote', async () => {
    const renderer = new NotionRenderer();
    renderer.setDependencies({
      notionService: {
        fetchChildBlocks: async blockId => blockId === 'quote-1'
          ? [{
              id: 'paragraph-1',
              type: 'paragraph',
              has_children: false,
              paragraph: { rich_text: richText('Nested quote content') }
            }]
          : []
      }
    });

    const html = await renderer.renderBlocks([{
      id: 'quote-1',
      type: 'quote',
      has_children: true,
      quote: { rich_text: richText('Quote heading') }
    }]);
    const template = document.createElement('template');
    template.innerHTML = html;

    const quote = template.content.querySelector('.notion-quote');
    expect(quote.textContent).toContain('Quote heading');
    expect(quote.querySelector('.notion-quote-children').textContent)
      .toContain('Nested quote content');
  });

  it('keeps nested images inside their list item', async () => {
    const renderer = new NotionRenderer();
    renderer.setDependencies({
      notionService: {
        fetchChildBlocks: async blockId => blockId === 'list-1'
          ? [{
              id: 'image-1',
              type: 'image',
              has_children: false,
              image: {
                type: 'external',
                external: { url: 'https://example.com/map.png' },
                caption: richText('Encounter map')
              }
            }]
          : []
      }
    });

    const html = await renderer.renderBlocks([{
      id: 'list-1',
      type: 'bulleted_list_item',
      has_children: true,
      bulleted_list_item: { rich_text: richText('Maps') }
    }]);
    const template = document.createElement('template');
    template.innerHTML = html;

    const listItem = template.content.querySelector('li.notion-bulleted-list-item');
    expect(listItem.textContent).toContain('Maps');
    expect(listItem.querySelector('img.notion-image-clickable').getAttribute('src'))
      .toBe('https://example.com/map.png');
  });
});
