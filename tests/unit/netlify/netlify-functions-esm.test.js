import { describe, expect, it } from '@jest/globals';
import { readdir, readFile } from 'node:fs/promises';

const functionsDirectory = new URL('../../../netlify/functions/', import.meta.url);
const functionFiles = (await readdir(functionsDirectory))
  .filter(file => file.endsWith('.js'))
  .sort();

describe.each(functionFiles)('%s Netlify function module', file => {
  it('loads as ESM and exports a handler', async () => {
    const module = await import(new URL(file, functionsDirectory));

    expect(typeof module.handler).toBe('function');
  });

  it('does not use CommonJS export globals', async () => {
    const source = await readFile(new URL(file, functionsDirectory), 'utf8');

    expect(source).not.toMatch(/\b(?:exports\s*\.|module\.exports\b)/);
  });
});
