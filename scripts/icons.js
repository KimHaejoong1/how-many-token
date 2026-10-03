import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
// A geometric toolbar glyph; no image dependencies or downloaded assets.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / size, py = (y + .5) / size;
    const inside = px >= .08 && px <= .92 && py >= .08 && py <= .92;
    const line = py >= .66 && py <= .79 && px >= .21 && px <= .79;
    const bar = line && px <= .64;
    const color = !inside ? [0, 0, 0, 0] : bar ? [163, 230, 53, 255] : line ? [82, 82, 82, 255] : [38, 38, 38, 255];
    // Two small bars above the gauge keep the glyph legible at 16px.
    if (inside && py >= .25 && py <= .52 && ((px >= .22 && px <= .35) || (px >= .47 && px <= .60))) {
      color.splice(0, 4, 245, 245, 245, 255);
    }
    rows.set(color, y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(new URL(`../icons/${size}.png`, import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))
  ]));
}
