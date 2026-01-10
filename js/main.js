/**
 * @fileoverview Punto de entrada principal de GM Vault
 * 
 * Este archivo inicializa la aplicación y conecta todos los módulos.
 * NOTA: Este es el nuevo punto de entrada modular. El index.js original
 * se mantiene como backup durante la migración.
 */

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { ExtensionController } from './controllers/ExtensionController.js';

// Instancia global del controlador
let extensionController = null;

const BUILD_VERSION = '2.0.1-' + Date.now();
console.log('🚀 GM Vault: Cargando módulos... v' + BUILD_VERSION);

// Esperar a que OBR SDK esté listo
try {
  OBR.onReady(async () => {
    console.log('✅ OBR SDK listo, inicializando GM Vault...');
    
    try {
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
            <p class="empty-state-hint">${e.message}</p>
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
  version: '2.0.0-modular'
};

