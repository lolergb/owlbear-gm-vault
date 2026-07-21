import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 8000;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OWLBEAR_ORIGIN = 'https://www.owlbear.rodeo';

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

function setDevelopmentHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', OWLBEAR_ORIGIN);
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
  setDevelopmentHeaders(response);

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
  console.log(`CORS enabled for ${OWLBEAR_ORIGIN}`);
});
