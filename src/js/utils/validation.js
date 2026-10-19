// Input validation. Error results carry an i18n key, never a hardcoded string.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
export const ACCEPT_ATTRIBUTE = '.png,.jpg,.jpeg,.webp,.gif,.avif,image/png,image/jpeg,image/webp,image/gif,image/avif';
export const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

/** Detects the real image type from the first bytes, ignoring the claimed MIME. */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/**
 * Validates a File/Blob before any processing.
 * @returns {Promise<{ok: true, mime: string} | {ok: false, error: string, params?: object}>}
 */
export async function validateImageFile(file, maxBytes = MAX_FILE_BYTES) {
  if (!file || typeof file.size !== 'number') return { ok: false, error: 'errors.invalidFile' };
  if (file.size === 0) return { ok: false, error: 'errors.emptyFile' };
  if (file.size > maxBytes) return { ok: false, error: 'errors.fileTooLarge', params: { max: maxBytes } };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = sniffImageType(head);
  if (!mime || !ACCEPTED_TYPES.includes(mime)) return { ok: false, error: 'errors.unsupportedType' };
  return { ok: true, mime };
}

export function cleanFilename(name) {
  const base = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  return (base || 'screenshot').slice(0, 255);
}

export function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

export function validateCollectionName(name) {
  const v = String(name ?? '').trim();
  if (!v) return { ok: false, error: 'errors.nameRequired' };
  if (v.length > 80) return { ok: false, error: 'errors.nameTooLong', params: { max: 80 } };
  return { ok: true, value: v };
}

export function normalizeTagName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
}

export const COLLECTION_COLORS = ['#10B981', '#0EA5E9', '#6366F1', '#A855F7', '#EC4899', '#F43F5E', '#F59E0B', '#78716C'];
export const COLLECTION_ICONS = ['folder', 'briefcase', 'message-circle', 'receipt', 'plane', 'shopping-bag', 'graduation-cap', 'code', 'heart', 'star', 'bookmark', 'lightbulb'];

export function isHexColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value ?? ''));
}
