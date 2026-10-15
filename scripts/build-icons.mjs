import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const logo = readFileSync(new URL('../assets/bigbikes-logo.png', import.meta.url));
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!logo.subarray(0, 8).equals(signature)) throw new Error('The BigBikes logo must be a PNG file.');

let width = 0;
let height = 0;
const compressed = [];
for (let offset = 8; offset < logo.length;) {
  const length = logo.readUInt32BE(offset);
  const type = logo.toString('ascii', offset + 4, offset + 8);
  const data = logo.subarray(offset + 8, offset + 8 + length);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('Expected a non-interlaced, 8-bit RGBA logo PNG.');
  }
  if (type === 'IDAT') compressed.push(data);
  offset += length + 12;
}

const rowBytes = width * 4;
const inflated = inflateSync(Buffer.concat(compressed));
const source = Buffer.alloc(rowBytes * height);
const paeth = (left, above, upperLeft) => {
  const estimate = left + above - upperLeft;
  const dl = Math.abs(estimate - left);
  const da = Math.abs(estimate - above);
  const du = Math.abs(estimate - upperLeft);
  return dl <= da && dl <= du ? left : da <= du ? above : upperLeft;
};
for (let y = 0; y < height; y += 1) {
  const input = y * (rowBytes + 1);
  const output = y * rowBytes;
  const filter = inflated[input];
  for (let x = 0; x < rowBytes; x += 1) {
    const left = x >= 4 ? source[output + x - 4] : 0;
    const above = y > 0 ? source[output + x - rowBytes] : 0;
    const upperLeft = y > 0 && x >= 4 ? source[output + x - rowBytes - 4] : 0;
    const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0;
    source[output + x] = (inflated[input + 1 + x] + predictor) & 255;
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function bilinear(x, y, channel) {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, x - x0);
  const fy = Math.max(0, y - y0);
  const at = (px, py) => source[(py * width + px) * 4 + channel];
  return (at(x0, y0) * (1 - fx) * (1 - fy)) + (at(x1, y0) * fx * (1 - fy)) + (at(x0, y1) * (1 - fx) * fy) + (at(x1, y1) * fx * fy);
}
function icon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const background = [241, 240, 235];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      pixels[at] = background[0];
      pixels[at + 1] = background[1];
      pixels[at + 2] = background[2];
      pixels[at + 3] = 255;
    }
  }
  const targetWidth = size * 0.94;
  const targetHeight = targetWidth * height / width;
  const left = (size - targetWidth) / 2;
  const top = (size - targetHeight) / 2;
  for (let y = Math.floor(top); y < Math.ceil(top + targetHeight); y += 1) {
    if (y < 0 || y >= size) continue;
    for (let x = Math.floor(left); x < Math.ceil(left + targetWidth); x += 1) {
      if (x < 0 || x >= size) continue;
      const sx = ((x + 0.5 - left) / targetWidth) * width - 0.5;
      const sy = ((y + 0.5 - top) / targetHeight) * height - 0.5;
      const alpha = bilinear(sx, sy, 3) / 255;
      const at = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[at + channel] = Math.round((bilinear(sx, sy, channel) * alpha) + (background[channel] * (1 - alpha)));
      }
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), icon(size));
writeFileSync(new URL('../icons/apple-touch-icon.png', import.meta.url), icon(180));
console.log('Generated PWA icons from the supplied BigBikes logo: 192, 512 and 180 px.');
