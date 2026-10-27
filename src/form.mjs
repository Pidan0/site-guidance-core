import { httpsUrl } from './schema.mjs';
import { invariant } from './errors.mjs';

export const FIELD_TYPES = ['text', 'email', 'tel', 'textarea'];
// Formspree's documented honeypot name; other services must be configured to drop submissions where it is filled.
export const HONEYPOT = '_gotcha';
const AUTOCOMPLETE = { email: 'email', tel: 'tel' };
const FORM_LABELS = {
  'zh-CN': { title: '在线咨询', send: '发送', trap: '请勿填写此项', note: '提交后由本站选用的表单接收服务处理。' },
  en: { title: 'Send an inquiry', send: 'Send', trap: 'Leave this field empty', note: 'Submissions are handled by the form service this site uses.' }
};
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeField(field, i, languages) {
  const at = `form.fields[${i}]`;
  invariant(isObject(field), 'INVALID_CONTENT', `${at} 必须为对象`);
  for (const key of Object.keys(field)) invariant(['id', 'type', 'required', 'label'].includes(key), 'INVALID_CONTENT', `${at}.${key} 不是支持的字段`);
  invariant(typeof field.id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(field.id), 'INVALID_CONTENT', `${at}.id 需为小写字母开头的简短标识`);
  invariant(FIELD_TYPES.includes(field.type), 'INVALID_CONTENT', `${at}.type 只支持 ${FIELD_TYPES.join('/')}`);
  invariant(field.required === undefined || typeof field.required === 'boolean', 'INVALID_CONTENT', `${at}.required 必须为布尔值`);
  invariant(isObject(field.label), 'MISSING_CONTENT', `${at}.label 需要按语言提供文本`);
  const label = {};
  for (const lang of languages) {
    const value = field.label[lang];
    invariant(typeof value === 'string' && value.trim() && value.length <= 200, 'MISSING_CONTENT', `${at}.label.${lang} 缺少或过长`);
    label[lang] = value.trim();
  }
  return { id: field.id, type: field.type, required: field.required === true, label };
}

// Returns null when the site has no form. A form must be confirmed in the brief, and a confirmed form must exist.
export function normalizeForm(input, brief, languages) {
  const wanted = brief.features?.forms;
  if (input === undefined) {
    invariant(wanted !== true, 'MISSING_CONTENT', '需求确认需要表单，必须在site.form提供接收地址与字段，不能静默改成纯联系方式');
    return null;
  }
  invariant(wanted === true, 'INVALID_CONTENT', '站点表单需在brief中确认features.forms=true，内容资料不能自行增加提交路径');
  invariant(isObject(input), 'INVALID_CONTENT', 'form 必须为对象');
  for (const key of Object.keys(input)) invariant(['endpoint', 'fields'].includes(key), 'INVALID_CONTENT', `form.${key} 不是支持的字段`);
  const url = httpsUrl(input.endpoint, 'form.endpoint');
  invariant(!url.hash, 'INVALID_CONTENT', 'form.endpoint 不允许片段');
  invariant(Array.isArray(input.fields) && input.fields.length && input.fields.length <= 20, 'INVALID_CONTENT', 'form.fields 需要1到20个字段');
  const fields = input.fields.map((field, i) => normalizeField(field, i, languages));
  invariant(new Set(fields.map(f => f.id)).size === fields.length, 'INVALID_CONTENT', 'form.fields 出现重复ID');
  invariant(fields.some(f => f.type === 'email' || f.type === 'tel'), 'INVALID_CONTENT', '表单至少需要一个email或tel字段，便于回复询盘');
  return { endpoint: url.href, origin: url.origin, fields };
}

// No-script POST form: explicit label/for pairs, required attributes and a visually hidden honeypot.
export function renderForm(form, lang, escapeHtml) {
  const l = FORM_LABELS[lang];
  const controls = form.fields.map(field => {
    const id = `f-${field.id}`, required = field.required ? ' required' : '', label = escapeHtml(field.label[lang]);
    const auto = AUTOCOMPLETE[field.type] ? ` autocomplete="${AUTOCOMPLETE[field.type]}"` : '';
    const control = field.type === 'textarea'
      ? `<textarea id="${id}" name="${field.id}" rows="5"${required}></textarea>`
      : `<input id="${id}" name="${field.id}" type="${field.type}"${auto}${required}>`;
    return `<div class="field"><label for="${id}">${label}${field.required ? ' *' : ''}</label>${control}</div>`;
  }).join('');
  const trap = `<div class="hp" aria-hidden="true"><label for="f-${HONEYPOT}">${l.trap}</label>`
    + `<input id="f-${HONEYPOT}" name="${HONEYPOT}" type="text" tabindex="-1" autocomplete="off"></div>`;
  return `<h2>${l.title}</h2><form class="inquiry" method="post" action="${escapeHtml(form.endpoint)}" accept-charset="utf-8">`
    + `${controls}${trap}<button type="submit">${l.send}</button><p class="note">${l.note}</p></form>`;
}
