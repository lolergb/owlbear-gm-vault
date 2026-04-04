/**
 * @fileoverview Setup global para tests
 */

import { jest, beforeEach } from '@jest/globals';
import { mockOBR } from './obr-sdk.js';

// Mock global de OBR
global.OBR = mockOBR;

// Mock de localStorage
const localStorageMock = {
  store: {},
  getItem: jest.fn((key) => localStorageMock.store[key] || null),
  setItem: jest.fn((key, value) => {
    localStorageMock.store[key] = String(value);
  }),
  removeItem: jest.fn((key) => {
    delete localStorageMock.store[key];
  }),
  clear: jest.fn(() => {
    localStorageMock.store = {};
  }),
  get length() {
    return Object.keys(localStorageMock.store).length;
  },
  key: jest.fn((index) => Object.keys(localStorageMock.store)[index] || null)
};

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true
});

// Mock de fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ results: [] })
  })
);

// Mock de console para tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Limpiar mocks antes de cada test
beforeEach(() => {
  jest.clearAllMocks();
  localStorageMock.clear();
});

