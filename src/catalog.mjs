import { readFileSync } from 'node:fs';
import { invariant } from './errors.mjs';
const read = name => JSON.parse(readFileSync(new URL(`../knowledge/${name}.json`, import.meta.url), 'utf8'));
export const capabilities = read('capabilities').capabilities;
export const routes = read('routes').routes;
export function validateCatalog() {
  for (const list of [capabilities, routes]) invariant(new Set(list.map(x => x.id)).size === list.length, 'INVALID_CATALOG', '重复的知识条目ID');
  for (const item of capabilities) invariant(['implemented', 'integration_required', 'manual_verification', 'planned'].includes(item.status), 'INVALID_CATALOG', item.id);
  for (const route of routes) invariant(['local', 'guided', 'discovery'].includes(route.execution), 'INVALID_CATALOG', route.id);
  return { capabilities: capabilities.length, routes: routes.length };
}
validateCatalog();
