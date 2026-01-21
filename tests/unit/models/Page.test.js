/**
 * @fileoverview Tests unitarios para el modelo Page
 */

import { describe, it, expect } from '@jest/globals';
import { Page } from '../../../js/models/Page.js';

describe('Page Model', () => {
  describe('constructor', () => {
    it('debe crear una página con nombre y URL', () => {
      const page = new Page('Test Page', 'https://notion.so/page');
      expect(page.name).toBe('Test Page');
      expect(page.url).toBe('https://notion.so/page');
    });

    it('debe tener valores por defecto correctos', () => {
      const page = new Page('Test', 'https://example.com');
      expect(page.visibleToPlayers).toBe(false);
      expect(page.blockTypes).toBeNull();
      expect(page.icon).toBeNull();
      expect(page.linkedTokenId).toBeNull();
    });

    it('debe aceptar opciones adicionales', () => {
      const page = new Page('Test', 'https://example.com', {
        visibleToPlayers: true,
        blockTypes: ['quote', 'callout'],
        icon: { type: 'emoji', emoji: '📄' },
        linkedTokenId: 'token-123'
      });
      
      expect(page.visibleToPlayers).toBe(true);
      expect(page.blockTypes).toEqual(['quote', 'callout']);
      expect(page.icon).toEqual({ type: 'emoji', emoji: '📄' });
      expect(page.linkedTokenId).toBe('token-123');
    });

    it('debe aceptar htmlContent (local-first, sin URL)', () => {
      const page = new Page('Obsidian Page', null, {
        htmlContent: '<div class="notion-content"><h1>Title</h1></div>',
        visibleToPlayers: true
      });
      
      expect(page.name).toBe('Obsidian Page');
      expect(page.url).toBeNull();
      expect(page.htmlContent).toBe('<div class="notion-content"><h1>Title</h1></div>');
      expect(page.visibleToPlayers).toBe(true);
      expect(page.hasEmbeddedHtml()).toBe(true);
      expect(page.getContentType()).toBe('embedded-html');
    });

    it('debe funcionar con URL y htmlContent (ambos presentes)', () => {
      // Caso edge: tiene ambos, htmlContent tiene prioridad
      const page = new Page('Hybrid Page', 'https://notion.so/page', {
        htmlContent: '<div>Embedded</div>'
      });
      
      expect(page.url).toBe('https://notion.so/page');
      expect(page.htmlContent).toBe('<div>Embedded</div>');
      expect(page.hasEmbeddedHtml()).toBe(true);
      expect(page.isNotionPage()).toBe(true);
      // getContentType prioriza htmlContent
      expect(page.getContentType()).toBe('embedded-html');
    });
  });

  describe('isNotionPage', () => {
    it('debe detectar URLs de notion.so', () => {
      const page = new Page('Test', 'https://www.notion.so/Page-abc123');
      expect(page.isNotionPage()).toBe(true);
    });

    it('debe detectar URLs de notion.site', () => {
      const page = new Page('Test', 'https://workspace.notion.site/Page-abc123');
      expect(page.isNotionPage()).toBe(true);
    });

    it('debe rechazar otras URLs', () => {
      const page = new Page('Test', 'https://example.com/page');
      expect(page.isNotionPage()).toBe(false);
    });
  });

  describe('isGoogleDoc', () => {
    it('debe detectar Google Docs', () => {
      const page = new Page('Test', 'https://docs.google.com/document/d/123');
      expect(page.isGoogleDoc()).toBe(true);
    });

    it('debe rechazar otras URLs', () => {
      const page = new Page('Test', 'https://notion.so/page');
      expect(page.isGoogleDoc()).toBe(false);
    });
  });

  describe('isImage', () => {
    it('debe detectar imágenes JPG', () => {
      const page = new Page('Test', 'https://example.com/image.jpg');
      expect(page.isImage()).toBe(true);
    });

    it('debe detectar imágenes PNG', () => {
      const page = new Page('Test', 'https://example.com/image.png');
      expect(page.isImage()).toBe(true);
    });

    it('debe rechazar otras URLs', () => {
      const page = new Page('Test', 'https://example.com/page.html');
      expect(page.isImage()).toBe(false);
    });
  });

  describe('isVideo', () => {
    it('debe detectar YouTube', () => {
      const page = new Page('Test', 'https://www.youtube.com/watch?v=123');
      expect(page.isVideo()).toBe(true);
    });

    it('debe detectar Vimeo', () => {
      const page = new Page('Test', 'https://vimeo.com/123');
      expect(page.isVideo()).toBe(true);
    });

    it('debe rechazar otras URLs', () => {
      const page = new Page('Test', 'https://example.com/page');
      expect(page.isVideo()).toBe(false);
    });
  });

  describe('hasEmbeddedHtml', () => {
    it('debe detectar páginas con htmlContent', () => {
      const page = new Page('Test', null, {
        htmlContent: '<div>Content from Obsidian</div>'
      });
      expect(page.hasEmbeddedHtml()).toBe(true);
    });

    it('debe retornar false para páginas sin htmlContent', () => {
      const page = new Page('Test', 'https://notion.so/page');
      expect(page.hasEmbeddedHtml()).toBe(false);
    });

    it('debe retornar false para htmlContent vacío', () => {
      const page = new Page('Test', 'https://example.com', {
        htmlContent: ''
      });
      expect(page.hasEmbeddedHtml()).toBe(false);
    });

    it('debe funcionar junto con URL (prioridad htmlContent)', () => {
      const page = new Page('Test', 'https://notion.so/page', {
        htmlContent: '<div>Embedded content</div>'
      });
      // Tiene ambos, pero hasEmbeddedHtml tiene prioridad en getContentType
      expect(page.hasEmbeddedHtml()).toBe(true);
      expect(page.isNotionPage()).toBe(true);
      expect(page.getContentType()).toBe('embedded-html');
    });
  });

  describe('getContentType', () => {
    it('debe retornar "embedded-html" para páginas con htmlContent', () => {
      const page = new Page('Test', null, {
        htmlContent: '<div>Content from Obsidian</div>'
      });
      expect(page.getContentType()).toBe('embedded-html');
    });

    it('debe retornar "embedded-html" con prioridad sobre Notion', () => {
      // Si tiene ambos, htmlContent tiene prioridad
      const page = new Page('Test', 'https://notion.so/page', {
        htmlContent: '<div>Embedded content</div>'
      });
      expect(page.getContentType()).toBe('embedded-html');
    });

    it('debe retornar "notion" para páginas de Notion', () => {
      const page = new Page('Test', 'https://notion.so/page');
      expect(page.getContentType()).toBe('notion');
    });

    it('debe retornar "google-doc" para Google Docs', () => {
      const page = new Page('Test', 'https://docs.google.com/document/d/123');
      expect(page.getContentType()).toBe('google-doc');
    });

    it('debe retornar "image" para imágenes', () => {
      const page = new Page('Test', 'https://example.com/image.png');
      expect(page.getContentType()).toBe('image');
    });

    it('debe retornar "video" para videos', () => {
      const page = new Page('Test', 'https://youtube.com/watch?v=123');
      expect(page.getContentType()).toBe('video');
    });

    it('debe retornar "external" para otras URLs', () => {
      const page = new Page('Test', 'https://example.com/page');
      expect(page.getContentType()).toBe('external');
    });
  });

  describe('getNotionPageId', () => {
    it('debe extraer el ID de una URL de Notion', () => {
      const page = new Page('Test', 'https://www.notion.so/Page-abc123def456789012345678901234ab');
      const pageId = page.getNotionPageId();
      expect(pageId).toBe('abc123de-f456-7890-1234-5678901234ab');
    });

    it('debe retornar null para URLs no-Notion', () => {
      const page = new Page('Test', 'https://example.com/page');
      expect(page.getNotionPageId()).toBeNull();
    });
  });

  describe('clone', () => {
    it('debe crear una copia independiente', () => {
      const original = new Page('Test', 'https://notion.so/page', {
        visibleToPlayers: true,
        blockTypes: ['quote']
      });
      
      const cloned = original.clone();
      
      expect(cloned.name).toBe(original.name);
      expect(cloned.url).toBe(original.url);
      expect(cloned.visibleToPlayers).toBe(original.visibleToPlayers);
      expect(cloned.blockTypes).toEqual(original.blockTypes);
      
      // Modificar clon no debe afectar original
      cloned.name = 'Modified';
      cloned.blockTypes.push('callout');
      
      expect(original.name).toBe('Test');
      expect(original.blockTypes).toEqual(['quote']);
    });

    it('debe clonar htmlContent correctamente', () => {
      const original = new Page('Test', null, {
        htmlContent: '<div>Content from Obsidian</div>',
        visibleToPlayers: true
      });
      
      const cloned = original.clone();
      
      expect(cloned.name).toBe(original.name);
      expect(cloned.url).toBe(original.url);
      expect(cloned.htmlContent).toBe(original.htmlContent);
      expect(cloned.visibleToPlayers).toBe(original.visibleToPlayers);
      expect(cloned.hasEmbeddedHtml()).toBe(true);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('debe serializar y deserializar correctamente', () => {
      const original = new Page('Test', 'https://notion.so/page', {
        visibleToPlayers: true,
        blockTypes: ['quote', 'callout'],
        icon: { type: 'emoji', emoji: '📄' }
      });
      
      const json = original.toJSON();
      const restored = Page.fromJSON(json);
      
      expect(restored.name).toBe(original.name);
      expect(restored.url).toBe(original.url);
      expect(restored.visibleToPlayers).toBe(original.visibleToPlayers);
      expect(restored.blockTypes).toEqual(original.blockTypes);
      expect(restored.icon).toEqual(original.icon);
    });

    it('debe serializar y deserializar htmlContent correctamente', () => {
      const original = new Page('Obsidian Page', null, {
        htmlContent: '<div class="notion-content"><h1>Title</h1><p>Content</p></div>',
        visibleToPlayers: true,
        icon: { type: 'emoji', emoji: '📔' }
      });
      
      const json = original.toJSON();
      
      // Verificar JSON
      expect(json.name).toBe('Obsidian Page');
      expect(json.url).toBeUndefined(); // No debe incluir url si es null
      expect(json.htmlContent).toBe(original.htmlContent);
      expect(json.visibleToPlayers).toBe(true);
      expect(json.icon).toEqual({ type: 'emoji', emoji: '📔' });
      
      // Verificar restauración
      const restored = Page.fromJSON(json);
      
      expect(restored.name).toBe(original.name);
      expect(restored.url).toBeNull();
      expect(restored.htmlContent).toBe(original.htmlContent);
      expect(restored.visibleToPlayers).toBe(original.visibleToPlayers);
      expect(restored.icon).toEqual(original.icon);
      expect(restored.hasEmbeddedHtml()).toBe(true);
      expect(restored.getContentType()).toBe('embedded-html');
    });

    it('debe omitir propiedades vacías en toJSON', () => {
      const page = new Page('Test', 'https://example.com');
      const json = page.toJSON();
      
      // Debe incluir id, name y url
      expect(json.id).toBeDefined();
      expect(json.name).toBe('Test');
      expect(json.url).toBe('https://example.com');
      
      // Propiedades opcionales no deben estar presentes si están vacías
      expect(json.visibleToPlayers).toBeUndefined();
      expect(json.blockTypes).toBeUndefined();
      expect(json.icon).toBeUndefined();
      expect(json.linkedTokenId).toBeUndefined();
      expect(json.htmlContent).toBeUndefined();
    });

    it('debe manejar página solo con htmlContent (sin URL)', () => {
      const page = new Page('Local Page', null, {
        htmlContent: '<p>Local content</p>'
      });
      const json = page.toJSON();
      
      // URL no debe estar presente
      expect(json.url).toBeUndefined();
      expect(json.htmlContent).toBe('<p>Local content</p>');
      
      // Restaurar y verificar
      const restored = Page.fromJSON(json);
      expect(restored.url).toBeNull();
      expect(restored.htmlContent).toBe('<p>Local content</p>');
    });
  });
});

