/**
 * @fileoverview Icon Helper - Genera iconos SVG via CSS mask-image
 * 
 * Los SVGs se usan como máscara CSS, permitiendo colorearlos
 * con `background-color: currentColor` para que se adapten al tema.
 */

/**
 * Genera HTML de un icono usando CSS mask-image
 * @param {string} src - Ruta del SVG (ej: 'img/icon-trash.svg')
 * @param {Object} [options] - Opciones
 * @param {string} [options.className=''] - Clases CSS adicionales
 * @param {string} [options.size=''] - Tamaño: 'sm', 'lg', o '' (default md)
 * @param {string} [options.style=''] - Estilos inline adicionales
 * @param {string} [options.alt=''] - Texto alternativo (aria-label)
 * @param {string} [options.color=''] - Color específico (override currentColor)
 * @returns {string} HTML del icono
 */
export function iconHtml(src, { className = '', size = '', style = '', alt = '', color = '' } = {}) {
  const sizeClass = size ? `icon--${size}` : '';
  const colorStyle = color ? `background-color: ${color};` : '';
  const ariaLabel = alt ? `aria-label="${alt}" role="img"` : 'aria-hidden="true"';
  
  return `<span class="icon ${sizeClass} ${className}" style="-webkit-mask-image: url('${src}'); mask-image: url('${src}'); ${colorStyle}${style}" ${ariaLabel}></span>`;
}

/**
 * Crea un elemento DOM icono usando CSS mask-image
 * @param {string} src - Ruta del SVG
 * @param {Object} [options] - Opciones (mismas que iconHtml)
 * @returns {HTMLElement} Elemento span del icono
 */
export function createIcon(src, { className = '', size = '', style = '', alt = '', color = '' } = {}) {
  const span = document.createElement('span');
  span.className = `icon ${size ? `icon--${size}` : ''} ${className}`.trim();
  span.style.cssText = `-webkit-mask-image: url('${src}'); mask-image: url('${src}'); ${color ? `background-color: ${color};` : ''}${style}`;
  
  if (alt) {
    span.setAttribute('aria-label', alt);
    span.setAttribute('role', 'img');
  } else {
    span.setAttribute('aria-hidden', 'true');
  }
  
  return span;
}
