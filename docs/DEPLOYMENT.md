# Deployment

The production build is a folder of static files (`dist/`). Any static host works, and there is no server code, database or environment variable.

```bash
npm ci
npm run build      # → dist/
```

## Vercel

`vercel.json` already sets the build command, the output directory and the security headers. Import the repository in Vercel; nothing else is needed.

## Other static hosts (Netlify, Cloudflare Pages, GitHub Pages, nginx, …)

1. Upload the contents of `dist/`.
2. Configure the same response headers as in `vercel.json`, the **Content-Security-Policy** above all. Without them the app still works, but you lose its protections.
3. Serve `sw.js` with `Cache-Control: no-cache` so app updates are noticed. `assets/` can be cached as immutable (file names contain a hash).
4. Serve `.wasm` as `application/wasm` and `.webmanifest` as `application/manifest+json`.

The app uses hash routing (`#/library`), so no rewrite rules are needed, and it works from a sub-path because asset URLs are relative (`base: './'`).

Netlify `_headers` example:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
/sw.js
  Cache-Control: no-cache
```

## HTTPS

Service workers, `crypto.subtle` (SHA-256) and persistent storage need a secure context: HTTPS, or `localhost` during development.

## Updating

Every build gives the service worker a new version (a hash of the precached files). Open tabs show "A new version of the app is available" and reload only when the user clicks **Reload**. The library in IndexedDB is not affected by updates.

## Checking a deployment

`node scripts/serve-dist.mjs 4173` serves `dist/` locally with the headers from `vercel.json`, the same setup the browser tests use.
