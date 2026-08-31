import { describe, expect, it } from '@jest/globals';
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
