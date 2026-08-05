import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";

/**
 * Generate the PWA home-screen icons from the same shape as public/icon.svg.
 *
 *   npm run icons
 *
 * Written by hand rather than with an image library because the plan does not
 * name one and this is the only raster asset in the project — a whole
 * dependency to draw one tick would be a poor trade. Android Chrome wants PNG
 * in the manifest; SVG icons are still inconsistently honoured there, and a
 * blank square on the home screen would undermine the one thing Phase 5 is for.
 *
 * Re-run after changing icon.svg so the two do not drift.
 */
const BRAND: [number, number, number] = [0x1d, 0x4e, 0xd8];
const WHITE: [number, number, number] = [0xff, 0xff, 0xff];

/** The tick from icon.svg, in a 512-unit space: (150,262) -> (214,326) -> (362,178). */
const STROKE: [number, number][][] = [
  [
    [150, 262],
    [214, 326],
  ],
  [
    [214, 326],
    [362, 178],
  ],
];
const STROKE_WIDTH = 44;
const CORNER_RADIUS = 96;

function render(size: number): Buffer {
  const scale = size / 512;
  const radius = CORNER_RADIUS * scale;
  const half = (STROKE_WIDTH * scale) / 2;

  // One byte of filter type (0) then RGBA per pixel, per scanline.
  const raw = Buffer.alloc(size * (1 + size * 4));

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;

    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const inside = insideRoundedRect(px, py, size, radius);
      if (inside <= 0) {
        // Fully transparent outside the badge.
        raw.writeUInt32BE(0, rowStart + 1 + x * 4);
        continue;
      }

      let colour = BRAND;
      let alpha = inside;

      const d = STROKE.reduce(
        (best, [a, b]) =>
          Math.min(best, distanceToSegment(px / scale, py / scale, a, b)),
        Number.POSITIVE_INFINITY,
      );
      const tick = coverage(half / scale - d);
      if (tick > 0) {
        colour = WHITE;
        alpha = Math.min(1, inside) * tick + inside * (1 - tick);
        // Blend the tick over the brand colour rather than punching a hole.
        const mixed: [number, number, number] = [
          Math.round(WHITE[0] * tick + BRAND[0] * (1 - tick)),
          Math.round(WHITE[1] * tick + BRAND[1] * (1 - tick)),
          Math.round(WHITE[2] * tick + BRAND[2] * (1 - tick)),
        ];
        colour = mixed;
        alpha = inside;
      }

      const offset = rowStart + 1 + x * 4;
      raw[offset] = colour[0];
      raw[offset + 1] = colour[1];
      raw[offset + 2] = colour[2];
      raw[offset + 3] = Math.round(alpha * 255);
    }
  }

  return png(size, raw);
}

/** Antialiased coverage: 1 well inside, 0 well outside, a ramp across one pixel. */
const coverage = (signedDistance: number) =>
  Math.max(0, Math.min(1, signedDistance + 0.5));

function insideRoundedRect(
  x: number,
  y: number,
  size: number,
  radius: number,
): number {
  const dx = Math.max(radius - x, x - (size - radius), 0);
  const dy = Math.max(radius - y, y - (size - radius), 0);
  return coverage(radius - Math.hypot(dx, dy));
}

function distanceToSegment(
  x: number,
  y: number,
  a: [number, number],
  b: [number, number],
): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = x - a[0];
  const wy = y - a[1];
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
  return Math.hypot(x - (a[0] + t * vx), y - (a[1] + t * vy));
}

/* ------------------------------------------------------------------ PNG ---- */

function png(size: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);

  return Buffer.concat([length, body, crc]);
}

for (const size of [192, 512]) {
  const file = `public/icon-${size}.png`;
  writeFileSync(file, render(size));
  console.log(`wrote ${file}`);
}
