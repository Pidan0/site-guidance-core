import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function example(name = 'b2b') { return JSON.parse(await readFile(new URL(`../examples/${name}.brief.json`, import.meta.url), 'utf8')); }
export async function content() { return JSON.parse(await readFile(new URL('../examples/b2b.site.json', import.meta.url), 'utf8')); }
export async function temporary(t) {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'site-core-')));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
