/**
 * @fileoverview Mock del SDK de Owlbear Rodeo para tests
 */

import { jest } from '@jest/globals';

export const mockOBR = {
  room: {
    id: 'test-room-id',
    getId: jest.fn(() => Promise.resolve('test-room-id')),
    getMetadata: jest.fn(() => Promise.resolve({})),
    setMetadata: jest.fn(() => Promise.resolve()),
    onMetadataChange: jest.fn(() => ({ unsubscribe: jest.fn() }))
  },
  player: {
    getId: jest.fn(() => Promise.resolve('test-player-id')),
    getConnectionId: jest.fn(() => Promise.resolve('test-connection-id')),
    getName: jest.fn(() => Promise.resolve('Test Player')),
    getRole: jest.fn(() => Promise.resolve('GM'))
  },
  party: {
    getPlayers: jest.fn(() => Promise.resolve([])),
    onChange: jest.fn(() => ({ unsubscribe: jest.fn() }))
  },
  broadcast: {
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: jest.fn(() => ({ unsubscribe: jest.fn() }))
  },
  onReady: jest.fn((callback) => {
    if (callback) callback();
    return Promise.resolve();
  }),
  contextMenu: {
    create: jest.fn(() => Promise.resolve())
  },
  modal: {
    open: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve())
  }
};

export default mockOBR;
