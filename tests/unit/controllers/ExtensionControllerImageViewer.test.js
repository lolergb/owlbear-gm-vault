import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';

const viewerPath = fileURLToPath(
  new URL('../../../html/image-viewer.html', import.meta.url)
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
});

describe('image-viewer.html contract', () => {
  const source = readFileSync(viewerPath, 'utf8');

  it('ajusta la imagen por ancho y alto en el modo inicial', () => {
    expect(source).toMatch(/img\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/s);
    expect(source).toMatch(/object-fit:\s*contain/);
  });

  it('ofrece un modo explícito de tamaño real sin límites de fit', () => {
    expect(source).toMatch(/id=["'](?:actual-size|size-toggle|fit-toggle)["']/);
    expect(source).toMatch(/(?:actual-size|full-size)[^{]*\{[^}]*max-width:\s*none[^}]*max-height:\s*none/s);
  });

  it('oculta compartir cuando share=false', () => {
    expect(source).toMatch(/shareParam\s*!==\s*['"]false['"]/);
    expect(source).toMatch(/if\s*\(\s*showShareButton[^)]*\)[\s\S]{0,300}toolbar/);
  });

  it('cierra el modal de Owlbear mediante su API', () => {
    expect(source).toMatch(/OBR\.modal\.close\s*\(\s*['"]notion-image-viewer['"]\s*\)/);
    expect(source).not.toMatch(/window\.close\s*\(/);
  });
});
