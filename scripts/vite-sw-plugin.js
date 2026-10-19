// Builds the service worker from src/sw.js, injecting a versioned precache
// list of the hashed build assets. Runs only for production builds.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function serviceWorkerPlugin() {
  return {
    name: 'screenshot-organizer-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .filter((f) => !f.startsWith('ocr/'));
      const shell = ['./', './index.html', './manifest.webmanifest', './theme-init.js',
        './icons/icon-192.png', './icons/icon-512.png', './icons/favicon.svg'];
      const precache = [...new Set([...shell, ...assets.map((a) => `./${a}`)])].sort();
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      const template = readFileSync(join(process.cwd(), 'src', 'sw.js'), 'utf8');
      const source = template
        .replace("'__SW_VERSION__'", JSON.stringify(version))
        .replace('= __PRECACHE_LIST__;', `= ${JSON.stringify(precache)};`);
      if (/__SW_VERSION__|__PRECACHE_LIST__/.test(source.replace(/\/\*[\s\S]*?\*\//g, ''))) {
        this.error('service worker placeholders were not replaced');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
