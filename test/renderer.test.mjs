import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSite, checkFiles, normalizeContent } from '../src/index.mjs';
import { example, content } from './helpers.mjs';

test('中英文、多页与产品详情生成，站内链接和地图独立检查通过', async () => {
  const result = renderSite(await example(), await content());
  assert.equal(result.pages.length, 10); assert.ok(result.files.has('zh-CN/products/sample-bottle.html'));
  assert.equal(checkFiles(result.files, result.pages).passed, true);
});
test('GitHub Pages项目子路径保留在canonical和sitemap里', async () => {
  const result = renderSite(await example(), await content());
  assert.ok(result.files.get('index.html').includes('href="https://demo.example.com/catalog/index.html"'));
  assert.ok(result.files.get('sitemap.xml').includes('/catalog/zh-CN/about.html'));
});
test('缺失译文、缺失对应产品、空的必要内容会失败', async () => {
  const b = await example(), s = await content(); delete s.locales['zh-CN']; assert.throws(() => renderSite(b, s), { code: 'LANGUAGE_MISMATCH' });
  const s2 = await content(); s2.locales['zh-CN'].products = []; assert.throws(() => renderSite(b, s2), { code: 'LANGUAGE_MISMATCH' });
  const s3 = await content(); s3.locales.en.headline = ''; assert.throws(() => renderSite(b, s3), { code: 'MISSING_CONTENT' });
});
test('品牌官网不强制编造一个产品', async () => {
  const b = await example(), s = await content(); b.goals = ['brand']; b.features.catalog = false;
  for (const value of Object.values(s.locales)) value.products = [];
  assert.equal(renderSite(b, s).pages.length, 8);
});
test('内容转义和JSON-LD防止闭合script，模板不注入可执行脚本', async () => {
  const b = await example(), s = await content();
  s.locales.en.headline = '<img src=x onerror=alert(1)>'; s.locales.en.summary = '</script><script>alert(1)</script>';
  const result = renderSite(b, s), page = result.files.get('index.html');
  assert.ok(page.includes('&lt;img')); assert.ok(!page.includes('<script>alert(1)')); assert.equal(checkFiles(result.files, result.pages).passed, true);
});
test('危险baseUrl、路径ID、联系方式、浅色主题被拒绝', async () => {
  const b = await example();
  const s = await content(); s.baseUrl = 'javascript:alert(1)'; assert.throws(() => normalizeContent(s, b), { code: 'INVALID_URL' });
  const s2 = await content(); s2.locales.en.products[0].id = '../escape'; assert.throws(() => normalizeContent(s2, b), { code: 'INVALID_CONTENT' });
  const s3 = await content(); s3.contact.email = 'test@example.com" onclick="x'; assert.throws(() => normalizeContent(s3, b), { code: 'INVALID_CONTENT' });
  const s4 = await content(); s4.theme.primary = '#eeeeee'; assert.throws(() => normalizeContent(s4, b), { code: 'INVALID_CONTENT' });
});
test('咨询站缺联系方式失败，已有外部购票入口按明确URL生成', async () => {
  const b = await example(), s = await content(); delete s.contact; assert.throws(() => renderSite(b, s), { code: 'MISSING_CONTACT' });
  const t = await example('tourism'), s2 = await content(); delete s2.locales.en; s2.defaultLocale = 'zh-CN';
  assert.ok(renderSite(t, s2).files.get('index.html').includes('https://tickets.example.com/event'));
});
test('结构检查能发现手改造成的H1、链接和索引状态错误', async () => {
  const result = renderSite(await example(), await content());
  result.files.set('index.html', result.files.get('index.html').replace('<h1>', '<h2>').replace('href="catalog.html"', 'href="missing.html"'));
  const check = checkFiles(result.files, result.pages); assert.equal(check.passed, false);
  assert.ok(check.issues.find(i => i.check === 'h1')); assert.ok(check.issues.find(i => i.check === 'local-link'));
});
test('草稿和公开包的索引策略不同，公开包仍通过本地检查', async () => {
  const b = await example(), s = await content();
  assert.match(renderSite(b, s).files.get('robots.txt'), /Disallow: \//);
  const pub = renderSite(b, s, { publication: true }); assert.equal(checkFiles(pub.files, pub.pages, { publication: true }).passed, true);
  assert.ok(!pub.files.get('index.html').includes('content="noindex'));
});
test('空站点不能作为合格网站返回', () => {
  assert.equal(checkFiles(new Map([['robots.txt', 'User-agent: *']]), []).passed, false);
});
test('站点地图按<loc>精确比较，前缀相同或多余的地址都不算通过', async () => {
  const result = renderSite(await example(), await content()), sitemap = result.files.get('sitemap.xml');
  const about = result.pages.find(p => p.file === 'about.html').canonical;
  result.files.set('sitemap.xml', sitemap.replace(`<loc>${about}</loc>`, `<loc>${about}.bak</loc>`));
  const check = checkFiles(result.files, result.pages);
  assert.ok(check.issues.find(i => i.page === 'about.html' && i.check === 'sitemap'));
  assert.ok(check.issues.find(i => i.page === 'sitemap.xml' && i.message.includes('.bak')));
});
