import { afterEach, describe, expect, it } from '@jest/globals';
import { handler } from '../../../netlify/functions/get-mixpanel-token.js';

const originalMixpanelToken = process.env.MIXPANEL_TOKEN;
const originalContext = process.env.CONTEXT;

const event = (httpMethod = 'GET', host = '') => ({
  httpMethod,
  headers: host ? { host } : {}
});

afterEach(() => {
  if (originalMixpanelToken === undefined) delete process.env.MIXPANEL_TOKEN;
  else process.env.MIXPANEL_TOKEN = originalMixpanelToken;

  if (originalContext === undefined) delete process.env.CONTEXT;
  else process.env.CONTEXT = originalContext;
});

describe('get-mixpanel-token Netlify function', () => {
  it('exports an ESM handler that returns the production configuration', async () => {
    process.env.MIXPANEL_TOKEN = 'test-token';
    process.env.CONTEXT = 'production';

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      token: 'test-token',
      enabled: true,
      environment: 'production',
      deployContext: 'production',
      isBeta: false
    });
  });

  it('returns analytics disabled when the token is not configured', async () => {
    delete process.env.MIXPANEL_TOKEN;
    process.env.CONTEXT = 'production';

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      token: null,
      enabled: false,
      environment: 'production',
      deployContext: 'production',
      isBeta: false
    });
  });

  it.each([
    ['owlbear-gm-vault.netlify.app', 'production', 'production', false],
    ['deploy-preview-12--owlbear-gm-vault.netlify.app', 'beta', 'deploy-preview', true],
    ['develop--owlbear-gm-vault.netlify.app', 'beta', 'branch-deploy', true]
  ])(
    'infers deployment metadata from %s when CONTEXT is unavailable',
    async (host, environment, deployContext, isBeta) => {
      delete process.env.CONTEXT;
      delete process.env.MIXPANEL_TOKEN;

      const response = await handler(event('GET', host));

      expect(JSON.parse(response.body)).toMatchObject({
        environment,
        deployContext,
        isBeta
      });
    }
  );

  it('handles CORS preflight without CommonJS globals', async () => {
    const response = await handler(event('OPTIONS'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });
});
