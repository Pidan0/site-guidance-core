import { readFileSync } from 'node:fs';
import { fail } from './errors.mjs';
export const briefSchema = JSON.parse(readFileSync(new URL('../schemas/brief.schema.json', import.meta.url), 'utf8'));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Only the JSON Schema vocabulary used in brief.schema.json is implemented.
export function validateSchema(value, schema, path = '$', errors = []) {
  if (schema.enum && !schema.enum.some(candidate => Object.is(value, candidate))) errors.push(`${path}: 不在允许值内`);
  if (schema.type) {
    const ok = schema.type === 'object' ? object(value) : schema.type === 'array' ? Array.isArray(value) : typeof value === schema.type;
    if (!ok) { errors.push(`${path}: 需要 ${schema.type}`); return errors; }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) errors.push(`${path}: 不能为空`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: 内容过长`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: 格式不正确`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 至少 ${schema.minItems} 项`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: 项数过多`);
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) errors.push(`${path}: 不可重复`);
    value.forEach((v, i) => validateSchema(v, schema.items ?? {}, `${path}[${i}]`, errors));
  }
  if (object(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: 缺少必填项`);
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) { errors.push(`${path}.${key}: 不允许的属性`); continue; }
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${path}.${key}: 未知字段`);
      else validateSchema(v, schema.properties?.[key] ?? {}, `${path}.${key}`, errors);
    }
  }
  return errors;
}

export function httpsUrl(value, label = 'URL') {
  let url;
  try { url = new URL(value); } catch { throw fail('INVALID_URL', `${label} 必须是完整 HTTPS 地址`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail('INVALID_URL', `${label} 只允许不含账号密码的 HTTPS 地址`);
  return url;
}

export function validateBrief(input) {
  const errors = validateSchema(input, briefSchema);
  if (errors.length) throw fail('INVALID_BRIEF', '需求资料不符合格式', errors);
  for (const field of ['externalCheckoutUrl', 'externalBookingUrl']) if (input.features?.[field]) httpsUrl(input.features[field], field);
  return structuredClone(input);
}
