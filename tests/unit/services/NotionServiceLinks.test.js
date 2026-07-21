import { describe, expect, it, jest } from '@jest/globals';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { NotionRenderer } from '../../../js/renderers/NotionRenderer.js';
import { NotionService } from '../../../js/services/NotionService.js';

const ROOT_ID = '3a3d4856-c90e-8019-9267-dff41d1609a1';
const A_ID = '3a3d4856-c90e-812c-abe5-d9dd50ed3333';
const B_ID = '4b4d4856-c90e-812c-abe5-d9dd50ed4444';
const GROUP_ID = '5c5d4856-c90e-812c-abe5-d9dd50ed5555';
const A1_ID = '6d6d4856-c90e-812c-abe5-d9dd50ed6666';
const DATABASE_ID = '7e7d4856-c90e-812c-abe5-d9dd50ed7777';
const GOBLIN_ID = '8f8d4856-c90e-812c-abe5-d9dd50ed8888';
const OGRE_ID = '9a9d4856-c90e-812c-abe5-d9dd50ed9999';

function childPage(id, title, hasChildren = false) {
  return {
    id,
    type: 'child_page',
    has_children: hasChildren,
    child_page: { title }
  };
}

function linkToPage(id) {
  return {
    id: `link-${id}`,
    type: 'link_to_page',
    has_children: false,
    link_to_page: { type: 'page_id', page_id: id }
  };
}

function linkToDatabase(id) {
  return {
    id: `link-db-${id}`,
    type: 'link_to_page',
    has_children: false,
    link_to_page: { type: 'database_id', database_id: id }
  };
}

function childDatabase(id, title) {
  return {
    id,
    type: 'child_database',
    has_children: true,
    child_database: { title }
  };
}

function paragraph(richText) {
  return {
    id: 'paragraph',
    type: 'paragraph',
    has_children: false,
    paragraph: { rich_text: richText }
  };
}

function plainText(value) {
  return { type: 'text', text: { content: value }, plain_text: value };
}

function pageMention(id, title) {
  return {
    type: 'mention',
    mention: { type: 'page', page: { id } },
    plain_text: title
  };
}

function createService({ childrenByPage = {}, blocksByPage = {}, databasePages = [] } = {}) {
  const service = new NotionService();
  service.storageService = { getUserToken: () => 'test-token' };
  service._fetchWithRetry = jest.fn(async url => {
    const request = new URL(url, 'https://gm-vault.test');
    const pageId = request.searchParams.get('pageId');
    return {
      ok: true,
      json: async () => ({ results: childrenByPage[pageId] || [] })
    };
  });
  service.fetchBlocks = jest.fn(async id => blocksByPage[id] || []);
  service.fetchDatabasePages = jest.fn().mockResolvedValue(databasePages);
  service.fetchPageInfo = jest.fn().mockResolvedValue({ properties: {} });
  return service;
}

function collectPagePaths(config) {
  const paths = [];

  const visit = (items = [], parent = []) => {
    for (const item of items) {
      const path = [...parent, item.name];
      if (item.type === 'page') paths.push(path.join('/'));
      if (item.type === 'category') visit(item.items, path);
    }
  };

  for (const category of config.categories || []) {
    visit(category.items, [category.name]);
  }
  for (const page of config.pages || []) {
    paths.push(page.name);
  }

  return paths;
}

describe('NotionService hierarchy and internal navigation', () => {
  it('ignora link_to_page de página y base de datos al calcular hijos', async () => {
    const service = createService({
      childrenByPage: {
        [ROOT_ID]: [
          linkToPage(B_ID),
          linkToDatabase(DATABASE_ID),
          childPage(A_ID, 'A')
        ]
      }
    });

    await expect(service.fetchChildPages(ROOT_ID)).resolves.toEqual([
      expect.objectContaining({ id: A_ID, title: 'A', type: 'child_page' })
    ]);
    expect(service.fetchPageInfo).not.toHaveBeenCalled();
    expect(service.fetchDatabasePages).not.toHaveBeenCalled();
  });

  it('mantiene B bajo su padre real aunque A contenga link_to_page hacia B', async () => {
    const service = createService({
      childrenByPage: {
        [ROOT_ID]: [
          childPage(A_ID, 'A'),
          childPage(GROUP_ID, 'Group', true)
        ],
        [A_ID]: [linkToPage(B_ID)],
        [GROUP_ID]: [childPage(B_ID, 'B')]
      },
      blocksByPage: {
        [ROOT_ID]: [],
        [A_ID]: [linkToPage(B_ID)],
        [GROUP_ID]: [],
        [B_ID]: [paragraph([plainText('B content')])]
      }
    });

    const { config, stats } = await service.generateVaultFromPage(ROOT_ID, 'Root');

    expect(collectPagePaths(config)).toEqual([
      'Root/A',
      'Root/Group/B'
    ]);
    expect(stats.pagesImported).toBe(2);
    expect(service.fetchPageInfo).not.toHaveBeenCalled();
  });

  it('no vuelve a insertar la raíz dentro de una página que la enlaza', async () => {
    const service = createService({
      childrenByPage: {
        [ROOT_ID]: [childPage(GROUP_ID, 'One-Shot ES')],
        [GROUP_ID]: [linkToPage(ROOT_ID)]
      },
      blocksByPage: {
        [ROOT_ID]: [paragraph([plainText('Root content')])],
        [GROUP_ID]: [
          paragraph([pageMention(ROOT_ID, 'Bajo el Hielo Carmesí')]),
          linkToPage(ROOT_ID)
        ]
      }
    });

    const { config, stats } = await service.generateVaultFromPage(ROOT_ID, 'Root');
    const serialized = JSON.stringify(config);
    const rootUrlId = ROOT_ID.replace(/-/g, '');

    expect(collectPagePaths(config)).toEqual(['Root/Root', 'Root/One-Shot ES']);
    expect(serialized.split(rootUrlId)).toHaveLength(2);
    expect(stats.pagesImported).toBe(2);
  });

  it('no duplica ni mueve B cuando A contiene una @mention hacia B', async () => {
    const service = createService({
      childrenByPage: {
        [ROOT_ID]: [
          childPage(A_ID, 'A', true),
          childPage(B_ID, 'B')
        ],
        [A_ID]: [childPage(A1_ID, 'A1')]
      },
      blocksByPage: {
        [ROOT_ID]: [],
        [A_ID]: [paragraph([plainText('See '), pageMention(B_ID, 'B')])],
        [A1_ID]: [paragraph([plainText('A1 content')])],
        [B_ID]: [paragraph([plainText('B content')])]
      }
    });

    const { config, stats } = await service.generateVaultFromPage(ROOT_ID, 'Root');
    const paths = collectPagePaths(config);

    expect(paths).toEqual([
      'Root/A/A',
      'Root/A/A1',
      'Root/B'
    ]);
    expect(paths.filter(path => path.endsWith('/B'))).toHaveLength(1);
    expect(JSON.stringify(config.categories[0].items[0])).not.toContain('"name":"B"');
    expect(stats.pagesImported).toBe(3);
  });

  it('mantiene hermanos estructurales y resuelve un href entre ellos al renderizar', async () => {
    const targetUrl = `https://app.notion.com/p/B-${B_ID.replace(/-/g, '')}`;
    const internalLink = {
      type: 'text',
      text: { content: 'Open B', link: { url: targetUrl } },
      plain_text: 'Open B',
      href: targetUrl,
      annotations: {}
    };
    const service = createService({
      childrenByPage: {
        [ROOT_ID]: [childPage(A_ID, 'A'), childPage(B_ID, 'B')]
      },
      blocksByPage: {
        [ROOT_ID]: [],
        [A_ID]: [paragraph([internalLink])],
        [B_ID]: [paragraph([plainText('B content')])]
      }
    });

    const { config: generatedConfig } = await service.generateVaultFromPage(ROOT_ID, 'Root');
    const config = new ConfigParser().parse(generatedConfig);
    const renderer = new NotionRenderer();
    renderer.setDependencies({ config, isGM: true });

    expect(collectPagePaths(generatedConfig)).toEqual(['Root/A', 'Root/B']);
    expect(renderer.renderRichText([internalLink])).toContain(
      `data-mention-page-id="${B_ID}"`
    );
  });

  it('mantiene visible una página cuyo único contenido es navegación', async () => {
    const mentionService = createService({
      blocksByPage: {
        [A_ID]: [paragraph([pageMention(B_ID, 'B')])]
      }
    });
    const linkBlockService = createService({
      blocksByPage: {
        [A_ID]: [linkToPage(B_ID)]
      }
    });

    await expect(mentionService.hasRealContent(A_ID)).resolves.toBe(true);
    await expect(linkBlockService.hasRealContent(A_ID)).resolves.toBe(true);
  });

  it('conserva todas las filas de una child_database aunque tengan relations', async () => {
    const databasePages = [
      {
        id: GOBLIN_ID,
        title: 'Goblin',
        url: `https://www.notion.so/Goblin-${GOBLIN_ID.replace(/-/g, '')}`,
        labels: ['NPC'],
        properties: {
          Related: { type: 'relation', relation: [{ id: OGRE_ID }] }
        }
      },
      {
        id: OGRE_ID,
        title: 'Ogre',
        url: `https://www.notion.so/Ogre-${OGRE_ID.replace(/-/g, '')}`,
        labels: [],
        properties: {}
      }
    ];
    const service = createService({
      childrenByPage: {
        [ROOT_ID]: [
          childDatabase(DATABASE_ID, 'Bestiary'),
          childPage(GROUP_ID, 'NPCs', true)
        ],
        [GROUP_ID]: [childPage(A1_ID, 'A1')]
      },
      blocksByPage: {
        [ROOT_ID]: [],
        [GROUP_ID]: [],
        [A1_ID]: [paragraph([plainText('A1 content')])]
      },
      databasePages
    });

    const { config, stats } = await service.generateVaultFromPage(ROOT_ID, 'Root');

    expect(collectPagePaths(config)).toEqual([
      'Root/Bestiary/Goblin',
      'Root/Bestiary/Ogre',
      'Root/NPCs/A1'
    ]);
    expect(stats.pagesImported).toBe(3);
    expect(service.fetchDatabasePages).toHaveBeenCalledTimes(1);
  });

  it('conserva la carpeta de una child_database aunque se llame como su página padre', async () => {
    const service = createService({
      childrenByPage: {
        [ROOT_ID]: [childDatabase(DATABASE_ID, 'Root')]
      },
      blocksByPage: { [ROOT_ID]: [] },
      databasePages: [{
        id: GOBLIN_ID,
        title: 'Goblin',
        url: `https://www.notion.so/Goblin-${GOBLIN_ID.replace(/-/g, '')}`,
        labels: []
      }]
    });

    const { config } = await service.generateVaultFromPage(ROOT_ID, 'Root');

    expect(collectPagePaths(config)).toEqual(['Root/Root/Goblin']);
  });
});
