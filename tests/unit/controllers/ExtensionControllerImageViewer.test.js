import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';

const viewerPath = fileURLToPath(
  new URL('../../../html/image-viewer.html', import.meta.url)
);
const backgroundPath = fileURLToPath(
  new URL('../../../js/background.js', import.meta.url)
);
const controllerPath = fileURLToPath(
  new URL('../../../js/controllers/ExtensionController.js', import.meta.url)
);
const manifestPath = fileURLToPath(
  new URL('../../../manifest.json', import.meta.url)
);
const localManifestPath = fileURLToPath(
  new URL('../../../manifest.local.json', import.meta.url)
);

function bareController() {
  const controller = Object.create(ExtensionController.prototype);
  controller.isGM = true;
  controller._setNotionDisplayMode = jest.fn();
  controller._attachMentionHandlers = jest.fn();
  return controller;
}

describe('ExtensionController image viewer', () => {
  it('abre el visor por la ruta central como modal responsive sin papel', async () => {
    const controller = bareController();
    controller.OBR = {
      modal: { open: jest.fn().mockResolvedValue(undefined) }
    };

    await controller._showImageModal(
      'https://assets.example/map.png',
      'Dungeon map'
    );

    expect(controller.OBR.modal.open).toHaveBeenCalledTimes(1);
    expect(controller.OBR.modal.open).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'notion-image-viewer',
        fullScreen: true,
        hidePaper: true
      })
    );

    const [options] = controller.OBR.modal.open.mock.calls[0];
    expect(options).not.toHaveProperty('width');
    expect(options).not.toHaveProperty('height');

    const { url } = options;
    const viewerUrl = new URL(url);
    expect(viewerUrl.pathname).toMatch(/\/html\/image-viewer\.html$/);
    expect(decodeURIComponent(viewerUrl.searchParams.get('url'))).toBe(
      'https://assets.example/map.png'
    );
  });

  it('_renderImagePage conserva un solo listener aunque se centralicen los handlers', async () => {
    document.body.innerHTML = '<div id="notion-content"></div>';
    const controller = bareController();
    controller._showImageModal = jest.fn();
    controller._shareImageToPlayers = jest.fn();

    await controller._renderImagePage({
      url: 'https://assets.example/portrait.png',
      name: 'NPC portrait'
    });

    const content = document.getElementById('notion-content');
    controller._attachImageHandlers(content);
    content.querySelector('.notion-image-clickable').click();

    expect(controller._showImageModal).toHaveBeenCalledTimes(1);
    expect(controller._showImageModal).toHaveBeenCalledWith(
      'https://assets.example/portrait.png',
      'NPC portrait'
    );
  });

  it('mantiene vacío un caption explícito y no usa el alt técnico', () => {
    const controller = bareController();
    controller._showImageModal = jest.fn();
    const content = document.createElement('div');
    content.innerHTML = `
      <img class="notion-image-clickable"
           src="https://assets.example/cover.png"
           alt="Page cover"
           data-image-url="https://assets.example/cover.png"
           data-image-caption="">
    `;

    controller._attachImageHandlers(content);
    content.querySelector('img').click();

    expect(controller._showImageModal).toHaveBeenCalledWith(
      'https://assets.example/cover.png',
      ''
    );
  });

  it('propaga share=false al visor para imágenes recibidas por jugadores', async () => {
    const controller = bareController();
    controller.isGM = false;
    controller.OBR = {
      modal: { open: jest.fn().mockResolvedValue(undefined) }
    };

    await controller._showImageModal(
      'https://assets.example/handout.png',
      '',
      false
    );

    const [{ url }] = controller.OBR.modal.open.mock.calls[0];
    expect(new URL(url).searchParams.get('share')).toBe('false');
  });

  it('permite ampliar una imagen raster base64 importada sin aceptar SVG activo', async () => {
    const controller = bareController();
    controller.OBR = {
      modal: { open: jest.fn().mockResolvedValue(undefined) }
    };

    const raster = 'data:image/png;base64,QUJDRA==';
    await controller._showImageModal(raster, 'Local map');
    const [{ url }] = controller.OBR.modal.open.mock.calls[0];
    expect(decodeURIComponent(new URL(url).searchParams.get('url'))).toBe(raster);

    controller.OBR.modal.open.mockClear();
    await controller._showImageModal(
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'Unsafe vector'
    );
    expect(controller.OBR.modal.open).not.toHaveBeenCalled();
  });
});

describe('image-viewer.html contract', () => {
  const source = readFileSync(viewerPath, 'utf8');

  it('ajusta la imagen por ancho y alto en el modo inicial', () => {
    expect(source).toMatch(/img\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/s);
    expect(source).toMatch(/object-fit:\s*contain/);
  });

  it('deja el modo fit sin fondo ni borde', () => {
    expect(source).toMatch(
      /\.image-stage\s*\{[^}]*background:\s*transparent[^}]*border:\s*0/s
    );
    expect(source).toMatch(
      /\.image-stage\.actual-size\s*\{[^}]*background:\s*var\(--color-stage\)[^}]*border:\s*1px/s
    );
  });

  it('usa el cierre cuadrado común de los modales', () => {
    expect(source).toMatch(
      /\.close-button\s*\{[^}]*background:\s*transparent[^}]*border:\s*none[^}]*border-radius:\s*var\(--radius-sm\)/s
    );
    expect(source).toMatch(
      /\.close-button:hover\s*\{[^}]*background:\s*var\(--color-bg-hover\)/s
    );
    expect(source).toMatch(/title=["']Close \(Escape\)["']/);
  });

  it('mantiene compartir y tamaño fijos en la cabecera', () => {
    expect(source).toMatch(
      /<div class=["']header-toolbar["'][^>]*>[\s\S]*id=["']size-toggle["'][\s\S]*id=["']share-button["'][\s\S]*id=["']close-button["']/
    );
    expect(source).toMatch(
      /\.header-action-button\s*\{[^}]*background:\s*transparent[^}]*border:\s*none[^}]*border-radius:\s*var\(--radius-full\)/s
    );
    expect(source).not.toMatch(/positionImageToolbar|id=["']image-toolbar["']/);
  });

  it('ofrece un modo explícito de tamaño real sin límites de fit', () => {
    expect(source).toMatch(/id=["'](?:actual-size|size-toggle|fit-toggle)["']/);
    expect(source).toMatch(/(?:actual-size|full-size)[^{]*\{[^}]*max-width:\s*none[^}]*max-height:\s*none/s);
  });

  it('oculta compartir cuando share=false', () => {
    expect(source).toMatch(/shareParam\s*!==\s*['"]false['"]/);
    expect(source).toMatch(
      /if\s*\(\s*showShareButton[^)]*\)[\s\S]{0,300}shareButton\.hidden\s*=\s*false/
    );
  });

  it('cierra el modal de Owlbear mediante su API', () => {
    expect(source).toMatch(/OBR\.modal\.close\s*\(\s*['"]notion-image-viewer['"]\s*\)/);
    expect(source).not.toMatch(/window\.close\s*\(/);
  });

  it('confirma al GM si la imagen cargó o falló realmente', () => {
    expect(source).toMatch(/reportImageLoadStatus\(IMAGE_SHARE_STATUS\.LOADED\)/);
    expect(source).toMatch(
      /reportImageLoadStatus\(IMAGE_SHARE_STATUS\.FAILED,\s*['"]image_load_failed['"]\)/
    );
    expect(source).toMatch(/reason:\s*['"]viewer_closed['"]/);
    expect(source).toMatch(/referrerpolicy=["']no-referrer["']/);
  });

  it('usa el protocolo fiable también desde el botón del visor', () => {
    expect(source).toMatch(/shareImageWithPlayers\s*\(\s*\{/);
    expect(source).toMatch(/trackImageShareResult\(result\)/);
    expect(source).not.toMatch(
      /OBR\.broadcast\.sendMessage\(\s*['"]com\.dmscreen\/showImage['"]/
    );
  });

  it('mide apertura y zoom sin duplicar extension_opened', () => {
    expect(source).toMatch(/trackImageViewerOpened\(viewerContext\)/);
    expect(source).toMatch(/trackImageViewerZoom\(/);
    expect(source).toMatch(/trackExtensionOpened:\s*false/);
    expect(source).toMatch(/showConsentBanner:\s*false/);
  });

  it('vuelve a validar la URL como imagen raster dentro del visor', () => {
    expect(source).toMatch(/sanitizeImageUrl\(new URL\(imageUrl, window\.location\.origin\)\.href\)/);
  });
});

describe('image share background contract', () => {
  it('carga un receptor de background en producción y local', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const localManifest = JSON.parse(readFileSync(localManifestPath, 'utf8'));

    expect(manifest.background_url).toBe('/html/background.html');
    expect(localManifest.background_url).toBe('/html/background.html');
    expect(manifest.version).toBe('2.1.0-beta.2');
    expect(localManifest.version).toBe('2.1.0-beta.2');
  });

  it('delega la recepción al listener único de background', () => {
    const source = readFileSync(backgroundPath, 'utf8');
    expect(source).toMatch(/listenForImageShares\s*\(\s*\{/);
    expect(source).toMatch(/OBR\.modal\.open\s*\(\s*\{/);
    expect(source).toMatch(/shareId/);
    expect(source).toMatch(/senderConnectionId/);
    expect(source).toMatch(/reason:\s*['"]replaced_by_new_share['"]/);
    expect(source.indexOf("OBR.modal.close('notion-image-viewer')"))
      .toBeLessThan(source.indexOf('OBR.modal.open({'));
  });

  it('no permite que una página externa emita directamente como GM', () => {
    const source = readFileSync(controllerPath, 'utf8');
    expect(source).toMatch(/event\.source\s*===\s*iframe\.contentWindow/);
    expect(source).toMatch(/event\.origin\s*!==\s*iframeOrigin/);
    expect(source).toMatch(/querySelectorAll\(['"]\.mention-modal__iframe['"]\)/);
    expect(source).toMatch(
      /type\s*===\s*['"]shareImage['"][\s\S]*?_showImageModal\(safeImageUrl, caption \|\| '', true, true\)/
    );
    expect(source).not.toMatch(
      /type\s*===\s*['"]shareImage['"][\s\S]{0,800}?_shareImageToPlayers\(/
    );
  });

  it('bloquea dobles clics mientras un share inline sigue pendiente', () => {
    const source = readFileSync(controllerPath, 'utf8');
    expect(source).toMatch(/if\s*\(btn\.disabled\)\s*return/);
    expect(source).toMatch(
      /await\s+runShareButtonAction\(\s*btn\s*,\s*\(\)\s*=>\s*this\._shareImageToPlayers\(url, caption\)/
    );
  });
});
