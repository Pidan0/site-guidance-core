#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as core from '../src/index.mjs';
import { fail } from '../src/errors.mjs';

function argsOf(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw fail('INVALID_ARGUMENTS', `未知参数：${args[i]}`);
    const key = args[i].slice(2);
    if (Object.hasOwn(options, key)) throw fail('INVALID_ARGUMENTS', `重复参数：${key}`);
    options[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  }
  return options;
}
const required = (options, key) => { if (typeof options[key] !== 'string' || !options[key]) throw fail('INVALID_ARGUMENTS', `需要 --${key}`); return options[key]; };
const load = async path => JSON.parse(await readFile(resolve(path), 'utf8'));
async function newDir(path) {
  const target = resolve(path);
  try { await lstat(target); throw fail('TARGET_EXISTS', '输出目录已存在，不覆盖'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(dirname(target), { recursive: true }); await mkdir(target); return target;
}
const HELP = `Site Guidance Core 0.1.0

需求指导：
  node bin/site-core.mjs intake --text "用户自然语言需求"
  node bin/site-core.mjs plan --brief examples/b2b.brief.json [--out 新目录]
  node bin/site-core.mjs catalog

本地静态站闭环：
  node bin/site-core.mjs init --brief 需求.json --site 内容.json --out 新工作区
  node bin/site-core.mjs build --workspace 工作区
  node bin/site-core.mjs update --workspace 工作区 --patch 修改.json
  node bin/site-core.mjs check --workspace 工作区
  node bin/site-core.mjs rollback --workspace 工作区 --revision r-版本 [--discard-draft]
  node bin/site-core.mjs export --workspace 工作区 --out 新交付目录

上线准备（不执行上传、DNS、付款或发布）：
  node bin/site-core.mjs review --workspace 工作区 --check content --status pass --note "实际核对证据"
  node bin/site-core.mjs review --workspace 工作区 --check contact --status pass --note "实际联系路径证据"
  node bin/site-core.mjs review --workspace 工作区 --check domain --status pass --note "实际域名核对证据"
  node bin/site-core.mjs prepare-publish --workspace 工作区 --out 新上线准备目录

演示：node bin/site-core.mjs demo --out 新演示目录
`;

export async function runCLI(args, { stdout = text => process.stdout.write(`${text}\n`) } = {}) {
  const [command, ...rest] = args, options = argsOf(rest);
  const print = value => stdout(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const allowed = {
    help: [], intake: ['text'], plan: ['brief', 'out'], catalog: [],
    init: ['brief', 'site', 'out'], build: ['workspace'], update: ['workspace', 'patch'], check: ['workspace'],
    rollback: ['workspace', 'revision', 'discard-draft'], review: ['workspace', 'check', 'status', 'note'],
    export: ['workspace', 'out'], 'prepare-publish': ['workspace', 'out'], demo: ['out']
  };
  const cmd = command ?? 'help';
  if (!Object.hasOwn(allowed, cmd)) throw fail('INVALID_ARGUMENTS', `未知命令：${cmd}`);
  for (const key of Object.keys(options)) if (!allowed[cmd].includes(key)) throw fail('INVALID_ARGUMENTS', `未知选项：--${key}`);
  if (options['discard-draft'] !== undefined && options['discard-draft'] !== true) throw fail('INVALID_ARGUMENTS', '--discard-draft是独立开关，不接受参数值');
  if (cmd === 'help') return print(HELP);
  if (cmd === 'intake') return print(core.intakeRequest(required(options, 'text')));
  if (cmd === 'catalog') return print({ ...core.validateCatalog(), routes: core.routes, capabilities: core.capabilities });
  if (cmd === 'plan') {
    const plan = core.planSite(await load(required(options, 'brief')));
    if (options.out) {
      const out = await newDir(required(options, 'out'));
      await writeFile(join(out, 'plan.json'), JSON.stringify(plan, null, 2));
      await writeFile(join(out, 'GUIDANCE.md'), core.planMarkdown(plan));
      return print({ directory: out, route: plan.route.id, readiness: plan.readiness });
    }
    return print(core.planMarkdown(plan));
  }
  if (cmd === 'init') return print(await core.createWorkspace(required(options, 'out'), await load(required(options, 'brief')), options.site ? await load(required(options, 'site')) : undefined));
  if (cmd === 'build') return print(await core.buildWorkspace(required(options, 'workspace')));
  if (cmd === 'update') return print(await core.updateWorkspace(required(options, 'workspace'), await load(required(options, 'patch'))));
  if (cmd === 'check') return print(await core.checkWorkspace(required(options, 'workspace')));
  if (cmd === 'rollback') return print(await core.rollbackWorkspace(required(options, 'workspace'), required(options, 'revision'), { discardDraft: options['discard-draft'] === true }));
  if (cmd === 'review') return print(await core.recordReview(required(options, 'workspace'), required(options, 'check'), required(options, 'status'), required(options, 'note')));
  if (cmd === 'export' || cmd === 'prepare-publish') return print(await core.exportWorkspace(required(options, 'workspace'), required(options, 'out'), { forPublication: cmd === 'prepare-publish' }));
  if (cmd === 'demo') {
    const out = await newDir(required(options, 'out')), examples = fileURLToPath(new URL('../examples/', import.meta.url));
    const brief = await load(join(examples, 'b2b.brief.json')), site = await load(join(examples, 'b2b.site.json'));
    await core.createWorkspace(join(out, 'workspace'), brief, site);
    const built = await core.buildWorkspace(join(out, 'workspace'));
    const bundle = await core.exportWorkspace(join(out, 'workspace'), join(out, 'handoff'));
    const scenarios = ['b2b', 'commerce', 'self-hosted-commerce', 'tourism', 'booking', 'content', 'unknown'];
    const plans = [];
    await mkdir(join(out, 'plans'));
    for (const name of scenarios) {
      const plan = core.planSite(await load(join(examples, `${name}.brief.json`)));
      await writeFile(join(out, 'plans', `${name}.md`), core.planMarkdown(plan));
      plans.push({ example: name, route: plan.route.id, localBuild: plan.readiness.localBuild });
    }
    return print({ ...built, runtime: process.version, handoff: bundle.destination, scenarios: plans });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCLI(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${JSON.stringify({ error: error.code ?? 'FAILED', message: error.message, ...(error.details ? { details: error.details } : {}) }, null, 2)}\n`);
  process.exitCode = 1;
});
