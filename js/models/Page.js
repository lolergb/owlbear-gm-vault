/**
 * @fileoverview Modelo de Página
 * 
 * Representa una página de contenido (Notion, Google Docs, imagen, etc.)
 * Este modelo es independiente del framework y puede ser serializado a JSON.
 */

import { extractNotionPageId, isNotionUrl, isDemoHtmlFile } from '../utils/helpers.js';

/**
 * Genera un ID único para páginas
 * @returns {string}
 */
function generatePageId() {
  // Usar crypto.randomUUID si está disponible, sino fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `page_${crypto.randomUUID().slice(0, 8)}`;
  }
  // Fallback para entornos sin crypto.randomUUID
  return `page_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Clase que representa una página de contenido
 */
export class Page {
  /**
   * @param {string} name - Nombre de la página
   * @param {string} url - URL de la página (puede ser null si hay htmlContent)
   * @param {Object} options - Opciones adicionales
   * @param {string} [options.id] - ID único (se genera automáticamente si no se proporciona)
   * @param {boolean} [options.visibleToPlayers=false] - Si está visible para jugadores
   * @param {string[]} [options.blockTypes] - Tipos de bloques a filtrar (Notion)
   * @param {Object} [options.icon] - Icono de la página
   * @param {string} [options.linkedTokenId] - ID del token vinculado
   * @param {string} [options.htmlContent] - HTML pre-renderizado (local-first, sin URL)
   */
  constructor(name, url, options = {}) {
    this.id = options.id || generatePageId();
    this.name = name;
    this.url = url;
    this.visibleToPlayers = options.visibleToPlayers || false;
    this.blockTypes = options.blockTypes || null;
    this.icon = options.icon || null;
    this.linkedTokenId = options.linkedTokenId || null;
    this.htmlContent = options.htmlContent || null;
  }

  /**
   * Obtiene el ID de página de Notion (si aplica)
   * Para content-demo devuelve null ya que no son páginas de Notion reales
   * @returns {string|null}
   */
  getNotionPageId() {
    // Content-demo no tiene pageId de Notion
    if (this.isDemoHtmlFile()) return null;
    return extractNotionPageId(this.url);
  }

  /**
   * Verifica si esta página es de Notion real
   * @returns {boolean}
   */
  isNotionPage() {
    if (!this.url) return false;
    return isNotionUrl(this.url);
  }

  /**
   * Verifica si esta página es un archivo HTML de demo (content-demo)
   * Estos se renderizan con estilo Notion pero son archivos HTML estáticos
   * @returns {boolean}
   */
  isDemoHtmlFile() {
    return isDemoHtmlFile(this.url);
  }

  /**
   * Verifica si debe mostrarse con estilo Notion (Notion real o demo)
   * @returns {boolean}
   */
  isNotionStyle() {
    if (!this.url) return false;
    return isNotionUrl(this.url) || isDemoHtmlFile(this.url);
  }

  /**
   * Verifica si esta página es un documento de Google
   * @returns {boolean}
   */
  isGoogleDoc() {
    return this.url && (
      this.url.includes('docs.google.com') ||
      this.url.includes('drive.google.com')
    );
  }

  /**
   * Verifica si esta página es una imagen
   * @returns {boolean}
   */
  isImage() {
    if (!this.url) return false;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const lowercaseUrl = this.url.toLowerCase();
    return imageExtensions.some(ext => lowercaseUrl.includes(ext));
  }

  /**
   * Verifica si esta página es un video
   * @returns {boolean}
   */
  isVideo() {
    if (!this.url) return false;
    return this.url.includes('youtube.com') || 
           this.url.includes('youtu.be') || 
           this.url.includes('vimeo.com') ||
           this.url.includes('.mp4');
  }

  /**
   * Verifica si esta página tiene HTML embebido (local-first)
   * @returns {boolean}
   */
  hasEmbeddedHtml() {
    return !!this.htmlContent;
  }

  /**
   * Obtiene el tipo de contenido de la página
   * @returns {'embedded-html'|'notion'|'google-doc'|'image'|'video'|'external'}
   */
  getContentType() {
    if (this.hasEmbeddedHtml()) return 'embedded-html';
    if (this.isNotionPage()) return 'notion';
    if (this.isGoogleDoc()) return 'google-doc';
    if (this.isImage()) return 'image';
    if (this.isVideo()) return 'video';
    return 'external';
  }

  /**
   * Crea una copia de la página
   * @param {boolean} keepId - Si true, mantiene el mismo ID; si false, genera uno nuevo
   * @returns {Page}
   */
  clone(keepId = false) {
    return new Page(this.name, this.url, {
      id: keepId ? this.id : undefined, // undefined genera nuevo ID
      visibleToPlayers: this.visibleToPlayers,
      blockTypes: this.blockTypes ? [...this.blockTypes] : null,
      icon: this.icon ? { ...this.icon } : null,
      linkedTokenId: this.linkedTokenId,
      htmlContent: this.htmlContent
    });
  }

  /**
   * Serializa la página a un objeto JSON plano
   * @returns {Object}
   */
  toJSON() {
    const json = {
      id: this.id,
      name: this.name
    };

    // URL puede ser null si hay htmlContent
    if (this.url) {
      json.url = this.url;
    }

    if (this.visibleToPlayers) {
      json.visibleToPlayers = true;
    }

    if (this.blockTypes && this.blockTypes.length > 0) {
      json.blockTypes = this.blockTypes;
    }

    if (this.icon) {
      json.icon = this.icon;
    }

    if (this.linkedTokenId) {
      json.linkedTokenId = this.linkedTokenId;
    }

    // HTML embebido (local-first)
    if (this.htmlContent) {
      json.htmlContent = this.htmlContent;
    }

    return json;
  }

  /**
   * Crea una Page desde un objeto JSON plano
   * Si no tiene ID (config legacy), se genera uno automáticamente
   * @param {Object} json - Objeto JSON
   * @returns {Page}
   */
  static fromJSON(json) {
    return new Page(json.name, json.url || null, {
      id: json.id, // Si no existe, el constructor genera uno nuevo
      visibleToPlayers: json.visibleToPlayers,
      blockTypes: json.blockTypes,
      icon: json.icon,
      linkedTokenId: json.linkedTokenId,
      htmlContent: json.htmlContent
    });
  }
}

export default Page;

