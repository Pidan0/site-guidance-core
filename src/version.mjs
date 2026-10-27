import { readFileSync } from 'node:fs';

// Single source of truth: package.json. Revision ids hash this value, so a new engine version yields new revisions.
export const ENGINE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
