/**
 * @fileoverview Servicio para interactuar con Google Drive API
 * 
 * Permite seleccionar una carpeta y generar el vault automáticamente
 * basándose en la estructura de carpetas y documentos en Drive.
 */

import { log, logError } from '../utils/logger.js';

/**
 * Servicio para interactuar con Google Drive
 */
export class GoogleDriveService {
  constructor() {
    // Referencia a OBR (se inyecta)
    this.OBR = null;
    // API Key de Google (se configura)
    this.apiKey = null;
    // Client ID para OAuth (se configura)
    this.clientId = null;
    // Token de acceso OAuth
    this.accessToken = null;
    // ID de la carpeta seleccionada
    this.selectedFolderId = null;
    // Google Picker API cargada
    this.pickerApiLoaded = false;
    // Google API client cargado
    this.gapiLoaded = false;
  }

  /**
   * Inyecta la referencia a OBR SDK
   * @param {Object} obr - Referencia al SDK
   */
  setOBR(obr) {
    this.OBR = obr;
  }

  /**
   * Configura las credenciales de Google
   * @param {string} apiKey - API Key de Google
   * @param {string} clientId - Client ID de OAuth
   */
  setCredentials(apiKey, clientId) {
    this.apiKey = apiKey;
    this.clientId = clientId;
  }

  /**
   * Carga las APIs de Google necesarias
   * @returns {Promise<void>}
   */
  async loadGoogleAPIs() {
    if (this.pickerApiLoaded && this.gapiLoaded) {
      return;
    }

    // Cargar Google API Client primero
    if (!window.gapi) {
      await this._loadScript('https://apis.google.com/js/api.js');
    }

    return new Promise((resolve, reject) => {
      // Cargar Picker API usando gapi.load
      if (!this.pickerApiLoaded) {
        window.gapi.load('picker', () => {
          // Verificar que Google Picker esté disponible
          if (!window.google || !window.google.picker) {
            reject(new Error('Google Picker API no está disponible después de cargar'));
            return;
          }
          this.pickerApiLoaded = true;
          log('✅ Google Picker API cargada');
          this._loadGapiClient().then(() => {
            this.gapiLoaded = true;
            resolve();
          }).catch(reject);
        });
      } else {
        this._loadGapiClient().then(() => {
          this.gapiLoaded = true;
          resolve();
        }).catch(reject);
      }
    });
  }

  /**
   * Carga un script dinámicamente
   * @param {string} src - URL del script
   * @returns {Promise<void>}
   * @private
   */
  _loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar si ya está cargado
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Error cargando script: ${src}`));
      document.head.appendChild(script);
    });
  }

  /**
   * Carga el cliente de Google API
   * @private
   */
  async _loadGapiClient() {
    // Verificar que las credenciales estén configuradas
    if (!this.apiKey || !this.clientId) {
      throw new Error('Credenciales de Google no configuradas. Por favor, configura API Key y Client ID.');
    }

    return new Promise((resolve, reject) => {
      window.gapi.load('client:auth2', async () => {
        try {
          await window.gapi.client.init({
            apiKey: this.apiKey,
            clientId: this.clientId,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
            scope: 'https://www.googleapis.com/auth/drive.readonly'
          });
          log('✅ Google API Client inicializado');
          resolve();
        } catch (error) {
          logError('Error inicializando Google API Client:', error);
          reject(error);
        }
      });
    });
  }

  /**
   * Autentica al usuario con Google
   * @returns {Promise<string>} - Token de acceso
   */
  async authenticate() {
    try {
      await this.loadGoogleAPIs();
      
      // Verificar que gapi.auth2 esté disponible
      if (!window.gapi || !window.gapi.auth2) {
        throw new Error('Google Auth2 no está disponible. Asegúrate de que las credenciales estén configuradas.');
      }
      
      const authInstance = window.gapi.auth2.getAuthInstance();
      if (!authInstance) {
        throw new Error('No se pudo obtener la instancia de autenticación. Verifica las credenciales.');
      }
      
      const user = await authInstance.signIn();
      this.accessToken = user.getAuthResponse().access_token;
      log('✅ Autenticado con Google Drive');
      return this.accessToken;
    } catch (error) {
      logError('Error en autenticación:', error);
      throw error;
    }
  }

  /**
   * Abre el selector de Google Drive para seleccionar una carpeta
   * @returns {Promise<string>} - ID de la carpeta seleccionada
   */
  async selectFolder() {
    try {
      await this.loadGoogleAPIs();
      
      // Verificar que Google Picker esté disponible
      if (!window.google || !window.google.picker) {
        throw new Error('Google Picker API no está disponible');
      }
      
      if (!this.accessToken) {
        await this.authenticate();
      }

      return new Promise((resolve, reject) => {
        const picker = new window.google.picker.PickerBuilder()
          .setOAuthToken(this.accessToken)
          .setDeveloperKey(this.apiKey)
          .setCallback((data) => {
            if (data[window.google.picker.Response.ACTION] === window.google.picker.Action.PICKED) {
              const folder = data[window.google.picker.Response.DOCUMENTS][0];
              this.selectedFolderId = folder.id;
              log(`✅ Carpeta seleccionada: ${folder.name} (${folder.id})`);
              resolve(folder.id);
            } else if (data[window.google.picker.Response.ACTION] === window.google.picker.Action.CANCEL) {
              reject(new Error('Selección cancelada'));
            }
          })
          .addView(window.google.picker.ViewId.FOLDERS)
          .setSelectableMimeTypes('application/vnd.google-apps.folder')
          .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
          .build();
        
        picker.setVisible(true);
      });
    } catch (error) {
      logError('Error seleccionando carpeta:', error);
      throw error;
    }
  }

  /**
   * Lista recursivamente el contenido de una carpeta
   * @param {string} folderId - ID de la carpeta
   * @param {string} [folderName] - Nombre de la carpeta (para logging)
   * @returns {Promise<Object>} - Estructura con carpetas y archivos
   */
  async listFolderContents(folderId, folderName = 'root') {
    try {
      log(`📁 Listando contenido de: ${folderName} (${folderId})`);
      
      // Verificar que el cliente esté inicializado
      if (!window.gapi || !window.gapi.client || !window.gapi.client.drive) {
        throw new Error('Google API Client no está inicializado. Asegúrate de que las credenciales estén configuradas.');
      }
      
      const response = await window.gapi.client.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, webViewLink, webContentLink)',
        pageSize: 1000
      });

      const items = response.result.files || [];
      const folders = [];
      const files = [];

      for (const item of items) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          folders.push(item);
        } else {
          files.push(item);
        }
      }

      log(`  📂 ${folders.length} carpetas, 📄 ${files.length} archivos`);

      const result = {
        folders: [],
        files: files.map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          url: f.webViewLink || f.webContentLink
        }))
      };

      // Procesar subcarpetas recursivamente
      for (const folder of folders) {
        const subfolderContents = await this.listFolderContents(folder.id, folder.name);
        result.folders.push({
          id: folder.id,
          name: folder.name,
          mimeType: folder.mimeType,
          contents: subfolderContents
        });
      }

      return result;
    } catch (error) {
      logError(`Error listando carpeta ${folderName}:`, error);
      throw error;
    }
  }

  /**
   * Genera la configuración del vault desde la estructura de Drive
   * @param {string} folderId - ID de la carpeta raíz
   * @returns {Promise<Object>} - Configuración en formato del vault
   */
  async generateVaultFromFolder(folderId) {
    try {
      log('🔄 Generando vault desde Google Drive...');
      
      const structure = await this.listFolderContents(folderId, 'GM vault');
      
      // Convertir estructura de Drive a formato del vault
      const config = this._convertDriveStructureToVault(structure);
      
      log(`✅ Vault generado: ${config.categories.length} categorías raíz`);
      return config;
    } catch (error) {
      logError('Error generando vault:', error);
      throw error;
    }
  }

  /**
   * Convierte la estructura de Drive al formato del vault
   * @param {Object} structure - Estructura de Drive
   * @returns {Object} - Configuración del vault
   * @private
   */
  _convertDriveStructureToVault(structure) {
    const categories = [];

    // Procesar carpetas
    for (const folder of structure.folders || []) {
      const category = {
        name: folder.name,
        pages: [],
        categories: []
      };

      // Procesar archivos directamente en esta carpeta
      if (folder.contents && folder.contents.files) {
        for (const file of folder.contents.files) {
          if (this._isSupportedFileType(file.mimeType)) {
            category.pages.push({
              name: file.name,
              url: file.url || this._generateFileUrl(file.id, file.mimeType),
              visibleToPlayers: false
            });
          }
        }
      }

      // Procesar subcarpetas recursivamente
      if (folder.contents) {
        const subVault = this._convertDriveStructureToVault(folder.contents);
        category.categories = subVault.categories;
        // Los archivos de la raíz de subcarpetas (si no hay subcarpetas) se añaden a pages
        if (subVault.categories.length === 0 && subVault.pages && subVault.pages.length > 0) {
          category.pages.push(...subVault.pages);
        }
      }

      categories.push(category);
    }

    // Procesar archivos en la raíz (si no están dentro de carpetas)
    const rootPages = [];
    if (structure.files) {
      for (const file of structure.files) {
        if (this._isSupportedFileType(file.mimeType)) {
          rootPages.push({
            name: file.name,
            url: file.url || this._generateFileUrl(file.id, file.mimeType),
            visibleToPlayers: false
          });
        }
      }
    }

    return {
      categories,
      pages: rootPages
    };
  }

  /**
   * Verifica si un tipo de archivo es soportado
   * @param {string} mimeType - Tipo MIME del archivo
   * @returns {boolean}
   * @private
   */
  _isSupportedFileType(mimeType) {
    const supportedTypes = [
      'application/vnd.google-apps.document', // Google Docs
      'application/vnd.google-apps.spreadsheet', // Google Sheets
      'application/vnd.google-apps.presentation', // Google Slides
      'application/pdf', // PDFs
      'text/plain', // Texto plano
      'text/html' // HTML
    ];
    return supportedTypes.includes(mimeType);
  }

  /**
   * Genera la URL de un archivo de Google Drive
   * @param {string} fileId - ID del archivo
   * @param {string} mimeType - Tipo MIME
   * @returns {string}
   * @private
   */
  _generateFileUrl(fileId, mimeType) {
    if (mimeType === 'application/vnd.google-apps.document') {
      return `https://docs.google.com/document/d/${fileId}/edit`;
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      return `https://docs.google.com/presentation/d/${fileId}/edit`;
    } else {
      return `https://drive.google.com/file/d/${fileId}/view`;
    }
  }
}
