import { validateBrief } from './schema.mjs';
import { routes, capabilities, rules } from './catalog.mjs';
import { evaluate, explain } from './rules.mjs';
import { fail, invariant } from './errors.mjs';
import { mergePatch, valueAt } from './patch.mjs';
import { ENGINE_VERSION } from './version.mjs';
import { getPlaybook, composePlaybook, playbookSections } from './playbooks.mjs';

const fill = (template, brief) => template.replace(/\{([a-zA-Z.]+)\}/g, (_, path) => String(valueAt(brief, path) ?? ''));

// First matching rule in priority order; every rule evaluated before it is recorded with the reason it did not match.
function firstMatch(candidates, ctx, skipped) {
  for (const route of candidates) for (const rule of route.when) {
    if (evaluate(rule.if, ctx)) return { route, rule };
    skipped?.push({ route: route.id, rule: rule.id, unmet: explain(rule.if, ctx) });
  }
  return null;
}

// Routes are tried in routes.json order. Override routes (existing-platform) win when they match,
// but the base route is still decided so its obligations stay in the plan.
function decideRoute(brief) {
  const ctx = { brief, conditions: rules.conditions }, skipped = [];
  const override = firstMatch(routes.filter(r => r.override), ctx, skipped);
  const base = firstMatch(routes.filter(r => !r.override), ctx, override ? null : skipped);
  invariant(base, 'INVALID_CATALOG', '路线规则缺少兜底规则');
  const chosen = override ?? base, summary = hit => ({ route: hit.route.id, rule: hit.rule.id, reason: fill(hit.rule.reason, brief) });
  return {
    ...summary(chosen), skipped,
    ...(override ? { base: summary(base) } : {}),
    matched: [base, override].filter(Boolean).map(hit => hit.rule.id),
    hits: [base, override].filter(Boolean)
  };
}

function requiredCapabilities(ctx, hits) {
  const required = new Set(rules.baseCapabilities);
  for (const hit of hits) for (const id of hit.rule.capabilities ?? []) required.add(id);
  for (const rule of rules.capabilities) if (evaluate(rule.if, ctx)) rule.add.forEach(id => required.add(id));
  return required;
}

function optionPatch(option, brief) {
  if (!option.goals) return structuredClone(option.patch);
  const { add = [], remove = [] } = option.goals;
  const goals = [...new Set([...brief.goals.filter(goal => !remove.includes(goal)), ...add])];
  return mergePatch(option.patch, { goals });
}

function materializeQuestion(def, brief) {
  const options = def.options.map(option => ({
    id: option.id, label: option.label, patch: optionPatch(option, brief), ...(option.input ? { input: structuredClone(option.input) } : {})
  }));
  return { id: def.id, question: def.question, field: def.field, options, ...(def.custom ? { custom: true } : {}), blocksExecution: true };
}

// Step and acceptance ids a given playbook source contributes to the merged plan playbook.
function refsOf(playbook, source) {
  const steps = playbook.phases.flatMap(p => p.steps).filter(step => step.source === source);
  return {
    steps: steps.map(step => step.id), blocking: steps.filter(step => step.blocking).map(step => step.id),
    acceptanceIds: playbook.acceptance.filter(item => item.source === source).map(item => item.id)
  };
}

function playbookTask({ id, stage, prefix, name, guide, refs }) {
  const detail = `按实施手册完成${refs.steps.length}个步骤（从${refs.steps[0]}开始，阻塞步骤${refs.blocking.length}个）`;
  return {
    id, stage, action: `${prefix}${name}。${detail}。`, guide, acceptance: `通过验收用例并留存证据：${refs.acceptanceIds.join('、')}。`,
    steps: refs.steps, acceptanceIds: refs.acceptanceIds
  };
}

function tasksFor(plan, brief, executionGaps) {
  const verb = plan.route.id === 'existing-platform' ? '核验已有平台能力：' : '补充或接入：', pb = plan.playbook;
  const routeRefs = refsOf(pb, `route:${plan.route.id}`), deliveryRefs = plan.gaps.filter(c => c.status === 'manual_verification');
  const delivery = deliveryRefs.map(c => refsOf(pb, `capability:${c.id}`));
  return [
    ...plan.questions.map(q => ({ id: q.id, stage: 'intake', action: q.question, acceptance: '用户明确回答并更新需求资料。' })),
    ...plan.conflicts.map(c => ({ id: c.id, stage: 'decision', action: c.action, acceptance: '约束冲突有明确解决方案。' })),
    ...(brief.existing?.migrationRequired ? [{
      id: 'migration', stage: 'migration', action: '导出既有内容、资源和业务数据，建立旧新URL映射、重定向和回退方案。',
      acceptance: '迁移前备份可恢复，关键页面和业务记录有对应检查。'
    }] : []),
    ...(routeRefs.steps.length ? [playbookTask({
      id: 'route-playbook', stage: plan.route.execution === 'guided' ? 'integration' : 'build', prefix: '执行路线手册：', name: plan.route.name,
      guide: plan.route.guide, refs: routeRefs
    })] : []),
    ...executionGaps.map(c => playbookTask({
      id: c.id, stage: 'integration', prefix: verb, name: c.name, guide: c.guide, refs: refsOf(pb, `capability:${c.id}`)
    })),
    { id: 'content', stage: 'build', action: '整理经确认的文字、产品或服务内容；逐语言提供译文。', acceptance: '不编造价格、资质、图片授权或翻译。' },
    {
      id: 'delivery', stage: 'acceptance', action: '核对页面、联系或交易路径、域名与交付责任。', acceptance: '以当前版本的实测证据记录，不能用代码存在代替上线。',
      ...(delivery.length ? { steps: delivery.flatMap(r => r.steps), acceptanceIds: delivery.flatMap(r => r.acceptanceIds) } : {})
    }
  ];
}

function readinessOf(route, questions, conflicts, executionGaps) {
  const localBuildAllowed = route.execution === 'local' && !questions.length && !conflicts.length && !executionGaps.length;
  const localBuild = localBuildAllowed ? 'ready' : route.execution === 'guided' ? 'external_implementation' : 'blocked';
  return { guidance: questions.length ? 'needs_information' : 'ready', localBuild, publication: 'not_verified' };
}

export function planSite(input) {
  const brief = validateBrief(input), decision = decideRoute(brief), { hits, ...trace } = decision;
  const route = structuredClone(routes.find(r => r.id === decision.route));
  delete route.when; delete route.override;
  const ctx = { brief, conditions: rules.conditions, execution: route.execution, matched: new Set(decision.matched) };
  ctx.capabilities = requiredCapabilities(ctx, hits);
  const questions = rules.questions.filter(q => evaluate(q.if, ctx)).map(q => materializeQuestion(q, brief));
  const conflicts = rules.conflicts.filter(c => evaluate(c.if, ctx)).map(({ id, message, action }) => ({ id, message, action }));
  const warnings = rules.warnings.filter(w => evaluate(w.if, ctx)).map(w => w.text);
  const capabilityPlan = [...ctx.capabilities].map(id => structuredClone(capabilities.find(c => c.id === id)));
  const gaps = capabilityPlan.filter(c => c.status !== 'implemented');
  const executionGaps = gaps.filter(c => c.status !== 'manual_verification');
  const reasons = [decision.reason, ...(decision.base ? [decision.base.reason] : [])];
  const plan = {
    schemaVersion: 1, engineVersion: ENGINE_VERSION, project: brief.name, route, reasons, decision: trace,
    confidence: questions.length || conflicts.length ? 'provisional' : 'ready_for_guidance',
    questions, conflicts, capabilities: capabilityPlan, gaps, warnings,
    readiness: readinessOf(route, questions, conflicts, executionGaps)
  };
  const playbookGaps = [...executionGaps, ...gaps.filter(c => c.status === 'manual_verification')];
  plan.playbook = composePlaybook([getPlaybook({ route: route.id }), ...playbookGaps.map(c => getPlaybook({ capability: c.id }))]);
  plan.tasks = tasksFor(plan, brief, executionGaps);
  plan.checklist = ['客户确认内容准确', '各目标语言与手机页面可读', '咨询或业务路径实测成功', '域名、HTTPS与目标地区访问验证', '交接资料和维护责任确认'];
  return plan;
}

const line = value => String(value).replace(/\r?\n/g, ' ');
const bullets = (items, empty) => (items.length ? items.map(x => `- ${line(x)}`).join('\n') : empty);

function decisionSection(plan) {
  const name = id => routes.find(r => r.id === id)?.name ?? id, d = plan.decision;
  const lines = [`命中规则：\`${d.rule}\`（${name(d.route)}）`];
  if (d.base) lines.push(`基础路线：\`${d.base.rule}\`（${name(d.base.route)}），其能力义务继续保留`);
  if (!d.skipped.length) lines.push('没有更高优先级的路线规则被跳过。');
  else lines.push(`跳过的更高优先级规则：\n${d.skipped.map(s => `  - \`${s.rule}\`（${name(s.route)}）：${line(s.unmet)}`).join('\n')}`);
  return lines.map(x => `- ${x}`).join('\n');
}

function questionLine(q) {
  const options = q.options.map(o => `${o.id}=${o.label}${o.input ? `（需提供${o.input.label}）` : ''}`).join(' / ');
  return `- [${q.id}] ${line(q.question)} 选项：${options}${q.custom ? `；也可直接填写${q.field}` : ''}`;
}

export function planMarkdown(plan) {
  const capabilityRows = plan.capabilities.map(c => `| ${line(c.name)} | ${c.status} | ${c.implementation ?? c.guide} |`).join('\n');
  const tasks = plan.tasks.map((t, i) => `${i + 1}. ${line(t.action)} 完成证据：${line(t.acceptance)}`).join('\n');
  return [
    `# ${line(plan.project)} 建站指导`,
    `## 建议路线\n\n${plan.route.name}：${plan.route.summary}\n\n${bullets(plan.reasons, '')}`,
    `## 判断依据\n\n${decisionSection(plan)}`,
    `## 当前能执行到哪里\n\n指导：${plan.readiness.guidance}；本地生成：${plan.readiness.localBuild}；公网发布：尚未验收。`,
    `## 必须先回答\n\n${plan.questions.length ? plan.questions.map(questionLine).join('\n') : '没有阻塞指导的追问。'}`,
    `## 约束冲突\n\n${bullets(plan.conflicts.map(c => c.message), '未识别到显式冲突。')}`,
    `## 能力与缺口\n\n| 能力 | 状态 | 实现或指引 |\n|---|---|---|\n${capabilityRows}`,
    `## 执行任务\n\n${tasks}`,
    `## 验收\n\n${plan.checklist.map(x => `- [ ] ${x}`).join('\n')}`,
    `## 条件与边界\n\n${plan.warnings.map(x => `- ${x}`).join('\n')}`,
    `${playbookSections(plan.playbook)}\n`
  ].join('\n\n');
}

const INTAKE_PATTERNS = [
  ['tickets', /门票|票务|核销/u], ['booking', /预约|预订|排期/u], ['sales', /商城|购物车|在线卖货|在线支付/u],
  ['inquiry', /询盘|询价|咨询|外贸/u], ['brand', /品牌|官网|展示/u], ['membership', /会员|登录|权限/u]
];

export function intakeRequest(request) {
  if (typeof request !== 'string' || !request.trim()) throw fail('INVALID_REQUEST', '请提供用户的原始需求。');
  const hints = INTAKE_PATTERNS.flatMap(([goal, pattern]) => {
    const match = request.match(pattern);
    return match ? [{ field: 'goals', candidate: goal, evidence: match[0], confirmed: false, patch: { goals: [goal] } }] : [];
  });
  return {
    request, hints,
    ...(hints.length ? { suggestedPatch: { goals: hints.map(h => h.candidate) }, suggestedPatchConfirmed: false } : {}),
    brief: { schemaVersion: 1, name: '待命名项目', request, goals: [] },
    questions: ['访客最重要的动作是什么？', '购买、预约或业务操作由本站还是已有系统承接？', '使用哪些语言，谁负责后续维护？'],
    note: '关键词仅为线索。由用户或对话Agent确认后填写brief（可用answerQuestions或update应用patch），再调用plan；本步骤不自动决定路线。'
  };
}
