import { posix } from 'node:path';
import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprints(files) { return Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => [path, sha256(content)])); }
const unescape = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function checkFiles(files, pages, { publication = false } = {}) {
  const issues = [], add = (page, check, message) => issues.push({ page, check, message });
  if (!pages.length) add('/', 'empty-site', '站点没有待验收页面');
  const sitemap = files.get('sitemap.xml') ?? '';
  for (const p of pages) {
    const html = files.get(p.file);
    if (typeof html !== 'string') { add(p.file, 'missing-page', '页面不存在'); continue; }
    if ((html.match(/<h1\b/gi) ?? []).length !== 1) add(p.file, 'h1', '页面必须有且只有一个H1');
    for (const [check, pattern] of [['title', /<title>[^<]+<\/title>/], ['description', /<meta name="description" content="[^"]+">/], ['viewport', /<meta name="viewport"/], ['main', /<main\b/]]) if (!pattern.test(html)) add(p.file, check, `缺少${check}`);
    const canonical = unescape(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? '');
    if (canonical !== p.canonical) add(p.file, 'canonical', 'canonical与预期页面地址不一致');
    if (!sitemap.includes(escapeXml(p.canonical))) add(p.file, 'sitemap', '站点地图缺少页面地址');
    if (/<script\b(?![^>]*type="application\/ld\+json")/i.test(html)) add(p.file, 'script', '静态内容不应注入执行脚本');
    for (const json of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) try { JSON.parse(json[1]); } catch { add(p.file, 'jsonld', '结构化数据不是合法JSON'); }
    if (publication && /content="noindex/.test(html)) add(p.file, 'robots', '发布包仍然禁止索引');
    if (!publication && !/content="noindex/.test(html)) add(p.file, 'robots', '草稿缺少noindex');
    for (const match of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
      const target = unescape(match[1]);
      if (/^(https:|mailto:|tel:)/i.test(target)) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('/')) { add(p.file, 'unsafe-link', `不支持的链接：${target}`); continue; }
      const fragmentless = target.split('#')[0].split('?')[0];
      if (!fragmentless) continue;
      const path = posix.normalize(posix.join(posix.dirname(p.file), fragmentless));
      if (path.startsWith('../') || !files.has(path)) add(p.file, 'local-link', `站内目标不存在：${target}`);
    }
  }
  if (!files.has('robots.txt')) add('robots.txt', 'robots', '缺少robots.txt');
  if (publication && /Disallow:\s*\//.test(files.get('robots.txt') ?? '')) add('robots.txt', 'robots', '发布包仍然禁止抓取');
  return { passed: issues.length === 0, pages: pages.length, issues, scope: '本地结构、链接、草稿状态与文件检查；不包含视觉、送达、DNS或支付实网验证' };
}
function escapeXml(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
