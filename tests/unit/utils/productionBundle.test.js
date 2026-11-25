/** @jest-environment-options {"url":"https://owlbear-gm-vault.netlify.app"} */
import { afterEach, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mockOBR } from '../../mocks/obr-sdk.js';

afterEach(() => {
  window.gmVault?.getController()?.cleanup();
  document.body.innerHTML = '';
});

it('boots the actual minified production bundle without debug, manifest or pre-consent analytics requests', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: process.cwd(), env: { ...process.env, CONTEXT: 'production', COMMIT_REF: 'c'.repeat(40) }, stdio: 'pipe'
  });
  const html = readFileSync('dist/index.html', 'utf8');
  document.documentElement.innerHTML = html;
  let ready;
  mockOBR.onReady.mockImplementation(callback => { ready = callback; });
  mockOBR.theme = { getTheme: jest.fn().mockResolvedValue({ mode: 'DARK' }), onChange: jest.fn() };
  mockOBR.room.onMetadataChange.mockReturnValue(jest.fn());
  mockOBR.party.onChange.mockReturnValue(jest.fn());
  mockOBR.broadcast.onMessage.mockReturnValue(jest.fn());
  const src = document.querySelector('script[type="module"]').getAttribute('src');
  await import(`../../../dist${src}`);
  expect(ready).toEqual(expect.any(Function));
  await ready();
  const controller = window.gmVault.getController();
  expect(controller?.isInitialized).toBe(true);
  expect(document.querySelector('.vault-empty-state')).not.toBeNull();
  const requests = fetch.mock.calls.map(([url]) => url);
  expect(requests).not.toContain('/.netlify/functions/get-debug-mode');
  expect(requests).not.toContain('/manifest.json');
  expect(requests).not.toContain('/.netlify/functions/get-mixpanel-token');
  expect(console.error).not.toHaveBeenCalled();
}, 15000);
