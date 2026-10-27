import { invariant } from './errors.mjs';

const FORBIDDEN = ['__proto__', 'prototype', 'constructor'];
export const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Deep-merges objects; arrays and scalars replace the previous value as a whole.
export function mergePatch(base, patch) {
  invariant(isPlainObject(patch), 'INVALID_PATCH', 'patch必须是对象');
  const out = structuredClone(base ?? {});
  for (const [key, value] of Object.entries(patch)) {
    invariant(!FORBIDDEN.includes(key), 'INVALID_PATCH', '不允许的补丁字段');
    out[key] = isPlainObject(value) ? mergePatch(isPlainObject(out[key]) ? out[key] : {}, value) : structuredClone(value);
  }
  return out;
}

// 'operations.maintenanceOwner' + value -> { operations: { maintenanceOwner: value } }
export const patchAt = (path, value) => path.split('.').reduceRight((inner, key) => ({ [key]: inner }), value);

export const valueAt = (object, path) => path.split('.')
  .reduce((value, key) => (isPlainObject(value) && Object.hasOwn(value, key) ? value[key] : undefined), object);
