/**
 * @fileoverview Tests unitarios para ConfigParser
 */

import { describe, it, expect } from '@jest/globals';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';

describe('ConfigParser', () => {
  let parser;

  beforeEach(() => {
    parser = new ConfigParser();
  });

  describe('parse', () => {
    it('debe parsear configuración válida', () => {
      const json = {
        categories: [
          {
            name: 'NPCs',
            pages: [
              { name: 'Gandalf', url: 'https://notion.so/gandalf' }
            ]
          }
        ]
      };

      const config = parser.parse(json);

      expect(config.categories).toHaveLength(1);
      expect(config.categories[0].name).toBe('NPCs');
      expect(config.categories[0].pages).toHaveLength(1);
      expect(config.categories[0].pages[0].name).toBe('Gandalf');
    });

    it('debe retornar config vacía para JSON nulo', () => {
      const config = parser.parse(null);
      expect(config.categories).toEqual([]);
    });

    it('debe parsear categorías anidadas', () => {
      const json = {
        categories: [
          {
            name: 'Characters',
            categories: [
              {
                name: 'NPCs',
                pages: [{ name: 'Test', url: 'https://...' }]
              }
            ]
          }
        ]
      };

      const config = parser.parse(json);
      
      expect(config.categories[0].categories).toHaveLength(1);
      expect(config.categories[0].categories[0].name).toBe('NPCs');
    });

    it('debe parsear opciones de página', () => {
      const json = {
        categories: [
          {
            name: 'Test',
            pages: [
              {
                name: 'Page',
                url: 'https://notion.so/page',
                visibleToPlayers: true,
                blockTypes: ['quote', 'callout']
              }
            ]
          }
        ]
      };

      const config = parser.parse(json);
      const page = config.categories[0].pages[0];
      
      expect(page.visibleToPlayers).toBe(true);
      expect(page.blockTypes).toEqual(['quote', 'callout']);
    });
  });

  describe('validate', () => {
    it('debe validar configuración correcta', () => {
      const json = {
        categories: [
          { name: 'Test', pages: [{ name: 'Page', url: 'https://...' }] }
        ]
      };

      const result = parser.validate(json);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('debe detectar configuración nula', () => {
      const result = parser.validate(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('This backup is empty.');
    });

    it('debe detectar categories faltante', () => {
      const result = parser.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('This file is missing its folder list.');
    });

    it('debe detectar página sin nombre', () => {
      const json = {
        categories: [
          { name: 'Test', pages: [{ url: 'https://...' }] }
        ]
      };

      const result = parser.validate(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing a name'))).toBe(true);
    });

    it('debe detectar página sin URL', () => {
      const json = {
        categories: [
          { name: 'Test', pages: [{ name: 'Page' }] }
        ]
      };

      const result = parser.validate(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('needs a URL'))).toBe(true);
    });

    it('debe validar también las páginas del nivel raíz', () => {
      const valid = parser.validate({
        categories: [],
        pages: [{ name: 'Root page', url: 'https://example.com/root' }]
      });
      const invalid = parser.validate({
        categories: [],
        pages: [{ name: 'Broken root page' }]
      });

      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors).toContain('Page “Broken root page” needs a URL or saved page content.');
    });

    it('debe rechazar arrays y colecciones raíz con tipos incompatibles', () => {
      expect(parser.validate([]).errors).toContain('The backup must contain a JSON object.');
      expect(parser.validate({ categories: [], pages: {} }).errors)
        .toContain('The root page list in this backup has an invalid format.');
    });

    it('debe rechazar propiedades de página con tipos que se descartarían', () => {
      const result = parser.validate({
        categories: [{
          name: 'Test',
          pages: [{
            name: 'Page',
            url: 'https://example.com',
            visibleToPlayers: 'yes',
            blockTypes: ['paragraph', 3]
          }]
        }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Page “Page” must use true or false for player visibility.');
      expect(result.errors).toContain('Page “Page” has invalid block type information.');
    });
  });

  describe('preflight', () => {
    it('resume carpetas y páginas sin modificar la configuración', () => {
      const json = {
        categories: [{
          name: 'World',
          pages: [{ name: 'Map', url: 'https://example.com/map' }],
          categories: [{
            name: 'NPCs',
            pages: [{ name: 'Innkeeper', htmlContent: '<p>Hello</p>' }]
          }]
        }],
        pages: [{ name: 'Home', url: 'https://example.com' }]
      };
      const original = JSON.parse(JSON.stringify(json));

      const result = parser.preflight(json);

      expect(result.valid).toBe(true);
      expect(result.format).toBe('legacy');
      expect(result.summary).toEqual({ categoryCount: 2, pageCount: 3 });
      expect(result.warnings).toEqual([]);
      expect(json).toEqual(original);
    });

    it('avisa exactamente de los campos que se descartarán', () => {
      const result = parser.preflight({
        categories: [{
          name: 'World',
          customFolderData: true,
          pages: [{
            name: 'Map',
            url: 'https://example.com/map',
            customPageData: 'ignored'
          }]
        }],
        schemaVersion: 99
      });

      expect(result.valid).toBe(true);
      expect(result.ignoredFields).toEqual([
        'schemaVersion',
        'categories[0].customFolderData',
        'categories[0].pages[0].customPageData'
      ]);
      expect(result.warnings).toContain(
        'GM Vault will import the folders and pages, but it does not recognize 3 extra details in this backup. Those details will be left out.'
      );
    });

    it('detecta items[] anidados aunque la categoría superior use categories[]', () => {
      const json = {
        categories: [{
          name: 'World',
          categories: [{
            name: 'Scenes',
            items: [{ type: 'page', name: 'Intro', url: 'https://example.com/intro' }]
          }]
        }]
      };

      expect(parser.detectFormat(json)).toBe('items');
      expect(parser.preflight(json).summary).toEqual({ categoryCount: 2, pageCount: 1 });
    });

  });

  // ============================================
  // NUEVO FORMATO: items[] + type
  // ============================================
  describe('parse - nuevo formato items[]', () => {
    it('debe parsear formato items[] con páginas', () => {
      const json = {
        categories: [
          {
            name: 'Locations',
            items: [
              { type: 'page', name: 'Overview', url: 'https://notion.so/overview' },
              { type: 'page', name: 'Map', url: 'https://notion.so/map' }
            ]
          }
        ]
      };

      const config = parser.parse(json);

      expect(config.categories).toHaveLength(1);
      expect(config.categories[0].name).toBe('Locations');
      expect(config.categories[0].pages).toHaveLength(2);
      expect(config.categories[0].pages[0].name).toBe('Overview');
      expect(config.categories[0].pages[1].name).toBe('Map');
    });

    it('debe parsear formato items[] con subcategorías', () => {
      const json = {
        categories: [
          {
            name: 'Main',
            items: [
              { type: 'category', name: 'NPCs', items: [
                { type: 'page', name: 'Gandalf', url: 'https://notion.so/gandalf' }
              ]},
              { type: 'category', name: 'Locations', items: [] }
            ]
          }
        ]
      };

      const config = parser.parse(json);

      expect(config.categories[0].categories).toHaveLength(2);
      expect(config.categories[0].categories[0].name).toBe('NPCs');
      expect(config.categories[0].categories[0].pages).toHaveLength(1);
      expect(config.categories[0].categories[1].name).toBe('Locations');
    });

    it('debe parsear formato items[] mixto (páginas y categorías intercaladas)', () => {
      const json = {
        categories: [
          {
            name: 'Adventure',
            items: [
              { type: 'page', name: 'Intro', url: 'https://notion.so/intro' },
              { type: 'category', name: 'Chapter 1', items: [
                { type: 'page', name: 'Scene 1', url: 'https://notion.so/scene1' }
              ]},
              { type: 'page', name: 'Appendix', url: 'https://notion.so/appendix' },
              { type: 'category', name: 'Chapter 2', items: [] }
            ]
          }
        ]
      };

      const config = parser.parse(json);
      const cat = config.categories[0];

      // Debe tener 2 páginas y 2 subcategorías
      expect(cat.pages).toHaveLength(2);
      expect(cat.categories).toHaveLength(2);
      
      // Y un order que preserve el orden original
      expect(cat.order).toEqual([
        { type: 'page', index: 0 },
        { type: 'category', index: 0 },
        { type: 'page', index: 1 },
        { type: 'category', index: 1 }
      ]);
    });

    it('debe parsear formato items[] con visibleToPlayers y blockTypes', () => {
      const json = {
        categories: [
          {
            name: 'Test',
            items: [
              { 
                type: 'page', 
                name: 'Visible Page', 
                url: 'https://notion.so/page',
                visibleToPlayers: true,
                blockTypes: ['quote', 'callout']
              }
            ]
          }
        ]
      };

      const config = parser.parse(json);
      const page = config.categories[0].pages[0];

      expect(page.visibleToPlayers).toBe(true);
      expect(page.blockTypes).toEqual(['quote', 'callout']);
    });

    it('debe parsear formato items[] anidado profundamente', () => {
      const json = {
        categories: [
          {
            name: 'Root',
            items: [
              { type: 'category', name: 'Level1', items: [
                { type: 'category', name: 'Level2', items: [
                  { type: 'category', name: 'Level3', items: [
                    { type: 'page', name: 'DeepPage', url: 'https://notion.so/deep' }
                  ]}
                ]}
              ]}
            ]
          }
        ]
      };

      const config = parser.parse(json);
      const deepPage = config.categories[0].categories[0].categories[0].categories[0].pages[0];

      expect(deepPage.name).toBe('DeepPage');
    });
  });

  describe('validate - nuevo formato items[]', () => {
    it('debe validar formato items[] correcto', () => {
      const json = {
        categories: [
          {
            name: 'Test',
            items: [
              { type: 'page', name: 'Page', url: 'https://...' },
              { type: 'category', name: 'Sub', items: [] }
            ]
          }
        ]
      };

      const result = parser.validate(json);
      expect(result.valid).toBe(true);
    });

    it('debe detectar item sin type', () => {
      const json = {
        categories: [
          {
            name: 'Test',
            items: [
              { name: 'NoType', url: 'https://...' }
            ]
          }
        ]
      };

      const result = parser.validate(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('type'))).toBe(true);
    });

    it('debe detectar page sin url en formato items[]', () => {
      const json = {
        categories: [
          {
            name: 'Test',
            items: [
              { type: 'page', name: 'NoUrl' }
            ]
          }
        ]
      };

      const result = parser.validate(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('URL') || e.includes('url'))).toBe(true);
    });
  });

  describe('detectFormat', () => {
    it('debe detectar formato legacy (pages[] + categories[])', () => {
      const json = {
        categories: [
          { name: 'Test', pages: [], categories: [] }
        ]
      };

      expect(parser.detectFormat(json)).toBe('legacy');
    });

    it('debe detectar formato nuevo (items[])', () => {
      const json = {
        categories: [
          { name: 'Test', items: [] }
        ]
      };

      expect(parser.detectFormat(json)).toBe('items');
    });

    it('debe retornar legacy para categorías vacías', () => {
      const json = { categories: [] };
      expect(parser.detectFormat(json)).toBe('legacy');
    });
  });

  describe('toItemsFormat', () => {
    it('debe convertir formato legacy a items[]', () => {
      const legacy = {
        categories: [
          {
            name: 'Locations',
            pages: [
              { name: 'City', url: 'https://...' }
            ],
            categories: [
              { name: 'Dungeons', pages: [], categories: [] }
            ],
            order: [
              { type: 'category', index: 0 },
              { type: 'page', index: 0 }
            ]
          }
        ]
      };

      const converted = parser.toItemsFormat(legacy);

      expect(converted.categories[0].items).toHaveLength(2);
      expect(converted.categories[0].items[0].type).toBe('category');
      expect(converted.categories[0].items[0].name).toBe('Dungeons');
      expect(converted.categories[0].items[1].type).toBe('page');
      expect(converted.categories[0].items[1].name).toBe('City');
    });

    it('debe mantener todas las propiedades de página al convertir', () => {
      const legacy = {
        categories: [
          {
            name: 'Test',
            pages: [
              { 
                name: 'Page', 
                url: 'https://...', 
                visibleToPlayers: true,
                blockTypes: ['callout'],
                icon: { type: 'emoji', emoji: '📄' }
              }
            ],
            categories: []
          }
        ]
      };

      const converted = parser.toItemsFormat(legacy);
      const page = converted.categories[0].items[0];

      expect(page.visibleToPlayers).toBe(true);
      expect(page.blockTypes).toEqual(['callout']);
      expect(page.icon).toEqual({ type: 'emoji', emoji: '📄' });
    });
  });

  describe('toLegacyFormat', () => {
    it('debe convertir formato items[] a legacy', () => {
      const itemsFormat = {
        categories: [
          {
            name: 'Adventure',
            items: [
              { type: 'page', name: 'Intro', url: 'https://...' },
              { type: 'category', name: 'Chapter 1', items: [] },
              { type: 'page', name: 'Outro', url: 'https://...' }
            ]
          }
        ]
      };

      const legacy = parser.toLegacyFormat(itemsFormat);

      expect(legacy.categories[0].pages).toHaveLength(2);
      expect(legacy.categories[0].categories).toHaveLength(1);
      expect(legacy.categories[0].order).toEqual([
        { type: 'page', index: 0 },
        { type: 'category', index: 0 },
        { type: 'page', index: 1 }
      ]);
    });
  });

  describe('migrate', () => {
    it('debe migrar campo "visible" a "visibleToPlayers"', () => {
      const json = {
        categories: [
          {
            name: 'Test',
            pages: [{ name: 'Page', url: 'https://...', visible: true }]
          }
        ]
      };

      const migrated = parser.migrate(json);
      expect(migrated.categories[0].pages[0].visibleToPlayers).toBe(true);
    });

    it('debe añadir categories si no existe', () => {
      const migrated = parser.migrate({});
      expect(migrated.categories).toEqual([]);
    });

    it('debe filtrar páginas sin URL', () => {
      const json = {
        categories: [
          {
            name: 'Test',
            pages: [
              { name: 'Valid', url: 'https://...' },
              { name: 'Invalid' }
            ]
          }
        ]
      };

      const migrated = parser.migrate(json);
      expect(migrated.categories[0].pages).toHaveLength(1);
      expect(migrated.categories[0].pages[0].name).toBe('Valid');
    });
  });
});
