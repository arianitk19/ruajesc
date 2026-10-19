# Security and privacy

## Data never leaves the device

- There is no server, account, analytics or third-party request. Screenshots, metadata, OCR text and settings are stored in this browser (IndexedDB and localStorage).
- OCR runs locally with Tesseract.js. The engine and the language models are served by the app's own origin. The OCR browser test records every network request and fails if any goes elsewhere.
- The Content-Security-Policy (below) allows no third-party origins at all, so even a bug could not send data elsewhere.

## Content-Security-Policy

Set in `vercel.json` (copy it to whatever host you use; see [DEPLOYMENT.md](DEPLOYMENT.md)):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
connect-src 'self' blob:; img-src 'self' blob:; style-src 'self' 'unsafe-inline';
font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

- There are no inline scripts. The theme bootstrap is the external `public/theme-init.js`.
- `'wasm-unsafe-eval'` is needed to compile the Tesseract WASM core. It does not allow `eval()` of JavaScript.
- `blob:` is used for image object URLs and the OCR worker.
- `style-src 'unsafe-inline'` covers style attributes set through the CSSOM (chart bar widths, collection colors). No user data is ever written into styles: colors are validated against `#RRGGBB`.
- `assetsInlineLimit: 0` in the Vite config keeps fonts and images out of `data:` URLs.

The browser tests run against `dist/` served with exactly these headers (`scripts/serve-dist.mjs`). They fail on any console error or CSP violation, and one test checks that an injected inline script is actually blocked.

Other headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy` that turns off the camera, microphone, geolocation and payment.

## Untrusted input

| Input | Handling |
| --- | --- |
| Filenames, titles, notes, tags, OCR text, backup manifests | Rendered only as text nodes through `h()`. `innerHTML`, `insertAdjacentHTML` and `document.write` are not used anywhere. Search highlighting builds `<mark>` elements around text nodes. Unit and browser tests import a file named `<img src=x onerror=alert(1)>.png` and fail on any dialog or injected element. |
| Image files | The type is detected from magic bytes, not the extension or the claimed MIME. Files must decode as images, and SVG is not accepted. The size limit is 25 MB. |
| Text fields | Control characters are stripped and lengths are capped (title 200, description 5,000, notes 10,000, tag 50, collection name 80). |
| Backup ZIPs | The manifest is validated (format, version, ids, ISO dates, arrays), and file paths must match `originals/<name>` (no `../`). Every image is type-sniffed and its SHA-256 is checked against the manifest. Collection colors and icons are checked against allow-lists. Restore only adds; nothing existing is overwritten. |
| CSV export | Cells that start with `= + - @` or a tab are prefixed with `'` to prevent formula injection in spreadsheet apps. |

## Data safety

- An import saves metadata and both images in one IndexedDB transaction.
- Deleting moves items to Trash first. Permanent deletion asks for confirmation, and deleting the whole library requires typing a confirmation word.
- Duplicates are never deleted automatically.
- Restore never overwrites. It records progress, so an interrupted restore resumes without repeating finished items.
- "Persistent storage" can be requested in Settings, so the browser won't evict the library under storage pressure.

## What this protects against, and what it doesn't

The library is as private as the browser profile it lives in. Anyone with access to the unlocked device and browser profile can open it, as with any local file. Browser extensions with access to the site can read the page. Backups are plain ZIP files, so store them as carefully as the screenshots themselves.

## Reporting

Please report security issues privately to the maintainer rather than in a public issue.
