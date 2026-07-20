import { describe, expect, it, jest } from '@jest/globals';
import { NotionService } from '../../../js/services/NotionService.js';

const ROOT_ID = '3a3d4856-c90e-8019-9267-dff41d1609a1';
const LINKED_ID = '3a3d4856-c90e-812c-abe5-d9dd50ed3333';
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
  it('extrae enlaces internos normales además de mentions', async () => {
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
      text: 'Monstruos y criaturas'
    }]);
  });

  it('trata una lista de enlaces internos como navegación', () => {
    const service = new NotionService();
    const richText = [linkedText()];

    expect(service._hasOnlyMentions(richText)).toBe(true);
    expect(service._hasRealTextContent(richText)).toBe(false);
  });

  it('extrae enlaces internos de propiedades de bases de datos', () => {
    const service = new NotionService();
    const mentions = service._extractMentionsFromPageProperties({
      Notes: { type: 'rich_text', rich_text: [linkedText()] }
    });

    expect(mentions).toEqual([{
      pageId: LINKED_ID,
      text: 'Monstruos y criaturas'
    }]);
  });

  it('convierte rich_text.href en páginas hijas recorribles', async () => {
    const service = new NotionService();
    service.storageService = { getUserToken: () => 'test-token' };
    service._fetchWithRetry = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          id: 'block-1',
          type: 'bulleted_list_item',
          has_children: false,
          bulleted_list_item: { rich_text: [linkedText()] }
        }]
      })
    });
    service.fetchPageInfo = jest.fn().mockResolvedValue({
      properties: {
        Name: {
          type: 'title',
          title: [{ plain_text: 'Monstruos y criaturas' }]
        }
      }
    });

    const children = await service.fetchChildPages(ROOT_ID);

    expect(children).toEqual([expect.objectContaining({
      id: LINKED_ID,
      title: 'Monstruos y criaturas',
      type: 'linked_text_page'
    })]);
  });

  it('evita ciclos al recorrer enlaces internos recursivamente', async () => {
    const service = new NotionService();
    service.fetchChildPages = jest.fn(async id => {
      if (id === ROOT_ID) {
        return [{ id: LINKED_ID, title: 'Monstruos y criaturas', type: 'linked_text_page' }];
      }
      return [{ id: ROOT_ID, title: 'Bajo el Hielo Carmesí', type: 'linked_text_page' }];
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
