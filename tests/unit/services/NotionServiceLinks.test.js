import { describe, expect, it, jest } from '@jest/globals';
import { NotionService } from '../../../js/services/NotionService.js';

const ROOT_ID = '3a3d4856-c90e-8019-9267-dff41d1609a1';
const LINKED_ID = '3a3d4856-c90e-812c-abe5-d9dd50ed3333';
const NESTED_ID = '4b4d4856-c90e-812c-abe5-d9dd50ed4444';
const CHILD_ID = '5c5d4856-c90e-812c-abe5-d9dd50ed5555';
const LINKED_URL = 'https://app.notion.com/p/Monstruos-y-criaturas-3a3d4856c90e812cabe5d9dd50ed3333?source=copy_link';

function linkedText(text = 'Monstruos y criaturas') {
  return {
    type: 'text',
    text: { content: text, link: { url: LINKED_URL } },
    plain_text: text,
    href: LINKED_URL
  };
}

describe('NotionService internal page links', () => {
  it('ignora href para la estructura y conserva las mentions reales', async () => {
    const service = new NotionService();
    const blocks = [{
      id: 'block-1',
      type: 'paragraph',
      has_children: false,
      paragraph: {
        rich_text: [
          linkedText(),
          {
            type: 'mention',
            mention: { type: 'page', page: { id: LINKED_ID } },
            plain_text: 'Nombre duplicado'
          },
          {
            type: 'text',
            text: { content: 'Web', link: { url: 'https://example.com' } },
            plain_text: 'Web',
            href: 'https://example.com'
          }
        ]
      }
    }];

    await expect(service._extractMentionsFromBlocks(blocks)).resolves.toEqual([{
      pageId: LINKED_ID,
      text: 'Nombre duplicado'
    }]);
  });

  it('no sube referencias atravesando el límite de una child_page', async () => {
    const service = new NotionService();
    service.fetchChildBlocks = jest.fn().mockResolvedValue([{
      id: 'nested-mention',
      type: 'paragraph',
      has_children: false,
      paragraph: {
        rich_text: [{
          type: 'mention',
          mention: { type: 'page', page: { id: LINKED_ID } },
          plain_text: 'Nested page'
        }]
      }
    }]);

    const references = await service._extractMentionsFromBlocks([{
      id: 'child-page-block',
      type: 'child_page',
      has_children: true,
      child_page: { title: 'Child' }
    }]);

    expect(references).toEqual([]);
    expect(service.fetchChildBlocks).not.toHaveBeenCalled();
  });

  it('conserva visible una página cuyo contenido incluye enlaces internos', () => {
    const service = new NotionService();
    const richText = [linkedText()];

    expect(service._hasOnlyMentions(richText)).toBe(false);
    expect(service._hasRealTextContent(richText)).toBe(true);
  });

  it('no convierte href de propiedades en páginas del árbol', () => {
    const service = new NotionService();
    const mentions = service._extractMentionsFromPageProperties({
      Notes: { type: 'rich_text', rich_text: [linkedText()] }
    });

    expect(mentions).toEqual([]);
  });

  it('no convierte rich_text.href en una relación padre-hijo', async () => {
    const service = new NotionService();
    service.storageService = { getUserToken: () => 'test-token' };
    // Reproduce la respuesta real de `action=children`: el proxy excluye los
    // párrafos y solo devuelve bloques estructurales.
    service._fetchWithRetry = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    });
    const contentBlocks = [{
      id: 'block-1',
      type: 'bulleted_list_item',
      has_children: false,
      bulleted_list_item: { rich_text: [linkedText()] }
    }];
    service.fetchBlocks = jest.fn().mockResolvedValue(contentBlocks);
    service.fetchPageInfo = jest.fn().mockResolvedValue({
      properties: {
        Name: {
          type: 'title',
          title: [{ plain_text: 'Monstruos y criaturas' }]
        }
      }
    });

    const children = await service.fetchChildPages(ROOT_ID);

    expect(children).toEqual([]);
    expect(service.fetchBlocks).not.toHaveBeenCalled();
    expect(service.fetchPageInfo).not.toHaveBeenCalled();
  });

  it('mantiene hermanos estructurales aunque uno enlace al otro', async () => {
    const service = new NotionService();
    const blocksByPage = {
      [ROOT_ID]: [{
        id: 'root-content',
        type: 'paragraph',
        has_children: false,
        paragraph: {
          rich_text: [{ type: 'text', text: { content: 'Intro' }, plain_text: 'Intro' }]
        }
      }],
      [LINKED_ID]: [{
        id: 'sibling-link',
        type: 'paragraph',
        has_children: false,
        paragraph: { rich_text: [{ ...linkedText('Abrir hermano'), href: `https://app.notion.com/p/Sibling-${NESTED_ID.replace(/-/g, '')}`, text: { content: 'Abrir hermano', link: { url: `https://app.notion.com/p/Sibling-${NESTED_ID.replace(/-/g, '')}` } } }] }
      }],
      [NESTED_ID]: [{
        id: 'sibling-content',
        type: 'paragraph',
        has_children: false,
        paragraph: {
          rich_text: [{ type: 'text', text: { content: 'Sibling content' }, plain_text: 'Sibling content' }]
        }
      }],
      [CHILD_ID]: [{
        id: 'child-content',
        type: 'paragraph',
        has_children: false,
        paragraph: {
          rich_text: [{ type: 'text', text: { content: 'Child content' }, plain_text: 'Child content' }]
        }
      }]
    };

    service.storageService = { getUserToken: () => 'test-token' };
    service._fetchWithRetry = jest.fn(async url => {
      const requestedId = new URL(url, 'https://gm-vault.test').searchParams.get('pageId');
      const results = requestedId === ROOT_ID
        ? [
            { id: LINKED_ID, type: 'child_page', has_children: true, child_page: { title: 'Section A' } },
            { id: NESTED_ID, type: 'child_page', has_children: false, child_page: { title: 'Sibling B' } }
          ]
        : requestedId === LINKED_ID
          ? [{ id: CHILD_ID, type: 'child_page', has_children: false, child_page: { title: 'Child A1' } }]
          : [];
      return { ok: true, json: async () => ({ results }) };
    });
    service.fetchBlocks = jest.fn(async id => blocksByPage[id] || []);
    service._getMentionedPageInfo = jest.fn().mockResolvedValue({
      id: NESTED_ID,
      title: 'Sibling B',
      url: `https://www.notion.so/Sibling-B-${NESTED_ID.replace(/-/g, '')}`,
      parentDbId: null,
      parentDbTitle: null
    });

    const { config, stats } = await service.generateVaultFromPage(
      ROOT_ID,
      'Bajo el Hielo Carmesí'
    );

    const rootItems = config.categories[0].items;
    expect(rootItems.map(item => [item.type, item.name])).toEqual([
      ['page', 'Bajo el Hielo Carmesí'],
      ['category', 'Section A'],
      ['page', 'Sibling B']
    ]);
    expect(rootItems[1].items.map(item => [item.type, item.name])).toEqual([
      ['page', 'Section A'],
      ['page', 'Child A1']
    ]);
    expect(JSON.stringify(rootItems[1])).not.toContain('Sibling B');
    expect(JSON.stringify(config).match(/Sibling B/g)).toHaveLength(1);
    expect(stats.pagesImported).toBe(4);
    expect(service._getMentionedPageInfo).not.toHaveBeenCalled();
  });

  it('evita ciclos en bloques estructurales link_to_page', async () => {
    const service = new NotionService();
    service.fetchChildPages = jest.fn(async id => {
      if (id === ROOT_ID) {
        return [{ id: LINKED_ID, title: 'Monstruos y criaturas', type: 'link_to_page' }];
      }
      return [{ id: ROOT_ID, title: 'Bajo el Hielo Carmesí', type: 'link_to_page' }];
    });
    service.hasRealContent = jest.fn().mockResolvedValue(true);
    service.fetchBlocks = jest.fn().mockResolvedValue([]);

    const { config, stats } = await service.generateVaultFromPage(
      ROOT_ID,
      'Bajo el Hielo Carmesí'
    );

    expect(service.fetchChildPages).toHaveBeenCalledTimes(2);
    expect(stats.pagesImported).toBe(2);
    expect(config.categories[0].name).toBe('Bajo el Hielo Carmesí');
    expect(JSON.stringify(config).match(/Monstruos y criaturas/g)).toHaveLength(2);
  });
});
