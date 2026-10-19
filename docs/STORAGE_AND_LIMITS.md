# Storage and limits

Screenshot Organizer has no server and no paid tier. Its only limits are the ones the browser places on a website's storage.

## Where data is kept

| What | Where |
| --- | --- |
| Original images and thumbnails | IndexedDB, store `blobs` |
| Metadata, tags, collections, OCR text | IndexedDB |
| Settings, recent searches, language, theme | localStorage |
| App files and the OCR engine/models (for offline use) | Cache Storage (service worker) |

All of it belongs to the site's origin in **this browser profile on this device**.

## How much fits

Browsers give each site a share of the disk, not a fixed number. According to MDN's *Storage quotas and eviction criteria* (checked October 2026):

- **Chrome, Edge and other Chromium browsers:** a site may store up to **60% of the total disk size**.
- **Firefox:** without persistent storage, the smaller of **10% of the disk or 10 GiB**, shared by all origins of the same site. With persistent storage granted, up to **50% of the disk** (capped at 8 TiB).
- **Safari (macOS 14 / iOS 17 and later):** up to about **60% of the disk** per site in the Safari app. Inside other apps' web views it is about 15%, and a site saved to the Home Screen or Dock gets the 60% quota. Older Safari versions start at 1 GiB and ask the user before storing more.

Settings → Storage shows the browser's own estimate for this site ("X of Y allowed"). A typical phone screenshot is 0.3–3 MB, plus a thumbnail of about 30–80 KB.

## When storage is full

The import of that file fails with "Browser storage is full", and nothing is half-saved, because each screenshot is written in one transaction. Free space by emptying Trash, deleting large files (Smart views → Large files) or exact duplicates, or move older screenshots out with a backup.

## Eviction and persistent storage

Under storage pressure, browsers may delete data of sites that are not marked *persistent*. In **Settings → Storage → Request persistent storage**, the app asks the browser to keep its data. Browsers decide automatically: Chrome usually grants it to installed or frequently used sites, Firefox may ask the user. The current state is shown in Settings.

## Things that delete the library

- "Clear browsing data" / "Clear site data" for this site
- Uninstalling the browser or removing the browser profile
- Private/incognito windows (their data is discarded when they close)
- Safari with cross-site tracking prevention (the default): if you don't interact with the site (a click or tap) within **7 days of browser use**, data created by its scripts is deleted. Opening the app regularly, or adding it to the Home Screen/Dock, avoids this.

## No syncing between devices

Each browser on each device has its own separate library. To move or copy it, **download a full backup** and **restore** it on the other device (see [BACKUP_FORMAT.md](BACKUP_FORMAT.md)). Restoring only adds and skips what already exists, so it is safe to repeat.

## Backup reminder

When the library has screenshots and no full backup was made in the last 30 days, Home shows a reminder with a button to the backup page. It can be turned off in Settings → Storage.

## OCR

OCR uses the device's processor. The first time text is read, the engine (about 4 MB, one build chosen to match the processor) and the language models (Albanian about 1 MB, English about 3 MB, compressed) are loaded from the app's own server and cached for offline use. Long or very large screenshots take longer; one image is processed at a time.
