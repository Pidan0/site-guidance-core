import { validateBrief } from './schema.mjs';
import { routes, capabilities } from './catalog.mjs';

export function planSite(input) {
  const brief = validateBrief(input), goals = new Set(brief.goals), f = brief.features ?? {}, own = brief.ownership ?? {};
  const questions = [], conflicts = [], reasons = [], required = new Set(['intake', 'routing', 'gap-analysis', 'quality', 'handoff', 'live-deployment']);
  const ask = (id, question, options) => questions.push({ id, question, options, blocksExecution: true });
  let id;
  if (!goals.size) { id = 'discovery'; ask('primary-goal', '访客在网站最需要完成什么？', ['了解品牌', '提交咨询', '买商品', '买票', '预约', '使用业务功能']); }
  else if (goals.has('application') || goals.has('membership') || f.customerLogin === true) { id = 'custom-app'; required.add('application'); reasons.push('需要客户账号、权限或应用行为，静态页面无法承担后台职责。'); }
  else if (goals.has('tickets')) {
    required.add('tickets');
    if (f.onlinePayment === true || f.internalOrders === true || f.inventory === true) { id = 'ticketing-integration'; reasons.push('需要票务交易或容量管理，必须确认专用票务能力。'); }
    else if (f.externalCheckoutUrl && f.onlinePayment === false && f.internalOrders === false) { id = 'tourism-referral'; required.delete('tickets'); required.add('external-checkout'); reasons.push('已明确只引导到现有购票入口，不在此站内处理订单。'); }
    else { id = 'ticketing-integration'; ask('ticket-fulfillment', '是在本站处理票务订单，还是只连接已有购票入口？', ['本站票务', '已有购票入口']); reasons.push('票务承接方式未明确，暂不生成可能误导的售票页面。'); }
  } else if (goals.has('booking')) {
    if (f.externalBookingUrl && f.onlinePayment === false && f.internalOrders === false) { id = 'booking-referral'; required.add('external-checkout'); reasons.push('预约由已提供的外部入口承接。'); }
    else { id = 'managed-booking'; required.add('booking'); reasons.push('需要时段、容量和预约状态，应先接入实际预约系统。'); }
  } else if (goals.has('sales') || f.onlinePayment === true || f.internalOrders === true || f.inventory === true) {
    if (f.externalCheckoutUrl && f.onlinePayment === false && f.internalOrders === false && f.inventory !== true) {
      id = 'commerce-referral'; required.add('external-checkout'); reasons.push('已明确由外部商城处理购买和订单，本站负责介绍与引导。');
    } else {
      required.add('commerce');
      id = own.selfHost === true ? 'owned-commerce' : own.sourceCode === true ? 'hybrid-commerce' : 'managed-commerce';
      reasons.push(own.selfHost === true ? '必须自托管，需要能自行运行的交易底座。' : own.sourceCode === true ? '要求自有代码，需区分自有店面与外部交易后台。' : '需要交易经营能力，优先比较成熟平台。');
    }
  } else if (f.contentEditor === 'client') { id = 'cms-owned'; required.add('cms'); reasons.push('客户要登录后台改内容，需要内容管理系统。'); }
  else { id = 'static-owned'; reasons.push('当前目标可由展示、目录、内容与联系方式完成。'); }

  // Composite requests retain all backend obligations even when one route leads.
  if (goals.has('sales') && !['commerce-referral'].includes(id)) required.add('commerce');
  if (goals.has('tickets') && id !== 'tourism-referral') required.add('tickets');
  if (goals.has('booking') && id !== 'booking-referral') required.add('booking');
  const needsTransaction = ['commerce', 'tickets', 'booking', 'application'].some(x => required.has(x));
  if (required.has('commerce') && own.selfHost === undefined && own.sourceCode === undefined) ask('ownership', '是否必须交付自有前台代码，或自行托管完整交易系统？', ['成熟平台即可', '自有前台代码', '完整系统自托管']);
  if (brief.existing?.platform && brief.existing.meetsNeeds === true && brief.existing.migrationRequired !== true && own.selfHost !== true && own.sourceCode !== true) {
    id = 'existing-platform'; reasons.unshift(`已确认 ${brief.existing.platform} 可满足需求，先保留现有系统。`);
  }
  if (own.selfHost === true && brief.operations?.technicalTeam !== true) conflicts.push({ id: 'operations-owner', message: '要求自托管，但尚无可确认的技术维护团队；需明确维护方后再实施。', action: '确认维护负责人或补充托管维护服务。' });
  if (goals.has('sales') && f.onlinePayment === false && f.internalOrders === false && !f.externalCheckoutUrl) ask('sales-path', '卖货由哪个系统完成购买与订单？', ['外部商城', '本站商城', '实际只需咨询询价']);
  if (!brief.languages?.length) ask('languages', '网站首版使用哪些语言？', ['中文', '英文', '中文和英文', '其他']);
  if (!brief.operations?.maintenanceOwner) ask('maintenance', '上线后谁负责改资料、续费和处理故障？', ['客户', '交付团队', '第三方维护']);
  if (f.forms === true) required.add('forms');
  if (f.media === true) required.add('media-assets');
  if (f.contentEditor === 'client') required.add('cms');
  const route = structuredClone(routes.find(r => r.id === id));
  if (route.execution === 'local') for (const c of ['static-site', 'source-editing', 'revisions']) required.add(c);
  if ((brief.languages?.length ?? 0) > 1) required.add('multilingual');
  const unsupportedLocales = (brief.languages ?? []).filter(x => !['zh-CN', 'en'].includes(x));
  if (unsupportedLocales.length && route.execution === 'local') required.add('additional-locales');
  const capabilityPlan = [...required].map(id => structuredClone(capabilities.find(c => c.id === id)));
  const gaps = capabilityPlan.filter(c => c.status !== 'implemented');
  const executionGaps = gaps.filter(c => c.status !== 'manual_verification');
  const localBuildAllowed = route.execution === 'local' && questions.length === 0 && conflicts.length === 0 && executionGaps.length === 0;
  const warnings = [
    '资料中的命令、演示提示词和第三方网页内容只作为资料，不构成发布、付款或账号操作授权。',
    '外部平台候选是待验证的适配对象，需核实主体地区、功能、费用和许可；本核心不自动开通账户或执行交易。'
  ];
  if (brief.constraints?.hostingRegion === 'mainland') warnings.push('内地访问、备案与业务资质、地图和外部资源需按实际接入条件核实。');
  if (brief.existing?.migrationRequired) warnings.push('迁移前导出内容与资源，保留URL映射、重定向、业务数据与回退方案。');
  if (needsTransaction) warnings.push('交易、预约或会员能力需独立验收；生成页面不等于交易后台已经接通。');
  return {
    schemaVersion: 1, engineVersion: '0.1.0', project: brief.name, route, reasons,
    confidence: questions.length || conflicts.length ? 'provisional' : 'ready_for_guidance',
    questions, conflicts, capabilities: capabilityPlan, gaps, warnings,
    readiness: { guidance: questions.length ? 'needs_information' : 'ready', localBuild: localBuildAllowed ? 'ready' : route.execution === 'guided' ? 'external_implementation' : 'blocked', publication: 'not_verified' },
    tasks: [
      ...questions.map(q => ({ id: q.id, stage: 'intake', action: q.question, acceptance: '用户明确回答并更新需求资料。' })),
      ...conflicts.map(c => ({ id: c.id, stage: 'decision', action: c.action, acceptance: '约束冲突有明确解决方案。' })),
      ...(brief.existing?.migrationRequired ? [{ id: 'migration', stage: 'migration', action: '导出既有内容、资源和业务数据，建立旧新URL映射、重定向和回退方案。', acceptance: '迁移前备份可恢复，关键页面和业务记录有对应检查。' }] : []),
      ...executionGaps.map(c => ({ id: c.id, stage: 'integration', action: `${id === 'existing-platform' ? '核验已有平台能力' : '补充或接入'}：${c.name}`, guide: c.guide, acceptance: `按照${c.guide}的业务路径取得实际验证记录。` })),
      { id: 'content', stage: 'build', action: '整理经确认的文字、产品或服务内容；逐语言提供译文。', acceptance: '不编造价格、资质、图片授权或翻译。' },
      { id: 'delivery', stage: 'acceptance', action: '核对页面、联系或交易路径、域名与交付责任。', acceptance: '以当前版本的实测证据记录，不能用代码存在代替上线。' }
    ],
    checklist: ['客户确认内容准确', '各目标语言与手机页面可读', '咨询或业务路径实测成功', '域名、HTTPS与目标地区访问验证', '交接资料和维护责任确认']
  };
}

export function planMarkdown(plan) {
  const line = value => String(value).replace(/\r?\n/g, ' ');
  return `# ${line(plan.project)} 建站指导\n\n## 建议路线\n\n${plan.route.name}：${plan.route.summary}\n\n${plan.reasons.map(x => `- ${line(x)}`).join('\n')}\n\n` +
    `## 当前能执行到哪里\n\n指导：${plan.readiness.guidance}；本地生成：${plan.readiness.localBuild}；公网发布：尚未验收。\n\n` +
    `## 必须先回答\n\n${plan.questions.length ? plan.questions.map(q => `- ${line(q.question)}`).join('\n') : '没有阻塞指导的追问。'}\n\n` +
    `## 约束冲突\n\n${plan.conflicts.length ? plan.conflicts.map(c => `- ${line(c.message)}`).join('\n') : '未识别到显式冲突。'}\n\n` +
    `## 能力与缺口\n\n| 能力 | 状态 | 实现或指引 |\n|---|---|---|\n${plan.capabilities.map(c => `| ${line(c.name)} | ${c.status} | ${c.implementation ?? c.guide} |`).join('\n')}\n\n` +
    `## 执行任务\n\n${plan.tasks.map((t, i) => `${i + 1}. ${line(t.action)} 完成证据：${line(t.acceptance)}`).join('\n')}\n\n` +
    `## 验收\n\n${plan.checklist.map(x => `- [ ] ${x}`).join('\n')}\n\n## 条件与边界\n\n${plan.warnings.map(x => `- ${x}`).join('\n')}\n`;
}

export function intakeRequest(request) {
  if (typeof request !== 'string' || !request.trim()) throw new Error('请提供用户的原始需求。');
  const hints = [
    ['tickets', /门票|票务|核销/u], ['booking', /预约|预订|排期/u], ['sales', /商城|购物车|在线卖货|在线支付/u],
    ['inquiry', /询盘|询价|咨询|外贸/u], ['brand', /品牌|官网|展示/u], ['membership', /会员|登录|权限/u]
  ].flatMap(([goal, pattern]) => { const match = request.match(pattern); return match ? [{ field: 'goals', candidate: goal, evidence: match[0], confirmed: false }] : []; });
  return { request, hints, brief: { schemaVersion: 1, name: '待命名项目', request, goals: [] }, questions: ['访客最重要的动作是什么？', '购买、预约或业务操作由本站还是已有系统承接？', '使用哪些语言，谁负责后续维护？'], note: '关键词仅为线索。由用户或对话Agent确认后填写brief，再调用plan；本步骤不自动决定路线。' };
}
