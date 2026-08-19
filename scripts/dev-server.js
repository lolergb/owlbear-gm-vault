import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler as notionApiHandler } from '../netlify/functions/notion-api.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OWLBEAR_ORIGINS = new Set([
  'https://www.owlbear.rodeo',
  'https://owlbear.rodeo',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8001',
  'http://127.0.0.1:8001'
]);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

function setDevelopmentHeaders(response, request) {
  const requestOrigin = request.headers.origin;
  const allowedOrigin = OWLBEAR_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : 'https://www.owlbear.rodeo';
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Notion-Token, X-GM-Vault-Default'
  );
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  response.setHeader('Vary', 'Origin');
}

function sendText(response, status, message) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}

const server = http.createServer(async (request, response) => {
  setDevelopmentHeaders(response, request);

  // Mirror the Netlify function locally so the Owlbear extension can use the
  // same Notion import flow during development.
  if ((request.url || '').startsWith('/.netlify/functions/notion-api')) {
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed');
      return;
    }

    try {
      const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
      const body = await new Promise((resolveBody, rejectBody) => {
        let raw = '';
        request.setEncoding('utf8');
        request.on('data', chunk => { raw += chunk; });
        request.on('end', () => resolveBody(raw));
        request.on('error', rejectBody);
      });
      const result = await notionApiHandler({
        httpMethod: request.method,
        headers: request.headers,
        queryStringParameters: Object.fromEntries(requestUrl.searchParams.entries()),
        body: body || null
      });
      response.statusCode = result.statusCode || 200;
      for (const [name, value] of Object.entries(result.headers || {})) {
        response.setHeader(name, value);
      }
      response.end(result.body || '');
    } catch (error) {
      console.error('Local Notion function error:', error);
      sendText(response, 500, 'Local Notion function error');
    }
    return;
  }

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed');
    return;
  }

  try {
    const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    let filePath = resolve(ROOT, `.${pathname}`);
    const rootPrefix = ROOT.endsWith(sep) ? ROOT : `${ROOT}${sep}`;
    if (filePath !== ROOT && !filePath.startsWith(rootPrefix)) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
    }

    const body = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader(
      'Content-Type',
      CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
    );
    response.setHeader('Content-Length', body.length);

    if (request.method === 'HEAD') {
      response.end();
    } else {
      response.end(body);
    }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      sendText(response, 404, 'Not found');
      return;
    }

    console.error(error);
    sendText(response, 500, 'Internal server error');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`GM Vault Local: http://${HOST}:${PORT}/manifest.local.json`);
  console.log('CORS enabled for Owlbear Rodeo origins');
});
