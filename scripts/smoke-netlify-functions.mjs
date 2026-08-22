const baseUrlArgument = process.argv[2];

if (!baseUrlArgument) {
  console.error('Usage: npm run smoke:functions -- https://deploy-preview.example.netlify.app');
  process.exit(1);
}

const baseUrl = new URL(baseUrlArgument);
baseUrl.pathname = '/';
baseUrl.search = '';
baseUrl.hash = '';

const checks = [
  {
    name: 'manifest',
    path: '/manifest.json',
    expectedStatus: 200,
    validate: body => typeof body.name === 'string' && body.name.length > 0
  },
  {
    name: 'get-mixpanel-token',
    path: '/.netlify/functions/get-mixpanel-token',
    expectedStatus: 200,
    validate: body => (
      typeof body.enabled === 'boolean' &&
      ['production', 'beta', 'unknown'].includes(body.environment) &&
      typeof body.deployContext === 'string'
    )
  },
  {
    name: 'notion-api',
    path: '/.netlify/functions/notion-api',
    expectedStatus: 400,
    validate: body => typeof body.error === 'string' && body.error.includes('No token provided')
  },
  {
    name: 'get-default-token',
    path: '/.netlify/functions/get-default-token',
    expectedStatus: 200,
    validate: body => Object.hasOwn(body, 'token')
  },
  {
    name: 'get-debug-mode',
    path: '/.netlify/functions/get-debug-mode',
    expectedStatus: 200,
    validate: body => typeof body.debug === 'boolean'
  }
];

let failed = false;

for (const check of checks) {
  const url = new URL(check.path, baseUrl);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error'
    });
    const body = await response.json();

    if (response.status !== check.expectedStatus) {
      throw new Error(`expected HTTP ${check.expectedStatus}, received ${response.status}`);
    }

    if (!check.validate(body)) {
      throw new Error('response body does not satisfy the endpoint contract');
    }

    console.log(`PASS ${check.name} (${response.status})`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${check.name}: ${error.message}`);
  }
}

if (failed) process.exit(1);
