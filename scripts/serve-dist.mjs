// Serves dist/ with the exact headers from vercel.json (including the strict
// Content-Security-Policy), so the browser tests run against production rules.
// Usage: node scripts/serve-dist.mjs [port]
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('dist');
const port = Number(process.argv[2] ?? 4173);
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.map': 'application/json',
};

function headersFor(pathname) {
  const out = {};
  for (const rule of config.headers) {
    const re = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`);
    if (re.test(pathname)) for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, headersFor(url.pathname));
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...headersFor(url.pathname) });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`dist/ on http://localhost:${port} with vercel.json headers`));
