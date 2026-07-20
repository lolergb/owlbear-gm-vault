import { describe, expect, it } from '@jest/globals';
import { NotionRenderer } from '../../../js/renderers/NotionRenderer.js';

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
});
