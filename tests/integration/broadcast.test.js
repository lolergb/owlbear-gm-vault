/**
 * @fileoverview Tests de integración para el flujo de broadcast GM → Player/Co-GM
 * 
 * Estos tests verifican los escenarios críticos de comunicación entre roles:
 * - GM envía páginas visibles a Players
 * - GM envía vault completo a Co-GMs
 * - Player solicita contenido al GM
 * - Co-GM recibe actualizaciones
 * - Manejo de errores y límites de tamaño
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BroadcastService } from '../../js/services/BroadcastService.js';
import { filterVisiblePages } from '../../js/utils/helpers.js';
import { 
  BROADCAST_CHANNEL_REQUEST,
  BROADCAST_CHANNEL_RESPONSE,
  BROADCAST_CHANNEL_VISIBLE_PAGES,
  BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES,
  BROADCAST_CHANNEL_SHOW_IMAGE,
  BROADCAST_CHANNEL_REQUEST_FULL_VAULT,
  BROADCAST_CHANNEL_RESPONSE_FULL_VAULT
} from '../../js/utils/constants.js';

// ============================================
// MOCK DE OBR MEJORADO PARA TESTS DE BROADCAST
// ============================================

/**
 * Crea un mock de OBR que simula la comunicación broadcast entre múltiples clientes
 */
function createMockOBR(role = 'GM') {
  const messageHandlers = new Map();
  
  return {
    role,
    player: {
      getRole: jest.fn(() => Promise.resolve(role)),
      getId: jest.fn(() => Promise.resolve(`player-${role}-${Date.now()}`)),
    },
    broadcast: {
      // Envía mensaje y dispara handlers registrados
      sendMessage: jest.fn((channel, data) => {
        return new Promise((resolve, reject) => {
          // Simular límite de 64KB
          const size = JSON.stringify(data).length;
          if (size > 64 * 1024) {
            reject({ 
              error: { 
                name: 'SizeLimitExceededError',
                message: 'Message exceeds size limit of 64KB'
              }
            });
            return;
          }
          
          // Disparar handlers registrados para este canal
          const handlers = messageHandlers.get(channel) || [];
          handlers.forEach(handler => {
            // Simular evento de broadcast
            setTimeout(() => handler({ data }), 0);
          });
          
          resolve();
        });
      }),
      
      // Registra handler para un canal
      onMessage: jest.fn((channel, handler) => {
        if (!messageHandlers.has(channel)) {
          messageHandlers.set(channel, []);
        }
        messageHandlers.get(channel).push(handler);
        
        // Retorna función de unsubscribe
        return () => {
          const handlers = messageHandlers.get(channel);
          const index = handlers.indexOf(handler);
          if (index > -1) {
            handlers.splice(index, 1);
          }
        };
      }),
      
      // Helper para tests: simula recibir un mensaje externo
      _simulateIncomingMessage: (channel, data) => {
        const handlers = messageHandlers.get(channel) || [];
        handlers.forEach(handler => handler({ data }));
      },
      
      // Helper para tests: obtiene handlers registrados
      _getHandlers: (channel) => messageHandlers.get(channel) || [],
    },
    room: {
      id: 'test-room-123',
    }
  };
}

// ============================================
// FIXTURES
// ============================================

const sampleConfig = {
  categories: [
    {
      name: 'NPCs',
      pages: [
        { name: 'Gandalf', url: 'https://notion.so/gandalf-123', visibleToPlayers: true },
        { name: 'Sauron (secreto)', url: 'https://notion.so/sauron-456', visibleToPlayers: false },
      ],
      categories: [
        {
          name: 'Aliados',
          pages: [
            { name: 'Aragorn', url: 'https://notion.so/aragorn-789', visibleToPlayers: true },
          ]
        }
      ]
    },
    {
      name: 'Locaciones',
      pages: [
        { name: 'Rivendell', url: 'https://notion.so/rivendell-abc', visibleToPlayers: true },
        { name: 'Mordor (oculto)', url: 'https://notion.so/mordor-def', visibleToPlayers: false },
      ]
    }
  ]
};

const sampleHtmlContent = '<div class="notion-page"><h1>Gandalf</h1><p>Un mago muy sabio...</p></div>';

// ============================================
// TESTS: filterVisiblePages
// ============================================

describe('filterVisiblePages', () => {
  it('debe filtrar solo páginas con visibleToPlayers: true', () => {
    const filtered = filterVisiblePages(sampleConfig);
    
    // Debe tener las categorías que contienen páginas visibles
    expect(filtered.categories).toHaveLength(2);
    
    // NPCs: solo Gandalf debe ser visible (no Sauron)
    const npcs = filtered.categories.find(c => c.name === 'NPCs');
    expect(npcs.pages).toHaveLength(1);
    expect(npcs.pages[0].name).toBe('Gandalf');
    
    // Subcategoría Aliados con Aragorn
    expect(npcs.categories).toHaveLength(1);
    expect(npcs.categories[0].pages[0].name).toBe('Aragorn');
    
    // Locaciones: solo Rivendell
    const locations = filtered.categories.find(c => c.name === 'Locaciones');
    expect(locations.pages).toHaveLength(1);
    expect(locations.pages[0].name).toBe('Rivendell');
  });

  it('debe eliminar categorías vacías tras filtrar', () => {
    const configWithEmptyCategory = {
      categories: [
        {
          name: 'Solo secretos',
          pages: [
            { name: 'Secreto 1', url: 'https://...', visibleToPlayers: false },
            { name: 'Secreto 2', url: 'https://...', visibleToPlayers: false },
          ]
        },
        {
          name: 'Con visibles',
          pages: [
            { name: 'Visible', url: 'https://...', visibleToPlayers: true },
          ]
        }
      ]
    };
    
    const filtered = filterVisiblePages(configWithEmptyCategory);
    
    // Solo debe quedar la categoría con páginas visibles
    expect(filtered.categories).toHaveLength(1);
    expect(filtered.categories[0].name).toBe('Con visibles');
  });

  it('debe manejar config vacía o null', () => {
    expect(filterVisiblePages(null)).toEqual({ categories: [] });
    expect(filterVisiblePages({})).toEqual({ categories: [] });
    expect(filterVisiblePages({ categories: [] })).toEqual({ categories: [] });
  });

  it('debe preservar propiedades de página al filtrar', () => {
    const configWithExtras = {
      categories: [{
        name: 'Test',
        pages: [{
          name: 'Page',
          url: 'https://notion.so/page',
          visibleToPlayers: true,
          icon: { type: 'emoji', emoji: '📄' },
          blockTypes: ['quote', 'callout'],
          linkedTokenId: 'token-123'
        }]
      }]
    };
    
    const filtered = filterVisiblePages(configWithExtras);
    const page = filtered.categories[0].pages[0];
    
    expect(page.icon).toEqual({ type: 'emoji', emoji: '📄' });
    expect(page.blockTypes).toEqual(['quote', 'callout']);
    expect(page.linkedTokenId).toBe('token-123');
  });
});

// ============================================
// TESTS: BroadcastService - Envío de mensajes
// ============================================

describe('BroadcastService - Envío de mensajes', () => {
  let broadcastService;
  let mockOBR;

  beforeEach(() => {
    mockOBR = createMockOBR('GM');
    broadcastService = new BroadcastService();
    broadcastService.setDependencies({ OBR: mockOBR });
  });

  it('debe enviar mensaje correctamente', async () => {
    const result = await broadcastService.sendMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, {
      config: { categories: [] }
    });
    
    expect(result.success).toBe(true);
    expect(mockOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_VISIBLE_PAGES,
      expect.objectContaining({
        config: { categories: [] },
        timestamp: expect.any(Number)
      })
    );
  });

  it('debe detectar error de límite de tamaño (64KB)', async () => {
    // Crear contenido que exceda 64KB
    const largeContent = 'x'.repeat(70 * 1024);
    
    let sizeLimitCalled = false;
    broadcastService.setSizeLimitCallback((channel, size) => {
      sizeLimitCalled = true;
      expect(channel).toBe(BROADCAST_CHANNEL_RESPONSE);
      expect(size).toBeGreaterThan(64);
    });
    
    const result = await broadcastService.sendMessage(BROADCAST_CHANNEL_RESPONSE, {
      html: largeContent
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('size_limit');
    expect(sizeLimitCalled).toBe(true);
  });

  it('debe añadir timestamp a todos los mensajes', async () => {
    const beforeSend = Date.now();
    
    await broadcastService.sendMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, { test: true });
    
    const sentData = mockOBR.broadcast.sendMessage.mock.calls[0][1];
    expect(sentData.timestamp).toBeGreaterThanOrEqual(beforeSend);
  });
});

// ============================================
// TESTS: Flujo GM → Player (páginas visibles)
// ============================================

describe('Flujo GM → Player: Páginas visibles', () => {
  let gmBroadcast;
  let playerBroadcast;
  let gmOBR;
  let playerOBR;

  beforeEach(() => {
    // Crear instancias separadas para GM y Player
    gmOBR = createMockOBR('GM');
    playerOBR = createMockOBR('PLAYER');
    
    gmBroadcast = new BroadcastService();
    gmBroadcast.setDependencies({ OBR: gmOBR });
    
    playerBroadcast = new BroadcastService();
    playerBroadcast.setDependencies({ OBR: playerOBR });
  });

  it('GM debe enviar solo páginas visibles a players', async () => {
    const visibleConfig = filterVisiblePages(sampleConfig);
    
    // GM envía páginas visibles
    gmBroadcast.broadcastVisiblePages(visibleConfig);
    
    expect(gmOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_VISIBLE_PAGES,
      expect.objectContaining({
        config: visibleConfig
      })
    );
    
    // Verificar que NO incluye páginas ocultas
    const sentConfig = gmOBR.broadcast.sendMessage.mock.calls[0][1].config;
    const allPageNames = [];
    
    function collectPageNames(categories) {
      categories.forEach(cat => {
        cat.pages?.forEach(p => allPageNames.push(p.name));
        if (cat.categories) collectPageNames(cat.categories);
      });
    }
    collectPageNames(sentConfig.categories);
    
    expect(allPageNames).toContain('Gandalf');
    expect(allPageNames).toContain('Aragorn');
    expect(allPageNames).toContain('Rivendell');
    expect(allPageNames).not.toContain('Sauron (secreto)');
    expect(allPageNames).not.toContain('Mordor (oculto)');
  });

  it('Player debe poder solicitar páginas visibles', async () => {
    // Simular que el GM está escuchando
    let gmReceivedRequest = false;
    gmOBR.broadcast.onMessage(BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES, () => {
      gmReceivedRequest = true;
    });
    
    // Player solicita páginas
    const requestPromise = playerBroadcast.requestVisiblePages();
    
    // Simular respuesta del GM
    setTimeout(() => {
      playerOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, {
        config: filterVisiblePages(sampleConfig),
        timestamp: Date.now()
      });
    }, 10);
    
    const result = await requestPromise;
    
    expect(result).not.toBeNull();
    expect(result.categories).toBeDefined();
  });

  it('Player debe recibir timeout si GM no responde', async () => {
    // No configuramos respuesta del GM
    const result = await playerBroadcast.requestVisiblePages();
    
    // Debe retornar null después del timeout
    expect(result).toBeNull();
  }, 10000); // Timeout mayor para el test
});

// ============================================
// TESTS: Flujo GM → Player (contenido HTML)
// ============================================

describe('Flujo GM → Player: Contenido HTML', () => {
  let gmBroadcast;
  let playerBroadcast;
  let gmOBR;
  let playerOBR;
  let mockCacheService;

  beforeEach(() => {
    gmOBR = createMockOBR('GM');
    playerOBR = createMockOBR('PLAYER');
    
    mockCacheService = {
      getHtmlFromLocalCache: jest.fn((pageId) => {
        if (pageId === 'gandalf-123') {
          return sampleHtmlContent;
        }
        return null;
      }),
      saveHtmlToLocalCache: jest.fn(),
    };
    
    gmBroadcast = new BroadcastService();
    gmBroadcast.setDependencies({ OBR: gmOBR, cacheService: mockCacheService });
    
    playerBroadcast = new BroadcastService();
    playerBroadcast.setDependencies({ OBR: playerOBR });
  });

  it('Player debe poder solicitar contenido HTML al GM', async () => {
    const pageId = 'gandalf-123';
    
    // Player solicita contenido
    const requestPromise = playerBroadcast.requestContentFromGM(pageId);
    
    // Simular respuesta del GM
    setTimeout(() => {
      playerOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_RESPONSE, {
        pageId,
        html: sampleHtmlContent,
        timestamp: Date.now()
      });
    }, 10);
    
    const result = await requestPromise;
    
    expect(result).toBe(sampleHtmlContent);
  });

  it('GM debe responder con HTML del caché', async () => {
    const pageId = 'gandalf-123';
    
    // Configurar GM para responder
    gmBroadcast.setupGMContentResponder(async (requestedPageId) => {
      return mockCacheService.getHtmlFromLocalCache(requestedPageId);
    });
    
    // Simular solicitud de player
    gmOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_REQUEST, {
      pageId,
      requestId: Date.now()
    });
    
    // Esperar a que se procese
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verificar que se envió respuesta
    expect(gmOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_RESPONSE,
      expect.objectContaining({
        pageId,
        html: sampleHtmlContent
      })
    );
  });

  it('GM sanea HTML legado del caché justo antes de enviarlo', async () => {
    const pageId = 'legacy-cache';
    mockCacheService.getHtmlFromLocalCache.mockImplementation((requestedPageId) => (
      requestedPageId === pageId
        ? '<p>Visible</p><img src=x onerror="window.pwned=1"><script>window.pwned=2</script>'
        : null
    ));
    const generator = jest.fn();
    gmBroadcast.setupGMContentResponder(generator);

    gmOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_REQUEST, {
      pageId,
      requestId: Date.now()
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    const response = gmOBR.broadcast.sendMessage.mock.calls.find(
      ([channel]) => channel === BROADCAST_CHANNEL_RESPONSE
    )?.[1];
    expect(generator).not.toHaveBeenCalled();
    expect(response.html).toContain('Visible');
    expect(response.html).not.toMatch(/onerror=|<script/i);
  });

  it('Player debe recibir null si GM no tiene el contenido', async () => {
    const pageId = 'pagina-no-cacheada';
    
    // Player solicita contenido que no existe
    const result = await playerBroadcast.requestContentFromGM(pageId);
    
    // Debe retornar null (timeout)
    expect(result).toBeNull();
  }, 10000);
});

// ============================================
// TESTS: Flujo GM → Co-GM (vault completo)
// ============================================

describe('Flujo GM → Co-GM: Vault completo', () => {
  let gmBroadcast;
  let coGmBroadcast;
  let gmOBR;
  let coGmOBR;

  beforeEach(() => {
    gmOBR = createMockOBR('GM');
    coGmOBR = createMockOBR('GM'); // Co-GM también tiene rol GM
    
    gmBroadcast = new BroadcastService();
    gmBroadcast.setDependencies({ OBR: gmOBR });
    
    coGmBroadcast = new BroadcastService();
    coGmBroadcast.setDependencies({ OBR: coGmOBR });
  });

  it('GM debe enviar vault completo (incluyendo páginas ocultas) a Co-GM', async () => {
    // GM envía vault completo
    await gmBroadcast.sendMessage(BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, {
      config: sampleConfig
    });
    
    // Verificar que se envió la config completa
    const sentData = gmOBR.broadcast.sendMessage.mock.calls[0][1];
    
    // Debe incluir TODAS las páginas (visibles y ocultas)
    const allPageNames = [];
    function collectPageNames(categories) {
      categories.forEach(cat => {
        cat.pages?.forEach(p => allPageNames.push(p.name));
        if (cat.categories) collectPageNames(cat.categories);
      });
    }
    collectPageNames(sentData.config.categories);
    
    expect(allPageNames).toContain('Gandalf');
    expect(allPageNames).toContain('Sauron (secreto)'); // Debe incluir secretos
    expect(allPageNames).toContain('Mordor (oculto)'); // Debe incluir ocultos
  });

  it('Co-GM debe poder solicitar vault completo', async () => {
    // Co-GM solicita vault
    await coGmBroadcast.sendMessage(BROADCAST_CHANNEL_REQUEST_FULL_VAULT, {
      requesterId: 'cogm-123',
      requesterName: 'Co-GM Player'
    });
    
    expect(coGmOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_REQUEST_FULL_VAULT,
      expect.objectContaining({
        requesterId: 'cogm-123',
        requesterName: 'Co-GM Player'
      })
    );
  });
});

// ============================================
// TESTS: Compartir imágenes
// ============================================

describe('Compartir imágenes GM → Players', () => {
  let gmBroadcast;
  let playerBroadcast;
  let gmOBR;
  let playerOBR;

  beforeEach(() => {
    gmOBR = createMockOBR('GM');
    playerOBR = createMockOBR('PLAYER');
    
    gmBroadcast = new BroadcastService();
    gmBroadcast.setDependencies({ OBR: gmOBR });
    
    playerBroadcast = new BroadcastService();
    playerBroadcast.setDependencies({ OBR: playerOBR });
  });

  it('GM debe poder compartir imagen con players', async () => {
    const imageUrl = 'https://example.com/map.png';
    
    await gmBroadcast.sendMessage('SHOW_IMAGE', {
      url: imageUrl,
      caption: 'Mapa del mundo'
    });
    
    expect(gmOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_SHOW_IMAGE,
      expect.objectContaining({
        url: imageUrl,
        caption: 'Mapa del mundo'
      })
    );
  });

  it('Player debe recibir imagen compartida', async () => {
    const imageUrl = 'https://example.com/map.png';
    let receivedImage = null;
    
    // Player escucha imágenes
    playerBroadcast.onMessage('SHOW_IMAGE', (data) => {
      receivedImage = data;
    });
    
    // Simular que GM envía imagen
    playerOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_SHOW_IMAGE, {
      url: imageUrl,
      caption: 'Mapa del mundo',
      timestamp: Date.now()
    });
    
    // Esperar procesamiento
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(receivedImage).not.toBeNull();
    expect(receivedImage.url).toBe(imageUrl);
  });
});

// ============================================
// TESTS: Escenarios de error y edge cases
// ============================================

describe('Escenarios de error y edge cases', () => {
  let broadcastService;
  let mockOBR;

  beforeEach(() => {
    mockOBR = createMockOBR('GM');
    broadcastService = new BroadcastService();
    broadcastService.setDependencies({ OBR: mockOBR });
  });

  it('debe manejar OBR no disponible', async () => {
    const serviceWithoutOBR = new BroadcastService();
    // No llamamos setDependencies
    
    const result = await serviceWithoutOBR.sendMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, {});
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('OBR not available');
  });

  it('debe limpiar subscripciones correctamente', () => {
    // Registrar varias subscripciones
    broadcastService.onMessage('SHOW_IMAGE', () => {});
    broadcastService.setupGMContentResponder(() => {});
    broadcastService.listenForVisiblePagesUpdates(() => {});
    
    expect(broadcastService.subscriptions.length).toBeGreaterThan(0);
    
    // Limpiar
    broadcastService.cleanup();
    
    expect(broadcastService.subscriptions).toHaveLength(0);
  });

  it('debe manejar config con categorías profundamente anidadas', () => {
    const deepConfig = {
      categories: [{
        name: 'Level 1',
        categories: [{
          name: 'Level 2',
          categories: [{
            name: 'Level 3',
            pages: [
              { name: 'Deep Page', url: 'https://...', visibleToPlayers: true }
            ]
          }]
        }]
      }]
    };
    
    const filtered = filterVisiblePages(deepConfig);
    
    // Debe preservar la estructura anidada
    expect(filtered.categories[0].name).toBe('Level 1');
    expect(filtered.categories[0].categories[0].name).toBe('Level 2');
    expect(filtered.categories[0].categories[0].categories[0].name).toBe('Level 3');
    expect(filtered.categories[0].categories[0].categories[0].pages[0].name).toBe('Deep Page');
  });

  it('debe manejar páginas sin visibleToPlayers (default false)', () => {
    const configWithDefaults = {
      categories: [{
        name: 'Test',
        pages: [
          { name: 'Sin propiedad', url: 'https://...' }, // No tiene visibleToPlayers
          { name: 'Explícito false', url: 'https://...', visibleToPlayers: false },
          { name: 'Explícito true', url: 'https://...', visibleToPlayers: true },
        ]
      }]
    };
    
    const filtered = filterVisiblePages(configWithDefaults);
    
    // Solo debe incluir la página con visibleToPlayers: true
    expect(filtered.categories[0].pages).toHaveLength(1);
    expect(filtered.categories[0].pages[0].name).toBe('Explícito true');
  });
});

// ============================================
// TESTS: Refresh manual con forceRefresh
// ============================================

describe('Refresh manual con forceRefresh', () => {
  let gmBroadcast;
  let playerBroadcast;
  let gmOBR;
  let playerOBR;
  let mockCacheService;

  beforeEach(() => {
    gmOBR = createMockOBR('GM');
    playerOBR = createMockOBR('PLAYER');
    
    mockCacheService = {
      getHtmlFromLocalCache: jest.fn((pageId) => {
        if (pageId === 'cached-page') {
          return '<div>Cached content</div>';
        }
        return null;
      }),
      saveHtmlToLocalCache: jest.fn(),
      clearPageCache: jest.fn(),
    };
    
    gmBroadcast = new BroadcastService();
    gmBroadcast.setDependencies({ OBR: gmOBR, cacheService: mockCacheService });
    
    playerBroadcast = new BroadcastService();
    playerBroadcast.setDependencies({ OBR: playerOBR });
  });

  it('Player debe poder solicitar contenido con forceRefresh=true', async () => {
    const pageId = 'test-page';
    
    // Player solicita contenido CON forceRefresh
    const requestPromise = playerBroadcast.requestContentFromGM(pageId, true);
    
    // Simular respuesta del GM
    setTimeout(() => {
      playerOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_RESPONSE, {
        pageId,
        html: '<div>Fresh content</div>',
        timestamp: Date.now()
      });
    }, 10);
    
    const result = await requestPromise;
    
    // Verificar que la solicitud incluyó forceRefresh
    expect(playerOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_REQUEST,
      expect.objectContaining({
        pageId,
        forceRefresh: true,
        requestId: expect.any(Number)
      })
    );
    expect(result).toBe('<div>Fresh content</div>');
  });

  it('Solicitud con forceRefresh debe tener timeout mayor (10s)', async () => {
    const pageId = 'test-page';
    const startTime = Date.now();
    
    // Player solicita con forceRefresh (no habrá respuesta, esperamos timeout)
    const result = await playerBroadcast.requestContentFromGM(pageId, true);
    
    const elapsed = Date.now() - startTime;
    
    // Debe haber esperado ~10 segundos (con algo de margen)
    expect(elapsed).toBeGreaterThanOrEqual(9500);
    expect(result).toBeNull();
  }, 15000);

  it('Solicitud SIN forceRefresh debe tener timeout menor (5s)', async () => {
    const pageId = 'test-page';
    const startTime = Date.now();
    
    // Player solicita SIN forceRefresh (no habrá respuesta, esperamos timeout)
    const result = await playerBroadcast.requestContentFromGM(pageId, false);
    
    const elapsed = Date.now() - startTime;
    
    // Debe haber esperado ~5 segundos (con algo de margen)
    expect(elapsed).toBeLessThan(7000);
    expect(result).toBeNull();
  }, 10000);

  it('GM debe procesar forceRefresh y limpiar caché antes de responder', async () => {
    const pageId = 'cached-page';
    let generateCalled = false;
    let generateForceRefresh = null;
    
    // Configurar GM para responder (con callback que rastrea forceRefresh)
    gmBroadcast.setupGMContentResponder(async (requestedPageId, forceRefresh) => {
      generateCalled = true;
      generateForceRefresh = forceRefresh;
      return '<div>Generated content</div>';
    });
    
    // Simular solicitud de player CON forceRefresh
    gmOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_REQUEST, {
      pageId,
      forceRefresh: true,
      requestId: Date.now()
    });
    
    // Esperar procesamiento
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verificar que se llamó al generador con forceRefresh=true
    expect(generateCalled).toBe(true);
    expect(generateForceRefresh).toBe(true);
    
    // Verificar que se limpió el caché antes de generar
    expect(mockCacheService.clearPageCache).toHaveBeenCalledWith(pageId);
  });

  it('GM debe usar caché cuando NO hay forceRefresh', async () => {
    const pageId = 'cached-page';
    let generateCalled = false;
    
    // Configurar GM para responder
    gmBroadcast.setupGMContentResponder(async () => {
      generateCalled = true;
      return '<div>Generated content</div>';
    });
    
    // Simular solicitud de player SIN forceRefresh
    gmOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_REQUEST, {
      pageId,
      forceRefresh: false,
      requestId: Date.now()
    });
    
    // Esperar procesamiento
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verificar que se usó el caché (NO se llamó al generador)
    expect(generateCalled).toBe(false);
    expect(mockCacheService.getHtmlFromLocalCache).toHaveBeenCalledWith(pageId);
    expect(mockCacheService.clearPageCache).not.toHaveBeenCalled();
    
    // Verificar que se envió el contenido cacheado
    expect(gmOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_RESPONSE,
      expect.objectContaining({
        pageId,
        html: '<div>Cached content</div>'
      })
    );
  });
});

// ============================================
// TESTS: Actualización de visibilidad en tiempo real
// ============================================

describe('Actualización de visibilidad en tiempo real', () => {
  let gmBroadcast;
  let playerBroadcast;
  let gmOBR;
  let playerOBR;

  beforeEach(() => {
    gmOBR = createMockOBR('GM');
    playerOBR = createMockOBR('PLAYER');
    
    gmBroadcast = new BroadcastService();
    gmBroadcast.setDependencies({ OBR: gmOBR });
    
    playerBroadcast = new BroadcastService();
    playerBroadcast.setDependencies({ OBR: playerOBR });
  });

  it('Player debe recibir actualizaciones cuando GM cambia visibilidad', async () => {
    let receivedUpdates = [];
    
    // Player escucha actualizaciones
    playerBroadcast.listenForVisiblePagesUpdates((config) => {
      receivedUpdates.push(config);
    });
    
    // GM cambia visibilidad y envía actualización
    const updatedConfig = {
      categories: [{
        name: 'NPCs',
        pages: [
          { name: 'Gandalf', url: 'https://...', visibleToPlayers: true },
          { name: 'Sauron', url: 'https://...', visibleToPlayers: true }, // Ahora visible
        ]
      }]
    };
    
    // Simular broadcast del GM
    playerOBR.broadcast._simulateIncomingMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, {
      config: updatedConfig,
      timestamp: Date.now()
    });
    
    // Esperar procesamiento
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(receivedUpdates).toHaveLength(1);
    expect(receivedUpdates[0].categories[0].pages).toHaveLength(2);
  });

  it('GM debe enviar actualización al guardar config', async () => {
    // Simular el flujo de guardar config
    const newConfig = { ...sampleConfig };
    newConfig.categories[0].pages[1].visibleToPlayers = true; // Hacer visible a Sauron
    
    const visibleConfig = filterVisiblePages(newConfig);
    gmBroadcast.broadcastVisiblePages(visibleConfig);
    
    // Verificar que se envió
    expect(gmOBR.broadcast.sendMessage).toHaveBeenCalledWith(
      BROADCAST_CHANNEL_VISIBLE_PAGES,
      expect.objectContaining({
        config: expect.objectContaining({
          categories: expect.any(Array)
        })
      })
    );
    
    // Verificar que Sauron ahora está incluido
    const sentConfig = gmOBR.broadcast.sendMessage.mock.calls[0][1].config;
    const npcs = sentConfig.categories.find(c => c.name === 'NPCs');
    const sauron = npcs.pages.find(p => p.name === 'Sauron (secreto)');
    expect(sauron).toBeDefined();
  });
});
