import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCases, runCalibration, scoreCase, validateCase, calibrationMarkdown, playbooks, getPlaybook, playbookMarkdown, validateCatalog } from '../src/index.mjs';
import { runCLI } from '../bin/site-core.mjs';
import { temporary } from './helpers.mjs';

const expected = (route, more = {}) => ({ route, acceptableAlternatives: [], mustAsk: [], mustConflict: [], mustHaveCapabilities: [], ...more });
const make = (id, source, exp, brief, extra = {}) => ({
  id, source, request: '原话', brief: { schemaVersion: 1, name: id, ...brief }, expected: exp,
  rationale: '理由', labeledBy: 'tester', labeledAt: '2026-10-27', ...extra
});
const plan = (route, { q = [], c = [], caps = [] } = {}) => ({
  route: { id: route }, questions: q.map(id => ({ id })), conflicts: c.map(id => ({ id })), capabilities: caps.map(id => ({ id }))
});
const cli = async args => { const out = []; try { await runCLI(args, { stdout: x => out.push(x) }); } catch (error) { return { out: out.join('\n'), error }; } return { out: out.join('\n') }; };

test('scoreCase区分命中、可接受、错误，并检查问题/冲突/能力覆盖', () => {
  const c = make('a', 'synthetic', expected('static-owned', { acceptableAlternatives: ['cms-owned'], mustAsk: ['languages'], mustHaveCapabilities: ['forms'] }), {});
  assert.equal(scoreCase(c, plan('static-owned', { q: ['languages'], caps: ['forms'] })).status, 'pass');
  assert.equal(scoreCase(c, plan('cms-owned', { q: ['languages'], caps: ['forms'] })).verdict, 'acceptable');
  const wrong = scoreCase(c, plan('custom-app', { q: ['languages'], caps: ['forms'] }));
  assert.deepEqual([wrong.verdict, wrong.status], ['wrong', 'fail']);
  const gap = scoreCase(c, plan('static-owned'));
  assert.deepEqual([gap.verdict, gap.status, gap.missing.questions, gap.missing.capabilities], ['hit', 'fail', ['languages'], ['forms']]);
  const conflict = scoreCase(make('b', 'synthetic', expected('owned-commerce', { mustConflict: ['operations-owner'] }), {}), plan('owned-commerce'));
  assert.deepEqual(conflict.missing.conflicts, ['operations-owner']);
});

test('knownMismatch：失败不使整体失败，意外通过会被标出', () => {
  const known = make('k', 'synthetic', expected('discovery'), { goals: ['brand'] }, { knownMismatch: '已知' });
  const fixed = make('f', 'synthetic', expected('static-owned'), { goals: ['brand'] }, { knownMismatch: '已修复？' });
  const report = runCalibration([known, fixed]);
  assert.deepEqual(report.cases.map(r => r.status), ['known', 'resolved']);
  assert.equal(report.ok, true);
  assert.match(calibrationMarkdown(report), /请移除knownMismatch/);
  assert.equal(runCalibration([make('x', 'synthetic', expected('discovery'), { goals: ['brand'] })]).ok, false);
});

test('汇总按source分开统计，并给出命中率、覆盖与混淆矩阵', () => {
  const report = runCalibration([
    make('s1', 'synthetic', expected('static-owned'), { goals: ['brand'] }),
    make('s2', 'synthetic', expected('discovery', { acceptableAlternatives: ['static-owned'], mustAsk: ['primary-goal'] }), { goals: ['brand'] }),
    make('s3', 'synthetic', expected('cms-owned'), { goals: ['brand'] }),
    make('r1', 'real-anonymized', expected('discovery', { mustAsk: ['primary-goal'] }), { goals: [] })
  ]);
  const s = report.bySource.synthetic, r = report.bySource['real-anonymized'];
  assert.deepEqual([s.total, s.hit, s.acceptable, s.wrong, s.hitRate, s.acceptableRate], [3, 1, 1, 1, 0.333, 0.667]);
  assert.deepEqual(s.questions, { cases: 1, covered: 0 });
  assert.deepEqual(s.confusion, { 'static-owned': { 'static-owned': 1 }, discovery: { 'static-owned': 1 }, 'cms-owned': { 'static-owned': 1 } });
  assert.deepEqual([r.total, r.hit, r.hitRate, r.questions], [1, 1, 1, { cases: 1, covered: 1 }]);
});

test('规划抛错的案例记为错误', () => {
  const report = runCalibration([make('e', 'synthetic', expected('static-owned'), { goals: ['bogus'] })]);
  assert.deepEqual([report.cases[0].verdict, report.cases[0].status, report.bySource.synthetic.wrong], ['error', 'fail', 1]);
});

test('validateCase拒绝格式错误、悬空引用和ID与文件名不符', async t => {
  const ok = make('ok-1', 'synthetic', expected('static-owned'), { goals: ['brand'] });
  assert.doesNotThrow(() => validateCase(ok));
  const rejects = (mutate, pattern) => { const c = structuredClone(ok); mutate(c); assert.throws(() => validateCase(c), e => e.code === 'INVALID_CALIBRATION' && pattern.test(e.message)); };
  rejects(c => { c.source = 'made-up'; }, /source/);
  rejects(c => { c.expected.route = 'nowhere'; }, /路线不存在|route不存在/);
  rejects(c => { c.expected.mustAsk = ['no-such-question']; }, /追问/);
  rejects(c => { c.expected.mustHaveCapabilities = ['teleport']; }, /能力/);
  rejects(c => { c.expected.acceptableAlternatives = ['static-owned']; }, /不应包含/);
  rejects(c => { delete c.rationale; }, /rationale/);
  const dir = await temporary(t);
  await writeFile(join(dir, 'other.json'), JSON.stringify(ok));
  await assert.rejects(() => loadCases(dir), { code: 'INVALID_CALIBRATION' });
  await writeFile(join(dir, 'other.json'), JSON.stringify({ ...ok, id: 'other' }));
  await writeFile(join(dir, '_TEMPLATE.real.json'), '{坏JSON但模板被跳过');
  assert.equal((await loadCases(dir)).length, 1);
});

test('synthetic案例当前全部通过（knownMismatch除外且必须有说明）', async () => {
  const cases = await loadCases();
  assert.ok(cases.length >= 25);
  assert.ok(cases.every(c => c.source === 'synthetic' && c.labeledBy === 'synthetic-draft' && /待业务专家复核/.test(c.rationale)));
  const report = runCalibration(cases);
  assert.deepEqual(report.cases.filter(r => r.status === 'fail'), []);
  assert.deepEqual(report.cases.filter(r => r.status === 'resolved').map(r => r.id), [], '意外通过的knownMismatch请移除标记');
  assert.equal(report.ok, true);
  assert.ok(!report.bySource['real-anonymized']);
});

test('CLI calibrate输出报告；失败时报CALIBRATION_FAILED', async t => {
  const text = await cli(['calibrate']);
  assert.match(text.out, /路线校准报告/); assert.equal(text.error, undefined);
  const json = JSON.parse((await cli(['calibrate', '--json'])).out);
  assert.equal(json.ok, true);
  const dir = await temporary(t);
  await writeFile(join(dir, 'bad.json'), JSON.stringify(make('bad', 'synthetic', expected('discovery'), { goals: ['brand'] })));
  const failed = await cli(['calibrate', '--dir', dir]);
  assert.equal(failed.error.code, 'CALIBRATION_FAILED'); assert.deepEqual(failed.error.details.failed, ['bad']);
  assert.match(failed.out, /### 失败/);
});

test('手册review：全部为draft，Markdown标题标注草稿，校验拒绝非法状态', () => {
  for (const pb of [...playbooks.routes, ...playbooks.capabilities]) assert.deepEqual(pb.review, { status: 'draft' });
  assert.match(playbookMarkdown(getPlaybook({ capability: 'commerce' })).split('\n')[0], /（草稿·待专家复核）$/);
  const rejects = (mutate, pattern) => {
    const copy = structuredClone(playbooks); mutate(copy);
    assert.throws(() => validateCatalog({ playbooks: copy }), e => e.code === 'INVALID_CATALOG' && pattern.test(e.message));
  };
  rejects(c => { delete c.routes[0].review; }, /review对象/);
  rejects(c => { c.routes[0].review.status = 'approved'; }, /review\.status/);
  rejects(c => { c.routes[0].review = { status: 'expert-reviewed' }; }, /reviewedBy/);
  rejects(c => { c.routes[0].review = { status: 'draft', reviewedBy: '某人' }; }, /draft不应/);
  rejects(c => { c.routes[0].review = { status: 'expert-reviewed', reviewedBy: '某人', reviewedAt: '昨天' }; }, /reviewedAt/);
  rejects(c => { c.capabilities.find(p => p.capability === 'commerce').phases[0].steps[0].sources = [{ url: 'http://x.com/a', claim: 'c' }]; }, /HTTPS/);
  const reviewed = structuredClone(getPlaybook({ capability: 'commerce' }));
  reviewed.review = { status: 'expert-reviewed', reviewedBy: '电商专家', reviewedAt: '2026-11-01' };
  assert.match(playbookMarkdown(reviewed).split('\n')[0], /专家已复核：电商专家，2026-11-01/);
});

test('关键步骤带可核验出处', () => {
  const ids = new Set(['commerce.event-contract', 'commerce.webhook-handler', 'commerce.refund-flow', 'tickets.event-contract', 'tickets.refund-reschedule',
    'booking.event-handling', 'live-deployment.upload-site', 'live-deployment.dns-https']);
  const withSources = [...playbooks.routes, ...playbooks.capabilities].flatMap(p => p.phases.flatMap(x => x.steps)).filter(s => s.sources);
  assert.deepEqual(new Set(withSources.map(s => s.id)), ids);
  assert.ok(withSources.every(s => s.sources.every(x => x.url.startsWith('https://') && x.claim)));
});
