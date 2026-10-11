import zlib from 'zlib';

/**
 * Minimal PNG reader/writer with no dependencies.
 *
 * Rocky only needs to look at screenshots (compare them, not display them), so
 * this supports what screen-capture tools actually produce: non-interlaced,
 * 8-bit PNGs in grayscale, grayscale+alpha, RGB, RGBA or palette colour.
 * Anything else throws, and callers treat that as "could not look" rather than
 * as a failure of the action being checked.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE);
}

/** Decode a PNG buffer into { width, height, data } where data is RGBA bytes. */
export function decodePng(buf) {
  if (!isPng(buf)) throw new Error('not a PNG');

  let pos = 8;
  let header = null;
  let palette = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4),
        depth: body[8], colorType: body[9], interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }

  if (!header) throw new Error('PNG has no header');
  const { width, height, depth, colorType, interlace } = header;
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error('palette PNG without PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data is truncated');

  // Undo the per-row filters. One tight loop per filter type (this runs on
  // every screenshot Rocky checks, so it avoids per-byte branching).
  const px = Buffer.alloc(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride; // start of the previous row (valid when y > 0)
    switch (filter) {
      case 0:
        for (let i = 0; i < stride; i++) px[dst + i] = raw[src + i];
        break;
      case 1:
        for (let i = 0; i < bpp; i++) px[dst + i] = raw[src + i];
        for (let i = bpp; i < stride; i++) px[dst + i] = (raw[src + i] + px[dst + i - bpp]) & 0xff;
        break;
      case 2:
        if (y === 0) for (let i = 0; i < stride; i++) px[dst + i] = raw[src + i];
        else for (let i = 0; i < stride; i++) px[dst + i] = (raw[src + i] + px[up + i]) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? px[dst + i - bpp] : 0;
          const b = y > 0 ? px[up + i] : 0;
          px[dst + i] = (raw[src + i] + ((a + b) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? px[dst + i - bpp] : 0;
          const b = y > 0 ? px[up + i] : 0;
          const c = y > 0 && i >= bpp ? px[up + i - bpp] : 0;
          const p = a + b - c;
          const pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
          px[dst + i] = (raw[src + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        break;
      default:
        throw new Error(`bad PNG filter ${filter}`);
    }
  }

  // Normalise to RGBA.
  const data = new Uint8Array(width * height * 4);
  const n = width * height;
  if (colorType === 6) {
    data.set(px);
  } else if (colorType === 2) {
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 3, d += 4) {
      data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = 255;
    }
  } else if (colorType === 0) {
    for (let i = 0, d = 0; i < n; i++, d += 4) { data[d] = data[d + 1] = data[d + 2] = px[i]; data[d + 3] = 255; }
  } else if (colorType === 4) {
    for (let i = 0, d = 0; i < n; i++, d += 4) { data[d] = data[d + 1] = data[d + 2] = px[i * 2]; data[d + 3] = px[i * 2 + 1]; }
  } else {
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      const p = px[i] * 3;
      data[d] = palette[p]; data[d + 1] = palette[p + 1]; data[d + 2] = palette[p + 2]; data[d + 3] = 255;
    }
  }
  return { width, height, data };
}

// ── Encoder (used by tests and for saving debug frames) ──────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Encode RGBA bytes as an 8-bit RGBA PNG. `filterType` (0-4) is applied to every row. */
export function encodePng(width, height, rgba, { filterType = 0 } = {}) {
  const channels = 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filterType;
    for (let i = 0; i < stride; i++) {
      const cur = rgba[y * stride + i];
      const a = i >= channels ? rgba[y * stride + i - channels] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= channels ? rgba[(y - 1) * stride + i - channels] : 0;
      let pred = 0;
      if (filterType === 1) pred = a;
      else if (filterType === 2) pred = b;
      else if (filterType === 3) pred = (a + b) >> 1;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + i] = (cur - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
