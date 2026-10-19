// Pure image helpers shared by the main thread and the image worker.
// No DOM access here, so this module also runs inside a Web Worker.

export const THUMB_MAX_WIDTH = 480;
export const THUMB_MAX_HEIGHT = 1200;

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Thumbnail geometry. Very tall screenshots (long scrolling captures) keep
 * their top section so thumbnails stay recognisable; the original is untouched.
 */
export function thumbnailGeometry(width, height) {
  const scale = Math.min(1, THUMB_MAX_WIDTH / width);
  const targetWidth = Math.max(1, Math.round(width * scale));
  let targetHeight = Math.max(1, Math.round(height * scale));
  let sourceHeight = height;
  if (targetHeight > THUMB_MAX_HEIGHT) {
    targetHeight = THUMB_MAX_HEIGHT;
    sourceHeight = Math.round(THUMB_MAX_HEIGHT / scale);
  }
  return { targetWidth, targetHeight, sourceWidth: width, sourceHeight, cropped: sourceHeight < height };
}

const PH_N = 32;
const PH_COS = Array.from({ length: 8 }, (_, u) => Float64Array.from({ length: PH_N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PH_N))));
export const PHASH_SIZE = PH_N;

/**
 * Perceptual hash (pHash): 2-D DCT of a 32×32 grayscale image, the 8×8
 * lowest frequencies compared with their median → 64 bits as 16 hex chars.
 * The median threshold keeps about half the bits informative even for
 * screenshots that are mostly flat background, so different screenshots stay
 * far apart while re-encoded or resized copies stay close.
 * @param {ArrayLike<number>} gray 1024 luminance values, row-major, 32 wide
 */
export function pHashFromGray(gray) {
  if (gray.length !== PH_N * PH_N) throw new Error('pHash expects 32x32 grayscale input');
  const coeffs = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < PH_N; y++) {
        const cy = PH_COS[u][y];
        const row = y * PH_N;
        for (let x = 0; x < PH_N; x++) sum += gray[row + x] * cy * PH_COS[v][x];
      }
      coeffs[u * 8 + v] = sum;
    }
  }
  const ac = Array.from(coeffs.subarray(1)).sort((a, b) => a - b);
  const median = ac[Math.floor(ac.length / 2)];
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let k = 0; k < 4; k++) nibble = (nibble << 1) | (coeffs[i + k] > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function rgbaToGray(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

const POPCOUNT = Array.from({ length: 16 }, (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));

export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

// --- Capture date detection -------------------------------------------------

function validDate(y, mo, d, h = 0, mi = 0, s = 0) {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (date.getMonth() !== mo - 1) return null;
  return date;
}

/**
 * Reads the capture time that phones and desktops write into screenshot names:
 * "Screenshot 2026-05-01 at 10.22.33", "Screenshot_20260501-102233",
 * "IMG_20260501_102233", "WhatsApp Image 2026-05-01 at 10.22.33", …
 */
export function captureDateFromFilename(name) {
  const s = String(name ?? '');
  const re = /(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:(?:[ _\-T]+(?:at[ _]+|um[ _]+|me[ _]+)?)(\d{1,2})[.\-_:h]?(\d{2})(?:[.\-_:m]?(\d{2}))?(?:\s*([AaPp])[Mm])?)?/;
  const m = s.match(re);
  if (!m) return null;
  let hour = m[4] != null ? Number(m[4]) : 0;
  const ampm = m[7]?.toLowerCase();
  if (ampm === 'p' && hour < 12) hour += 12;
  if (ampm === 'a' && hour === 12) hour = 0;
  return validDate(Number(m[1]), Number(m[2]), Number(m[3]), hour, m[5] != null ? Number(m[5]) : 0, m[6] != null ? Number(m[6]) : 0);
}

function parseExifDateString(str) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(str);
  return m ? validDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : null;
}

/** Parses a TIFF/EXIF block and returns DateTimeOriginal, falling back to DateTime. */
export function dateFromTiff(view, start) {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (o) => view.getUint16(start + o, little);
  const u32 = (o) => view.getUint32(start + o, little);
  if (u16(2) !== 42) return null;
  const readAscii = (off, count) => {
    let out = '';
    for (let i = 0; i < count - 1 && start + off + i < view.byteLength; i++) out += String.fromCharCode(view.getUint8(start + off + i));
    return out;
  };
  const scanIfd = (ifdOffset, wanted) => {
    const found = {};
    if (start + ifdOffset + 2 > view.byteLength) return found;
    const count = u16(ifdOffset);
    for (let i = 0; i < count && i < 512; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (start + entry + 12 > view.byteLength) break;
      const tag = u16(entry);
      if (wanted.includes(tag)) {
        const type = u16(entry + 2);
        const n = u32(entry + 4);
        if (tag === 0x8769) found[tag] = u32(entry + 8);
        else if (type === 2) found[tag] = readAscii(n > 4 ? u32(entry + 8) : entry + 8, n);
      }
    }
    return found;
  };
  const ifd0 = scanIfd(u32(4), [0x0132, 0x8769]);
  let result = null;
  if (ifd0[0x8769]) {
    const exif = scanIfd(ifd0[0x8769], [0x9003, 0x9004]);
    result = parseExifDateString(exif[0x9003] ?? exif[0x9004] ?? '');
  }
  return result ?? parseExifDateString(ifd0[0x0132] ?? '');
}

/** Capture date from JPEG EXIF, PNG eXIf or PNG "Creation Time" text chunks. */
export function captureDateFromBytes(buffer, mime) {
  try {
    const view = new DataView(buffer);
    if (mime === 'image/jpeg') {
      let off = 2;
      while (off + 4 < view.byteLength) {
        if (view.getUint8(off) !== 0xff) break;
        const marker = view.getUint8(off + 1);
        const len = view.getUint16(off + 2);
        if (marker === 0xe1 && view.getUint32(off + 4) === 0x45786966) return dateFromTiff(view, off + 10);
        if (marker === 0xda) break;
        off += 2 + len;
      }
    } else if (mime === 'image/png') {
      let off = 8;
      while (off + 12 <= view.byteLength) {
        const len = view.getUint32(off);
        const type = String.fromCharCode(view.getUint8(off + 4), view.getUint8(off + 5), view.getUint8(off + 6), view.getUint8(off + 7));
        if (type === 'eXIf') return dateFromTiff(view, off + 8);
        if (type === 'tEXt' || type === 'iTXt') {
          const bytes = new Uint8Array(buffer, off + 8, Math.min(len, 400));
          const text = new TextDecoder('latin1').decode(bytes);
          const [key, ...rest] = text.split('\u0000');
          if (key === 'Creation Time') {
            const value = rest.filter(Boolean).pop() ?? '';
            const exif = parseExifDateString(value);
            if (exif) return exif;
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1990) return parsed;
          }
        }
        if (type === 'IDAT' || type === 'IEND') break;
        off += 12 + len;
      }
    }
  } catch {
    /* malformed metadata is ignored; the image itself is still valid */
  }
  return null;
}
