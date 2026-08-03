import { deflateSync } from "node:zlib";

// Noderyx generates its own launcher artwork so a new mobile project has valid
// PNG icons without pulling an image library into the dependency tree.

const KERNEL_NIGHT = [0x09, 0x0b, 0x14];
const NODERYX_VIOLET = [0x7c, 0x5c, 0xff];
const RUNTIME_CYAN = [0x22, 0xd3, 0xee];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/**
 * Encode 8-bit RGBA pixels as a PNG. `paint(x, y)` returns [r, g, b, a].
 */
export function encodePng(width, height, paint) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    let offset = y * stride + 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function mix(from, to, amount) {
  const t = Math.min(1, Math.max(0, amount));
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t)
  ];
}

function insideRoundedSquare(u, v, inset, radius) {
  const min = inset;
  const max = 1 - inset;
  if (u < min || u > max || v < min || v > max) return false;

  const cornerX = u < min + radius ? min + radius : (u > max - radius ? max - radius : u);
  const cornerY = v < min + radius ? min + radius : (v > max - radius ? max - radius : v);
  const dx = u - cornerX;
  const dy = v - cornerY;
  return dx * dx + dy * dy <= radius * radius;
}

function insideGlyph(u, v, inset) {
  // The "N" mark: two uprights joined by a diagonal, drawn in normalised space.
  const left = inset;
  const right = 1 - inset;
  const top = inset;
  const bottom = 1 - inset;
  if (u < left || u > right || v < top || v > bottom) return false;

  const stroke = (right - left) * 0.22;
  if (u <= left + stroke) return true;
  if (u >= right - stroke) return true;

  const progress = (v - top) / (bottom - top);
  const center = left + stroke / 2 + progress * (right - left - stroke);
  return Math.abs(u - center) <= stroke * 0.78;
}

function markPainter({ squareInset, radius, glyphInset }) {
  return (u, v) => {
    if (!insideRoundedSquare(u, v, squareInset, radius)) return KERNEL_NIGHT;
    if (insideGlyph(u, v, glyphInset)) return KERNEL_NIGHT;
    const span = 1 - squareInset * 2;
    return mix(NODERYX_VIOLET, RUNTIME_CYAN, (u + v - squareInset * 2) / (span * 2));
  };
}

function draw(size, painter) {
  const samples = size <= 1024 ? 3 : 1;
  const total = samples * samples;

  return encodePng(size, size, (x, y) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < samples; sy += 1) {
      for (let sx = 0; sx < samples; sx += 1) {
        const color = painter(
          (x + (sx + 0.5) / samples) / size,
          (y + (sy + 0.5) / samples) / size
        );
        r += color[0];
        g += color[1];
        b += color[2];
      }
    }
    return [Math.round(r / total), Math.round(g / total), Math.round(b / total), 255];
  });
}

/**
 * Draw the Noderyx launcher icon. A maskable icon fills the whole canvas and
 * keeps the mark inside the centre safe zone that Android may crop to.
 */
export function noderyxIcon(size, { maskable = false } = {}) {
  return draw(size, maskable
    ? markPainter({ squareInset: 0, radius: 0, glyphInset: 0.3 })
    : markPainter({ squareInset: 0.08, radius: 0.2, glyphInset: 0.32 }));
}

/**
 * Splash artwork: a centred mark on the Kernel Night background.
 */
export function noderyxSplash(size = 2048) {
  const mark = markPainter({ squareInset: 0.08, radius: 0.2, glyphInset: 0.32 });
  const scale = 0.24;
  const start = (1 - scale) / 2;

  return draw(size, (u, v) => {
    const localU = (u - start) / scale;
    const localV = (v - start) / scale;
    if (localU < 0 || localU > 1 || localV < 0 || localV > 1) return KERNEL_NIGHT;
    return mark(localU, localV);
  });
}

export const ICON_SIZES = [192, 512];
