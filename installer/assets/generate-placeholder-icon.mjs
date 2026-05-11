/**
 * Emit a minimal 16x16 .ico file at the path given as argv[2].
 *
 * Used by build.ps1 when installer/assets/icon.ico is missing, so the build
 * doesn't fail just because we haven't shipped a real icon yet. Replace the
 * generated file with a proper .ico whenever you're ready.
 *
 * Layout of a single-image ICO:
 *   ICONDIR  (6 bytes)
 *   ICONDIRENTRY  (16 bytes)
 *   BITMAPINFOHEADER (40 bytes)
 *   Pixel data (XOR mask)
 *   Pixel data (AND mask)
 */

import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) {
  console.error('usage: node generate-placeholder-icon.mjs <out.ico>');
  process.exit(1);
}

const W = 16;
const H = 16;
const ROW_PIXELS = W * 4; // 32-bit BGRA
const PIXEL_BYTES = ROW_PIXELS * H;
const AND_ROW = Math.ceil(W / 32) * 4; // 4 bytes per row at minimum
const AND_BYTES = AND_ROW * H;
const IMG_BYTES = 40 /* BITMAPINFOHEADER */ + PIXEL_BYTES + AND_BYTES;

const ICONDIR = Buffer.alloc(6);
ICONDIR.writeUInt16LE(0, 0); // reserved
ICONDIR.writeUInt16LE(1, 2); // type = 1 (icon)
ICONDIR.writeUInt16LE(1, 4); // image count

const ENTRY = Buffer.alloc(16);
ENTRY.writeUInt8(W, 0);
ENTRY.writeUInt8(H, 1);
ENTRY.writeUInt8(0, 2); // 0 = 256 colors (or true color)
ENTRY.writeUInt8(0, 3); // reserved
ENTRY.writeUInt16LE(1, 4); // color planes
ENTRY.writeUInt16LE(32, 6); // bits per pixel
ENTRY.writeUInt32LE(IMG_BYTES, 8);
ENTRY.writeUInt32LE(6 + 16, 12); // image data offset

const HEADER = Buffer.alloc(40);
HEADER.writeUInt32LE(40, 0); // header size
HEADER.writeInt32LE(W, 4);
HEADER.writeInt32LE(H * 2, 8); // height = real height * 2 (icon convention)
HEADER.writeUInt16LE(1, 12); // planes
HEADER.writeUInt16LE(32, 14); // bpp
HEADER.writeUInt32LE(0, 16); // compression (BI_RGB)
HEADER.writeUInt32LE(PIXEL_BYTES, 20); // image size
// remaining fields default to 0

// Solid green pixels (PZ-ish), with full alpha. Rows are stored bottom-up.
const PIXELS = Buffer.alloc(PIXEL_BYTES);
for (let i = 0; i < PIXEL_BYTES; i += 4) {
  PIXELS[i] = 0x45; // B
  PIXELS[i + 1] = 0xb6; // G
  PIXELS[i + 2] = 0x22; // R
  PIXELS[i + 3] = 0xff; // A
}

const AND = Buffer.alloc(AND_BYTES, 0); // fully transparent mask off (all visible)

writeFileSync(out, Buffer.concat([ICONDIR, ENTRY, HEADER, PIXELS, AND]));
console.log(`wrote placeholder icon to ${out}`);
