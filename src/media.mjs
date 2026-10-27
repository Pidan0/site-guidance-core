import { fail, invariant } from './errors.mjs';
import { createHash } from 'node:crypto';

export const MEDIA_LIMIT = 5 * 1024 * 1024;
export const MEDIA_FORMATS = { png: ['png'], jpeg: ['jpg', 'jpeg'], webp: ['webp'], avif: ['avif'] };
export const mediaIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const mediaFilePattern = /^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpe?g|webp|avif)$/;
const ascii = (buffer, start, end) => buffer.toString('latin1', start, end);
const MAX_SIDE = 20000;

function pngSize(b) {
  invariant(b.length >= 24 && ascii(b, 12, 16) === 'IHDR', 'INVALID_MEDIA', 'PNG文件头不完整');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// Walks JPEG segments to the first SOFn frame header (not DHT/JPG/DAC, which share the C4/C8/CC markers).
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    if (marker === 0xd9 || marker === 0xda || length < 2) break;
    i += 2 + length;
  }
  throw fail('INVALID_MEDIA', 'JPEG中找不到图像尺寸');
}

function webpSize(b) {
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  throw fail('INVALID_MEDIA', 'WebP文件头不完整');
}

// AVIF dimensions live in the 'ispe' (image spatial extents) property of the primary item.
function avifSize(b) {
  const at = b.indexOf('ispe', 0, 'latin1');
  invariant(at >= 4 && at + 16 <= b.length, 'INVALID_MEDIA', 'AVIF中找不到ispe尺寸');
  return { width: b.readUInt32BE(at + 8), height: b.readUInt32BE(at + 12) };
}

function formatOf(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 16 && ascii(b, 4, 8) === 'ftyp') {
    const size = Math.min(b.readUInt32BE(0), b.length), brands = [ascii(b, 8, 12)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, i + 4));
    if (brands.some(x => x === 'avif' || x === 'avis')) return 'avif';
  }
  return null;
}

// Identifies the format by magic number only; extensions and declared MIME types are never trusted.
export function inspectImage(buffer, label = '图片') {
  invariant(Buffer.isBuffer(buffer) && buffer.length, 'INVALID_MEDIA', `${label} 为空或不是文件内容`);
  invariant(buffer.length <= MEDIA_LIMIT, 'MEDIA_TOO_LARGE', `${label} 超过${MEDIA_LIMIT / 1024 / 1024}MB上限，请先压缩`);
  const format = formatOf(buffer);
  if (!format) {
    const head = buffer.toString('utf8', 0, 512).trimStart().toLowerCase();
    const svg = head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
    throw fail('UNSUPPORTED_MEDIA', svg ? `${label} 是SVG；SVG可含脚本，不作为内容图片接受` : `${label} 不是png/jpeg/webp/avif`);
  }
  const { width, height } = { png: pngSize, jpeg: jpegSize, webp: webpSize, avif: avifSize }[format](buffer);
  const sane = [width, height].every(x => Number.isInteger(x) && x > 0 && x <= MAX_SIDE);
  invariant(sane, 'INVALID_MEDIA', `${label} 尺寸无效（需为1到${MAX_SIDE}像素）`);
  return { format, ext: MEDIA_FORMATS[format][0], width, height, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}

export const extensionMatches = (file, format) => MEDIA_FORMATS[format].includes(file.split('.').pop());
export const mediaOutputPath = info => `assets/media/${info.sha256.slice(0, 16)}.${info.ext}`;
