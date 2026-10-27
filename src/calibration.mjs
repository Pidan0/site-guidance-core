import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSchema } from './schema.mjs';
import { planSite } from './planner.mjs';
import { routes, capabilities, rules } from './catalog.mjs';
import { fail, invariant } from './errors.mjs';

// 校准：用标注案例检验路线规则。synthetic 与 real-anonymized 分开统计，不混算。
export const caseSchema = JSON.parse(readFileSync(new URL('../calibration/case.schema.json', import.meta.url), 'utf8'));
export const DEFAULT_CASES_DIR = new URL('../calibration/cases/', import.meta.url);
const SOURCES = ['synthetic', 'real-anonymized'];
const bad = (id, message) => invariant(false, 'INVALID_CALIBRATION', `calibration.${id}: ${message}`);

const known = {
  routes: new Set(routes.map(r => r.id)), capabilities: new Set(capabilities.map(c => c.id)),
  questions: new Set(rules.questions.map(q => q.id)), conflicts: new Set(rules.conflicts.map(c => c.id))
};

export function validateCase(value, file = value?.id ?? '?') {
  const errors = validateSchema(value, caseSchema);
  if (errors.length) bad(file, errors.join('；'));
  const e = value.expected;
  if (!known.routes.has(e.route)) bad(value.id, `expected.route不存在：${e.route}`);
  for (const [list, set, label] of [[e.acceptableAlternatives, known.routes, '路线'], [e.mustAsk, known.questions, '追问'],
    [e.mustConflict, known.conflicts, '冲突'], [e.mustHaveCapabilities, known.capabilities, '能力']]) {
    for (const id of list) if (!set.has(id)) bad(value.id, `引用了不存在的${label}：${id}`);
  }
  if (e.acceptableAlternatives.includes(e.route)) bad(value.id, 'acceptableAlternatives不应包含expected.route');
  return value;
}

// 读取目录下所有 *.json（以 _ 开头的模板跳过）；id 必须与文件名一致且唯一。
export async function loadCases(dir = DEFAULT_CASES_DIR) {
  const base = typeof dir === 'string' ? dir : dir.pathname, cases = [], seen = new Set();
  const files = (await readdir(dir)).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
  for (const file of files) {
    let parsed;
    try { parsed = JSON.parse(await readFile(join(base, file), 'utf8')); } catch (error) { throw fail('INVALID_CALIBRATION', `${file}: 不是有效JSON`); }
    validateCase(parsed, file);
    if (parsed.id !== file.slice(0, -5)) bad(file, `id「${parsed.id}」需与文件名一致`);
    if (seen.has(parsed.id)) bad(file, '重复的案例ID');
    seen.add(parsed.id); cases.push(parsed);
  }
  return cases;
}

const missingFrom = (needed, actual) => needed.filter(id => !actual.includes(id));

// 单个案例评分。plan 可由测试替身提供（只读 route.id / questions / conflicts / capabilities）。
export function scoreCase(c, plan) {
  const e = c.expected, actual = plan.route.id, ids = list => list.map(x => x.id);
  const verdict = actual === e.route ? 'hit' : e.acceptableAlternatives.includes(actual) ? 'acceptable' : 'wrong';
  const missing = {
    questions: missingFrom(e.mustAsk, ids(plan.questions)), conflicts: missingFrom(e.mustConflict, ids(plan.conflicts)),
    capabilities: missingFrom(e.mustHaveCapabilities, ids(plan.capabilities))
  };
  const passed = verdict !== 'wrong' && !Object.values(missing).some(m => m.length);
  const status = passed ? (c.knownMismatch ? 'resolved' : 'pass') : c.knownMismatch ? 'known' : 'fail';
  return {
    id: c.id, source: c.source, expected: e.route, actual, verdict, missing, status,
    ...(c.knownMismatch ? { knownMismatch: c.knownMismatch } : {})
  };
}

function runOne(c) {
  try { return scoreCase(c, planSite(c.brief)); } catch (error) {
    const status = c.knownMismatch ? 'known' : 'fail';
    return {
      id: c.id, source: c.source, expected: c.expected.route, actual: null, verdict: 'error', status, error: error.code ?? error.message,
      missing: { questions: [], conflicts: [], capabilities: [] }, ...(c.knownMismatch ? { knownMismatch: c.knownMismatch } : {})
    };
  }
}

const ratio = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null);
const covers = (results, kind, field) => {
  const asked = results.filter(r => r.coverage[kind]);
  return { cases: asked.length, covered: asked.filter(r => !r.missing[field].length).length };
};

function summarize(results, cases) {
  const byId = new Map(cases.map(c => [c.id, c]));
  const withCoverage = results.map(r => ({
    ...r, coverage: { questions: byId.get(r.id).expected.mustAsk.length > 0, conflicts: byId.get(r.id).expected.mustConflict.length > 0,
      capabilities: byId.get(r.id).expected.mustHaveCapabilities.length > 0 }
  }));
  const count = verdict => results.filter(r => r.verdict === verdict).length, total = results.length;
  const confusion = {};
  for (const r of results) { const row = (confusion[r.expected] ??= {}); row[r.actual ?? 'error'] = (row[r.actual ?? 'error'] ?? 0) + 1; }
  return {
    total, hit: count('hit'), acceptable: count('acceptable'), wrong: count('wrong') + count('error'),
    hitRate: ratio(count('hit'), total), acceptableRate: ratio(count('hit') + count('acceptable'), total),
    pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length,
    knownMismatch: results.filter(r => r.status === 'known').length, knownMismatchResolved: results.filter(r => r.status === 'resolved').length,
    questions: covers(withCoverage, 'questions', 'questions'), conflicts: covers(withCoverage, 'conflicts', 'conflicts'),
    capabilities: covers(withCoverage, 'capabilities', 'capabilities'), confusion
  };
}

// 运行全部案例，返回 { cases, bySource, ok }。ok = 没有未标注 knownMismatch 的失败。
export function runCalibration(cases) {
  invariant(Array.isArray(cases), 'INVALID_ARGUMENTS', 'cases必须是数组');
  const results = cases.map(runOne), bySource = {};
  for (const source of SOURCES) {
    const ids = new Set(cases.filter(c => c.source === source).map(c => c.id));
    if (ids.size) bySource[source] = summarize(results.filter(r => ids.has(r.id)), cases);
  }
  return { cases: results, bySource, ok: results.every(r => r.status !== 'fail') };
}

const pct = value => (value === null ? '-' : `${(value * 100).toFixed(1)}%`);
const cover = c => `${c.covered}/${c.cases}`;

function confusionLines(confusion) {
  const pairs = Object.entries(confusion).flatMap(([exp, row]) => Object.entries(row).map(([act, n]) => [exp, act, n]));
  const off = pairs.filter(([exp, act]) => exp !== act);
  return [
    `  路线混淆矩阵（期望→实际）：${pairs.filter(([exp, act]) => exp === act).map(([exp, , n]) => `${exp}×${n}`).join('、') || '无命中'}`,
    ...(off.length ? off.map(([exp, act, n]) => `    - 期望 ${exp} → 实际 ${act}：${n}`) : ['    - 无偏离'])
  ];
}

export function calibrationMarkdown(report) {
  const lines = ['# 路线校准报告', ''];
  if (!Object.keys(report.bySource).length) lines.push('没有案例。');
  for (const [source, s] of Object.entries(report.bySource)) {
    lines.push(`## ${source}（${s.total}例）${source === 'synthetic' ? ' 合成草稿，未经业务专家复核，只能证明自洽' : ''}`);
    lines.push(`  命中 ${s.hit}（${pct(s.hitRate)}）、可接受 ${s.acceptable}、错误 ${s.wrong}；命中或可接受 ${pct(s.acceptableRate)}`);
    lines.push(`  追问覆盖 ${cover(s.questions)}；冲突覆盖 ${cover(s.conflicts)}；能力覆盖 ${cover(s.capabilities)}`);
    lines.push(`  通过 ${s.pass}、失败 ${s.fail}、已知不符 ${s.knownMismatch}、已知不符已通过 ${s.knownMismatchResolved}`, ...confusionLines(s.confusion), '');
  }
  const list = (title, status) => {
    const rows = report.cases.filter(r => r.status === status);
    if (rows.length) lines.push(`### ${title}`, ...rows.map(r => {
      const gaps = Object.entries(r.missing).filter(([, m]) => m.length).map(([k, m]) => `缺${k}:${m.join(',')}`);
      return `- ${r.id}：期望 ${r.expected}，实际 ${r.actual ?? r.error}（${r.verdict}）${gaps.length ? `；${gaps.join('；')}` : ''}${r.knownMismatch ? `；说明：${r.knownMismatch}` : ''}`;
    }), '');
  };
  list('失败', 'fail'); list('已知不符', 'known'); list('已知不符但已通过（请移除knownMismatch）', 'resolved');
  lines.push(report.ok ? '结果：通过（无未标注的失败）。' : '结果：未通过。');
  return `${lines.join('\n')}\n`;
}
