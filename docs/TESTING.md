# Testing

```bash
npm test             # unit tests (Vitest, jsdom + in-memory IndexedDB)
npm run build        # production build
npm run test:e2e     # browser tests (Playwright, Chromium) against dist/
npm run test:all     # all of the above
```

The browser tests serve `dist/` with `scripts/serve-dist.mjs`, which applies the headers from `vercel.json`. Every browser test therefore runs under the **production Content-Security-Policy**. They fail on any console error, uncaught exception, CSP violation or unexpected `alert()`.

All test images are **synthetic**, drawn by `scripts/make-fixtures.py` (a chat, a receipt, a notes page, a settings screen and a JPEG copy of the chat). No real or private screenshots are used.

## Unit tests: 81 tests in 11 files

| File | Covers |
| --- | --- |
| `text.test.js` | accent folding, tokenizing, safe highlight segments, excerpts |
| `formatting.test.js` | Albanian/English numbers (`12 345`, `1,5`), binary file sizes, dates, months, percentages |
| `validation.test.js` | magic-byte type detection (PNG/JPEG/WebP/GIF/AVIF, SVG rejected), size limits, filename/text cleaning, names, tags, colors |
| `image-core.test.js` | pHash against real pixels: JPEG q60, 70% resize and a changed status bar stay within the threshold, while different screenshots stay far apart. Also SHA-256, thumbnail geometry for very tall images, and capture dates from common filenames |
| `search.test.js` | all words must match, accent-insensitive in both directions, partial words, field weight order, word-start boost, notes/description, recent searches, suggestions |
| `category.test.js` | app names in filenames, OCR evidence, no guess from one weak word, user choice never overridden |
| `duplicates.test.js` | exact groups, similar groups within the threshold, aspect-ratio guard, reviewed pairs |
| `repo.test.js` | IndexedDB library: persistence across reloads, pagination and sorting, search through title/OCR/tags/collections, smart views, trash/restore/permanent delete (blobs removed), unique tags, collections, statistics |
| `backup.test.js` | CSV formula-injection guard, manifest validation (path traversal, duplicate ids), full export → inspect → restore round trip, skip vs copy duplicates, merge vs new collections, damaged/missing images detected, interrupted restore resumes, backup reminder |
| `i18n.test.js` | identical key sets in sq/en, no empty values, same placeholders, plural forms, **every `t('…')` key used in the source exists**, dynamic key families, Albanian default, switching and persistence, no account/subscription wording |
| `dom.test.js` | untrusted strings render as text (no `<img onerror>` / `<script>`), safe highlighting, `replace()` never prints "null" |

## Browser tests: 22 tests, desktop (1440×900) and phone (Pixel 7, 320 px)

| Spec | Covers |
| --- | --- |
| `app.spec.js` | Albanian landing and switching to English (remembered after a reload). Onboarding → empty home, focus moves to the heading, skip link first on a fresh load. Import of 3 files: an exact duplicate is skipped with the reason, everything is still there after a reload. A fake `.png` is rejected. An HTML-like filename and notes are shown as text. Accent-insensitive search with highlight and recent searches. Favorites, trash with undo, restore, permanent delete (IndexedDB checked). Bulk add to a new collection. Viewer with keyboard navigation and zoom. Duplicate review keeps the chosen file and sends the other to Trash. Command palette. Statistics. Backup reminder. |
| `backup.spec.js` | Full ZIP download (manifest and originals checked). Delete the whole library (the confirmation word is required). Restore with a validated preview, then search and tags work again. Restoring the same ZIP again adds nothing. JSON/CSV exports. |
| `ocr.spec.js` | Real Tesseract OCR in the page under the CSP: reads "FATURË … Totali" from the synthetic receipt, suggests the *Fatura* category with evidence, the text becomes searchable, and **no request leaves the app's origin**. |
| `offline.spec.js` | The service worker installs without reloading the page, the shell is cached and screenshots are not, the library opens and shows thumbnails offline, and the offline indicator appears. The CSP header is present, has no third-party origins and no `'unsafe-eval'`, and blocks an injected inline script. |
| `mobile.spec.js` | Bottom navigation, the floating import button, and no sideways scrolling on 10 pages. The "More" drawer. 320 px landing and library. Menus open as bottom sheets. Dark theme and `prefers-reduced-motion`. |

## Latest results (19 October 2026)

- `npm test`: **81 passed**, 0 failed
- `npm run build`: OK
- `npm run test:e2e`: **22 passed**, 0 failed (about 30 s, including real OCR)
- ESLint 9 (`eslint:recommended`) on `src/`, `scripts/` and `tests/`: no problems

Performance, measured on this build in headless Chromium with 3,000 screenshots (each with ~250 words of OCR text): a cold reload shows the first thumbnails in 0.3–1.0 s; a search, including rendering the results, takes 230 ms for a narrow query and 430 ms when all 3,000 match; statistics take about 30 ms. Results are paginated 60 at a time.

## Not covered by automated tests

- Browsers other than Chromium. The code uses standard APIs with fallbacks (e.g. main-thread image processing when `OffscreenCanvas` is missing), but Firefox and Safari were not run here.
- Real storage-full conditions. The error path is implemented (`errors.localQuota`) but not simulated.
- Screen readers. Roles, labels, focus management and keyboard paths are tested in the browser; a manual pass with NVDA/VoiceOver is still recommended.
