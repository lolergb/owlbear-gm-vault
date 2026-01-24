/**
 * @fileoverview Servicio para interactuar con Google Drive API
 * 
 * Permite autenticarse con Google, listar carpetas y generar el vault
 * basándose en la estructura de carpetas y documentos en Drive.
 */

import { log, logError, logWarn } from '../utils/logger.js';

/**
 * Servicio para interactuar con Google Drive
 */
export class GoogleDriveService {
  constructor() {
    // Referencia a OBR (se inyecta)
    this.OBR = null;
    // Token de acceso OAuth 2.0 (almacenado solo en memoria, NO en localStorage)
    this.accessToken = null;
    // Timestamp de expiración del token (si está disponible)
    this.tokenExpiresAt = null;
    // ID de la carpeta seleccionada
    this.selectedFolderId = null;
    // Google API client cargado
    this.gapiLoaded = false;
    // Google Identity Services cargado
    this.gisLoaded = false;
    // Token client de Google Identity Services
    this.tokenClient = null;
  }

  /**
   * Inyecta la referencia a OBR SDK
   * @param {Object} obr - Referencia al SDK
   */
  setOBR(obr) {
    this.OBR = obr;
  }

  /**
   * Carga Google Identity Services y Google API Client
   * @returns {Promise<void>}
   */
  async loadGoogleAPIs() {
    if (this.gapiLoaded && this.gisLoaded) {
      return;
    }

    // Cargar Google Identity Services
    if (!window.google || !window.google.accounts) {
      await this._loadScript('https://accounts.google.com/gsi/client');
      this.gisLoaded = true;
      log('✅ Google Identity Services cargado');
    }

    // Cargar Google API Client
    if (!window.gapi) {
      await this._loadScript('https://apis.google.com/js/api.js');
    }

    return new Promise((resolve, reject) => {
      window.gapi.load('client', async () => {
        try {
          // Inicializar el cliente sin Client ID (lo obtendremos del token directamente)
          await window.gapi.client.init({
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
          });
          
          this.gapiLoaded = true;
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
   * Inicia sesión con Google usando OAuth 2.0 Token Model
   * Implementa el flujo de OAuth 2.0 para aplicaciones JavaScript del lado del cliente
   * según la documentación oficial: https://developers.google.com/identity/protocols/oauth2
   * 
   * Usa Google Identity Services con initTokenClient() que es el método recomendado
   * para aplicaciones JavaScript. No requiere client secret, solo Client ID.
   * 
   * @param {string} clientId - Client ID de Google OAuth (obtenido del usuario)
   * @returns {Promise<string>} - Token de acceso OAuth 2.0
   */
  async signInWithGoogle(clientId = null) {
    try {
      await this.loadGoogleAPIs();

      if (!window.google || !window.google.accounts) {
        throw new Error('Google Identity Services no está disponible');
      }

      // Obtener Client ID de localStorage si no se proporciona
      if (!clientId) {
        clientId = localStorage.getItem('google_drive_client_id');
        
        if (!clientId) {
          throw new Error('Client ID no configurado. Por favor, configura tu Client ID de Google OAuth.');
        }
      }

      // Usar Google Identity Services Token Model (recomendado por Google)
      // Documentación: https://developers.google.com/identity/oauth2/web/guides/use-token-model
      return new Promise((resolve, reject) => {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: (response) => {
            if (response.error) {
              logError('Error en autenticación OAuth 2.0:', response.error);
              reject(new Error(response.error));
              return;
            }
            // El access token se obtiene directamente del callback
            // No se necesita client secret para aplicaciones JavaScript
            // IMPORTANTE: El token se almacena solo en memoria (this.accessToken)
            // NO se guarda en localStorage por seguridad (requisito del proyecto)
            this.accessToken = response.access_token;
            
            // Guardar información del token si está disponible (para refresh si es necesario)
            // Los tokens OAuth 2.0 típicamente expiran en 1 hora
            if (response.expires_in) {
              this.tokenExpiresAt = Date.now() + (response.expires_in * 1000);
              log(`⏰ Token expira en ${Math.round(response.expires_in / 60)} minutos`);
            }
            
            // Si hay refresh token, guardarlo (aunque en el flujo implícito puede no estar disponible)
            // Nota: El flujo implícito de OAuth 2.0 para JavaScript no siempre proporciona refresh tokens
            // Si el token expira, el usuario necesitará autenticarse de nuevo
            
            // Configurar el token en el cliente de Google API una vez
            // Esto hará que todas las peticiones futuras incluyan el token automáticamente
            // en el header Authorization: Bearer <token>
            if (window.gapi && window.gapi.client) {
              window.gapi.client.setToken({ access_token: this.accessToken });
            }
            
            log('✅ Autenticado con Google Drive usando OAuth 2.0');
            log(`✅ Token de acceso obtenido (expira en ${response.expires_in || 'desconocido'} segundos)`);
            resolve(this.accessToken);
          }
        });
        
        // Solicitar token de acceso (abre ventana de autenticación de Google)
        this.tokenClient.requestAccessToken();
      });
    } catch (error) {
      logError('Error iniciando sesión con Google:', error);
      throw error;
    }
  }

  /**
   * Lista todas las carpetas de nivel superior (top-level) del usuario en Google Drive
   * Solo retorna carpetas que están directamente en "Mi unidad" (no en subcarpetas)
   * 
   * Usa el access token OAuth 2.0 para autenticar las peticiones a la API.
   * El token se envía automáticamente en el header Authorization: Bearer <token>
   * según la especificación OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
   * 
   * @returns {Promise<Array>} - Array de carpetas de nivel superior {id, name}
   */
  async listTopLevelFolders() {
    try {
      if (!this.accessToken) {
        throw new Error('No estás autenticado. Inicia sesión primero.');
      }

      // Verificar que el token no haya expirado
      if (!this._isTokenValid()) {
        throw new Error('El token de acceso ha expirado. Por favor, inicia sesión de nuevo.');
      }

      // Asegurar que el token esté configurado
      if (window.gapi && window.gapi.client) {
        window.gapi.client.setToken({ access_token: this.accessToken });
      }

      // Listar solo carpetas de nivel superior (que no tienen padre o están en "root")
      // 'root' in parents significa que están directamente en "Mi unidad"
      const response = await window.gapi.client.drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents",
        fields: 'files(id, name, mimeType)',
        pageSize: 1000,
        orderBy: 'name'
      });

      if (!response.result || !response.result.files) {
        logWarn('No se encontraron carpetas en la respuesta');
        return [];
      }

      const folders = response.result.files.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType
      }));

      log(`✅ ${folders.length} carpetas de nivel superior encontradas`);
      return folders;
    } catch (error) {
      logError('Error listando carpetas de nivel superior:', error);
      
      // Manejo específico de errores de API
      if (error.status === 401 || error.status === 403) {
        throw new Error('Error de autenticación. El token puede haber expirado. Por favor, inicia sesión de nuevo.');
      } else if (error.status === 429) {
        throw new Error('Demasiadas peticiones. Por favor, espera un momento e intenta de nuevo.');
      } else if (error.message) {
        throw error;
      } else {
        throw new Error(`Error desconocido al listar carpetas: ${error.status || 'unknown'}`);
      }
    }
  }

  /**
   * Verifica si el token de acceso es válido
   * @returns {boolean}
   * @private
   */
  _isTokenValid() {
    if (!this.accessToken) {
      return false;
    }
    
    // Si tenemos información de expiración, verificar
    if (this.tokenExpiresAt) {
      const now = Date.now();
      // Considerar expirado si falta menos de 1 minuto
      if (now >= (this.tokenExpiresAt - 60000)) {
        logWarn('⚠️ El token de acceso está próximo a expirar o ha expirado');
        return false;
      }
    }
    
    return true;
  }

  /**
   * Limpia el token de acceso de la memoria
   * Útil para cerrar sesión o en caso de error
   */
  clearToken() {
    this.accessToken = null;
    this.tokenExpiresAt = null;
    if (window.gapi && window.gapi.client) {
      window.gapi.client.setToken(null);
    }
    log('🔒 Token de acceso limpiado de la memoria');
  }

  /**
   * Lista todos los archivos dentro de una carpeta específica
   * Itera a través de todos los archivos (no subcarpetas) en la carpeta
   * 
   * @param {string} folderId - ID de la carpeta
   * @param {string} [folderName] - Nombre de la carpeta (para logging)
   * @returns {Promise<Array>} - Array de archivos {id, name, mimeType, url}
   */
  async listFilesInFolder(folderId, folderName = 'unknown') {
    try {
      log(`📁 Listando archivos en: ${folderName} (${folderId})`);
      
      if (!this.accessToken) {
        throw new Error('No estás autenticado. Inicia sesión primero.');
      }

      if (!this._isTokenValid()) {
        throw new Error('El token de acceso ha expirado. Por favor, inicia sesión de nuevo.');
      }

      // Asegurar que el token esté configurado
      if (window.gapi && window.gapi.client) {
        window.gapi.client.setToken({ access_token: this.accessToken });
      }
      
      // Listar solo archivos (no carpetas) dentro de esta carpeta
      const response = await window.gapi.client.drive.files.list({
        q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
        fields: 'files(id, name, mimeType, webViewLink, webContentLink)',
        pageSize: 1000,
        orderBy: 'name'
      });

      if (!response.result || !response.result.files) {
        log(`  📄 0 archivos encontrados en ${folderName}`);
        return [];
      }

      const files = response.result.files.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        url: f.webViewLink || f.webContentLink || this._generateFileUrl(f.id, f.mimeType)
      }));

      log(`  📄 ${files.length} archivos encontrados en ${folderName}`);
      return files;
    } catch (error) {
      logError(`Error listando archivos en carpeta ${folderName}:`, error);
      
      // Manejo específico de errores
      if (error.status === 401 || error.status === 403) {
        throw new Error('Error de autenticación al listar archivos. El token puede haber expirado.');
      } else if (error.status === 404) {
        throw new Error('Carpeta no encontrada. Puede que no tengas permisos para acceder a ella.');
      } else if (error.message) {
        throw error;
      } else {
        throw new Error(`Error desconocido al listar archivos: ${error.status || 'unknown'}`);
      }
    }
  }

  /**
   * Lista recursivamente el contenido de una carpeta (carpetas y archivos)
   * @param {string} folderId - ID de la carpeta
   * @param {string} [folderName] - Nombre de la carpeta (para logging)
   * @returns {Promise<Object>} - Estructura con carpetas y archivos
   */
  async listFolderContents(folderId, folderName = 'root') {
    try {
      log(`📁 Listando contenido de: ${folderName} (${folderId})`);
      
      if (!this.accessToken) {
        throw new Error('No estás autenticado');
      }

      if (!this._isTokenValid()) {
        throw new Error('El token de acceso ha expirado. Por favor, inicia sesión de nuevo.');
      }

      // Asegurar que el token esté configurado
      if (window.gapi && window.gapi.client) {
        window.gapi.client.setToken({ access_token: this.accessToken });
      }
      
      // Llamar a Google Drive API - el token se envía automáticamente
      const response = await window.gapi.client.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, webViewLink, webContentLink)',
        pageSize: 1000,
        orderBy: 'name'
      });

      if (!response.result || !response.result.files) {
        log(`  📂 0 carpetas, 📄 0 archivos en ${folderName}`);
        return { folders: [], files: [] };
      }

      const items = response.result.files;
      const folders = [];
      const files = [];

      // Separar carpetas y archivos
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
          url: f.webViewLink || f.webContentLink || this._generateFileUrl(f.id, f.mimeType)
        }))
      };

      // Procesar subcarpetas recursivamente
      for (const folder of folders) {
        try {
          const subfolderContents = await this.listFolderContents(folder.id, folder.name);
          result.folders.push({
            id: folder.id,
            name: folder.name,
            mimeType: folder.mimeType,
            contents: subfolderContents
          });
        } catch (subfolderError) {
          logError(`Error procesando subcarpeta ${folder.name}:`, subfolderError);
          // Continuar con otras carpetas aunque una falle
        }
      }

      return result;
    } catch (error) {
      logError(`Error listando carpeta ${folderName}:`, error);
      
      // Manejo específico de errores
      if (error.status === 401 || error.status === 403) {
        throw new Error('Error de autenticación. El token puede haber expirado.');
      } else if (error.status === 404) {
        throw new Error('Carpeta no encontrada.');
      } else if (error.message) {
        throw error;
      } else {
        throw new Error(`Error desconocido: ${error.status || 'unknown'}`);
      }
    }
  }

  /**
   * Genera la configuración del vault desde todas las carpetas de nivel superior
   * Itera a través de cada carpeta y sus archivos para crear el vault completo
   * 
   * @returns {Promise<Object>} - Configuración en formato del vault compatible con Notion
   */
  async generateVaultFromAllFolders() {
    try {
      log('🔄 Generando vault desde todas las carpetas de Google Drive...');
      
      // Obtener todas las carpetas de nivel superior
      const topLevelFolders = await this.listTopLevelFolders();
      
      if (!topLevelFolders || topLevelFolders.length === 0) {
        logWarn('⚠️ No se encontraron carpetas de nivel superior');
        return { categories: [], pages: [] };
      }

      const categories = [];
      
      // Iterar a través de cada carpeta de nivel superior
      for (const folder of topLevelFolders) {
        try {
          log(`📂 Procesando carpeta: ${folder.name}`);
          
          // Obtener todos los archivos dentro de esta carpeta
          const files = await this.listFilesInFolder(folder.id, folder.name);
          
          // Obtener estructura completa (incluyendo subcarpetas) para esta carpeta
          const folderStructure = await this.listFolderContents(folder.id, folder.name);
          
          // Convertir esta carpeta a una categoría del vault
          const category = this._convertFolderToCategory(folder, folderStructure);
          categories.push(category);
          
          log(`✅ Carpeta "${folder.name}" procesada: ${category.pages.length} páginas, ${category.categories.length} subcategorías`);
        } catch (folderError) {
          logError(`Error procesando carpeta ${folder.name}:`, folderError);
          // Continuar con otras carpetas aunque una falle
          continue;
        }
      }
      
      const config = {
        categories,
        pages: [] // Archivos de nivel superior (si los hay)
      };
      
      log(`✅ Vault generado: ${config.categories.length} categorías principales`);
      return config;
    } catch (error) {
      logError('Error generando vault desde todas las carpetas:', error);
      throw error;
    }
  }

  /**
   * Genera la configuración del vault desde una carpeta específica
   * @param {string} folderId - ID de la carpeta raíz
   * @returns {Promise<Object>} - Configuración en formato del vault
   */
  async generateVaultFromFolder(folderId) {
    try {
      log('🔄 Generando vault desde carpeta específica de Google Drive...');
      
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
   * Convierte una carpeta y su estructura a una categoría del vault
   * @param {Object} folder - Objeto de carpeta {id, name, mimeType}
   * @param {Object} structure - Estructura completa de la carpeta
   * @returns {Object} - Categoría en formato del vault
   * @private
   */
  _convertFolderToCategory(folder, structure) {
    const category = {
      name: folder.name,
      pages: [],
      categories: []
    };

    // Procesar archivos directamente en esta carpeta
    if (structure.files && structure.files.length > 0) {
      for (const file of structure.files) {
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
    if (structure.folders && structure.folders.length > 0) {
      for (const subfolder of structure.folders) {
        const subCategory = this._convertFolderToCategory(subfolder, subfolder.contents || {});
        category.categories.push(subCategory);
      }
    }

    return category;
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
