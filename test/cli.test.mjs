import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCLI } from '../bin/site-core.mjs';
import { temporary } from './helpers.mjs';

test('命令行从需求文件生成真实指导文件', async t => {
  const root = await temporary(t), output = [], brief = fileURLToPath(new URL('../examples/commerce.brief.json', import.meta.url));
  await runCLI(['plan', '--brief', brief, '--out', join(root, 'plan')], { stdout: x => output.push(x) });
  assert.equal(JSON.parse(await readFile(join(root, 'plan/plan.json'), 'utf8')).route.id, 'managed-commerce');
  assert.ok((await readFile(join(root, 'plan/GUIDANCE.md'), 'utf8')).includes('接入'));
});
test('完整demo可运行，生成站点、交付包与不同场景的计划', async t => {
  const root = await temporary(t), output = [];
  await runCLI(['demo', '--out', join(root, 'demo')], { stdout: x => output.push(x) });
  const result = JSON.parse(output[0]); assert.equal(result.checks.passed, true); assert.equal(new Set(result.scenarios.map(x => x.route)).size, 7);
  assert.equal(result.published, false);
  assert.deepEqual(result.scenarios.find(x => x.example === 'b2b-full'), { example: 'b2b-full', route: 'static-owned', localBuild: 'ready' });
  assert.deepEqual([result.full.checks, result.full.target, result.full.media], [true, 'github-pages', 2]);
  await readFile(join(result.full.package, 'repository/.github/workflows/pages.yml'), 'utf8');
});
test('media add与prepare-publish --target github-pages --cname可从命令行完成', async t => {
  const root = await temporary(t), out = [], run = args => runCLI(args, { stdout: x => out.push(JSON.parse(x)) });
  const file = name => fileURLToPath(new URL(`../examples/${name}`, import.meta.url)), ws = join(root, 'ws');
  await run(['init', '--brief', file('b2b-full.brief.json'), '--site', file('b2b-full.site.json'), '--out', ws]);
  for (const id of ['factory', 'sample-bottle']) await run(['media', 'add', '--workspace', ws, '--file', file(`media/${id}.png`), '--id', id]);
  assert.equal(out.at(-1).file, 'sample-bottle.png');
  await assert.rejects(() => run(['media', 'add', '--workspace', ws, '--file', file('media/factory.png'), '--id', 'factory', '--replace', 'x']), {
    code: 'INVALID_ARGUMENTS'
  });
  const patch = join(root, 'patch.json');
  const site = { baseUrl: 'https://www.customer-owned-domain.tld/', form: { endpoint: 'https://forms.customer-owned-domain.tld/x' } };
  await writeFile(patch, JSON.stringify({ site }));
  await run(['update', '--workspace', ws, '--patch', patch]); await run(['build', '--workspace', ws]);
  for (const check of ['content', 'contact', 'domain', 'form']) {
    await run(['review', '--workspace', ws, '--check', check, '--status', 'pass', '--note', '受控测试记录，不代表真实公网验证']);
  }
  const args = ['prepare-publish', '--workspace', ws, '--out', join(root, 'pkg'), '--target', 'github-pages'];
  await assert.rejects(() => run(args), { code: 'PAGES_URL_MISMATCH' });
  await run([...args.slice(0, 3), '--out', join(root, 'pkg2'), '--target', 'github-pages', '--cname', 'www.customer-owned-domain.tld']);
  assert.deepEqual([out.at(-1).published, out.at(-1).target, out.at(-1).preparedForPublication], [false, 'github-pages', true]);
  await assert.rejects(() => runCLI(['media', 'remove', '--workspace', ws]), { code: 'INVALID_ARGUMENTS' });
});
test('拼错参数、重复参数和未知命令失败而不猜测意图', async () => {
  await assert.rejects(() => runCLI(['plan', '--biref', 'x']), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(() => runCLI(['plan', '--brief', 'x', '--brief', 'y']), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(() => runCLI(['deploy']), { code: 'INVALID_ARGUMENTS' });
});
test('answer命令把回答写入新的需求文件，不覆盖已有文件', async t => {
  const root = await temporary(t), output = [], brief = fileURLToPath(new URL('../examples/unknown.brief.json', import.meta.url));
  const answers = join(root, 'answers.json'), out = join(root, 'answered.brief.json');
  await writeFile(answers, JSON.stringify({ 'primary-goal': 'brand', languages: 'zh-CN', maintenance: 'client' }));
  await runCLI(['answer', '--brief', brief, '--answers', answers, '--out', out], { stdout: x => output.push(x) });
  const result = JSON.parse(output[0]); assert.equal(result.route, 'static-owned'); assert.equal(result.readiness.localBuild, 'ready');
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')).goals, ['brand']);
  await assert.rejects(() => runCLI(['answer', '--brief', brief, '--answers', answers, '--out', out]), { code: 'TARGET_EXISTS' });
});
