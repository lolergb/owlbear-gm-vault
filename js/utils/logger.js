/**
 * @fileoverview Sistema de logging controlado para GM Vault
 * 
 * Proporciona funciones de logging que solo se activan en modo debug
 * y solo para usuarios GM (no jugadores).
 */

// Estado del modo debug
let DEBUG_MODE = false;

// Cache del rol del usuario
let cachedUserRole = null;
let roleCheckPromise = null;

// Referencia a la función para obtener token (se inyecta)
let getTokenFn = null;

// Referencia a OBR (se inyecta para evitar dependencia circular)
let OBRRef = null;

/**
 * Inyecta la referencia a OBR SDK
 * @param {Object} obr - Referencia al SDK de Owlbear Rodeo
 */
export function setOBRReference(obr) {
  OBRRef = obr;
}

/**
 * Inyecta la función para obtener el token del usuario
 * @param {Function} fn - Función que retorna el token
 */
export function setGetTokenFunction(fn) {
  getTokenFn = fn;
}

/**
 * Obtiene el rol del usuario (con caché)
 * @returns {Promise<boolean>} - true si es GM, false si es jugador
 */
export async function getUserRole() {
  if (cachedUserRole !== null) {
    return cachedUserRole;
  }
  
  if (roleCheckPromise) {
    return roleCheckPromise;
  }
  
  roleCheckPromise = (async () => {
    try {
      if (OBRRef && OBRRef.player && OBRRef.player.getRole) {
        const role = await OBRRef.player.getRole();
        cachedUserRole = role === 'GM';
        return cachedUserRole;
      }
    } catch (e) {
      // Si no se puede obtener el rol, asumir GM para no bloquear logs
      cachedUserRole = true;
      return cachedUserRole;
    }
    // Fallback: asumir GM
    cachedUserRole = true;
    return cachedUserRole;
  })();
  
  return roleCheckPromise;
}

/**
 * Inicializa el modo debug desde Netlify
 */
export async function initDebugMode() {
  try {
    // Solo intentar si estamos en Netlify
    if (window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')) {
      // Obtener el token del usuario para verificar si es tu cuenta
      const userToken = getTokenFn ? getTokenFn() : null;
      
      // Construir URL con el token si existe
      let url = '/.netlify/functions/get-debug-mode';
      if (userToken) {
        url += `?token=${encodeURIComponent(userToken)}`;
      }
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        DEBUG_MODE = data.debug === true;
        if (DEBUG_MODE) {
          log('🔍 Modo debug activado');
        }
      }
    }
  } catch (e) {
    // Si falla, usar false por defecto (logs desactivados)
    DEBUG_MODE = false;
  }
}

/**
 * Comprueba si el modo debug está activo
 * @returns {boolean}
 */
export function isDebugMode() {
  return DEBUG_MODE;
}

/**
 * Activa o desactiva el modo debug manualmente
 * @param {boolean} enabled
 */
export function setDebugMode(enabled) {
  DEBUG_MODE = enabled;
}

/**
 * Función de log que solo muestra si DEBUG_MODE está activado y es GM
 * @param {...any} args - Argumentos a loggear
 */
export function log(...args) {
  if (DEBUG_MODE) {
    // Si el rol ya está cacheado
    if (cachedUserRole === true) {
      // Es GM, mostrar log
      console.log(...args);
    } else if (cachedUserRole === false) {
      // Es jugador, no mostrar log
      return;
    } else {
      // Rol aún no verificado, verificar de forma asíncrona
      getUserRole().then(isGM => {
        if (isGM) {
          console.log(...args);
        }
      }).catch(() => {
        // Si hay error al verificar rol, no mostrar (más seguro)
      });
    }
  }
}

/**
 * Log de error - siempre se muestra
 * @param {...any} args - Argumentos a loggear
 */
export function logError(...args) {
  console.error(...args);
}

/**
 * Log de warning - siempre se muestra
 * @param {...any} args - Argumentos a loggear
 */
export function logWarn(...args) {
  console.warn(...args);
}

/**
 * Resetea el cache del rol (útil para testing)
 */
export function resetRoleCache() {
  cachedUserRole = null;
  roleCheckPromise = null;
}

