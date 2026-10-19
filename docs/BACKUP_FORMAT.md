# Backup format

A full backup is a standard ZIP file you can open with any archive tool:

```
screenshot-organizer-backup-2026-10-19-14-30.zip
├── manifest.json
├── originals/<id>.<png|jpg|webp|gif|avif>     the untouched original files
└── thumbnails/<id>.<webp|jpg>                   optional, regenerated on restore if missing
```

The JSON and CSV exports contain the same metadata without the images.

## manifest.json

```json
{
  "format": "screenshot-organizer-backup",
  "version": 1,
  "export_id": "1f0c…",
  "exported_at": "2026-10-19T12:30:00.000Z",
  "app_version": "1.0.0",
  "counts": { "screenshots": 2, "collections": 1 },
  "collections": [
    { "id": "c1…", "name": "Punë", "description": "", "color": "#0EA5E9", "icon": "briefcase", "created_at": "…" }
  ],
  "screenshots": [
    {
      "id": "a1…",
      "title": "Fatura e marsit",
      "description": "",
      "notes": "",
      "original_filename": "IMG_2041.png",
      "mime_type": "image/png",
      "file_size": 184233,
      "width": 1170,
      "height": 2532,
      "captured_at": "2026-03-04T09:12:00.000Z",
      "captured_source": "filename",
      "imported_at": "2026-03-05T18:00:00.000Z",
      "is_favorite": true,
      "is_trashed": false,
      "trashed_at": null,
      "ocr_status": "done",
      "ocr_text": "FATURË KEDS …",
      "ocr_lang": "sqi+eng",
      "category": "invoices",
      "category_source": "auto",
      "category_evidence": [{ "source": "ocr", "word": "fature" }],
      "content_hash": "<sha-256 of the original file, hex>",
      "phash": "<64-bit perceptual hash, 16 hex chars>",
      "tags": ["fatura"],
      "collection_ids": ["c1…"],
      "file": "originals/a1….png",
      "thumbnail": "thumbnails/a1….webp"
    }
  ]
}
```

## Restore rules

1. **Validate the structure.** The format name must match and `version` must not be newer than the app supports. Ids must be unique strings, dates must be ISO, and `file` must be `originals/<name>` (paths with `/..` or other folders are rejected).
2. **Validate every image.** The file must exist in the ZIP, its real type is detected from its bytes, and its SHA-256 must equal `content_hash`. Items that fail are listed with the reason and skipped. The rest can still be restored.
3. **Preview.** You see how many screenshots are valid, how many already exist in the library (same SHA-256), and how many collections have the same name as existing ones.
4. **Choose.** For existing screenshots, *skip them* (the default) or *add as copies*. For collections with the same name, *merge* (the default) or *create new*, which adds "(2)" to the name.
5. **Restore only adds.** Nothing in the library is modified or overwritten. Text is cleaned and length-limited, and colors and icons are checked against allow-lists. Thumbnails, dimensions and hashes are recomputed from the original.
6. **Resume.** Progress is recorded per item under `restore:<export_id>`. If the tab is closed or the restore is stopped, choosing the same file again continues where it stopped. After a fully successful restore the record is removed.

Backups made from a selection contain only those screenshots and the collections they belong to. Only full backups update "last backup" and the backup reminder.
