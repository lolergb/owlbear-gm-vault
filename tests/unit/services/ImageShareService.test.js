import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  IMAGE_SHARE_CHANNEL,
  IMAGE_SHARE_PROTOCOL_VERSION,
  IMAGE_SHARE_STATUS,
  IMAGE_SHARE_STATUS_CHANNEL,
  listenForImageShares,
  sendImageShareStatus,
  shareImageWithPlayers
} from '../../../js/services/ImageShareService.js';

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function createSenderOBR(players = [
  { id: 'player-1', connectionId: 'player-connection-1', role: 'PLAYER' },
  { id: 'player-2', connectionId: 'player-connection-2', role: 'PLAYER' }
]) {
  const handlers = new Map();

  const OBR = {
    player: {
      getConnectionId: jest.fn().mockResolvedValue('gm-connection')
    },
    party: {
      getPlayers: jest.fn().mockResolvedValue(players)
    },
    broadcast: {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      onMessage: jest.fn((channel, handler) => {
        handlers.set(channel, handler);
        return () => handlers.delete(channel);
      })
    }
  };

  OBR.emit = (channel, data, connectionId) => {
    handlers.get(channel)?.({ data, connectionId });
  };

  return OBR;
}

function emitStatus(OBR, shareId, connectionId, status) {
  OBR.emit(
    IMAGE_SHARE_STATUS_CHANNEL,
    {
      version: IMAGE_SHARE_PROTOCOL_VERSION,
      shareId,
      targetConnectionId: 'gm-connection',
      status
    },
    connectionId
  );
}

afterEach(() => {
  jest.useRealTimers();
});

describe('shareImageWithPlayers', () => {
  it('solo termina como visible cuando cada conexión confirma load o failure', async () => {
    const OBR = createSenderOBR();
    const updates = [];
    const shareId = 'share-success';

    const resultPromise = shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/map.png',
      caption: 'Map',
      shareId,
      retryDelayMs: 1000,
      timeoutMs: 2000,
      onProgress: (progress) => updates.push(progress)
    });
    await flushPromises();

    expect(OBR.broadcast.sendMessage).toHaveBeenCalledWith(
      IMAGE_SHARE_CHANNEL,
      expect.objectContaining({
        version: IMAGE_SHARE_PROTOCOL_VERSION,
        shareId,
        url: 'https://assets.example/map.png'
      }),
      { destination: 'REMOTE' }
    );

    emitStatus(OBR, shareId, 'player-connection-1', IMAGE_SHARE_STATUS.LOADED);
    emitStatus(OBR, shareId, 'player-connection-2', IMAGE_SHARE_STATUS.FAILED);

    const result = await resultPromise;
    expect(result).toMatchObject({
      phase: 'complete',
      total: 2,
      loaded: 1,
      failed: 1,
      missing: 0
    });
    expect(updates.at(-1)).toEqual(result);
  });

  it('ignora ACKs con un target o una conexión que no pertenecen al envío', async () => {
    jest.useFakeTimers();
    const OBR = createSenderOBR([
      { id: 'player-1', connectionId: 'player-connection-1', role: 'PLAYER' }
    ]);
    const resultPromise = shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/map.png',
      shareId: 'share-filtered',
      retryDelayMs: 10,
      timeoutMs: 30
    });
    await flushPromises();

    OBR.emit(IMAGE_SHARE_STATUS_CHANNEL, {
      version: IMAGE_SHARE_PROTOCOL_VERSION,
      shareId: 'share-filtered',
      targetConnectionId: 'another-gm',
      status: IMAGE_SHARE_STATUS.LOADED
    }, 'player-connection-1');
    emitStatus(OBR, 'share-filtered', 'unknown-connection', IMAGE_SHARE_STATUS.LOADED);

    await jest.advanceTimersByTimeAsync(30);
    const result = await resultPromise;
    expect(result.loaded).toBe(0);
    expect(result.missing).toBe(1);
  });

  it('rebroadcast una sola vez si falta el ACK received', async () => {
    jest.useFakeTimers();
    const OBR = createSenderOBR([
      { id: 'player-1', connectionId: 'player-connection-1', role: 'PLAYER' }
    ]);
    const resultPromise = shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/map.png',
      shareId: 'share-retry',
      retryDelayMs: 10,
      timeoutMs: 30
    });
    await flushPromises();

    expect(OBR.broadcast.sendMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10);
    expect(OBR.broadcast.sendMessage).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(20);
    const result = await resultPromise;
    expect(result).toMatchObject({ phase: 'complete', missing: 1 });
  });

  it('usa el único retry como sonda si falta el ACK terminal', async () => {
    jest.useFakeTimers();
    const OBR = createSenderOBR([
      { id: 'player-1', connectionId: 'player-connection-1', role: 'PLAYER' }
    ]);
    const resultPromise = shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/map.png',
      shareId: 'share-received',
      retryDelayMs: 10,
      timeoutMs: 30
    });
    await flushPromises();

    emitStatus(OBR, 'share-received', 'player-connection-1', IMAGE_SHARE_STATUS.RECEIVED);
    await jest.advanceTimersByTimeAsync(10);
    expect(OBR.broadcast.sendMessage).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(20);
    const result = await resultPromise;
    expect(result).toMatchObject({ loading: 1, missing: 0 });
  });

  it('devuelve no_recipients sin emitir si no hay nadie conectado', async () => {
    const OBR = createSenderOBR([]);
    const result = await shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/map.png'
    });

    expect(result).toMatchObject({ phase: 'no_recipients', total: 0 });
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });

  it('rechaza una URL no compartible antes de consultar la party', async () => {
    const OBR = createSenderOBR();
    const result = await shareImageWithPlayers({
      OBR,
      url: 'javascript:alert(1)'
    });

    expect(result).toMatchObject({ phase: 'error', error: 'invalid_url' });
    expect(OBR.party.getPlayers).not.toHaveBeenCalled();
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });

  it('no confunde un dominio que empieza por fc o fd con una IPv6 privada', async () => {
    const OBR = createSenderOBR([]);
    const result = await shareImageWithPlayers({
      OBR,
      url: 'https://fcdn.example/map.png'
    });

    expect(result).toMatchObject({ phase: 'no_recipients' });
    expect(OBR.party.getPlayers).toHaveBeenCalledTimes(1);
  });

  it('acepta una carga lenta posterior a cinco segundos', async () => {
    jest.useFakeTimers();
    const OBR = createSenderOBR([
      { id: 'player-1', connectionId: 'player-connection-1', role: 'PLAYER' }
    ]);
    const resultPromise = shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/large-map.png',
      shareId: 'share-slow-load'
    });
    await flushPromises();

    emitStatus(OBR, 'share-slow-load', 'player-connection-1', IMAGE_SHARE_STATUS.RECEIVED);
    await jest.advanceTimersByTimeAsync(6000);
    emitStatus(OBR, 'share-slow-load', 'player-connection-1', IMAGE_SHARE_STATUS.LOADED);

    await expect(resultPromise).resolves.toMatchObject({
      phase: 'complete',
      loaded: 1,
      missing: 0
    });
  });

  it('termina por watchdog aunque sendMessage no resuelva', async () => {
    jest.useFakeTimers();
    const OBR = createSenderOBR([
      { id: 'player-1', connectionId: 'player-connection-1', role: 'PLAYER' }
    ]);
    OBR.broadcast.sendMessage.mockImplementation(() => new Promise(() => {}));

    const resultPromise = shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/map.png',
      shareId: 'share-stalled-send',
      retryDelayMs: 10,
      timeoutMs: 30
    });
    await flushPromises();
    await jest.advanceTimersByTimeAsync(30);

    await expect(resultPromise).resolves.toMatchObject({
      phase: 'complete',
      loaded: 0,
      missing: 1
    });
  });

  it('termina por watchdog aunque la consulta de party no resuelva', async () => {
    jest.useFakeTimers();
    const OBR = createSenderOBR();
    OBR.party.getPlayers.mockImplementation(() => new Promise(() => {}));

    const resultPromise = shareImageWithPlayers({
      OBR,
      url: 'https://assets.example/map.png',
      shareId: 'share-stalled-party',
      timeoutMs: 30
    });
    await flushPromises();
    await jest.advanceTimersByTimeAsync(30);

    await expect(resultPromise).resolves.toMatchObject({
      phase: 'error',
      error: 'party_timeout'
    });
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });
});

describe('listenForImageShares', () => {
  function createReceiver({ senderRole = 'GM', modalError = null } = {}) {
    const handlers = new Map();
    const openImage = modalError
      ? jest.fn().mockRejectedValue(modalError)
      : jest.fn().mockResolvedValue(undefined);
    const OBR = {
      player: {
        getConnectionId: jest.fn().mockResolvedValue('receiver-connection')
      },
      party: {
        getPlayers: jest.fn().mockResolvedValue([
          { id: 'gm', connectionId: 'gm-connection', role: senderRole }
        ])
      },
      broadcast: {
        sendMessage: jest.fn().mockResolvedValue(undefined),
        onMessage: jest.fn((channel, handler) => {
          handlers.set(channel, handler);
          return jest.fn();
        })
      }
    };

    listenForImageShares({ OBR, openImage });
    const receive = (data) => handlers.get(IMAGE_SHARE_CHANNEL)({
      data,
      connectionId: 'gm-connection'
    });
    const recordLocalStatus = async (status) => {
      await handlers.get(IMAGE_SHARE_STATUS_CHANNEL)({
        data: {
          version: IMAGE_SHARE_PROTOCOL_VERSION,
          shareId: reliablePayload.shareId,
          targetConnectionId: 'gm-connection',
          status
        },
        connectionId: 'receiver-connection'
      });
    };
    return { OBR, openImage, receive, recordLocalStatus };
  }

  const reliablePayload = {
    version: IMAGE_SHARE_PROTOCOL_VERSION,
    shareId: 'share-background',
    url: 'https://assets.example/handout.png',
    caption: 'Handout'
  };

  it('confirma received y abre el modal desde el receptor de background', async () => {
    const { OBR, openImage, receive } = createReceiver();
    await receive(reliablePayload);

    expect(OBR.broadcast.sendMessage).toHaveBeenCalledWith(
      IMAGE_SHARE_STATUS_CHANNEL,
      expect.objectContaining({
        shareId: 'share-background',
        targetConnectionId: 'gm-connection',
        status: IMAGE_SHARE_STATUS.RECEIVED
      }),
      { destination: 'ALL' }
    );
    expect(openImage).toHaveBeenCalledWith({
      url: 'https://assets.example/handout.png',
      caption: 'Handout',
      shareId: 'share-background',
      senderConnectionId: 'gm-connection'
    });
  });

  it('abre la imagen aunque el ACK received quede pendiente', async () => {
    const { OBR, openImage, receive } = createReceiver();
    OBR.broadcast.sendMessage.mockImplementation(() => new Promise(() => {}));

    await receive(reliablePayload);

    expect(openImage).toHaveBeenCalledTimes(1);
  });

  it('reconfirma un retry pero no abre dos veces la misma imagen', async () => {
    const { OBR, openImage, receive } = createReceiver();
    await receive(reliablePayload);
    await receive(reliablePayload);

    expect(openImage).toHaveBeenCalledTimes(1);
    expect(OBR.broadcast.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reproduce el ACK terminal guardado cuando el primero se perdió', async () => {
    const { OBR, openImage, receive, recordLocalStatus } = createReceiver();
    await receive(reliablePayload);
    await recordLocalStatus(IMAGE_SHARE_STATUS.LOADED);
    await receive(reliablePayload);

    expect(openImage).toHaveBeenCalledTimes(1);
    expect(OBR.broadcast.sendMessage).toHaveBeenNthCalledWith(
      2,
      IMAGE_SHARE_STATUS_CHANNEL,
      expect.objectContaining({ status: IMAGE_SHARE_STATUS.LOADED }),
      { destination: 'ALL' }
    );
  });

  it('rechaza mensajes que no proceden de una conexión GM real', async () => {
    const { OBR, openImage, receive } = createReceiver({ senderRole: 'PLAYER' });
    await receive(reliablePayload);

    expect(openImage).not.toHaveBeenCalled();
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });

  it('rechaza esquemas de URL que no sean HTTP o HTTPS', async () => {
    const { OBR, openImage, receive } = createReceiver();
    await receive({
      ...reliablePayload,
      url: 'javascript:alert(1)'
    });

    expect(openImage).not.toHaveBeenCalled();
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });

  it('informa failed si Owlbear no puede abrir el modal', async () => {
    const { OBR, receive } = createReceiver({ modalError: new Error('modal failed') });
    await receive(reliablePayload);

    expect(OBR.broadcast.sendMessage).toHaveBeenNthCalledWith(
      2,
      IMAGE_SHARE_STATUS_CHANNEL,
      expect.objectContaining({
        status: IMAGE_SHARE_STATUS.FAILED,
        reason: 'modal_open_failed'
      }),
      { destination: 'ALL' }
    );
  });

  it('mantiene compatibilidad de apertura con mensajes legacy sin ACK falso', async () => {
    const { OBR, openImage, receive } = createReceiver();
    const legacyPayload = {
      url: 'https://assets.example/legacy.png',
      caption: 'Legacy',
      timestamp: 123
    };
    await receive(legacyPayload);
    await receive(legacyPayload);

    expect(openImage).toHaveBeenCalledTimes(2);
    expect(OBR.broadcast.sendMessage).not.toHaveBeenCalled();
  });
});

describe('sendImageShareStatus', () => {
  it('envía el estado de carga dirigido al emisor original', async () => {
    const OBR = { broadcast: { sendMessage: jest.fn().mockResolvedValue(undefined) } };
    await sendImageShareStatus(OBR, {
      shareId: 'share-loaded',
      targetConnectionId: 'gm-connection',
      status: IMAGE_SHARE_STATUS.LOADED
    });

    expect(OBR.broadcast.sendMessage).toHaveBeenCalledWith(
      IMAGE_SHARE_STATUS_CHANNEL,
      expect.objectContaining({
        shareId: 'share-loaded',
        targetConnectionId: 'gm-connection',
        status: IMAGE_SHARE_STATUS.LOADED
      }),
      { destination: 'ALL' }
    );
  });
});
