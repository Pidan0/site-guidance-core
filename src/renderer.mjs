import { posix } from 'node:path';
import { httpsUrl } from './schema.mjs';
import { invariant } from './errors.mjs';

export const supportedLocales = ['zh-CN', 'en'];
const labels = {
  'zh-CN': {
    home: '首页', catalog: '产品与服务', about: '关于我们', contact: '联系我们', more: '了解详情', inquiry: '发送咨询',
    purchase: '前往购买入口', booking: '前往预约入口', faq: '常见问题', language: '语言', back: '返回目录'
  },
  en: {
    home: 'Home', catalog: 'Products & services', about: 'About', contact: 'Contact', more: 'Details', inquiry: 'Contact us',
    purchase: 'Go to purchase', booking: 'Go to booking', faq: 'Questions', language: 'Language', back: 'Back to catalog'
  }
};
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ENTITIES[c]);
const text = (value, field, required = false) => {
  invariant(value === undefined || typeof value === 'string', 'INVALID_CONTENT', `${field} 必须为文本`);
  if (required) invariant(value?.trim(), 'MISSING_CONTENT', `缺少 ${field}`);
  invariant(!value || value.length <= 30000, 'INVALID_CONTENT', `${field} 内容过长`);
  return value?.trim() ?? '';
};
function keys(value, allowed, field) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CONTENT', `${field} 必须为对象`);
  for (const key of Object.keys(value)) invariant(allowed.includes(key), 'INVALID_CONTENT', `${field}.${key} 不是支持的内容字段`);
}
function itemList(raw, field, product = false) {
  if (raw === undefined) return [];
  invariant(Array.isArray(raw) && raw.length <= 200, 'INVALID_CONTENT', `${field} 必须是最多200项的数组`);
  const seen = new Set();
  return raw.map((item, i) => {
    const at = `${field}[${i}]`;
    keys(item, ['id', 'name', 'summary', 'description'], at);
    invariant(typeof item.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id), 'INVALID_CONTENT', `${at}.id 不允许路径或特殊字符`);
    invariant(!seen.has(item.id), 'INVALID_CONTENT', `${field} 出现重复ID`); seen.add(item.id);
    return {
      id: item.id, name: text(item.name, `${at}.name`, true), summary: text(item.summary, `${at}.summary`, true),
      description: text(item.description, `${at}.description`, product)
    };
  });
}

function normalizeLocale(locale, code) {
  keys(locale, ['brand', 'headline', 'summary', 'about', 'products', 'services', 'faq'], `locales.${code}`);
  const out = {
    brand: text(locale.brand, `${code}.brand`, true), headline: text(locale.headline, `${code}.headline`, true),
    summary: text(locale.summary, `${code}.summary`, true), about: text(locale.about, `${code}.about`, true),
    products: itemList(locale.products, `${code}.products`, true), services: itemList(locale.services, `${code}.services`)
  };
  if (locale.faq !== undefined) invariant(Array.isArray(locale.faq) && locale.faq.length <= 30, 'INVALID_CONTENT', `${code}.faq 必须为数组`);
  out.faq = (locale.faq ?? []).map((q, i) => {
    keys(q, ['question', 'answer'], `${code}.faq[${i}]`);
    return { question: text(q.question, `${code}.faq[${i}].question`, true), answer: text(q.answer, `${code}.faq[${i}].answer`, true) };
  });
  return out;
}

function normalizeContact(input) {
  const contact = {};
  if (!input) return contact;
  keys(input, ['email', 'phone', 'whatsapp'], 'contact');
  if (input.email !== undefined) {
    invariant(typeof input.email === 'string' && /^[^\s<>"'@]+@[^\s<>"'@]+\.[a-z]{2,}$/i.test(input.email), 'INVALID_CONTENT', 'email格式错误');
    contact.email = input.email;
  }
  if (input.whatsapp !== undefined) {
    invariant(typeof input.whatsapp === 'string' && /^[1-9]\d{7,14}$/.test(input.whatsapp), 'INVALID_CONTENT', 'whatsapp使用带国家码的纯数字');
    contact.whatsapp = input.whatsapp;
  }
  if (input.phone !== undefined) {
    invariant(typeof input.phone === 'string' && /^[+()\d -]{5,40}$/.test(input.phone), 'INVALID_CONTENT', 'phone格式错误');
    contact.phone = input.phone;
  }
  return contact;
}

function normalizeTheme(theme) {
  const primary = theme?.primary ?? '#244bb8';
  if (theme) keys(theme, ['primary'], 'theme');
  invariant(typeof primary === 'string' && /^#[0-9a-f]{6}$/i.test(primary), 'INVALID_CONTENT', '主题色必须为六位十六进制色值');
  const rgb = [1, 3, 5].map(i => parseInt(primary.slice(i, i + 2), 16) / 255).map(x => (x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4));
  invariant(1.05 / (.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] + .05) >= 4.5, 'INVALID_CONTENT', '主题色与白字对比度需达到4.5:1');
  return { primary };
}

export function normalizeContent(input, brief) {
  keys(input, ['schemaVersion', 'baseUrl', 'defaultLocale', 'locales', 'contact', 'theme'], 'site');
  invariant(input.schemaVersion === 1, 'INVALID_CONTENT', 'site.schemaVersion 必须为1');
  const url = httpsUrl(input.baseUrl, 'baseUrl');
  invariant(!url.search && !url.hash, 'INVALID_CONTENT', 'baseUrl 不允许查询参数或片段');
  // Project subdirectories (e.g. GitHub Pages /repo/) are first-class base URLs.
  const baseUrl = url.href.replace(/\/?$/, '/');
  keys(input.locales, Object.keys(input.locales ?? {}), 'locales');
  const languages = brief.languages ?? [];
  invariant(languages.length && languages.includes(input.defaultLocale), 'LANGUAGE_MISMATCH', '默认语言必须在需求语言内');
  const complete = Object.keys(input.locales).length === languages.length && languages.every(x => Object.hasOwn(input.locales, x));
  invariant(complete, 'LANGUAGE_MISMATCH', '每一种需求语言都必须提供完整内容，不能静默跳过');
  invariant(languages.every(x => supportedLocales.includes(x)), 'UNSUPPORTED_LOCALE', '本地渲染当前只支持zh-CN/en，其他语言先补界面与译文审核');
  const locales = Object.fromEntries(languages.map(code => [code, normalizeLocale(input.locales[code], code)]));
  const baseline = locales[input.defaultLocale];
  if (brief.features?.catalog === true) {
    invariant(baseline.products.length || baseline.services.length, 'MISSING_CONTENT', '需求包含目录，必须提供实际产品或服务，不能生成空目录');
  }
  const ids = list => list.map(x => x.id).sort().join('|');
  for (const [code, value] of Object.entries(locales)) for (const field of ['products', 'services']) {
    invariant(ids(value[field]) === ids(baseline[field]), 'LANGUAGE_MISMATCH', `${code}.${field} 与默认语言条目ID不一致`);
  }
  const contact = normalizeContact(input.contact);
  if (brief.goals.includes('inquiry')) invariant(contact.email || contact.whatsapp || contact.phone, 'MISSING_CONTACT', '咨询目标至少需要一个有效联系方式');
  return { schemaVersion: 1, baseUrl, defaultLocale: input.defaultLocale, locales, contact, theme: normalizeTheme(input.theme) };
}

function relative(from, to) { return posix.relative(posix.dirname(from), to) || posix.basename(to); }
function prefix(site, lang) { return lang === site.defaultLocale ? '' : `${lang}/`; }
function paragraph(value) { return value.split(/\n\s*\n/).map(x => `<p>${escapeHtml(x).replace(/\n/g, '<br>')}</p>`).join(''); }
const pageFile = (site, lang, kind) => `${prefix(site, lang)}${kind === 'home' ? 'index' : kind}.html`;
const CSS = [
  '*{box-sizing:border-box}body{margin:0;font:17px/1.8 "PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#17263d;background:#f5f7fb}',
  'a{color:var(--primary);text-underline-offset:4px}a:focus-visible{outline:3px solid var(--primary);outline-offset:4px}',
  '.wrap{max-width:1100px;margin:auto;padding:25px}header{background:#fff;border-bottom:1px solid #dce3ef}',
  '.nav{display:flex;justify-content:space-between;gap:20px;align-items:center;flex-wrap:wrap}.nav strong{font-size:21px}',
  'nav{display:flex;gap:20px;flex-wrap:wrap}main{min-height:65vh;padding-top:35px!important;padding-bottom:55px!important}',
  'h1{font-size:42px;line-height:1.3;margin:16px 0 23px}h2{font-size:25px;margin:30px 0 15px}.lead{font-size:21px;max-width:800px;color:#52617a}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:20px}',
  '.card{padding:25px;background:#fff;border:1px solid #dce3ef;border-radius:14px}.card h2,.card h3{margin-top:0}',
  '.cta{display:inline-block;background:var(--primary);color:white;border-radius:8px;padding:10px 20px;text-decoration:none;margin:12px 12px 12px 0}',
  'footer{border-top:1px solid #dce3ef;color:#52617a;font-size:14px}.languages{display:flex;gap:15px;margin-top:20px}',
  '.draft{padding:7px 25px;background:#fff3df;color:#6f4814;font-size:14px}.contact{display:grid;gap:12px;justify-items:start}',
  'details{margin:12px 0;background:white;border:1px solid #dce3ef;border-radius:8px;padding:15px}summary{cursor:pointer;font-weight:bold}',
  'a[aria-current=page]{font-weight:bold}@media(max-width:600px){.wrap{padding:20px}h1{font-size:31px}.lead{font-size:18px}',
  'nav{gap:13px;font-size:14px}.card{padding:20px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}'
].join('');
const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; base-uri 'none'; form-action 'none'";

function pageRoutes(site) {
  const routes = [];
  for (const [lang, t] of Object.entries(site.locales)) {
    for (const kind of ['home', 'catalog', 'about', 'contact']) routes.push({ lang, kind, file: pageFile(site, lang, kind) });
    for (const product of t.products) routes.push({ lang, kind: 'product', productId: product.id, file: `${prefix(site, lang)}products/${product.id}.html` });
  }
  return routes;
}

// Purchase and booking links come only from the confirmed brief, never from site content.
function actions(site, brief, file, lang) {
  const l = labels[lang], links = brief.features ?? {};
  return `<a class="cta" href="${relative(file, `${prefix(site, lang)}contact.html`)}">${l.inquiry}</a>`
    + (links.externalCheckoutUrl ? `<a class="cta" href="${escapeHtml(links.externalCheckoutUrl)}" rel="noopener">${l.purchase}</a>` : '')
    + (links.externalBookingUrl ? `<a class="cta" href="${escapeHtml(links.externalBookingUrl)}" rel="noopener">${l.booking}</a>` : '');
}

function catalogGrid(site, t, l, file, lang) {
  const products = t.products.map(p => `<article class="card"><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.summary)}</p>`
    + `<a href="${relative(file, `${prefix(site, lang)}products/${p.id}.html`)}">${l.more}</a></article>`);
  const services = t.services.map(s => `<article class="card"><h2>${escapeHtml(s.name)}</h2>${paragraph(s.summary)}${paragraph(s.description)}</article>`);
  return `<div class="grid">${products.join('')}${services.join('')}</div>`;
}

function contactLinks(contact) {
  return '<div class="contact">'
    + (contact.email ? `<a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>` : '')
    + (contact.whatsapp ? `<a href="https://wa.me/${contact.whatsapp}">WhatsApp</a>` : '')
    + (contact.phone ? `<a href="tel:${escapeHtml(contact.phone.replace(/[ ()-]/g, ''))}">${escapeHtml(contact.phone)}</a>` : '')
    + '</div>';
}

function pageBody(site, brief, route, product) {
  const { lang, kind, file } = route, t = site.locales[lang], l = labels[lang];
  if (kind === 'home') {
    const faqItems = t.faq.map(q => `<details><summary>${escapeHtml(q.question)}</summary>${paragraph(q.answer)}</details>`).join('');
    const faq = t.faq.length ? `<h2>${l.faq}</h2>${faqItems}` : '';
    return `<p class="lead">${escapeHtml(t.summary)}</p>${actions(site, brief, file, lang)}${catalogGrid(site, t, l, file, lang)}${faq}`;
  }
  if (kind === 'catalog') return catalogGrid(site, t, l, file, lang);
  if (kind === 'about') return paragraph(t.about);
  if (kind === 'contact') return contactLinks(site.contact);
  const back = `<p><a href="${relative(file, `${prefix(site, lang)}catalog.html`)}">${l.back}</a></p>`;
  return `<p class="lead">${escapeHtml(product.summary)}</p>${paragraph(product.description)}${actions(site, brief, file, lang)}${back}`;
}

function pageHead({ title, description, canonical, alternates, jsonld, file, publication }) {
  return '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">`
    + `<meta name="robots" content="${publication ? 'index,follow' : 'noindex,nofollow'}">`
    + `<meta http-equiv="Content-Security-Policy" content="${CSP}"><link rel="canonical" href="${escapeHtml(canonical)}">${alternates}`
    + `<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">`
    + `<meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:type" content="website">`
    + `<link rel="stylesheet" href="${relative(file, 'assets/site.css')}"><script type="application/ld+json">${jsonld}</script></head>`;
}

function renderPage(site, brief, route, routes, publication) {
  const { lang, kind, file } = route, t = site.locales[lang], l = labels[lang];
  const product = t.products.find(p => p.id === route.productId);
  const heading = kind === 'home' ? t.headline : kind === 'product' ? product.name : l[kind];
  const description = kind === 'product' ? product.summary : t.summary;
  const canonical = new URL(file, site.baseUrl).href, title = `${heading} | ${t.brand}`;
  const siblings = routes.filter(r => r.kind === kind && r.productId === route.productId);
  const alternates = siblings.map(r => `<link rel="alternate" hreflang="${r.lang}" href="${escapeHtml(new URL(r.file, site.baseUrl).href)}">`).join('');
  const languageLinks = siblings.map(r => `<a href="${relative(file, r.file)}" lang="${r.lang}">${r.lang}</a>`).join('');
  const structured = {
    '@context': 'https://schema.org', '@type': kind === 'product' ? 'Product' : 'Organization',
    name: kind === 'product' ? product.name : t.brand, description, url: canonical
  };
  const jsonld = JSON.stringify(structured).replace(/</g, '\\u003c');
  const navLinks = ['home', 'catalog', 'about', 'contact']
    .map(k => `<a href="${relative(file, pageFile(site, lang, k))}"${kind === k ? ' aria-current="page"' : ''}>${l[k]}</a>`).join('');
  const html = `<!doctype html><html lang="${lang}">${pageHead({ title, description, canonical, alternates, jsonld, file, publication })}`
    + `<body>${publication ? '' : '<div class="draft">Draft / 预览草稿</div>'}`
    + `<header><div class="wrap nav"><strong>${escapeHtml(t.brand)}</strong><nav aria-label="Navigation">${navLinks}</nav></div></header>`
    + `<main class="wrap"><h1>${escapeHtml(heading)}</h1>${pageBody(site, brief, route, product)}</main>`
    + `<footer><div class="wrap">${escapeHtml(t.brand)}<nav class="languages" aria-label="${l.language}">${languageLinks}</nav></div></footer>`
    + '</body></html>';
  return { html, page: { file, lang, canonical, title } };
}

export function renderSite(brief, rawContent, { publication = false } = {}) {
  const site = normalizeContent(rawContent, brief), files = new Map(), pages = [], routes = pageRoutes(site);
  for (const route of routes) {
    const { html, page } = renderPage(site, brief, route, routes, publication);
    files.set(route.file, html); pages.push(page);
  }
  files.set('assets/site.css', `:root{--primary:${site.theme.primary}}` + CSS);
  const urls = pages.map(p => `<url><loc>${escapeHtml(p.canonical)}</loc></url>`).join('');
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  files.set('robots.txt', `User-agent: *\n${publication ? 'Allow: /' : 'Disallow: /'}\nSitemap: ${new URL('sitemap.xml', site.baseUrl).href}\n`);
  return { files, pages, site, publication };
}

export function isPlaceholderUrl(value) {
  const host = new URL(value).hostname.toLowerCase();
  return ['example.com', 'example.org', 'example.net', 'localhost'].some(x => host === x || host.endsWith(`.${x}`)) || /\.(example|invalid|test)$/.test(host);
}
