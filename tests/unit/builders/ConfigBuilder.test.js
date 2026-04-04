/**
 * @fileoverview Tests unitarios para ConfigBuilder
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConfigBuilder } from '../../../js/builders/ConfigBuilder.js';

describe('ConfigBuilder', () => {
  describe('constructor', () => {
    it('debe crear builder con config vacía', () => {
      const builder = new ConfigBuilder();
      const config = builder.build();
      expect(config.categories).toEqual([]);
    });

    it('debe crear builder con config por defecto', () => {
      const builder = ConfigBuilder.createDefault();
      const config = builder.build();
      expect(config.categories.length).toBeGreaterThan(0);
    });
  });

  describe('addCategory', () => {
    it('debe añadir categoría raíz', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addCategory('Locations')
        .build();

      expect(config.categories).toHaveLength(2);
      expect(config.categories[0].name).toBe('NPCs');
      expect(config.categories[1].name).toBe('Locations');
    });
  });

  describe('addPage', () => {
    it('debe añadir página a categoría', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://notion.so/gandalf')
        .build();

      expect(config.categories[0].pages).toHaveLength(1);
      expect(config.categories[0].pages[0].name).toBe('Gandalf');
    });

    it('debe añadir página con opciones', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://notion.so/gandalf', {
          visibleToPlayers: true,
          blockTypes: ['quote']
        })
        .build();

      const page = config.categories[0].pages[0];
      expect(page.visibleToPlayers).toBe(true);
      expect(page.blockTypes).toEqual(['quote']);
    });
  });

  describe('updatePage', () => {
    it('debe actualizar página existente', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://notion.so/gandalf')
        .updatePage(['NPCs'], 0, { name: 'Gandalf the Grey' })
        .build();

      expect(config.categories[0].pages[0].name).toBe('Gandalf the Grey');
    });

    it('debe actualizar visibilidad', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://notion.so/gandalf')
        .updatePage(['NPCs'], 0, { visibleToPlayers: true })
        .build();

      expect(config.categories[0].pages[0].visibleToPlayers).toBe(true);
    });
  });

  describe('removePage', () => {
    it('debe eliminar página', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://...')
        .addPage(['NPCs'], 'Frodo', 'https://...')
        .removePage(['NPCs'], 0)
        .build();

      expect(config.categories[0].pages).toHaveLength(1);
      expect(config.categories[0].pages[0].name).toBe('Frodo');
    });
  });

  describe('setPageVisibility', () => {
    it('debe cambiar visibilidad de página', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://...')
        .setPageVisibility(['NPCs'], 0, true)
        .build();

      expect(config.categories[0].pages[0].visibleToPlayers).toBe(true);
    });
  });

  describe('setCategoryVisibility', () => {
    it('debe cambiar visibilidad de todas las páginas', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://...')
        .addPage(['NPCs'], 'Frodo', 'https://...')
        .setCategoryVisibility(['NPCs'], true)
        .build();

      expect(config.categories[0].pages[0].visibleToPlayers).toBe(true);
      expect(config.categories[0].pages[1].visibleToPlayers).toBe(true);
    });
  });

  describe('addSubcategory', () => {
    it('debe añadir subcategoría', () => {
      const config = new ConfigBuilder()
        .addCategory('Characters')
        .addSubcategory(['Characters'], 'NPCs')
        .addPage(['Characters', 'NPCs'], 'Gandalf', 'https://...')
        .build();

      expect(config.categories[0].categories).toHaveLength(1);
      expect(config.categories[0].categories[0].name).toBe('NPCs');
      expect(config.categories[0].categories[0].pages[0].name).toBe('Gandalf');
    });
  });

  describe('removeCategory', () => {
    it('debe eliminar categoría raíz', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addCategory('Locations')
        .removeCategory(['NPCs'])
        .build();

      expect(config.categories).toHaveLength(1);
      expect(config.categories[0].name).toBe('Locations');
    });

    it('debe eliminar subcategoría', () => {
      const config = new ConfigBuilder()
        .addCategory('Characters')
        .addSubcategory(['Characters'], 'NPCs')
        .addSubcategory(['Characters'], 'Players')
        .removeCategory(['Characters', 'NPCs'])
        .build();

      expect(config.categories[0].categories).toHaveLength(1);
      expect(config.categories[0].categories[0].name).toBe('Players');
    });
  });

  describe('reorderPage', () => {
    it('debe reordenar páginas', () => {
      const config = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'A', 'https://...')
        .addPage(['NPCs'], 'B', 'https://...')
        .addPage(['NPCs'], 'C', 'https://...')
        .reorderPage(['NPCs'], 0, 2)
        .build();

      expect(config.categories[0].pages[0].name).toBe('B');
      expect(config.categories[0].pages[1].name).toBe('C');
      expect(config.categories[0].pages[2].name).toBe('A');
    });
  });

  describe('toJSON', () => {
    it('debe exportar como JSON', () => {
      const json = new ConfigBuilder()
        .addCategory('NPCs')
        .addPage(['NPCs'], 'Gandalf', 'https://notion.so/gandalf', {
          visibleToPlayers: true
        })
        .toJSON();

      expect(json.categories).toHaveLength(1);
      expect(json.categories[0].pages[0].visibleToPlayers).toBe(true);
    });
  });

  describe('fromJSON', () => {
    it('debe crear builder desde JSON', () => {
      const json = {
        categories: [
          { name: 'NPCs', pages: [{ name: 'Gandalf', url: 'https://...' }] }
        ]
      };

      const config = ConfigBuilder.fromJSON(json)
        .addPage(['NPCs'], 'Frodo', 'https://...')
        .build();

      expect(config.categories[0].pages).toHaveLength(2);
    });
  });
});

