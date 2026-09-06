/**
 * @fileoverview Punto de entrada principal de GM Vault
 * 
 * Este archivo inicializa la aplicación y conecta todos los módulos.
 * NOTA: Este es el nuevo punto de entrada modular. El index.js original
 * se mantiene como backup durante la migración.
 */

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { ExtensionController } from './controllers/ExtensionController.js?v=20260906-8';
import { initTheme } from './utils/themeManager.js';
import { escapeHtml } from './utils/htmlSecurity.js?v=20260722-4';

// Instancia global del controlador
let extensionController = null;

const BUILD_VERSION = '2.1.0-beta.2';
console.log('🚀 GM Vault: Cargando módulos... v' + BUILD_VERSION);

// Esperar a que OBR SDK esté listo
try {
  OBR.onReady(async () => {
    console.log('✅ OBR SDK listo, inicializando GM Vault...');
    
    try {
      // Aplicar tema de OBR antes de renderizar la UI
      await initTheme(OBR);
      
      // Crear controlador
      extensionController = new ExtensionController();
      
      // Inicializar con OBR SDK (ya está listo)
      await extensionController.init(OBR, {
        pagesContainer: '#page-list',
        contentContainer: '#notion-content'
      });
      
      console.log('✅ GM Vault inicializado correctamente');
    } catch (e) {
      console.error('❌ Error iniciando GM Vault:', e);
      
      // Mostrar error en la UI
      const container = document.getElementById('page-list');
      if (container) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🚨</div>
            <p class="empty-state-text">Error loading extension</p>
            <p class="empty-state-hint">${escapeHtml(e.message)}</p>
            <button onclick="window.location.reload()">Retry</button>
          </div>
        `;
      }
    }
  });
} catch (error) {
  console.error('❌ Error crítico al cargar OBR SDK:', error);
}

// Limpiar al cerrar
window.addEventListener('beforeunload', () => {
  if (extensionController) {
    extensionController.cleanup();
  }
});

// Exponer controlador globalmente para debugging
window.gmVault = {
  getController: () => extensionController,
  getConfig: () => extensionController?.getConfig(),
  clearRoomMetadata: async () => {
    if (extensionController) {
      return await extensionController.clearRoomMetadata();
    }
    return false;
  },
  clearVaultOwner: async () => {
    if (extensionController?.storageService) {
      const result = await extensionController.storageService.clearVaultOwner();
      if (result) {
        console.log('✅ Vault owner limpiado. Recarga la página para aplicar cambios.');
      }
      return result;
    }
    return false;
  },
  getVaultOwner: async () => {
    if (extensionController?.storageService) {
      return await extensionController.storageService.getVaultOwner();
    }
    return null;
  },
  // Limpiar caché de página específica o todo el caché de pageInfo
  clearPageInfoCache: (pageId = null) => {
    const prefix = 'gm-vault-notion-page-info-';
    if (pageId) {
      localStorage.removeItem(prefix + pageId);
      console.log(`✅ Caché de pageInfo limpiado para: ${pageId}`);
    } else {
      // Limpiar todo el caché de pageInfo
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      keys.forEach(k => localStorage.removeItem(k));
      console.log(`✅ Limpiado caché de pageInfo: ${keys.length} entradas`);
    }
  },
  // Limpiar todo el caché de Notion
  clearAllNotionCache: () => {
    const prefixes = ['gm-vault-notion-blocks-', 'gm-vault-notion-page-info-', 'gm-vault-notion-html-'];
    let total = 0;
    prefixes.forEach(prefix => {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      keys.forEach(k => localStorage.removeItem(k));
      total += keys.length;
    });
    console.log(`✅ Limpiado todo el caché de Notion: ${total} entradas`);
  },
  version: BUILD_VERSION
};
