import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { renderSite, checkFiles, buildWorkspace, recordReview, checkWorkspace, exportWorkspace, updateWorkspace } from '../src/index.mjs';
import { example, content, fullExample, fullWorkspace, solidPng } from './helpers.mjs';

const media = new Map([['factory.png', solidPng(16, 9, [36, 75, 184])], ['sample-bottle.png', solidPng(12, 12, [214, 120, 40])]]);
const render = async (change = () => {}, options = {}) => {
  const { brief, site } = await fullExample(); change(brief, site); return renderSite(brief, site, { media, ...options });
};

test('联系页渲染无脚本POST表单：label关联、必填、蜜罐，CSP只放行接收地址origin', async () => {
  const result = await render(), page = result.files.get('contact.html');
  assert.match(page, /<form class="inquiry" method="post" action="https:\/\/forms\.example\.net\/f\/demo-inquiry"/);
  assert.match(page, /<label for="f-email">Email \*<\/label><input id="f-email" name="email" type="email" autocomplete="email" required>/);
  assert.match(page, /<textarea id="f-message" name="message" rows="5" required><\/textarea>/);
  assert.match(page, /<input id="f-phone" name="phone" type="tel" autocomplete="tel">/);
  assert.match(page, /class="hp" aria-hidden="true"><label for="f-_gotcha">[^<]+<\/label><input id="f-_gotcha" name="_gotcha" type="text" tabindex="-1"/);
  assert.ok(page.includes("form-action https://forms.example.net\"")); assert.ok(!/<script\b(?![^>]*ld\+json)/.test(page));
  assert.match(result.files.get('zh-CN/contact.html'), /<label for="f-name">姓名 \*<\/label>/);
  assert.equal(checkFiles(result.files, result.pages).passed, true);
  const plain = renderSite(await example(), await content()).files.get('contact.html');
  assert.ok(plain.includes("form-action 'none'")); assert.ok(!plain.includes('<form'));
});
test('表单字段文本转义，接收地址的路径不进入CSP', async () => {
  const result = await render((b, s) => { s.form.fields[0].label.en = '<script>alert(1)</script>'; s.form.endpoint = 'https://in.forms.example.net/a/b?x=1'; });
  const page = result.files.get('contact.html');
  assert.ok(page.includes('&lt;script&gt;')); assert.ok(page.includes('form-action https://in.forms.example.net"'));
  assert.ok(page.includes('action="https://in.forms.example.net/a/b?x=1"'));
});
test('需求要表单却没提供、未确认就加表单、字段不合格都拒绝构建', async () => {
  const cases = [
    ['MISSING_CONTENT', (b, s) => { delete s.form; }],
    ['INVALID_CONTENT', b => { b.features.forms = false; }],
    ['INVALID_CONTENT', b => { delete b.features.forms; }],
    ['INVALID_URL', (b, s) => { s.form.endpoint = 'http://forms.customer.tld/x'; }],
    ['INVALID_URL', (b, s) => { s.form.endpoint = 'javascript:alert(1)'; }],
    ['MISSING_CONTENT', (b, s) => { delete s.form.fields[1].label['zh-CN']; }],
    ['INVALID_CONTENT', (b, s) => { s.form.fields[0].type = 'file'; }],
    ['INVALID_CONTENT', (b, s) => { s.form.fields[0].id = '_gotcha'; }],
    ['INVALID_CONTENT', (b, s) => { s.form.fields[2].id = 'name'; }],
    ['INVALID_CONTENT', (b, s) => { s.form.fields = s.form.fields.filter(f => !['email', 'tel'].includes(f.type)); }],
    ['INVALID_CONTENT', (b, s) => { s.form.fields[0].required = 'yes'; }],
    ['INVALID_CONTENT', (b, s) => { s.form.fields = []; }]
  ];
  for (const [code, change] of cases) await assert.rejects(() => render(change), { code }, `${code} ${change}`);
});
test('有表单时审核项包含form，准备包要求form通过且拒绝占位接收地址', async t => {
  const { temp, workspace } = await fullWorkspace(t); await buildWorkspace(workspace);
  assert.deepEqual((await checkWorkspace(workspace)).requiredReviews, ['content', 'contact', 'domain', 'form']);
  await updateWorkspace(workspace, { site: { baseUrl: 'https://customer-owned-domain.tld/' } }); await buildWorkspace(workspace);
  for (const check of ['content', 'contact', 'domain']) await recordReview(workspace, check, 'pass', '受控测试记录，不代表真实公网验证');
  const placeholder = { code: 'PLACEHOLDER_DOMAIN', details: ['site.form.endpoint'] };
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'p1'), { forPublication: true }), placeholder);
  await updateWorkspace(workspace, { site: { form: { endpoint: 'https://forms.customer-owned-domain.tld/inquiry' } } }); await buildWorkspace(workspace);
  for (const check of ['content', 'contact', 'domain']) await recordReview(workspace, check, 'pass', '受控测试记录，不代表真实公网验证');
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'p2'), { forPublication: true }), { code: 'REVIEW_REQUIRED', details: ['form'] });
  await recordReview(workspace, 'form', 'pass', '受控测试记录：未做真实提交');
  const result = await exportWorkspace(workspace, join(temp, 'p3'), { forPublication: true });
  assert.equal(result.published, false); assert.equal(result.form.deliveryVerified, false); assert.equal(result.reviews.form.source, 'human-attested');
});
test('没有表单的站点不接受form审核项', async t => {
  const { createWorkspace } = await import('../src/index.mjs'), { temporary } = await import('./helpers.mjs');
  const temp = await temporary(t), workspace = join(temp, 'plain');
  await createWorkspace(workspace, await example(), await content()); await buildWorkspace(workspace);
  await assert.rejects(() => recordReview(workspace, 'form', 'pass', '无表单'), { code: 'INVALID_REVIEW' });
  await assert.rejects(() => recordReview(workspace, 'payment', 'pass', 'x'), { code: 'INVALID_REVIEW' });
  assert.deepEqual((await checkWorkspace(workspace)).requiredReviews, ['content', 'contact', 'domain']);
});
