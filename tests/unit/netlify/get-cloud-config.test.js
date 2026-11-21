import { afterEach, describe, expect, it } from '@jest/globals';
import { handler } from '../../../netlify/functions/get-cloud-config.js';
const names = ['GM_VAULT_CLOUD_ENABLED', 'GM_VAULT_SUPABASE_URL', 'GM_VAULT_SUPABASE_PUBLISHABLE_KEY'];
const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
afterEach(() => { for (const name of names) if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; });
function configure(key = 'sb_publishable_test') {
  process.env.GM_VAULT_CLOUD_ENABLED = 'true';
  process.env.GM_VAULT_SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.GM_VAULT_SUPABASE_PUBLISHABLE_KEY = key;
}
describe('public cloud configuration', () => {
  it('fails closed when disabled or missing configuration', async () => {
    configure(); delete process.env.GM_VAULT_CLOUD_ENABLED;
    expect(JSON.parse((await handler({ httpMethod: 'GET' })).body)).toEqual({ enabled: false });
    configure(); delete process.env.GM_VAULT_SUPABASE_URL;
    expect(JSON.parse((await handler({ httpMethod: 'GET' })).body)).toEqual({ enabled: false });
  });
  it('returns only public config with no caching', async () => {
    configure(); process.env.UNRELATED_SECRET = 'never-return';
    const result = await handler({ httpMethod: 'GET' });
    expect(JSON.parse(result.body)).toEqual({ enabled: true, url: 'https://test-project.supabase.co', key: 'sb_publishable_test' });
    expect(result.headers['Cache-Control']).toBe('no-store');
    delete process.env.UNRELATED_SECRET;
  });
  it.each(['sb_secret_danger', 'bad', `x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`])('never exposes a secret or invalid key: %s', async key => {
    configure(key);
    expect(JSON.parse((await handler({ httpMethod: 'GET' })).body)).toEqual({ enabled: false });
  });
  it('accepts an existing public anon key', async () => {
    configure(`x.${Buffer.from('{"role":"anon"}').toString('base64url')}.x`);
    expect(JSON.parse((await handler({ httpMethod: 'GET' })).body).enabled).toBe(true);
  });
  it('rejects non-GET and URL credentials or non-HTTPS URLs', async () => {
    configure(); expect((await handler({ httpMethod: 'POST' })).statusCode).toBe(405);
    for (const url of ['http://test.supabase.co', 'https://user:password@test.supabase.co', 'https://test.supabase.co/private']) {
      process.env.GM_VAULT_SUPABASE_URL = url;
      expect(JSON.parse((await handler({ httpMethod: 'GET' })).body)).toEqual({ enabled: false });
    }
  });
});
