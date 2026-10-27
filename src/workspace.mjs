import { mkdir, readFile, writeFile, rename, readdir, lstat, realpath, open, unlink, rm } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, invariant } from './errors.mjs';
import { planSite, planMarkdown } from './planner.mjs';
import { renderSite, isPlaceholderUrl } from './renderer.mjs';
import { checkFiles, fingerprints, sha256, stable } from './checker.mjs';
import { mergePatch, isPlainObject } from './patch.mjs';
import { ENGINE_VERSION } from './version.mjs';

const MARKER = '.site-core/manifest.json';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const revisionPattern = /^r-[a-f0-9]{20}$/;
const stagingPattern = /^staging-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function safe(root, name, allowMissing = false) {
  const relativeName = typeof name === 'string' && !isAbsolute(name) && !name.includes('\\');
  invariant(relativeName && name.split('/').every(x => x && x !== '.' && x !== '..'), 'UNSAFE_PATH', '文件路径不在工作区内');
  const path = resolve(root, name);
  invariant(!relative(root, path).startsWith('..'), 'UNSAFE_PATH', '文件路径越界');
  let current = root;
  for (const part of name.split('/')) {
    current = join(current, part);
    try { invariant(!(await lstat(current)).isSymbolicLink(), 'SYMLINK_REFUSED', '工作区内部不接受符号链接'); }
    catch (error) { if (!(allowMissing && error.code === 'ENOENT')) throw error; }
  }
  return path;
}
async function rootOf(input) {
  const root = resolve(input);
  invariant(await exists(root), 'NOT_A_WORKSPACE', '工作区不存在');
  invariant(!(await lstat(root)).isSymbolicLink(), 'SYMLINK_REFUSED', '工作区根不能是符号链接');
  const canonical = await realpath(root);
  invariant(await exists(await safe(canonical, MARKER)), 'NOT_A_WORKSPACE', '目标不是本核心创建的工作区');
  return canonical;
}
async function atomic(root, name, value) {
  const target = await safe(root, name, true), temp = `${target}.tmp-${randomUUID()}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temp, value, { flag: 'wx', mode: 0o600 });
  try { await rename(temp, target); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
async function locked(input, action) {
  const root = await rootOf(input), lockPath = await safe(root, '.site-core/lock', true);
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw fail('WORKSPACE_BUSY', '工作区正在修改；若进程异常退出，请确认无其他操作后移除.site-core/lock');
    throw error;
  }
  try {
    const manifest = await readJson(await safe(root, MARKER));
    invariant(manifest.format === 1 && manifest.revisions && manifest.reviews, 'INVALID_WORKSPACE', '工作区版本或记录损坏');
    return await action(root, manifest);
  } finally { await handle.close(); await unlink(lockPath); }
}

async function siteFiles(root, prefix) {
  const files = new Map();
  async function walk(name) {
    const path = await safe(root, name);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = `${name}/${entry.name}`;
      invariant(!entry.isSymbolicLink(), 'SYMLINK_REFUSED', '输出站点包含符号链接');
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.set(child.slice(prefix.length + 1), await readFile(await safe(root, child), 'utf8'));
      else throw fail('UNSAFE_PATH', '站点中有不支持的文件类型');
    }
  }
  await walk(prefix); return files;
}
async function revision(root, manifest, id = manifest.current) {
  const known = typeof id === 'string' && revisionPattern.test(id) && Object.hasOwn(manifest.revisions, id);
  invariant(known, 'INVALID_REVISION', '版本不存在或格式错误');
  const dir = `revisions/${id}`, record = manifest.revisions[id];
  const sourceText = await readFile(await safe(root, `${dir}/source.json`), 'utf8');
  const buildText = await readFile(await safe(root, `${dir}/build.json`), 'utf8');
  const intact = sha256(sourceText) === record.sourceHash && sha256(buildText) === record.buildHash;
  invariant(intact, 'REVISION_CHANGED', '版本资料或构建记录被手工修改');
  const source = JSON.parse(sourceText), build = JSON.parse(buildText), files = await siteFiles(root, `${dir}/site`);
  const untouched = stable(fingerprints(files)) === stable(build.fingerprints);
  invariant(untouched, 'REVISION_CHANGED', '已生成站点被改动；请在project.json修改内容，不覆盖或忽略手改文件');
  const checks = checkFiles(files, build.pages, { publication: false });
  invariant(checks.passed, 'CHECK_FAILED', '版本页面检查失败', checks.issues);
  return { id, source, build, files, checks };
}
async function sourceState(root) {
  const source = await readJson(await safe(root, 'project.json'));
  invariant(source.schemaVersion === 1 && source.brief, 'INVALID_WORKSPACE', 'project.json需要schemaVersion和brief');
  return source;
}
async function saveGuidance(root, plan) {
  await atomic(root, 'plan.json', json(plan)); await atomic(root, 'GUIDANCE.md', planMarkdown(plan));
}

export async function createWorkspace(input, brief, site) {
  const plan = planSite(brief), requested = resolve(input);
  invariant(!(await exists(requested)), 'TARGET_EXISTS', '目标目录已存在，不覆盖现有文件');
  await mkdir(dirname(requested), { recursive: true });
  await mkdir(requested); const root = await realpath(requested);
  await mkdir(join(root, '.site-core'));
  await atomic(root, MARKER, json({ format: 1, current: null, revisions: {}, reviews: {} }));
  await atomic(root, 'project.json', json({ schemaVersion: 1, brief, ...(site ? { site } : {}) }));
  await saveGuidance(root, plan);
  return { workspace: root, plan, built: false };
}

// Removes leftovers of an interrupted build: staging directories and revision directories the manifest never
// recorded (crash between rename and manifest write). Only directories in this core's own naming formats are touched.
async function removeOrphans(root, manifest) {
  const dir = await safe(root, 'revisions', true);
  if (!(await exists(dir))) return [];
  const orphan = entry => entry.isDirectory()
    && (stagingPattern.test(entry.name) || (revisionPattern.test(entry.name) && !Object.hasOwn(manifest.revisions, entry.name)));
  const removed = (await readdir(dir, { withFileTypes: true })).filter(orphan).map(entry => entry.name);
  for (const name of removed) await rm(await safe(root, `revisions/${name}`), { recursive: true });
  return removed;
}

async function writeStage(root, stageName, rendered, sourceText, buildText) {
  const stage = await safe(root, stageName, true);
  await mkdir(stage);
  for (const [name, content] of rendered.files) {
    const path = await safe(root, `${stageName}/site/${name}`, true);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { flag: 'wx' });
  }
  await writeFile(join(stage, 'source.json'), sourceText, { flag: 'wx', mode: 0o600 });
  await writeFile(join(stage, 'build.json'), buildText, { flag: 'wx', mode: 0o600 });
  return stage;
}

// Stages the revision, moves it into place, then records it. Anything created here is removed if a later step fails.
async function commitRevision(root, manifest, id, source, rendered, checks) {
  await mkdir(await safe(root, 'revisions', true), { recursive: true });
  const sourceText = json(source), buildText = json({ pages: rendered.pages, fingerprints: fingerprints(rendered.files), checks });
  const target = await safe(root, `revisions/${id}`, true), stageName = `revisions/staging-${randomUUID()}`;
  let created = await safe(root, stageName, true);
  try {
    await writeStage(root, stageName, rendered, sourceText, buildText);
    invariant(!(await exists(target)), 'REVISION_CONFLICT', `revisions/${id} 已被非本核心版本目录占用，请人工确认后移走`);
    await rename(created, target); created = target;
    manifest.revisions[id] = { sourceHash: sha256(sourceText), buildHash: sha256(buildText) }; manifest.current = id;
    await atomic(root, MARKER, json(manifest)); created = null;
  } catch (error) {
    if (created) await rm(created, { recursive: true, force: true });
    throw error;
  }
}

const buildResult = (root, id, unchanged, checks, cleaned) => ({
  revision: id, unchanged, site: join(root, 'revisions', id, 'site'), checks, ...(cleaned.length ? { cleaned } : {}), published: false
});

export async function buildWorkspace(input) {
  return locked(input, async (root, manifest) => {
    const cleaned = await removeOrphans(root, manifest);
    if (manifest.current) await revision(root, manifest);
    const source = await sourceState(root), plan = planSite(source.brief);
    await saveGuidance(root, plan);
    const blocked = { route: plan.route.id, questions: plan.questions, conflicts: plan.conflicts, gaps: plan.gaps };
    invariant(plan.readiness.localBuild === 'ready', 'BUILD_NOT_SUPPORTED', '当前路线需要先补信息或接入外部能力，不能伪装成本地已完成', blocked);
    invariant(source.site, 'MISSING_CONTENT', '需要在project.json提供site内容');
    const rendered = renderSite(source.brief, source.site), checks = checkFiles(rendered.files, rendered.pages);
    invariant(checks.passed, 'CHECK_FAILED', '本地质量检查失败', checks.issues);
    const id = `r-${sha256(stable({ engine: ENGINE_VERSION, source })).slice(0, 20)}`;
    if (Object.hasOwn(manifest.revisions, id)) {
      await revision(root, manifest, id); manifest.current = id; await atomic(root, MARKER, json(manifest));
      return buildResult(root, id, true, checks, cleaned);
    }
    await commitRevision(root, manifest, id, source, rendered, checks);
    return buildResult(root, id, false, checks, cleaned);
  });
}

export async function updateWorkspace(input, patch) {
  invariant(isPlainObject(patch), 'INVALID_PATCH', 'patch必须是只含brief或site的对象');
  return locked(input, async (root, manifest) => {
    if (manifest.current) await revision(root, manifest);
    invariant(Object.keys(patch).every(x => ['brief', 'site'].includes(x)), 'INVALID_PATCH', '只允许更新brief或site');
    const next = mergePatch(await sourceState(root), patch), plan = planSite(next.brief);
    // Validate content before replacing the editable source, even if the route has changed.
    if (next.site && plan.readiness.localBuild === 'ready') renderSite(next.brief, next.site);
    await atomic(root, 'project.json', json(next)); await saveGuidance(root, plan);
    return { updated: true, built: false, previousRevision: manifest.current, plan };
  });
}

export async function checkWorkspace(input) {
  return locked(input, async (root, manifest) => {
    const current = await revision(root, manifest), source = await sourceState(root);
    const reviews = manifest.reviews[current.id] ?? {};
    return { revision: current.id, checks: current.checks, unbuiltChanges: stable(current.source) !== stable(source), reviews, published: false };
  });
}

export async function rollbackWorkspace(input, id, { discardDraft = false } = {}) {
  return locked(input, async (root, manifest) => {
    const current = await revision(root, manifest), target = await revision(root, manifest, id), draft = await sourceState(root);
    invariant(discardDraft || stable(current.source) === stable(draft), 'UNBUILT_CHANGES', '有尚未构建的资料修改；先构建或显式使用discardDraft，不静默丢弃');
    await atomic(root, 'project.json', json(target.source)); manifest.current = id; await atomic(root, MARKER, json(manifest));
    await saveGuidance(root, planSite(target.source.brief));
    return { revision: id, restored: true, published: false };
  });
}

export async function recordReview(input, check, status, note) {
  const valid = ['content', 'contact', 'domain'].includes(check) && ['pass', 'fail'].includes(status) && typeof note === 'string' && note.trim();
  invariant(valid, 'INVALID_REVIEW', '检查项为content/contact/domain，结果为pass/fail，并填写实测证据');
  return locked(input, async (root, manifest) => {
    const current = await revision(root, manifest);
    invariant(stable(current.source) === stable(await sourceState(root)), 'UNBUILT_CHANGES', '资料有未构建变化，审核必须针对已构建版本');
    manifest.reviews[current.id] ??= {};
    manifest.reviews[current.id][check] = { status, note: note.trim(), source: 'human-attested', recordedAt: new Date().toISOString() };
    await atomic(root, MARKER, json(manifest));
    return { revision: current.id, check, status, selfReported: true, published: false };
  });
}

async function writeBundle(destination, files, additions) {
  const out = resolve(destination);
  invariant(!(await exists(out)), 'TARGET_EXISTS', '交付目标已存在，不覆盖');
  await mkdir(dirname(out), { recursive: true }); await mkdir(out);
  const root = await realpath(out);
  for (const [name, content] of [...files].map(([path, text]) => [`site/${path}`, text]).concat(Object.entries(additions))) {
    const path = await safe(root, name, true); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { flag: 'wx' });
  }
  return root;
}

// Every public URL the package would ship must be a real address, not a demo or reserved domain.
function assertPublicUrls(source) {
  const features = source.brief.features ?? {};
  const urls = [['site.baseUrl', source.site.baseUrl], ...['externalCheckoutUrl', 'externalBookingUrl'].map(key => [`features.${key}`, features[key]])];
  const placeholders = urls.filter(([, url]) => url && isPlaceholderUrl(url)).map(([field]) => field);
  invariant(!placeholders.length, 'PLACEHOLDER_DOMAIN', '上线准备包需要实际配置的域名，不能使用演示或保留域名', placeholders);
}

function handoffText(source, id, forPublication) {
  const stage = forPublication ? '这是上线准备包，尚未上传或发布。' : '这是草稿交付包，保留noindex与Disallow，不作为正式上线包。';
  return `# 网站交接\n\n版本：${id}\n\nsite/为静态文件；source/project.json为资料源。\n\n${stage}\n\n`
    + `维护方：${source.brief.operations.maintenanceOwner}\n\n`
    + '上传site/之前确认目标账号和域名；上线后实测HTTPS、页面、联系入口、移动显示与目标地区访问。涉及交易、表单和预约的功能单独验收。\n\n'
    + '不要将source/、receipt或内部资料目录作为网站根上传。\n';
}

export async function exportWorkspace(input, out, { forPublication = false } = {}) {
  return locked(input, async (root, manifest) => {
    const current = await revision(root, manifest), draft = await sourceState(root);
    invariant(stable(current.source) === stable(draft), 'UNBUILT_CHANGES', '资料有未构建变化，交付前先构建');
    const plan = planSite(current.source.brief), reviews = manifest.reviews[current.id] ?? {};
    let files = current.files, checks = current.checks;
    if (forPublication) {
      assertPublicUrls(current.source);
      const missing = ['content', 'contact', 'domain'].filter(key => reviews[key]?.status !== 'pass');
      invariant(!missing.length, 'REVIEW_REQUIRED', '当前版本尚缺内容、联系路径或域名的人工验收记录', missing);
      const rendered = renderSite(current.source.brief, current.source.site, { publication: true });
      files = rendered.files; checks = checkFiles(files, rendered.pages, { publication: true });
      invariant(checks.passed, 'CHECK_FAILED', '发布准备检查失败', checks.issues);
    }
    const receipt = {
      engineVersion: ENGINE_VERSION, revision: current.id, preparedForPublication: forPublication, published: false,
      verificationScope: checks.scope, reviews, fingerprints: fingerprints(files)
    };
    const destination = await writeBundle(out, files, {
      'source/project.json': json(current.source), 'GUIDANCE.md': planMarkdown(plan), 'checks.json': json(checks), 'receipt.json': json(receipt),
      'HANDOFF.md': handoffText(current.source, current.id, forPublication)
    });
    return { destination, ...receipt };
  });
}
