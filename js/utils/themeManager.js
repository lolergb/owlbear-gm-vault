/**
 * @fileoverview ThemeManager - Integra el tema de Owlbear Rodeo con GM Vault
 * 
 * Mapea las variables del OBR Theme a CSS custom properties,
 * derivando colores intermedios (hover, overlay, borders, tints)
 * para mantener coherencia visual con la UI de Owlbear Rodeo.
 * 
 * OBR Theme structure:
 *   mode: "DARK" | "LIGHT"
 *   primary: { light, main, dark, contrastText }
 *   secondary: { light, main, dark, contrastText }
 *   background: { default, paper }
 *   text: { primary, secondary, disabled }
 */

/**
 * Parsea cualquier formato de color CSS a componentes RGB
 * Soporta: #RGB, #RRGGBB, #RRGGBBAA, rgb(r,g,b), rgba(r,g,b,a), nombres de color
 * @param {string} color - Color en cualquier formato CSS
 * @returns {{ r: number, g: number, b: number }} Componentes RGB (0-255)
 */
function parseColor(color) {
  const fallback = { r: 150, g: 122, b: 204 }; // fallback púrpura
  if (!color || typeof color !== 'string') return fallback;
  
  const trimmed = color.trim();
  
  // Formato rgb(r, g, b) o rgba(r, g, b, a)
  const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10)
    };
  }
  
  // Formato hex: #RGB, #RRGGBB, #RRGGBBAA
  if (trimmed.startsWith('#')) {
    let h = trimmed.replace('#', '');
    
    // Expandir shorthand (#RGB → #RRGGBB)
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    
    // Ignorar canal alpha si existe (#RRGGBBAA)
    if (h.length === 8) {
      h = h.substring(0, 6);
    }
    
    const num = parseInt(h, 16);
    if (!isNaN(num)) {
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
      };
    }
  }
  
  // Fallback: usar un canvas offscreen para parsear cualquier color CSS válido
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = trimmed;
    const computed = ctx.fillStyle; // Devuelve hex normalizado
    if (computed.startsWith('#')) {
      const h = computed.replace('#', '');
      const num = parseInt(h, 16);
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
      };
    }
  } catch (e) {
    // Ignorar errores del canvas
  }
  
  return fallback;
}

/**
 * Convierte RGB a string para usar en rgba()
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {string} "r, g, b"
 */
function rgbString(rgb) {
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

/**
 * Mezcla dos colores RGB con un ratio dado
 * @param {{ r: number, g: number, b: number }} color1
 * @param {{ r: number, g: number, b: number }} color2
 * @param {number} ratio - 0 = todo color1, 1 = todo color2
 * @returns {{ r: number, g: number, b: number }}
 */
function mixColors(color1, color2, ratio) {
  return {
    r: Math.round(color1.r + (color2.r - color1.r) * ratio),
    g: Math.round(color1.g + (color2.g - color1.g) * ratio),
    b: Math.round(color1.b + (color2.b - color1.b) * ratio)
  };
}

/**
 * Genera una cadena rgb() desde componentes
 */
function rgb(r, g, b) {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Genera una cadena rgba() desde componentes
 */
function rgba(r, g, b, a) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Aplica el tema de OBR a las CSS custom properties de GM Vault
 * @param {Object} theme - Objeto Theme de OBR SDK
 * @param {string} theme.mode - "DARK" | "LIGHT"
 * @param {Object} theme.primary - { light, main, dark, contrastText }
 * @param {Object} theme.secondary - { light, main, dark, contrastText }
 * @param {Object} theme.background - { default, paper }
 * @param {Object} theme.text - { primary, secondary, disabled }
 */
export function applyOBRTheme(theme) {
  if (!theme) return;
  
  const isDark = theme.mode === 'DARK';
  const root = document.documentElement;

  // ---- Parsear colores del tema (soporta hex, rgb(), rgba()) ----
  const primaryRgb = parseColor(theme.primary.main);
  const primaryLightRgb = parseColor(theme.primary.light);
  const primaryDarkRgb = parseColor(theme.primary.dark);
  const secondaryRgb = parseColor(theme.secondary.main);
  const bgDefaultRgb = parseColor(theme.background.default);
  const bgPaperRgb = parseColor(theme.background.paper);
  const textPrimaryRgb = parseColor(theme.text.primary);
  const textSecondaryRgb = parseColor(theme.text.secondary);
  const textDisabledRgb = parseColor(theme.text.disabled);

  // ---- Derivar colores intermedios de texto ----
  // OBR usa rgba con alpha para jerarquía de texto (ej: rgba(255,255,255,0.7))
  // Muted y Hint se derivan del color base de texto con opacidad reducida
  const textMutedAlpha = isDark ? 0.5 : 0.55;
  const textHintAlpha = isDark ? 0.38 : 0.42;

  // ---- Colores de fondo ----
  // En dark mode: overlays con negro semi-transparente
  // En light mode: overlays con negro pero menor opacidad, o con el color de fondo
  const bgPrimaryAlpha = isDark ? 0.24 : 0.06;
  const bgHoverAlpha = isDark ? 0.24 : 0.08;
  const overlayAlpha = isDark ? 0.8 : 0.6;

  // ---- Tint de superficie (Material Design elevation) ----
  // Dark: leve brillo blanco encima de superficies oscuras
  // Light: no se necesita brillo (ya es claro), quizá leve sombra
  const surfaceTintColor = isDark ? '255, 255, 255' : '0, 0, 0';
  const surfaceTintAlpha = isDark ? 0.08 : 0.03;
  const surfaceHoverAlpha = isDark ? 0.1 : 0.06;
  const surfaceSeparatorAlpha = isDark ? 0.05 : 0.08;

  // ---- Error colors adaptivos ----
  const errorBgRgb = isDark ? { r: 74, g: 45, b: 45 } : { r: 254, g: 242, b: 242 };
  const errorBorderRgb = isDark ? { r: 106, g: 64, b: 64 } : { r: 252, g: 205, b: 205 };
  const errorTextColor = isDark ? '#ff6b6b' : '#dc2626';

  // ---- Feedback/Success colors adaptivos ----
  const feedbackBgRgb = isDark ? { r: 45, g: 74, b: 45 } : { r: 240, g: 253, b: 244 };
  const feedbackBorderRgb = isDark ? { r: 74, g: 106, b: 74 } : { r: 187, g: 247, b: 208 };
  const feedbackTextColor = isDark ? '#8fdf8f' : '#16a34a';

  // ---- Share button (siempre oscuro para contraste sobre el mapa) ----
  const shareBtnBg = isDark ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.7)';
  const shareBtnBgHover = isDark ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.85)';
  const shareBtnBorder = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.3)';
  const shareBtnBorderHover = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.5)';

  // ---- Sombras ----
  const shadowIntensity = isDark ? 0.2 : 0.1;

  // ---- Aplicar variables CSS ----
  const vars = {
    // === COLORES DE FONDO ===
    '--color-bg-primary': `rgba(0, 0, 0, ${bgPrimaryAlpha})`,
    '--color-bg-hover': `rgba(0, 0, 0, ${bgHoverAlpha})`,
    '--color-bg-active': rgba(primaryRgb.r, primaryRgb.g, primaryRgb.b, 0.12),
    '--color-bg-overlay': rgba(bgDefaultRgb.r, bgDefaultRgb.g, bgDefaultRgb.b, overlayAlpha),
    '--color-bg-surface': rgb(bgPaperRgb.r, bgPaperRgb.g, bgPaperRgb.b),
    '--color-bg-default': rgb(bgDefaultRgb.r, bgDefaultRgb.g, bgDefaultRgb.b),

    // === BORDES ===
    '--color-border-primary': 'rgba(0, 0, 0, 0)',
    '--color-border-active': rgba(primaryRgb.r, primaryRgb.g, primaryRgb.b, 0.32),
    '--color-border-subtle': rgba(textPrimaryRgb.r, textPrimaryRgb.g, textPrimaryRgb.b, isDark ? 0.1 : 0.12),

    // === TEXTO ===
    '--color-text-primary': theme.text.primary,
    '--color-text-secondary': theme.text.secondary,
    '--color-text-muted': rgba(textPrimaryRgb.r, textPrimaryRgb.g, textPrimaryRgb.b, textMutedAlpha),
    '--color-text-hint': rgba(textPrimaryRgb.r, textPrimaryRgb.g, textPrimaryRgb.b, textHintAlpha),
    '--color-text-disabled': theme.text.disabled,

    // === ACENTO (PRIMARY) ===
    '--color-accent-primary': theme.primary.main,
    '--color-accent-primary-hover': theme.primary.dark,
    '--color-accent-primary-light': theme.primary.light,
    '--color-accent-link': theme.primary.light,
    '--color-accent-primary-rgb': rgbString(primaryRgb),
    '--color-accent-primary-dark-rgb': rgbString(primaryDarkRgb),
    '--color-accent-primary-contrast': theme.primary.contrastText,

    // === ACENTO (SECONDARY) ===
    '--color-secondary': theme.secondary.main,
    '--color-secondary-light': theme.secondary.light,
    '--color-secondary-dark': theme.secondary.dark,

    // === SURFACE TINTS (para overlays en menús, modales) ===
    '--color-surface-tint': `rgba(${surfaceTintColor}, ${surfaceTintAlpha})`,
    '--color-surface-hover': `rgba(${surfaceTintColor}, ${surfaceHoverAlpha})`,
    '--color-surface-separator': `rgba(${surfaceTintColor}, ${surfaceSeparatorAlpha})`,

    // === ERROR ===
    '--color-error-bg': rgb(errorBgRgb.r, errorBgRgb.g, errorBgRgb.b),
    '--color-error-border': rgb(errorBorderRgb.r, errorBorderRgb.g, errorBorderRgb.b),
    '--color-error-text': errorTextColor,

    // === FEEDBACK/SUCCESS ===
    '--feedback-bg': rgb(feedbackBgRgb.r, feedbackBgRgb.g, feedbackBgRgb.b),
    '--feedback-border': rgb(feedbackBorderRgb.r, feedbackBorderRgb.g, feedbackBorderRgb.b),
    '--feedback-text': feedbackTextColor,

    // === SHARE BUTTON ===
    '--share-button-bg': shareBtnBg,
    '--share-button-bg-hover': shareBtnBgHover,
    '--share-button-bg-active': isDark ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.95)',
    '--share-button-border': shareBtnBorder,
    '--share-button-border-hover': shareBtnBorderHover,

    // === SEMANTIC STATUS COLORS ===
    '--color-success': isDark ? '#4caf50' : '#2e7d32',
    '--color-success-bg': isDark ? 'rgb(34, 48, 40)' : 'rgb(237, 247, 237)',
    '--color-warning': isDark ? '#ff9800' : '#e65100',
    '--color-warning-bg': isDark ? 'rgb(48, 42, 34)' : 'rgb(255, 243, 224)',
    '--color-info': theme.primary.main,
    '--color-info-bg': isDark
      ? rgba(primaryRgb.r, primaryRgb.g, primaryRgb.b, 0.12)
      : rgba(primaryRgb.r, primaryRgb.g, primaryRgb.b, 0.08),

    // === LOADING ===
    '--loading-bg': isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)',

    // === SOMBRAS ===
    '--shadow-menu': `rgba(0,0,0,${shadowIntensity}) 0px 2px 4px -1px, rgba(0,0,0,${shadowIntensity * 0.7}) 0px 4px 5px 0px, rgba(0,0,0,${shadowIntensity * 0.6}) 0px 1px 10px 0px`,
    '--shadow-card': `0 4px 6px rgba(0,0,0,${shadowIntensity * 0.5})`,

    // === BTN DANGER (adaptivo) ===
    '--color-danger': isDark ? '#ff6b6b' : '#dc2626',
    '--color-danger-hover': isDark ? '#e05555' : '#b91c1c',
    '--color-danger-active': isDark ? '#cc4444' : '#991b1b',

    // === BODY BACKGROUND ===
    '--body-bg': rgba(bgDefaultRgb.r, bgDefaultRgb.g, bgDefaultRgb.b, overlayAlpha),
  };

  // Aplicar todas las variables al root
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }

  // Debug: verificar valor muted aplicado
  console.log('🎨 text-muted valor:', vars['--color-text-muted'], '| computed:', getComputedStyle(root).getPropertyValue('--color-text-muted'));

  // Marcar modo en el body para selectores CSS condicionales
  document.body.dataset.obrTheme = isDark ? 'dark' : 'light';
  document.body.style.backgroundColor = vars['--body-bg'];

  console.log(`🎨 OBR Theme aplicado: ${theme.mode}`, {
    primary: theme.primary.main,
    primaryDark: theme.primary.dark,
    background: theme.background.paper,
    bgDefault: theme.background.default,
    textPrimary: theme.text.primary,
    textSecondary: theme.text.secondary,
    textDisabled: theme.text.disabled,
    // Parsed values para verificación
    _parsed: {
      textPrimaryRgb,
      mutedAlpha: textMutedAlpha,
      hintAlpha: textHintAlpha
    }
  });
}

/**
 * Inicializa la integración del tema con OBR
 * @param {Object} OBR - Referencia al SDK de Owlbear Rodeo
 */
export async function initTheme(OBR) {
  try {
    // Obtener tema inicial
    const theme = await OBR.theme.getTheme();
    applyOBRTheme(theme);

    // Suscribirse a cambios de tema (light ↔ dark)
    OBR.theme.onChange((theme) => {
      applyOBRTheme(theme);
    });
  } catch (error) {
    console.warn('⚠️ No se pudo obtener el tema de OBR, usando defaults:', error);
  }
}
