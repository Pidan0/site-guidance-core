import { readFileSync } from 'node:fs';
import { fail, invariant } from './errors.mjs';

// Structured implementation playbooks (knowledge/playbooks.json): one per route and one per non-implemented capability.
export const playbooks = JSON.parse(readFileSync(new URL('../knowledge/playbooks.json', import.meta.url), 'utf8'));

export const PHASES = [
  { id: 'scope', name: '需求与范围确认' }, { id: 'select', name: '选型与准入' }, { id: 'design', name: '数据与流程设计' },
  { id: 'build', name: '实施与配置' }, { id: 'verify', name: '验证与验收' }, { id: 'handoff', name: '交接与运营' }
];
export const OWNERS = ['client', 'delivery', 'vendor'];
const OWNER_LABEL = { client: '客户', delivery: '交付方', vendor: '供应商' };
const PRICE = /[¥￥$€£]\s*\d|\d\s*(元|美元|USD|CNY|RMB)/i;

const check = (condition, where, message) => invariant(condition, 'INVALID_CATALOG', `playbooks.${where}: ${message}`);
const text = value => typeof value === 'string' && value.trim().length > 0;
const texts = (value, min = 1) => Array.isArray(value) && value.length >= min && value.every(text);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const REVIEW_STATUSES = ['draft', 'expert-reviewed'];
const keyOf = pb => (pb.route !== undefined ? pb.route : pb.capability);

// sources: 可核验的出处。url必须是HTTPS，claim写明该出处支持的具体事实。
function checkSources(sources, where) {
  check(Array.isArray(sources) && sources.length > 0, where, 'sources必须是非空数组');
  for (const item of sources) {
    check(text(item?.url) && /^https:\/\/[^\s/]+\//.test(item.url), where, 'sources.url需要HTTPS地址');
    check(text(item.claim), where, 'sources.claim需要说明出处支持的事实');
    check(item.checkedAt === undefined || DATE.test(item.checkedAt), where, 'sources.checkedAt需要YYYY-MM-DD');
  }
}

// review: 手册的审核状态。expert-reviewed必须有复核人与日期；草稿不得冒充已复核。
function checkReview(review, ref) {
  check(review && typeof review === 'object' && !Array.isArray(review), ref, '需要review对象{status,reviewedBy?,reviewedAt?,notes?}');
  check(REVIEW_STATUSES.includes(review.status), ref, `review.status需为${REVIEW_STATUSES.join('|')}`);
  for (const key of ['reviewedBy', 'notes']) check(review[key] === undefined || text(review[key]), ref, `review.${key}需为非空文本`);
  check(review.reviewedAt === undefined || DATE.test(review.reviewedAt), ref, 'review.reviewedAt需要YYYY-MM-DD');
  if (review.status === 'expert-reviewed') check(text(review.reviewedBy) && review.reviewedAt !== undefined, ref, 'expert-reviewed需要reviewedBy和reviewedAt');
  else check(review.reviewedBy === undefined && review.reviewedAt === undefined, ref, 'draft不应填写reviewedBy/reviewedAt');
}

function checkStep(step, ref, ids) {
  const where = step?.id ?? ref;
  check(text(step?.id) && step.id.startsWith(`${ref}.`), where, `步骤ID需以"${ref}."开头`);
  check(!ids.has(step.id), where, '重复的ID');
  ids.add(step.id);
  check(text(step.action) && OWNERS.includes(step.owner), where, '需要action和owner(client|delivery|vendor)');
  check(texts(step.inputs) && texts(step.outputs), where, 'inputs和outputs需要非空文本数组');
  check(step.blocking === undefined || typeof step.blocking === 'boolean', where, 'blocking必须是布尔值');
  if (step.sources !== undefined) checkSources(step.sources, where);
  if (step.decision !== undefined) check(text(step.decision.question) && texts(step.decision.criteria), where, 'decision需要question和criteria');
}

function checkPhases(pb, ref, ids) {
  check(Array.isArray(pb.phases) && pb.phases.length > 0, ref, '需要phases');
  let last = -1;
  for (const phase of pb.phases) {
    const index = PHASES.findIndex(p => p.id === phase?.id);
    check(index > last, ref, `阶段"${phase?.id}"无效、重复或顺序错误（顺序：${PHASES.map(p => p.id).join('/')}）`);
    last = index;
    check(text(phase.name) && Array.isArray(phase.steps) && phase.steps.length > 0, `${ref}.${phase.id}`, '需要name和非空steps');
    for (const step of phase.steps) checkStep(step, ref, ids);
  }
}

function checkPlaybook(pb, ref, guide, ids) {
  check(text(pb.title) && text(pb.summary), ref, '需要title和summary');
  check(text(pb.guide) && (!guide || pb.guide === guide), ref, `guide需存在并与目录一致(${guide ?? '未指定'})`);
  checkReview(pb.review, ref);
  checkPhases(pb, ref, ids);
  check(Array.isArray(pb.vendorCriteria), ref, 'vendorCriteria必须是数组');
  for (const item of pb.vendorCriteria) {
    check(text(item.id) && item.id.startsWith(`${ref}.`) && !ids.has(item.id), item.id ?? ref, '选型标准ID需以"手册."开头且唯一');
    ids.add(item.id);
    check(text(item.category) && text(item.criterion) && text(item.verify), item.id, '需要category、criterion和verify');
  }
  check(Array.isArray(pb.acceptance) && pb.acceptance.length > 0, ref, '需要非空acceptance');
  for (const item of pb.acceptance) {
    check(text(item.id) && item.id.startsWith(`${ref}.`) && !ids.has(item.id), item.id ?? ref, '验收ID需以"手册."开头且唯一');
    ids.add(item.id);
    check(text(item.scenario) && text(item.expected) && text(item.evidence), item.id, '需要scenario、expected和evidence');
  }
  check(Array.isArray(pb.risks) && pb.risks.length > 0 && pb.risks.every(r => text(r.risk) && text(r.mitigation)), ref, 'risks需要risk和mitigation');
  check(texts(pb.handoff), ref, 'handoff需要非空交接物清单');
  check(!PRICE.test(JSON.stringify(pb)), ref, '手册不得写入价格或金额');
}

function checkCoverage(list, key, label, entries, required) {
  check(Array.isArray(list), label, '必须是数组');
  const seen = new Set();
  for (const pb of list) {
    check(text(pb?.[key]) && entries.has(pb[key]), label, `引用了不存在的${key === 'route' ? '路线' : '能力'}：${pb?.[key]}`);
    check(!seen.has(pb[key]), label, `重复的手册：${pb[key]}`);
    seen.add(pb[key]);
  }
  for (const id of required) check(seen.has(id), label, `${id} 缺少实施手册`);
}

// known: { routes: Map(id -> route), capabilities: Map(id -> capability) }. Playbooks are required for every route and every
// capability that is not implemented; extra playbooks for implemented capabilities are allowed.
export function validatePlaybooks(set, known) {
  check(Array.isArray(set?.routes) && Array.isArray(set?.capabilities), 'root', '需要routes和capabilities数组');
  const required = [...known.capabilities.values()].filter(c => c.status !== 'implemented').map(c => c.id);
  checkCoverage(set.routes, 'route', 'routes', known.routes, known.routes.keys());
  checkCoverage(set.capabilities, 'capability', 'capabilities', known.capabilities, required);
  const ids = new Set();
  for (const pb of set.routes) checkPlaybook(pb, pb.route, known.routes.get(pb.route).guide, ids);
  for (const pb of set.capabilities) checkPlaybook(pb, pb.capability, known.capabilities.get(pb.capability).guide, ids);
  return { routes: set.routes.length, capabilities: set.capabilities.length, steps: [...ids].length };
}

export function getPlaybook({ route, capability }) {
  invariant((route === undefined) !== (capability === undefined), 'INVALID_ARGUMENTS', '需要且只能指定 route 或 capability 之一');
  const [list, key, id] = route !== undefined ? [playbooks.routes, 'route', route] : [playbooks.capabilities, 'capability', capability];
  const found = list.find(pb => pb[key] === id);
  if (!found) throw fail('UNKNOWN_PLAYBOOK', `没有${key === 'route' ? '路线' : '能力'}「${id}」的实施手册`, { available: list.map(pb => pb[key]) });
  return structuredClone(found);
}

const stamp = (items, source) => items.map(item => ({ ...structuredClone(item), source }));

// Merges playbooks (route first, then capabilities) into one ordered view. Duplicate sources are dropped;
// phases follow PHASES order and keep source order inside a phase.
export function composePlaybook(sources) {
  const unique = [...new Map(sources.filter(Boolean).map(pb => [`${pb.route !== undefined ? 'route' : 'capability'}:${keyOf(pb)}`, pb])).entries()];
  const phases = PHASES.map(({ id, name }) => ({
    id, name, steps: unique.flatMap(([source, pb]) => stamp(pb.phases.find(p => p.id === id)?.steps ?? [], source))
  })).filter(phase => phase.steps.length);
  const collect = key => unique.flatMap(([source, pb]) => stamp(pb[key], source));
  return {
    sources: unique.map(([source, pb]) => ({ source, title: pb.title, summary: pb.summary, guide: pb.guide })),
    phases, vendorCriteria: collect('vendorCriteria'), acceptance: collect('acceptance'), risks: collect('risks'),
    handoff: unique.flatMap(([source, pb]) => pb.handoff.map(item => ({ item, source })))
  };
}

const line = value => String(value).replace(/\r?\n/g, ' ');
const list = items => items.map(line).join('、');

function stepLines(step) {
  const head = `- [${step.id}] ${OWNER_LABEL[step.owner]}：${line(step.action)}${step.blocking ? '（阻塞）' : ''}`;
  const io = `  - 输入：${list(step.inputs)}；产出：${list(step.outputs)}`;
  const decision = step.decision ? [`  - 决策：${line(step.decision.question)} 标准：${list(step.decision.criteria)}`] : [];
  return [head, io, ...decision];
}

export function playbookSections(composed, level = 2) {
  const h = depth => '#'.repeat(depth);
  const sourceList = composed.sources.map(s => `- ${s.source}：${line(s.title)}（${s.guide}）`).join('\n');
  const phases = composed.phases.map(p => `${h(level + 1)} ${p.name}（${p.id}）\n\n${p.steps.flatMap(stepLines).join('\n')}`).join('\n\n');
  const vendors = composed.vendorCriteria.map(v => `- [${v.id}] ${v.category}：${line(v.criterion)} 核实方式：${line(v.verify)}`).join('\n');
  const risks = composed.risks.map(r => `- ${line(r.risk)} 对策：${line(r.mitigation)}（${r.source}）`).join('\n');
  const handoff = composed.handoff.map(x => `- ${line(x.item)}（${x.source}）`).join('\n');
  const acceptance = composed.acceptance.map(a => `- [${a.id}] 场景：${line(a.scenario)} 预期：${line(a.expected)} 证据：${line(a.evidence)}`).join('\n');
  return [
    `${h(level)} 实施手册\n\n手册来源（候选供应商仅为待核实线索，不含价格，不代表已接入）：\n${sourceList}\n\n${phases}`,
    `${h(level + 1)} 选型标准\n\n${vendors || '无外部供应商选型。'}`,
    `${h(level + 1)} 风险\n\n${risks}`,
    `${h(level + 1)} 交接物\n\n${handoff}`,
    `${h(level)} 验收用例\n\n${acceptance}`
  ].join('\n\n');
}

const reviewBadge = review => (review?.status === 'expert-reviewed'
  ? `（专家已复核：${line(review.reviewedBy)}，${review.reviewedAt}）` : '（草稿·待专家复核）');

export function playbookMarkdown(pb) {
  const composed = composePlaybook([pb]);
  return `# ${line(pb.title)}（${keyOf(pb)}）${reviewBadge(pb.review)}\n\n${line(pb.summary)}\n\n${playbookSections(composed)}\n`;
}
