import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  inspectImage, addMedia, buildWorkspace, updateWorkspace, checkWorkspace, rollbackWorkspace, exportWorkspace, renderSite, MEDIA_LIMIT
} from '../src/index.mjs';
import { temporary, solidPng, EXAMPLE_IMAGES, exampleImage, fullWorkspace, fullExample } from './helpers.mjs';

const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xff, 0xd9]);
function webpVp8x(w, h) {
  const b = Buffer.alloc(30); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBPVP8X', 8, 'latin1');
  b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
}
function avif(w, h) {
  const ftyp = Buffer.alloc(24); ftyp.writeUInt32BE(24, 0); ftyp.write('ftypavif', 4, 'latin1'); ftyp.write('mif1miaf', 16, 'latin1');
  const ispe = Buffer.alloc(20); ispe.writeUInt32BE(20, 0); ispe.write('ispe', 4, 'latin1'); ispe.writeUInt32BE(w, 12); ispe.writeUInt32BE(h, 16);
  return Buffer.concat([ftyp, ispe]);
}
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

test('按魔数识别png/jpeg/webp/avif并解析尺寸，拒绝SVG、GIF、截断和超限文件', () => {
  const png = inspectImage(solidPng(7, 3, [0, 0, 0]));
  assert.deepEqual([png.format, png.width, png.height], ['png', 7, 3]);
  assert.equal(inspectImage(jpeg(640, 480)).width, 640); assert.equal(inspectImage(jpeg(640, 480)).ext, 'jpg');
  assert.deepEqual([inspectImage(webpVp8x(300, 200)).width, inspectImage(webpVp8x(300, 200)).height], [300, 200]);
  assert.deepEqual([inspectImage(avif(1200, 800)).format, inspectImage(avif(1200, 800)).height], ['avif', 800]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.throws(() => inspectImage(svg), { code: 'UNSUPPORTED_MEDIA', message: /SVG/ });
  assert.throws(() => inspectImage(Buffer.from('GIF89a\x01\x00\x01\x00')), { code: 'UNSUPPORTED_MEDIA' });
  assert.throws(() => inspectImage(solidPng(2, 2, [0, 0, 0]).subarray(0, 12)), { code: 'INVALID_MEDIA' });
  assert.throws(() => inspectImage(Buffer.concat([solidPng(1, 1, [0, 0, 0]), Buffer.alloc(MEDIA_LIMIT)])), { code: 'MEDIA_TOO_LARGE' });
});
test('示例图片就是测试工具自制的纯色PNG', async () => {
  for (const [id, [w, h, color]] of Object.entries(EXAMPLE_IMAGES)) assert.ok((await readFile(exampleImage(id))).equals(solidPng(w, h, color)));
});
test('media add按格式命名复制入media/，不覆盖、不接受SVG或符号链接', async t => {
  const { temp, workspace } = await fullWorkspace(t);
  assert.deepEqual((await readdir(join(workspace, 'media'))).sort(), ['factory.png', 'sample-bottle.png']);
  await assert.rejects(() => addMedia(workspace, exampleImage('factory'), { id: 'factory' }), { code: 'TARGET_EXISTS' });
  const replaced = await addMedia(workspace, exampleImage('sample-bottle'), { id: 'factory', replace: true });
  assert.equal(replaced.width, 12); assert.equal(replaced.published, false);
  const svg = join(temp, 'logo.svg'); await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await assert.rejects(() => addMedia(workspace, svg, { id: 'logo' }), { code: 'UNSUPPORTED_MEDIA' });
  const link = join(temp, 'link.png'); await symlink(exampleImage('factory'), link);
  await assert.rejects(() => addMedia(workspace, link, { id: 'linked' }), { code: 'INVALID_MEDIA' });
  await assert.rejects(() => addMedia(workspace, exampleImage('factory'), { id: '../x' }), { code: 'INVALID_MEDIA' });
  await assert.rejects(() => addMedia(workspace, join(temp, 'missing.png'), { id: 'missing' }), { code: 'MEDIA_NOT_FOUND' });
  assert.deepEqual((await readdir(join(workspace, 'media'))).sort(), ['factory.png', 'sample-bottle.png']);
});
test('图片按内容哈希输出，带尺寸、lazy与逐语言alt；版本保存原件和指纹', async t => {
  const { workspace } = await fullWorkspace(t), built = await buildWorkspace(workspace);
  const home = await readFile(join(built.site, 'index.html'), 'utf8'), zh = await readFile(join(built.site, 'zh-CN/index.html'), 'utf8');
  assert.match(home, /<img src="assets\/media\/9422cf3e3d1fb7b3\.png" width="16" height="9" alt="Solid blue[^"]+" loading="lazy"/);
  assert.match(zh, /<img src="\.\.\/assets\/media\/9422cf3e3d1fb7b3\.png" width="16" height="9" alt="代替工厂照片/);
  assert.ok((await readFile(join(built.site, 'assets/media/79f469c13a0ae508.png'))).equals(await readFile(exampleImage('sample-bottle'))));
  const dir = join(workspace, 'revisions', built.revision), source = await readJson(join(dir, 'source.json'));
  assert.equal(source.mediaFingerprints['factory.png'], '9422cf3e3d1fb7b3246ff340f1e8dd515a8ab2fbdf034330235dce98a1825012');
  await access(join(dir, 'media/factory.png'));
  assert.ok(!('mediaFingerprints' in await readJson(join(workspace, 'project.json'))), 'project.json仍是纯内容源');
});
test('只改图片字节也产生新版本；回退恢复旧图片原件', async t => {
  const { workspace } = await fullWorkspace(t), a = await buildWorkspace(workspace);
  const original = await readFile(join(workspace, 'media/factory.png'));
  await addMedia(workspace, exampleImage('sample-bottle'), { id: 'factory', replace: true });
  assert.equal((await checkWorkspace(workspace)).unbuiltChanges, true);
  const b = await buildWorkspace(workspace); assert.notEqual(a.revision, b.revision);
  assert.ok((await readFile(join(b.site, 'index.html'), 'utf8')).includes('width="12" height="12"'));
  const rolled = await rollbackWorkspace(workspace, a.revision);
  assert.deepEqual(rolled.mediaRestored, ['factory.png', 'sample-bottle.png']);
  assert.ok((await readFile(join(workspace, 'media/factory.png'))).equals(original));
  assert.equal((await checkWorkspace(workspace)).unbuiltChanges, false); assert.equal((await buildWorkspace(workspace)).revision, a.revision);
});
test('回退不静默覆盖media/中未登记的图片', async t => {
  const { workspace } = await fullWorkspace(t), a = await buildWorkspace(workspace);
  await updateWorkspace(workspace, { site: { media: (await fullExample()).site.media.slice(0, 1), locales: {
    en: { products: [{ ...(await fullExample()).site.locales.en.products[0], image: undefined }] },
    'zh-CN': { products: [{ ...(await fullExample()).site.locales['zh-CN'].products[0], image: undefined }] }
  } } });
  await buildWorkspace(workspace);
  await addMedia(workspace, exampleImage('factory'), { id: 'sample-bottle', replace: true });
  await assert.rejects(() => rollbackWorkspace(workspace, a.revision), { code: 'UNBUILT_CHANGES', details: ['media/sample-bottle.png'] });
  await rollbackWorkspace(workspace, a.revision, { discardDraft: true });
  assert.ok((await readFile(join(workspace, 'media/sample-bottle.png'))).equals(await readFile(exampleImage('sample-bottle'))));
});
test('media/中的符号链接拒绝读取', async t => {
  const { temp, workspace } = await fullWorkspace(t), { unlink } = await import('node:fs/promises');
  await writeFile(join(temp, 'outside.png'), solidPng(2, 2, [0, 0, 0]));
  await unlink(join(workspace, 'media/factory.png')); await symlink(join(temp, 'outside.png'), join(workspace, 'media/factory.png'));
  await assert.rejects(() => buildWorkspace(workspace), { code: 'SYMLINK_REFUSED' });
});
test('手改版本内的图片或原件副本被识别为REVISION_CHANGED', async t => {
  for (const target of ['site/assets/media/9422cf3e3d1fb7b3.png', 'media/factory.png']) {
    const { workspace } = await fullWorkspace(t), built = await buildWorkspace(workspace);
    await writeFile(join(workspace, 'revisions', built.revision, target), solidPng(16, 9, [0, 0, 0]));
    await assert.rejects(() => checkWorkspace(workspace), { code: 'REVISION_CHANGED' });
  }
});
test('缺alt、缺授权、未登记、文件缺失、扩展名不符和需求要图却没引用都拒绝构建', async t => {
  const cases = [
    ['MISSING_ALT', (b, s) => { delete s.media[0].alt['zh-CN']; }],
    ['MISSING_LICENSE', (b, s) => { delete s.media[1].license; }],
    ['MISSING_LICENSE', (b, s) => { s.media[1].license.holder = ' '; }],
    ['MISSING_MEDIA', (b, s) => { s.locales.en.heroImage = 'not-registered'; }],
    ['MISSING_MEDIA', (b, s) => { s.media.push({ ...s.media[0], id: 'extra', file: 'extra.png' }); }],
    ['INVALID_MEDIA', (b, s) => { s.media.push({ ...s.media[0], id: 'renamed', file: 'factory.webp' }); }],
    ['INVALID_CONTENT', (b, s) => { s.media[0].file = '../project.json'; }],
    ['MISSING_CONTENT', (b, s) => {
      delete s.locales.en.heroImage; delete s.locales['zh-CN'].heroImage;
      for (const lang of ['en', 'zh-CN']) delete s.locales[lang].products[0].image;
    }]
  ];
  for (const [code, change] of cases) {
    const { workspace } = await fullWorkspace(t, change);
    if (code === 'INVALID_MEDIA') await writeFile(join(workspace, 'media/factory.webp'), await readFile(exampleImage('factory')));
    await assert.rejects(() => buildWorkspace(workspace), { code }, code);
  }
  const { brief, site } = await fullExample(); delete site.media[0].alt.en;
  assert.throws(() => renderSite(brief, site), { code: 'MISSING_ALT' });
});
test('交付包source/包含图片原件，回执列出指纹且授权标为自报', async t => {
  const { temp, workspace } = await fullWorkspace(t); await buildWorkspace(workspace);
  const result = await exportWorkspace(workspace, join(temp, 'handoff'));
  assert.ok((await readFile(join(result.destination, 'source/media/factory.png'))).equals(await readFile(exampleImage('factory'))));
  assert.ok(!('mediaFingerprints' in await readJson(join(result.destination, 'source/project.json'))));
  assert.equal(result.media.length, 2); assert.ok(result.media.every(m => m.licenseSelfReported === true && m.sha256.length === 64));
});
test('不含图片的项目版本ID与快照格式保持不变', async t => {
  const temp = await temporary(t);
  const { createWorkspace } = await import('../src/index.mjs'), { example, content } = await import('./helpers.mjs');
  await createWorkspace(join(temp, 'plain'), await example(), await content());
  const built = await buildWorkspace(join(temp, 'plain'));
  assert.ok(!('mediaFingerprints' in await readJson(join(temp, 'plain/revisions', built.revision, 'source.json'))));
  await access(join(built.site, '404.html'));
});
