import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createWorkspace, addMedia } from '../src/index.mjs';
export async function example(name = 'b2b') { return JSON.parse(await readFile(new URL(`../examples/${name}.brief.json`, import.meta.url), 'utf8')); }
export async function content() { return JSON.parse(await readFile(new URL('../examples/b2b.site.json', import.meta.url), 'utf8')); }
export async function temporary(t) {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'site-core-')));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

// Self-made solid-colour PNG (8-bit RGB, no filter) written with node:zlib; used for tests and examples/media.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length); return out;
}
export function solidPng(width, height, [r, g, b]) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)), { level: 9 });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}
export const EXAMPLE_IMAGES = { factory: [16, 9, [36, 75, 184]], 'sample-bottle': [12, 12, [214, 120, 40]] };
export async function fullExample() {
  const read = async name => JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
  return { brief: await read('b2b-full.brief.json'), site: await read('b2b-full.site.json') };
}
export const exampleImage = id => fileURLToPath(new URL(`../examples/media/${id}.png`, import.meta.url));
// Workspace for the full example with both self-made PNGs copied into media/ (not yet built).
export async function fullWorkspace(t, change = () => {}) {
  const temp = await temporary(t), workspace = join(temp, 'full'), { brief, site } = await fullExample();
  change(brief, site);
  await createWorkspace(workspace, brief, site);
  for (const id of Object.keys(EXAMPLE_IMAGES)) await addMedia(workspace, exampleImage(id), { id });
  return { temp, workspace };
}
