import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  pagesTarget, pagesWorkflow, PAGES_ACTIONS, createWorkspace, buildWorkspace, updateWorkspace, recordReview, exportWorkspace, renderSite, checkFiles
} from '../src/index.mjs';
import { temporary, example, content, fullWorkspace } from './helpers.mjs';

const mismatch = { code: 'PAGES_URL_MISMATCH' };
const pass = async workspace => {
  for (const check of ['content', 'contact', 'domain', 'form']) await recordReview(workspace, check, 'pass', '受控测试记录，不代表真实公网验证');
};

test('baseUrl必须是Pages能服务的用户站、项目站或与--cname一致的自定义域名根', () => {
  assert.deepEqual(pagesTarget('https://octo-user.github.io/'), {
    kind: 'user', repository: 'octo-user/octo-user.github.io', cname: null, url: 'https://octo-user.github.io/'
  });
  assert.equal(pagesTarget('https://octo-user.github.io/site/').repository, 'octo-user/site');
  assert.equal(pagesTarget('https://www.customer.tld/', 'WWW.Customer.tld').cname, 'www.customer.tld');
  assert.throws(() => pagesTarget('https://octo-user.github.io/a/b/'), mismatch);
  assert.throws(() => pagesTarget('https://-bad-.github.io/'), mismatch);
  assert.throws(() => pagesTarget('https://octo-user.github.io/site/', 'www.customer.tld'), mismatch);
  assert.throws(() => pagesTarget('https://www.customer.tld/'), mismatch);
  assert.throws(() => pagesTarget('https://www.customer.tld/', 'customer.tld'), mismatch);
  assert.throws(() => pagesTarget('https://www.customer.tld/', 'https://www.customer.tld/'), mismatch);
  assert.throws(() => pagesTarget('https://www.customer.tld/site/', 'www.customer.tld'), mismatch);
});
test('部署工作流用固定提交SHA的官方action，权限只含pages与id-token写入', () => {
  const yaml = pagesWorkflow();
  for (const action of Object.values(PAGES_ACTIONS)) {
    assert.match(action.sha, /^[0-9a-f]{40}$/); assert.ok(yaml.includes(`${action.uses}@${action.sha} # ${action.version}，SHA核对于`));
  }
  assert.equal((yaml.match(/uses: /g) ?? []).length, 4); assert.ok(!/uses: [^@\n]+@v\d/.test(yaml), '不使用可变标签');
  assert.match(yaml, /permissions:\n {2}contents: read\n {2}pages: write\n {2}id-token: write\n/);
  assert.match(yaml, /path: site\n/); assert.match(yaml, /persist-credentials: false/);
});
test('Pages公开准备包：repository/可直接作为仓库内容，内部资料在仓库外', async t => {
  const { temp, workspace } = await fullWorkspace(t);
  await updateWorkspace(workspace, { site: {
    baseUrl: 'https://www.customer-owned-domain.tld/', form: { endpoint: 'https://forms.customer-owned-domain.tld/inquiry' }
  } });
  await buildWorkspace(workspace); await pass(workspace);
  const options = { forPublication: true, target: 'github-pages', cname: 'www.customer-owned-domain.tld' };
  const result = await exportWorkspace(workspace, join(temp, 'pages'), options), root = result.destination;
  assert.deepEqual((await readdir(root)).sort(), ['GUIDANCE.md', 'HANDOFF.md', 'checks.json', 'receipt.json', 'repository', 'source']);
  assert.deepEqual((await readdir(join(root, 'repository'))).sort(), ['.github', 'site']);
  assert.equal(await readFile(join(root, 'repository/site/CNAME'), 'utf8'), 'www.customer-owned-domain.tld\n');
  await access(join(root, 'repository/site/.nojekyll')); await access(join(root, 'repository/site/assets/media/9422cf3e3d1fb7b3.png'));
  assert.equal(await readFile(join(root, 'repository/.github/workflows/pages.yml'), 'utf8'), pagesWorkflow());
  assert.ok(!(await readFile(join(root, 'repository/site/index.html'), 'utf8')).includes('noindex'));
  assert.ok((await readFile(join(root, 'repository/site/404.html'), 'utf8')).includes('noindex'));
  const summary = [result.published, result.target, result.pages.kind, result.pages.cname];
  assert.deepEqual(summary, [false, 'github-pages', 'custom-domain', 'www.customer-owned-domain.tld']);
  const handoff = await readFile(join(root, 'HANDOFF.md'), 'utf8');
  for (const step of ['Settings → Pages', 'GitHub Actions', 'Custom domain', 'DNS', '上线后实测', 'published:false']) assert.ok(handoff.includes(step), step);
  assert.equal(JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8')).target, 'github-pages');
});
test('Pages包拒绝不匹配的baseUrl或cname、未知目标，以及无目标的cname', async t => {
  const temp = await temporary(t), workspace = join(temp, 'plain');
  await createWorkspace(workspace, await example(), await content()); await buildWorkspace(workspace);
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'a'), { target: 'github-pages' }), mismatch);
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'b'), { target: 'netlify' }), { code: 'INVALID_TARGET' });
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'c'), { cname: 'demo.example.com' }), { code: 'INVALID_TARGET' });
  await updateWorkspace(workspace, { site: { baseUrl: 'https://octo-user.github.io/catalog/' } }); await buildWorkspace(workspace);
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'd'), { target: 'github-pages', cname: 'www.customer.tld' }), mismatch);
  const draft = await exportWorkspace(workspace, join(temp, 'e'), { target: 'github-pages' });
  assert.equal(draft.preparedForPublication, false); assert.equal(draft.pages.repository, 'octo-user/catalog');
  assert.ok((await readFile(join(draft.destination, 'repository/site/index.html'), 'utf8')).includes('noindex'));
  await assert.rejects(() => access(join(draft.destination, 'repository/site/CNAME')));
});
test('每次构建都有404页：链接到各语言首页、绝对地址、不进站点地图，缺失时检查失败', async () => {
  const result = renderSite(await example(), await content()), page = result.files.get('404.html');
  assert.ok(page.includes('href="https://demo.example.com/catalog/index.html"'));
  assert.ok(page.includes('href="https://demo.example.com/catalog/zh-CN/index.html"'));
  assert.ok(page.includes('noindex')); assert.ok(!result.files.get('sitemap.xml').includes('404'));
  assert.ok(renderSite(await example(), await content(), { publication: true }).files.get('404.html').includes('noindex'));
  result.files.delete('404.html');
  assert.ok(checkFiles(result.files, result.pages).issues.find(i => i.check === 'not-found'));
  assert.equal(checkFiles(result.files, result.pages, { notFound: false }).passed, true, '早于404页的已记录版本仍可核对');
});
test('只对文本文件做文本检查；图片按魔数和哈希名核对，未知文件类型报出', async () => {
  const result = renderSite(await example(), await content());
  result.files.set('assets/media/0000000000000000.png', Buffer.from('not an image'));
  result.files.set('assets/tool.exe', Buffer.from([0x4d, 0x5a]));
  result.files.set('index.html', Buffer.from(result.files.get('index.html')));
  const issues = checkFiles(result.files, result.pages).issues;
  assert.ok(issues.find(i => i.page === 'assets/media/0000000000000000.png' && i.check === 'media'));
  assert.ok(issues.find(i => i.page === 'assets/tool.exe' && i.check === 'file-type')); assert.equal(issues.length, 2);
});
test('页面中的图片必须带alt、width/height和lazy', async () => {
  const result = renderSite(await example(), await content());
  result.files.set('about.html', result.files.get('about.html').replace('<main class="wrap">', '<main class="wrap"><img src="assets/site.css">'));
  assert.ok(checkFiles(result.files, result.pages).issues.find(i => i.page === 'about.html' && i.check === 'img'));
});
