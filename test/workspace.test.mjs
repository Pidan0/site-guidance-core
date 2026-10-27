import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createWorkspace, buildWorkspace, updateWorkspace, checkWorkspace, rollbackWorkspace, recordReview, exportWorkspace, ENGINE_VERSION
} from '../src/index.mjs';
import { temporary, example, content } from './helpers.mjs';

async function setup(t) {
  const temp = await temporary(t), workspace = join(temp, 'customer');
  await createWorkspace(workspace, await example(), await content()); return { temp, workspace };
}

test('建立工作区、构建、重复构建保持同一版本，交付包可查', async t => {
  const { temp, workspace } = await setup(t), first = await buildWorkspace(workspace), second = await buildWorkspace(workspace);
  assert.equal(first.revision, second.revision); assert.equal(second.unchanged, true);
  const result = await exportWorkspace(workspace, join(temp, 'handoff'));
  assert.equal(result.published, false); assert.equal(result.preparedForPublication, false);
  await access(join(result.destination, 'site/index.html')); await access(join(result.destination, 'source/project.json'));
});
test('局部修改保留其他资料，新版本保留旧文件，可回退', async t => {
  const { workspace } = await setup(t), a = await buildWorkspace(workspace);
  await updateWorkspace(workspace, { site: { locales: { en: { headline: 'Updated headline' } } } });
  assert.equal((await checkWorkspace(workspace)).unbuiltChanges, true);
  const b = await buildWorkspace(workspace); assert.notEqual(a.revision, b.revision);
  const source = JSON.parse(await readFile(join(workspace, 'project.json'), 'utf8')); assert.equal(source.site.locales.en.products[0].id, 'sample-bottle');
  await rollbackWorkspace(workspace, a.revision); assert.equal((await checkWorkspace(workspace)).revision, a.revision);
  await access(b.site); assert.ok(!(await readFile(join(a.site, 'index.html'), 'utf8')).includes('Updated headline'));
});
test('手改生成文件后不自动覆盖或忽略', async t => {
  const { workspace } = await setup(t), built = await buildWorkspace(workspace);
  await writeFile(join(built.site, 'index.html'), 'manual work');
  await assert.rejects(() => buildWorkspace(workspace), { code: 'REVISION_CHANGED' });
  await assert.rejects(() => checkWorkspace(workspace), { code: 'REVISION_CHANGED' });
  assert.equal(await readFile(join(built.site, 'index.html'), 'utf8'), 'manual work');
});
test('有未构建草稿时，交付和回退不静默丢弃', async t => {
  const { temp, workspace } = await setup(t), a = await buildWorkspace(workspace);
  await updateWorkspace(workspace, { site: { locales: { en: { headline: 'Unbuilt draft' } } } });
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'out')), { code: 'UNBUILT_CHANGES' });
  await assert.rejects(() => rollbackWorkspace(workspace, a.revision), { code: 'UNBUILT_CHANGES' });
  assert.equal((await checkWorkspace(workspace)).unbuiltChanges, true);
});
test('生成不能绕过交易缺口', async t => {
  const temp = await temporary(t), workspace = join(temp, 'commerce'); await createWorkspace(workspace, await example('commerce'), await content());
  await assert.rejects(() => buildWorkspace(workspace), { code: 'BUILD_NOT_SUPPORTED' });
  assert.ok((await readFile(join(workspace, 'GUIDANCE.md'), 'utf8')).includes('成熟平台建店'));
});
test('不覆盖任意既有目录，不接受路径越界或损坏版本ID', async t => {
  const { temp, workspace } = await setup(t), brief = await example(), site = await content();
  await assert.rejects(() => createWorkspace(workspace, brief, site), { code: 'TARGET_EXISTS' });
  await buildWorkspace(workspace); await assert.rejects(() => rollbackWorkspace(workspace, '../../elsewhere'), { code: 'INVALID_REVISION' });
  await mkdir(join(temp, 'existing')); await assert.rejects(() => exportWorkspace(workspace, join(temp, 'existing')), { code: 'TARGET_EXISTS' });
});
test('工作区内部符号链接拒绝读取，避免读写越出项目', async t => {
  const { temp, workspace } = await setup(t); await buildWorkspace(workspace);
  const target = join(temp, 'outside.json'); await writeFile(target, '{}');
  const { unlink } = await import('node:fs/promises'); await unlink(join(workspace, 'project.json')); await symlink(target, join(workspace, 'project.json'));
  await assert.rejects(() => checkWorkspace(workspace), { code: 'SYMLINK_REFUSED' }); assert.equal(await readFile(target, 'utf8'), '{}');
});
test('并发修改有锁；不删除另一操作的锁文件', async t => {
  const { workspace } = await setup(t), lock = join(workspace, '.site-core/lock'); await writeFile(lock, 'another operation');
  await assert.rejects(() => buildWorkspace(workspace), { code: 'WORKSPACE_BUSY' }); assert.equal(await readFile(lock, 'utf8'), 'another operation');
});
test('占位域名无法生成公开包，即使人工审核全部通过', async t => {
  const { temp, workspace } = await setup(t); await buildWorkspace(workspace);
  for (const check of ['content', 'contact', 'domain']) await recordReview(workspace, check, 'pass', '受控测试中的人工记录，非真实验收');
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'public'), { forPublication: true }), { code: 'PLACEHOLDER_DOMAIN' });
});
test('当前版本审核齐全才能生成公开准备包，新版本不能继承旧审核', async t => {
  const { temp, workspace } = await setup(t);
  await updateWorkspace(workspace, { site: { baseUrl: 'https://customer-owned-domain.tld/project/' } }); await buildWorkspace(workspace);
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'no-review'), { forPublication: true }), { code: 'REVIEW_REQUIRED' });
  for (const check of ['content', 'contact', 'domain']) await recordReview(workspace, check, 'pass', '受控测试记录，不代表真实公网验证');
  const result = await exportWorkspace(workspace, join(temp, 'public'), { forPublication: true });
  assert.equal(result.published, false); assert.equal(result.preparedForPublication, true);
  assert.ok(!(await readFile(join(result.destination, 'site/index.html'), 'utf8')).includes('content="noindex'));
  await updateWorkspace(workspace, { site: { locales: { en: { headline: 'Changed again' } } } }); await buildWorkspace(workspace);
  await assert.rejects(() => exportWorkspace(workspace, join(temp, 'new-public'), { forPublication: true }), { code: 'REVIEW_REQUIRED' });
});
test('公开包同样拒绝占位的外部购买或预约入口', async t => {
  for (const [field, url] of [['externalCheckoutUrl', 'https://shop.example.com/item'], ['externalBookingUrl', 'https://book.test/slot']]) {
    const { temp, workspace } = await setup(t);
    await updateWorkspace(workspace, { site: { baseUrl: 'https://customer-owned-domain.tld/' }, brief: { features: { [field]: url } } });
    await buildWorkspace(workspace);
    for (const check of ['content', 'contact', 'domain']) await recordReview(workspace, check, 'pass', '受控测试记录，不代表真实公网验证');
    const expected = { code: 'PLACEHOLDER_DOMAIN', details: [`features.${field}`] };
    await assert.rejects(() => exportWorkspace(workspace, join(temp, `public-${field}`), { forPublication: true }), expected);
  }
});
test('崩溃留下的staging与未登记版本目录在构建时清理，其他目录保持不动', async t => {
  const { workspace } = await setup(t), first = await buildWorkspace(workspace);
  const markerPath = join(workspace, '.site-core/manifest.json'), manifest = JSON.parse(await readFile(markerPath, 'utf8'));
  // Simulate a crash after rename(staging -> revisions/<id>) but before the manifest was written.
  delete manifest.revisions[first.revision]; manifest.current = null; await writeFile(markerPath, JSON.stringify(manifest));
  const staging = join(workspace, 'revisions/staging-0b8e2d5c-8a51-4a4b-9a2e-9f4f1f3a6c11');
  await mkdir(join(staging, 'site'), { recursive: true });
  await mkdir(join(workspace, 'revisions/keep-me')); await writeFile(join(workspace, 'revisions/r-notes.txt'), 'x');
  const again = await buildWorkspace(workspace);
  assert.equal(again.revision, first.revision); assert.equal(again.unchanged, false);
  assert.deepEqual(again.cleaned.sort(), [first.revision, 'staging-0b8e2d5c-8a51-4a4b-9a2e-9f4f1f3a6c11'].sort());
  await access(join(workspace, 'revisions/keep-me')); await access(join(workspace, 'revisions/r-notes.txt'));
  assert.equal((await checkWorkspace(workspace)).revision, first.revision);
});
test('构建失败时删除本次staging，不留下半成品', async t => {
  const { workspace } = await setup(t), first = await buildWorkspace(workspace);
  const markerPath = join(workspace, '.site-core/manifest.json'), manifest = JSON.parse(await readFile(markerPath, 'utf8'));
  delete manifest.revisions[first.revision]; manifest.current = null; await writeFile(markerPath, JSON.stringify(manifest));
  const { rm } = await import('node:fs/promises'); await rm(join(workspace, 'revisions', first.revision), { recursive: true });
  await writeFile(join(workspace, 'revisions', first.revision), 'not a directory created by the core');
  await assert.rejects(() => buildWorkspace(workspace), { code: 'REVISION_CONFLICT' });
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(join(workspace, 'revisions')), [first.revision]);
});
test('null或数组patch返回INVALID_PATCH而不是原生错误', async t => {
  const { workspace } = await setup(t);
  for (const patch of [null, [], ['brief'], 'brief']) await assert.rejects(() => updateWorkspace(workspace, patch), { code: 'INVALID_PATCH' });
});
test('计划、回执与版本号统一来自package.json', async t => {
  const { temp, workspace } = await setup(t), pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(ENGINE_VERSION, pkg.version); assert.equal(JSON.parse(await readFile(join(workspace, 'plan.json'), 'utf8')).engineVersion, pkg.version);
  await buildWorkspace(workspace); assert.equal((await exportWorkspace(workspace, join(temp, 'handoff'))).engineVersion, pkg.version);
});
