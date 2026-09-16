// serve.mjs — static server for local verification.
// Mirrors what Cloudflare Pages does in production (brotli/gzip + the
// Cache-Control rules from _headers) so a local Lighthouse run is
// representative instead of flattering or pessimistic.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import path from 'node:path';

const SITE = process.argv[2] || 'maadanina';
const PORT = Number(process.argv[3] || 4321);
const ROOT = path.resolve(import.meta.dirname, '..', 'sites', SITE);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.yml': 'text/yaml', '.txt': 'text/plain; charset=utf-8',
};
// Already-compressed formats must not be re-encoded.
const COMPRESSIBLE = /^(text\/|application\/(json|manifest))/;

const cacheFor = (p) =>
  /^\/assets\/(img|fonts)\//.test(p) ? 'public, max-age=31536000, immutable'
  : /^\/assets\/js\//.test(p) ? 'public, max-age=604800'
  : 'public, max-age=0, must-revalidate';

createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT)) return void res.writeHead(403).end('forbidden');

    const s = await stat(file).catch(() => null);
    const target = s?.isDirectory() ? path.join(file, 'index.html') : file;
    let body = await readFile(target);
    const type = TYPES[path.extname(target)] || 'application/octet-stream';

    const headers = {
      'content-type': type,
      'cache-control': cacheFor(urlPath),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    };

    const accept = req.headers['accept-encoding'] || '';
    if (COMPRESSIBLE.test(type)) {
      if (/\bbr\b/.test(accept)) {
        body = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
        headers['content-encoding'] = 'br';
      } else if (/\bgzip\b/.test(accept)) {
        body = gzipSync(body, { level: 6 });
        headers['content-encoding'] = 'gzip';
      }
      headers.vary = 'Accept-Encoding';
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, () => console.log(`serving sites/${SITE} → http://localhost:${PORT}`));
