import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Page } from '../../../js/models/Page.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

const cssPath = fileURLToPath(new URL('../../../css/app.css', import.meta.url));
const viewerPath = fileURLToPath(
  new URL('../../../html/image-viewer.html', import.meta.url)
);
const shareStatePath = fileURLToPath(
  new URL('../../../js/utils/shareButtonState.js', import.meta.url)
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleAsyncHandler() {
  await Promise.resolve();
  await Promise.resolve();
}

function createShareButton(onPageShare) {
  const renderer = new UIRenderer();
  const page = new Page('Goblin', 'https://example.com/goblin');
  renderer.onPageShare = onPageShare;

  const pageButton = renderer._createPageButton(page, 'room-1', [], 0, true);
  document.body.appendChild(pageButton);

  return pageButton.querySelector('.page-share-button');
}

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

describe('UIRenderer page share button', () => {
  it('oculta Share a Player pero conserva Open modal', () => {
    const renderer = new UIRenderer();
    const page = new Page('Goblin', 'https://example.com/goblin');
    const pageButton = renderer._createPageButton(page, 'room-1', [], 0, false);

    expect(pageButton.querySelector('.page-share-button')).toBeNull();
    expect(pageButton.querySelector('.page-open-modal-button')).not.toBeNull();
  });

  it('conserva la Promise del callback en el wiring del controlador', () => {
    const controller = Object.create(ExtensionController.prototype);
    const callbackResult = Promise.resolve(true);
    controller._shareCurrentPageToPlayers = jest.fn(() => callbackResult);
    controller.eventHandlers = {
      setDependencies: jest.fn(),
      setState: jest.fn(),
      setCallbacks: jest.fn()
    };
    controller.uiRenderer = { setCallbacks: jest.fn() };
    controller.isGM = true;
    controller.roomId = 'room-1';

    controller._setupEventHandlers();

    const callbacks = controller.uiRenderer.setCallbacks.mock.calls[0][0];
    expect(callbacks.onPageShare({ name: 'Goblin' }, [], 0)).toBe(callbackResult);
  });

  it('entra en busy inmediatamente, espera el callback y bloquea el doble clic', async () => {
    jest.useFakeTimers();
    const share = deferred();
    const onPageShare = jest.fn(() => share.promise);
    const shareButton = createShareButton(onPageShare);

    shareButton.click();

    expect(onPageShare).toHaveBeenCalledTimes(1);
    expect(shareButton.disabled).toBe(true);
    expect(shareButton.getAttribute('aria-busy')).toBe('true');

    // dispatchEvent prueba el guard explícito incluso si el navegador suprime
    // click() automáticamente sobre botones disabled.
    shareButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPageShare).toHaveBeenCalledTimes(1);

    share.resolve(true);
    await settleAsyncHandler();

    // El estado debe sobrevivir al menos un frame visible aunque el broadcast
    // termine casi inmediatamente (la regresión observada en Dia/Chromium).
    expect(shareButton.disabled).toBe(true);
    expect(shareButton.getAttribute('aria-busy')).toBe('true');

    await jest.runAllTimersAsync();

    expect(shareButton.disabled).toBe(false);
    expect(shareButton.hasAttribute('aria-busy')).toBe(false);
  });

  it('limpia busy y disabled cuando el callback rechaza', async () => {
    jest.useFakeTimers();
    const share = deferred();
    const shareButton = createShareButton(jest.fn(() => share.promise));

    shareButton.click();
    expect(shareButton.disabled).toBe(true);
    expect(shareButton.getAttribute('aria-busy')).toBe('true');

    share.reject(new Error('broadcast failed'));
    await settleAsyncHandler();
    await jest.runAllTimersAsync();

    expect(shareButton.disabled).toBe(false);
    expect(shareButton.hasAttribute('aria-busy')).toBe(false);
  });

  it('muestra el estado shared temporalmente cuando el callback confirma éxito', async () => {
    jest.useFakeTimers();
    const shareButton = createShareButton(jest.fn().mockResolvedValue(true));

    shareButton.click();
    await settleAsyncHandler();
    await jest.advanceTimersByTimeAsync(500);

    expect(shareButton.classList.contains('shared')).toBe(true);

    await jest.runAllTimersAsync();
    expect(shareButton.classList.contains('shared')).toBe(false);
  });
});

describe('share busy visual contracts', () => {
  it('dibuja el spinner con un pseudo-elemento y oculta el icono mientras está busy', () => {
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(
      /\.page-share-button\[aria-busy=["']true["']\]::after[\s\S]{0,900}?\{[^}]*animation:/
    );
    expect(css).toMatch(
      /\.page-share-button\[aria-busy=["']true["']\]\s*>?\s*(?:img|\.icon)[\s\S]{0,900}?\{[^}]*opacity:\s*0/
    );
  });

  it('desactiva la animación del spinner con reduced motion', () => {
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.page-share-button\[aria-busy=["']true["']\]::after[\s\S]{0,900}?\{[^}]*animation:\s*none/
    );
  });

  it('el visor de imagen delega el busy, bloqueo y cleanup al helper común', () => {
    const source = readFileSync(viewerPath, 'utf8');
    const shareStateSource = readFileSync(shareStatePath, 'utf8');

    expect(source).toMatch(/import\s*\{\s*runShareButtonAction\s*\}/);
    expect(source).toMatch(/await\s+runShareButtonAction\(\s*shareButton\s*,/);
    expect(shareStateSource).toMatch(/button\.disabled\s*\|\|[\s\S]{0,120}?aria-busy/);
    expect(shareStateSource).toMatch(/button\.disabled\s*=\s*true/);
    expect(shareStateSource).toMatch(
      /button\.setAttribute\(\s*['"]aria-busy['"],\s*['"]true['"]\s*\)/
    );
    expect(source).toMatch(
      /runShareButtonAction\([\s\S]{0,900}?shareImageWithPlayers\s*\(\s*\{/
    );
    expect(shareStateSource).toMatch(
      /button\.disabled\s*=\s*false[\s\S]{0,120}?button\.removeAttribute\(\s*['"]aria-busy['"]\s*\)/
    );
  });
});
