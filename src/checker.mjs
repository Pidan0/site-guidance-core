import { posix } from 'node:path';
import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprints(files) {
  return Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => [path, sha256(content)]));
}
const unescape = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const HEAD_CHECKS = [
  ['title', /<title>[^<]+<\/title>/], ['description', /<meta name="description" content="[^"]+">/], ['viewport', /<meta name="viewport"/], ['main', /<main\b/]
];

// Exact set of <loc> URLs in the sitemap (unescaped), so a prefix or substring of a page URL never counts as present.
export function sitemapLocations(xml) {
  return new Set([...(xml ?? '').matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => unescape(match[1].trim())));
}

function checkLinks(page, html, files, add) {
  for (const match of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
    const target = unescape(match[1]);
    if (/^(https:|mailto:|tel:)/i.test(target)) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('/')) { add(page.file, 'unsafe-link', `不支持的链接：${target}`); continue; }
    const fragmentless = target.split('#')[0].split('?')[0];
    if (!fragmentless) continue;
    const path = posix.normalize(posix.join(posix.dirname(page.file), fragmentless));
    if (path.startsWith('../') || !files.has(path)) add(page.file, 'local-link', `站内目标不存在：${target}`);
  }
}

function checkPage(page, html, { files, locations, publication }, add) {
  if ((html.match(/<h1\b/gi) ?? []).length !== 1) add(page.file, 'h1', '页面必须有且只有一个H1');
  for (const [check, pattern] of HEAD_CHECKS) if (!pattern.test(html)) add(page.file, check, `缺少${check}`);
  const canonical = unescape(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? '');
  if (canonical !== page.canonical) add(page.file, 'canonical', 'canonical与预期页面地址不一致');
  if (!locations.has(page.canonical)) add(page.file, 'sitemap', '站点地图缺少页面地址');
  if (/<script\b(?![^>]*type="application\/ld\+json")/i.test(html)) add(page.file, 'script', '静态内容不应注入执行脚本');
  for (const json of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(json[1]); } catch { add(page.file, 'jsonld', '结构化数据不是合法JSON'); }
  }
  if (publication && /content="noindex/.test(html)) add(page.file, 'robots', '发布包仍然禁止索引');
  if (!publication && !/content="noindex/.test(html)) add(page.file, 'robots', '草稿缺少noindex');
  checkLinks(page, html, files, add);
}

export function checkFiles(files, pages, { publication = false } = {}) {
  const issues = [], add = (page, check, message) => issues.push({ page, check, message });
  if (!pages.length) add('/', 'empty-site', '站点没有待验收页面');
  const locations = sitemapLocations(files.get('sitemap.xml')), expected = new Set(pages.map(p => p.canonical));
  for (const page of pages) {
    const html = files.get(page.file);
    if (typeof html !== 'string') { add(page.file, 'missing-page', '页面不存在'); continue; }
    checkPage(page, html, { files, locations, publication }, add);
  }
  for (const loc of locations) if (!expected.has(loc)) add('sitemap.xml', 'sitemap', `站点地图包含非本站页面：${loc}`);
  if (!files.has('robots.txt')) add('robots.txt', 'robots', '缺少robots.txt');
  if (publication && /Disallow:\s*\//.test(files.get('robots.txt') ?? '')) add('robots.txt', 'robots', '发布包仍然禁止抓取');
  return { passed: issues.length === 0, pages: pages.length, issues, scope: '本地结构、链接、草稿状态与文件检查；不包含视觉、送达、DNS或支付实网验证' };
}
