# Architecture

Screenshot Organizer is a static web app: an HTML page, compiled CSS and native ES modules. There is no backend. All data lives in the browser's IndexedDB.

## Layers

```
pages/ + components/      UI, built with the safe DOM helper h() (text nodes only)
        │
services/                 import, search, OCR, categories, duplicates, backup, storage, settings
        │
repo/local.repo.js        the library: metadata in memory, everything persisted in IndexedDB
        │
lib/db.js + lib/idb.js    IndexedDB schema and promise helpers
```

Pages never touch IndexedDB directly. They call `repo()` from `services/database.service.js`, which returns the open `LocalRepository`.

## IndexedDB schema (`screenshot-organizer`, version 1)

| Store | Key | Contents |
| --- | --- | --- |
| `screenshots` | `id` | metadata: title, description, notes, filename, MIME, size, dimensions, capture date and its source, import date, SHA-256 (`content_hash`), perceptual hash, favorite/trash flags, OCR status/text/language, category/source/evidence |
| `blobs` | `"<id>:original"`, `"<id>:thumb"` | the untouched original file and the WebP thumbnail |
| `collections` | `id` | name, description, color, icon |
| `tags` | `id` | name (unique ignoring case and accents) |
| `screenshot_collections` | `[screenshot_id, collection_id]` | links |
| `screenshot_tags` | `[screenshot_id, tag_id]` | links |
| `duplicate_reviews` | `[screenshot_a, screenshot_b]` | pairs the user chose to keep |
| `kv` | `key` | last backup, restore job progress |

A screenshot is created in **one transaction** covering `screenshots` and `blobs`, so a failure (for example a full disk) leaves nothing half-saved. Permanent delete removes metadata, both blobs and all links in one transaction.

On open, the repository loads all metadata (not image bytes) into memory. Listing, filtering, sorting and search run over that in-memory copy, which keeps them fast. Measured with 3,000 screenshots: first thumbnails 0.3–1.0 s after a cold reload, and a search with rendering 230–430 ms (see [TESTING.md](TESTING.md)). Image bytes are read only when a thumbnail scrolls into view or an original is opened. Object URLs are cached with an LRU limit of 800 and revoked when they are evicted.

## Import pipeline (`services/screenshot.service.js`)

For each file: **validate** (real type from magic bytes, size up to 25 MB) → **process** in a Web Worker (decode, SHA-256, thumbnail capped at 480×1200 that keeps the top of very tall captures, 32×32 grayscale → DCT perceptual hash, capture date from EXIF or PNG text) → **check** duplicates by SHA-256 → **save** in one transaction → apply the automatic category → queue OCR if enabled. If OffscreenCanvas is unavailable, processing falls back to the main thread. Each file has its own status, and files can be retried or cancelled.

The capture date comes from, in order: EXIF/PNG metadata, the filename (`Screenshot 2026-05-01 at 10.22.33`, `IMG_20260501_102233`, …), or the file's modification date. The source is stored and shown in the details panel.

## Search (`services/search.service.js`)

Text is folded (NFD with combining marks removed, then lowercased), so `ë` matches `e` and `ç` matches `c`. Every token must appear somewhere in the item. The score adds field weights (title 8, tags 6, filename 5, collections 3, description/notes 2, OCR 1), multiplied by 1.5 when a token starts a word. Matches are highlighted by mapping folded positions back to the original characters and rendering text nodes plus `<mark>`, never HTML.

## OCR (`services/ocr.service.js`)

Tesseract.js 7 runs in a worker. The worker script, the WASM core and the `sqi`/`eng` models are copied into `public/ocr/` by `scripts/copy-ocr-assets.mjs`, so they are served from the app's own origin. OCR uses a single queue, one image at a time, with progress reported to the UI. Screenshots left `pending` or `processing` by a closed tab are picked up again a few seconds after the app opens. The whole library is never OCR'd at startup; "Read text in all screenshots" is an explicit action.

## Categories (`services/category.service.js`)

These are rules, not AI. Each category has app names (weighted double) and keywords in Albanian and English. Words are matched in the filename (extension removed, split on `_` and `.`), title, tags and OCR text. The matching words are stored as evidence and shown to the user. A category set by the user (`category_source: 'user'`) is never changed automatically.

## Duplicates (`services/duplicate.service.js`)

Exact duplicates are grouped by SHA-256. Similar images are pairs whose 64-bit pHash Hamming distance is at most the threshold (default 10, adjustable in Settings) and whose aspect ratios differ by less than 8%. Pairs are clustered with union-find. Resolving a group moves the unchosen items to Trash and records the kept pairs, so they aren't suggested again.

## UI

- `router.js` is a small hash router (`#/library`, `#/s/:id`, …) with before/after hooks. Library routes open the database on demand.
- `state.js` holds a tiny store with `subscribe`/`emit`. `libraryChanged()` notifies the open pages and navigation counts.
- `lib/dom.js` provides `h(tag, props, ...children)`, which turns every string into a text node. `replace()` swaps children and skips `null`/`false`.
- `i18n/` resolves dotted keys, picks plurals with `Intl.PluralRules`, and formats dates, numbers and sizes per language. When the browser lacks Albanian locale data, it falls back to hand-written formats.
- The service worker (`src/sw.js`, with the precache list injected by `scripts/vite-sw-plugin.js`) is network-first for pages, cache-first for hashed assets, and caches OCR files after first use. It never caches screenshots, which live in IndexedDB. An update is applied only after the user accepts it.
