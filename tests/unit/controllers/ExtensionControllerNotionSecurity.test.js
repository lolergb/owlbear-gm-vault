import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';

const videoViewerSource = readFileSync(fileURLToPath(
  new URL('../../../html/video-viewer.html', import.meta.url)
), 'utf8');
const googleViewerSource = readFileSync(fileURLToPath(
  new URL('../../../html/google-doc-viewer.html', import.meta.url)
), 'utf8');

function bareController() {
  const controller = Object.create(ExtensionController.prototype);
  controller.isGM = true;
  controller.isCoGM = false;
  controller.config = {};
  controller._getVisibilityIndicator = () => '';
  controller._updateMentionsInContent = jest.fn();
  controller._attachImageHandlers = jest.fn();
  return controller;
}

describe('ExtensionController Notion HTML security boundary', () => {
  it('escapa el header y sanea incluso HTML inseguro devuelto por el renderer', async () => {
    const controller = bareController();
    controller._repairStoredPageTitle = jest.fn().mockResolvedValue(
      'Boss </h1><img src=x onerror="window.pwned=1">'
    );
    controller.notionService = {
      fetchPageInfo: jest.fn().mockResolvedValue({
        cover: { external: { url: 'javascript:alert(1)' } },
        icon: { type: 'emoji', emoji: '</span><script>window.pwned=2</script>' },
        properties: {}
      }),
      fetchBlocks: jest.fn().mockResolvedValue([])
    };
    controller.notionRenderer = {
      setDependencies: jest.fn(),
      setRenderingOptions: jest.fn(),
      renderBlocks: jest.fn().mockResolvedValue(
        '<p class="notion-paragraph">Hello<img src=x onerror="window.pwned=3"></p><script>window.pwned=4</script>'
      ),
      renderPageProperties: jest.fn().mockReturnValue('')
    };
    controller.cacheService = { saveHtmlToLocalCache: jest.fn() };
    const content = document.createElement('div');

    await controller._renderNotionPageWithToken(
      { visibleToPlayers: false, blockTypes: null },
      'page-id',
      content
    );

    expect(content.querySelector('script')).toBeNull();
    expect(content.querySelector('[onerror]')).toBeNull();
    expect(content.querySelector('.notion-page-cover')).toBeNull();
    expect(content.querySelector('.notion-page-title').textContent).toContain(
      'Boss </h1><img src=x onerror="window.pwned=1">'
    );
    expect(content.querySelectorAll('img')).toHaveLength(1);
    expect(content.querySelector('img').hasAttribute('onerror')).toBe(false);

    const cachedHtml = controller.cacheService.saveHtmlToLocalCache.mock.calls[0][1];
    const cached = document.createElement('div');
    cached.innerHTML = cachedHtml;
    expect(cached.querySelector('script, [onerror]')).toBeNull();
  });

  it('sanea el HTML recibido por broadcast antes de mostrarlo y cachearlo', async () => {
    const controller = bareController();
    controller.isGM = false;
    controller._checkGMAvailability = jest.fn().mockResolvedValue({ isActive: true });
    controller.broadcastService = {
      requestContentFromGM: jest.fn().mockResolvedValue(`
        <p class="notion-paragraph">Safe text</p>
        <img class="notion-image-clickable" src="https://assets.example/map.png" onerror="window.pwned=1">
        <a href="javascript:window.pwned=2">Bad link</a>
        <svg><script>window.pwned=3</script></svg>
      `)
    };
    controller.cacheService = {
      getHtmlFromLocalCache: jest.fn().mockReturnValue(null),
      saveHtmlToLocalCache: jest.fn(),
      clearPageCache: jest.fn()
    };
    const content = document.createElement('div');

    await controller._requestNotionContentFromGM({}, 'page-id', content);

    expect(content.textContent).toContain('Safe text');
    expect(content.querySelector('script, svg, [onerror]')).toBeNull();
    expect(content.querySelector('a').hasAttribute('href')).toBe(false);
    expect(content.querySelector('img')?.src).toBe('https://assets.example/map.png');

    const cachedHtml = controller.cacheService.saveHtmlToLocalCache.mock.calls[0][1];
    expect(cachedHtml).not.toMatch(/javascript:|onerror=|<script|<svg/i);
  });

  it('genera HTML compartible con cover, icono y título protegidos', async () => {
    const controller = bareController();
    controller.notionService = {
      fetchPageInfo: jest.fn().mockResolvedValue({
        cover: { external: { url: 'https://assets.example/map.png" onerror="window.pwned=1' } },
        icon: { external: { url: 'javascript:window.pwned=2' } },
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Map </h1><svg onload="window.pwned=3">' }]
          }
        }
      }),
      fetchBlocks: jest.fn().mockResolvedValue([])
    };
    controller.notionRenderer = {
      setRenderingOptions: jest.fn(),
      renderBlocks: jest.fn().mockResolvedValue('<p>Body</p>'),
      renderPageProperties: jest.fn().mockReturnValue('')
    };

    const result = await controller._generateNotionHtmlWithHeader('page-id', {
      includeShareButtons: true
    });
    const content = document.createElement('div');
    content.innerHTML = result.html;

    expect(content.querySelector('svg, script, [onerror], [onload]')).toBeNull();
    expect(content.querySelector('.notion-page-title').textContent)
      .toBe('Map </h1><svg onload="window.pwned=3">');
    expect(content.querySelector('.notion-page-icon-img')).toBeNull();
    expect(content.querySelector('.notion-page-cover img')?.src)
      .toContain('%22%20onerror=%22window.pwned=1');
  });

  it('sanea contenido Notion compartido antes de pasarlo a sessionStorage', async () => {
    sessionStorage.clear();
    const controller = bareController();
    controller.OBR = { modal: { open: jest.fn().mockResolvedValue(undefined) } };

    await controller._showNotionHtmlModal(
      'Handout',
      '<p>Visible</p><img src=x onerror="window.pwned=1"><script>window.pwned=2</script>',
      'embedded'
    );

    const [{ url }] = controller.OBR.modal.open.mock.calls[0];
    const viewerUrl = new URL(url);
    const contentKey = viewerUrl.searchParams.get('contentKey');
    expect(viewerUrl.searchParams.has('contentType')).toBe(false);
    const storedHtml = sessionStorage.getItem(contentKey);
    expect(storedHtml).toContain('Visible');
    expect(storedHtml).not.toMatch(/onerror=|<script/i);
  });

  it('vuelve a sanear el HTML de Notion al cargarlo desde sessionStorage', async () => {
    sessionStorage.clear();
    document.body.innerHTML = `
      <header id="header"></header>
      <button id="back-button"></button>
      <h1 id="page-title"></h1>
      <div id="page-list"></div>
      <div id="notion-container" class="hidden">
        <div id="notion-content"></div>
      </div>
    `;

    const controller = bareController();
    controller._setNotionDisplayMode = jest.fn();
    sessionStorage.setItem(
      'shared-notion',
      '<p>Visible</p><img src="https://assets.example/map.png" onerror="window.pwned=1"><script>window.pwned=2</script>'
    );

    // El tercer argumento simula una URL antigua/manipulada. Ya no puede
    // desactivar el saneado aunque JavaScript permita argumentos adicionales.
    await controller._loadHtmlContent('shared-notion', 'Handout', 'embedded');

    const content = document.getElementById('notion-content');
    expect(content.textContent).toContain('Visible');
    expect(content.querySelector('script, [onerror]')).toBeNull();
    expect(controller._attachImageHandlers).toHaveBeenCalledWith(content);
    expect(sessionStorage.getItem('shared-notion')).toBeNull();
  });

  it('ignora contentType y pageId falsificados en el broadcast compartido', async () => {
    const controller = bareController();
    controller.playerId = 'receiver';
    const handlers = new Map();
    controller.broadcastService = {
      listenForTrustedGMMessage: jest.fn((channel, callback) => {
        handlers.set(channel, callback);
        return jest.fn();
      })
    };
    controller._showNotionHtmlModal = jest.fn().mockResolvedValue(undefined);

    controller._setupSharedContentListeners();
    await handlers.get('com.dmscreen/showNotionContent')({
      name: 'Spoofed content',
      html: '<p>Visible</p><img src=x onerror="window.pwned=1"><script>window.pwned=2</script>',
      pageId: 'embedded-attacker-controlled',
      contentType: 'embedded',
      senderId: 'attacker'
    });

    const [, safeHtml] = controller._showNotionHtmlModal.mock.calls[0];
    expect(safeHtml).toContain('Visible');
    expect(safeHtml).not.toMatch(/onerror=|<script/i);
  });

  it('sanea también HTML embebido antes de renderizarlo y cachearlo', async () => {
    document.body.innerHTML = '<div id="notion-content"></div>';
    const controller = bareController();
    controller._setNotionDisplayMode = jest.fn();
    controller.cacheService = { saveHtmlToLocalCache: jest.fn() };

    await controller._renderEmbeddedHtmlPage({
      name: 'Imported page',
      htmlContent: '<h1>Imported</h1><img src=x onerror="window.pwned=1"><script>window.pwned=2</script>'
    });

    const content = document.getElementById('notion-content');
    expect(content.textContent).toContain('Imported');
    expect(content.querySelector('script, [onerror]')).toBeNull();
    expect(controller.cacheService.saveHtmlToLocalCache.mock.calls[0][1])
      .not.toMatch(/onerror=|<script/i);
  });

  it('conserva imágenes base64 y estilos del exporter al renderizar HTML embebido', async () => {
    const rasterDataUrl = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TA0AAAAvAAAAAAfQ';
    document.body.innerHTML = '<div id="notion-content"></div>';
    const controller = bareController();
    controller._setNotionDisplayMode = jest.fn();
    controller.cacheService = { saveHtmlToLocalCache: jest.fn() };

    await controller._renderEmbeddedHtmlPage({
      name: 'Local gallery',
      htmlContent: `
        <div class="gallery-row" style="display: flex; gap: 16px; margin-bottom: 16px;">
          <div class="notion-image-container" style="flex: 1; position: relative;">
            <img class="notion-image-clickable"
                 src="${rasterDataUrl}"
                 data-image-url="${rasterDataUrl}"
                 style="width: 100%; height: auto; border-radius: 4px; object-fit: contain; background: #f5f5f5; cursor: pointer;"
                 onerror="window.__embeddedXss = true">
          </div>
        </div>
        <script>window.__embeddedXss = true</script>
      `
    });

    const content = document.getElementById('notion-content');
    const renderedImage = content.querySelector('img');
    expect(renderedImage.getAttribute('src')).toBe(rasterDataUrl);
    expect(renderedImage.getAttribute('data-image-url')).toBe(rasterDataUrl);
    expect(renderedImage.getAttribute('style'))
      .toBe('width: 100%; height: auto; border-radius: 4px; object-fit: contain; background: #f5f5f5; cursor: pointer');
    expect(content.querySelector('.gallery-row').getAttribute('style'))
      .toBe('display: flex; gap: 16px; margin-bottom: 16px');
    expect(content.querySelector('script, [onerror]')).toBeNull();
    expect(controller._attachImageHandlers).toHaveBeenCalledWith(content);

    const cachedHtml = controller.cacheService.saveHtmlToLocalCache.mock.calls[0][1];
    const cached = document.createElement('div');
    cached.innerHTML = cachedHtml;
    expect(cached.querySelector('img').getAttribute('src')).toBe(rasterDataUrl);
    expect(cached.querySelector('img').getAttribute('style'))
      .toBe(renderedImage.getAttribute('style'));
    expect(cached.querySelector('.gallery-row').getAttribute('style'))
      .toBe(content.querySelector('.gallery-row').getAttribute('style'));
    expect(cached.querySelector('script, [onerror]')).toBeNull();
  });

  it('rechaza gadgets y protocolos inseguros en viewers compartidos', async () => {
    const controller = bareController();
    controller.OBR = { modal: { open: jest.fn().mockResolvedValue(undefined) } };

    await controller._showVideoModal(
      `${window.location.origin}/html/video-viewer.html?url=javascript%3Aalert(1)`,
      'Attack',
      'youtube'
    );
    await controller._showGoogleDocModal('javascript:alert(1)', 'Attack');
    await controller._showContentModal(
      `${window.location.origin}/html/google-doc-viewer.html?url=javascript%3Aalert(1)`,
      'Attack'
    );
    await controller._showNotionPageModal('javascript:alert(1)', 'Attack', 'page-id');

    expect(controller.OBR.modal.open).not.toHaveBeenCalled();
  });

  it('valida las URLs otra vez dentro de los viewers de mismo origen', () => {
    expect(videoViewerSource).toMatch(
      /sanitizeVideoEmbedUrl\(decodeURIComponent\(videoUrl\)\)/
    );
    expect(googleViewerSource).toMatch(
      /sanitizeGoogleEmbedUrl\(decodeURIComponent\(docUrl\)\)/
    );
    expect(videoViewerSource).not.toMatch(/new URL\(videoUrl, window\.location\.origin\)/);
    expect(googleViewerSource).not.toMatch(/new URL\(docUrl, window\.location\.origin\)/);
  });

  it('muestra el nombre del archivo importado como texto', async () => {
    const controller = bareController();
    controller._applyJsonImport = jest.fn();
    controller.modalManager = {
      close: jest.fn(),
      showCustom: jest.fn(({ content }) => {
        const modal = document.createElement('div');
        modal.innerHTML = content;
        return modal;
      })
    };

    await controller._showLoadJsonOptionsModal(
      { categories: [] },
      1,
      1,
      '</strong><img src=x onerror="window.pwned=1">.json'
    );

    const modal = controller.modalManager.showCustom.mock.results[0].value;
    expect(modal.querySelector('img, [onerror]')).toBeNull();
    expect(modal.textContent).toContain('</strong><img src=x onerror="window.pwned=1">.json');
  });

  it('bloquea URLs ejecutables en modales de menciones externas', async () => {
    document.body.innerHTML = '';
    const controller = bareController();
    controller.notionRenderer = { setRenderingOptions: jest.fn() };

    await controller._showMentionPageModal({
      url: 'javascript:parent.__owned=1',
      hasEmbeddedHtml: () => false,
      getNotionPageId: () => null
    }, 'External page');

    const overlay = document.querySelector('.mention-modal-overlay');
    expect(overlay.querySelector('iframe')).toBeNull();
    expect(overlay.textContent).toContain('Invalid external URL');
  });

  it('mantiene el estado de error de imágenes sin handlers inline', () => {
    const controller = bareController();
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="notion-image-container">
        <div class="image-loading"></div>
        <img class="notion-image-clickable" src="https://assets.example/missing.png" data-image-kind="content">
      </div>
    `;

    controller._attachImageLifecycleHandlers(content);
    content.querySelector('img').dispatchEvent(new Event('error'));

    expect(content.querySelector('.image-loading')).toBeNull();
    expect(content.querySelector('.notion-image-error .empty-state-text').textContent)
      .toBe('Could not load image');
    expect(content.querySelector('.notion-image-error button').textContent)
      .toBe('🔄 Reload page');
  });

  it('renderiza valores peligrosos del formulario como texto', () => {
    document.body.innerHTML = '';
    const controller = bareController();

    controller._showModalForm(
      'Edit <img src=x onerror="window.pwned=1">',
      [{
        name: 'page',
        label: 'Page',
        type: 'select',
        options: [{ value: '1" autofocus onfocus="window.pwned=2', label: '<svg onload="window.pwned=3">' }]
      }],
      jest.fn()
    );

    const modal = document.querySelector('.modal__content');
    expect(modal.querySelector('img, svg, [onerror], [onfocus]')).toBeNull();
    expect(modal.querySelector('.modal__title').textContent).toContain('<img');
    expect(modal.querySelector('option').textContent).toBe('<svg onload="window.pwned=3">');
  });
});
