// Serves dist-site/ below a base path, the way GitHub Pages hosts it.
//   node scripts/serve.mjs [--port 4310] [--base /tickdeck/]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { siteDir } from './lib.mjs';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.PORT ?? '4310' },
    base: { type: 'string', default: '/tickdeck/' },
  },
});
const base = `/${values.base.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');

if (!existsSync(path.join(siteDir, 'index.html'))) {
  console.error('dist-site/ is missing. Run `npm run build && npm run site` first.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(base)) {
    response.writeHead(302, { location: base }).end();
    return;
  }
  const relative = decodeURIComponent(url.pathname.slice(base.length));
  let file = path.join(siteDir, relative);
  if (!file.startsWith(siteDir)) {
    response.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    // Like GitHub Pages: /tickdeck/vanilla redirects to /tickdeck/vanilla/.
    if (!url.pathname.endsWith('/')) {
      response.writeHead(301, { location: `${url.pathname}/` }).end();
      return;
    }
    file = path.join(file, 'index.html');
  }
  if (!existsSync(file)) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(Number(values.port), '127.0.0.1', () => {
  console.log(`Serving dist-site/ at http://127.0.0.1:${values.port}${base}`);
});
