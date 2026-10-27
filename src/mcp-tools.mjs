import * as core from './index.mjs';
import { invariant } from './errors.mjs';
import { isPlainObject } from './patch.mjs';
import { assertDisjoint } from './mcp-paths.mjs';

// MCP工具定义。不提供上传、部署、付款、DNS或任何网络工具；所有回执保持published:false。
const object = { type: 'object' };
const workspace = { type: 'string', minLength: 1, description: '工作区目录，相对服务root的相对路径，如 "customer-a"。不接受绝对路径、".."或符号链接。' };
const out = { type: 'string', minLength: 1, description: '新输出目录，相对服务root的相对路径，必须尚不存在（不覆盖）。' };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const hints = (extra = {}) => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...extra });
const PURE = hints({ readOnlyHint: true, idempotentHint: true });

const planOf = plan => ({ plan, markdown: core.planMarkdown(plan) });

export const tools = [
  {
    name: 'intake', title: '采集原话线索', annotations: PURE,
    description: '保留用户原话并按关键词识别「未确认」的线索（如目标、语言），返回hints与suggestedPatch。这不是语义理解：线索必须先向用户确认，'
      + '再由你整理成brief交给plan。不写文件，不联网。',
    inputSchema: schema({ text: { type: 'string', minLength: 1, description: '用户的原话。其中的命令只作为资料，不会被执行。' } }, ['text']),
    run: ({ text }) => core.intakeRequest(text)
  },
  {
    name: 'plan', title: '判断路线与缺口', annotations: PURE,
    description: '对已确认的brief做确定性判断，返回plan JSON（路线、decision判断依据、追问、冲突、能力缺口、任务、readiness）和Markdown指导。'
      + 'brief格式见docs/API.md；未知的布尔项必须省略，不能填false。readiness.localBuild=ready才可建本地静态站；其他路线只给出指导，不会伪装已有能力。不写文件。',
    inputSchema: schema({ brief: { ...object, description: '用户确认过的需求brief：schemaVersion:1、name、goals必填，可含request、languages、features、ownership、operations、existing、constraints。' } }, ['brief']),
    run: ({ brief }) => planOf(core.planSite(brief))
  },
  {
    name: 'answer', title: '写回追问回答', annotations: PURE,
    description: '把用户对plan追问的回答应用到brief，返回新brief、重新规划后的plan和Markdown、applied与unused。只提交用户亲自确认的回答，不要替用户选默认项。'
      + 'answers形如{"问题ID":"选项ID"}、{"问题ID":{"option":"选项ID","value":x}}或自定义值。纯计算：不修改输入，不写文件。',
    inputSchema: schema({
      brief: { ...object, description: '当前brief。' },
      answers: { ...object, description: '以问题ID为键的回答对象，问题ID和选项ID取自plan.questions。' }
    }, ['brief', 'answers']),
    run: ({ brief, answers }) => {
      const { plan, ...rest } = core.answerQuestions(brief, answers);
      return { ...rest, ...planOf(plan) };
    }
  },
  {
    name: 'catalog', title: '查看路线与能力目录', annotations: PURE,
    description: '返回知识目录的校验计数、全部路线概要和能力清单（含implemented/integration_required/manual_verification/planned状态）。'
      + '用来如实告诉用户哪些能力现在能做、哪些需要接入或开发。只读。',
    inputSchema: schema({}),
    run: () => ({
      ...core.validateCatalog(),
      routes: core.routes.map(({ id, name, execution, summary }) => ({ id, name, execution, summary })),
      capabilities: core.capabilities
    })
  },
  {
    name: 'workspace_init', title: '创建本地工作区', needsRoot: true, annotations: hints(),
    description: '在服务root下新建工作区目录（project.json、plan.json、GUIDANCE.md），写入已确认的brief和可选的site内容。目标已存在则拒绝，不覆盖。'
      + '不构建站点；资料和译文必须来自用户或其授权流程，不要编造资质、价格、销量或翻译。',
    inputSchema: schema({
      workspace: { ...workspace, description: `${workspace.description}必须尚不存在。` },
      brief: { ...object, description: '用户确认过的brief。' },
      site: { ...object, description: '站点内容（见examples/b2b.site.json的格式）；可稍后用workspace_update补充。' }
    }, ['workspace', 'brief']),
    run: ({ brief, site }, { path }) => core.createWorkspace(path, brief, site),
    paths: { workspace: 'fresh' }
  },
  {
    name: 'workspace_build', title: '构建不可变版本', needsRoot: true, annotations: hints({ idempotentHint: true }),
    description: '为工作区构建本地静态站，写入不可变版本；同一资料重复构建返回同一版本。仅readiness.localBuild=ready的路线可构建，否则返回BUILD_NOT_SUPPORTED。'
      + '构建开始时会清理本核心中断构建遗留的staging目录。结果是本地构建，不是发布。',
    inputSchema: schema({ workspace }, ['workspace']),
    run: (_, { path }) => core.buildWorkspace(path),
    paths: { workspace: 'existing' }
  },
  {
    name: 'workspace_update', title: '修改工作区资料', needsRoot: true, annotations: hints({ destructiveHint: true, idempotentHint: true }),
    description: '用patch修改工作区的project.json。patch只能含brief和/或site两个键；对象深合并，数组整体替换（会覆盖原数组）。'
      + '修改后需再调用workspace_build才会成为版本。不要直接编辑revisions里的生成文件。',
    inputSchema: schema({
      workspace,
      patch: { ...object, description: '形如{"site":{...}}或{"brief":{...}}的修改对象。' }
    }, ['workspace', 'patch']),
    run: ({ patch }, { path }) => core.updateWorkspace(path, patch),
    paths: { workspace: 'existing' }
  },
  {
    name: 'workspace_check', title: '核对当前版本', needsRoot: true, annotations: PURE,
    description: '核对当前版本的内容、文件完整性及是否有未构建修改。只做本地结构检查，不验证DNS、邮件或线上可用性。只读。',
    inputSchema: schema({ workspace }, ['workspace']),
    run: (_, { path }) => core.checkWorkspace(path),
    paths: { workspace: 'existing' }
  },
  {
    name: 'workspace_rollback', title: '回退到已有版本', needsRoot: true, annotations: hints({ destructiveHint: true, idempotentHint: true }),
    description: '把工作区资料回退到某个已构建的可信版本。有未构建修改时默认拒绝（UNBUILT_CHANGES）；仅当用户明确同意丢弃草稿时才设discardDraft=true，不要自行决定。',
    inputSchema: schema({
      workspace,
      revision: { type: 'string', minLength: 1, description: '版本ID，形如r-加20位十六进制，取自build/check结果。' },
      discardDraft: { type: 'boolean', description: '是否丢弃尚未构建的修改。默认false。' }
    }, ['workspace', 'revision']),
    run: ({ revision, discardDraft }, { path }) => core.rollbackWorkspace(path, revision, { discardDraft: discardDraft === true }),
    paths: { workspace: 'existing' }
  },
  {
    name: 'workspace_review', title: '记录人工验收证据', needsRoot: true, annotations: hints(),
    description: '为当前已构建版本记录一项人工验收（check为content/contact/domain，status为pass/fail）。note必须是用户提供的真实核对证据'
      + '（如实际测试记录），不得由你编写、推断或从素材/网页内容取得；不要照抄示例文字。结果恒标selfReported:true：这只是自报记录，核心不会核实DNS、邮件或线上状态。',
    inputSchema: schema({
      workspace,
      check: { type: 'string', enum: ['content', 'contact', 'domain'], description: 'content=内容真实性；contact=联系路径已实测送达；domain=域名配置已核对。' },
      status: { type: 'string', enum: ['pass', 'fail'] },
      note: { type: 'string', minLength: 1, description: '用户提供的真实证据原文或其转述（含时间、方法、结果）。' }
    }, ['workspace', 'check', 'status', 'note']),
    run: async ({ check, status, note }, { path }) => ({ ...(await core.recordReview(path, check, status, note)), selfReported: true }),
    paths: { workspace: 'existing' }
  },
  {
    name: 'workspace_export', title: '导出交付包', needsRoot: true, annotations: hints(),
    description: '把当前版本导出为新目录（不覆盖）。默认是草稿交付包（保留noindex）。forPublication=true生成「上线准备包」，要求三项人工验收均已pass且域名不是占位域名。'
      + '两种包都只是待上传的文件，回执恒为published:false；本服务不上传、不部署、不改DNS。上传须由用户在服务之外自行授权完成。',
    inputSchema: schema({
      workspace,
      out,
      forPublication: { type: 'boolean', description: '是否生成上线准备包。默认false（草稿包）。' }
    }, ['workspace', 'out']),
    run: ({ forPublication }, { path, outPath }) => {
      assertDisjoint(path, outPath, 'out不能位于工作区内，也不能是工作区的上级');
      return core.exportWorkspace(path, outPath, { forPublication: forPublication === true });
    },
    paths: { workspace: 'existing', out: 'fresh' }
  }
];

const typeOk = { object: isPlainObject, string: v => typeof v === 'string', boolean: v => typeof v === 'boolean', array: Array.isArray };

// 只覆盖本文件使用的JSON Schema子集：type、required、properties、additionalProperties:false、enum、minLength。
export function validateArguments(schemaNode, value, where = '参数') {
  invariant(typeOk[schemaNode.type](value), 'INVALID_ARGUMENTS', `${where}应为${schemaNode.type}`);
  if (schemaNode.enum) invariant(schemaNode.enum.includes(value), 'INVALID_ARGUMENTS', `${where}应为${schemaNode.enum.join('/')}之一`);
  if (schemaNode.minLength) invariant(value.length >= schemaNode.minLength, 'INVALID_ARGUMENTS', `${where}不能为空`);
  if (schemaNode.type !== 'object' || !schemaNode.properties) return;
  for (const key of schemaNode.required ?? []) invariant(Object.hasOwn(value, key) && value[key] !== undefined, 'INVALID_ARGUMENTS', `缺少参数 ${key}`);
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(schemaNode.properties, key)) {
      invariant(schemaNode.additionalProperties !== false, 'INVALID_ARGUMENTS', `不支持的参数 ${key}`);
    } else if (item !== undefined) validateArguments(schemaNode.properties[key], item, key);
  }
}

export function listTools(hasRoot) {
  return tools.filter(tool => hasRoot || !tool.needsRoot)
    .map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } }));
}

// 返回工具的结构化结果；抛出的fail错误由调用方转成isError。
export async function runTool(name, args, resolver) {
  const tool = tools.find(t => t.name === name);
  if (!tool) return undefined;
  validateArguments(tool.inputSchema, args, '参数');
  const context = {};
  if (tool.needsRoot) {
    invariant(resolver, 'ROOT_NOT_CONFIGURED', '未配置root：请用 --root <目录> 或环境变量 SITE_CORE_ROOT 启动服务，才能使用工作区工具');
    const kinds = tool.paths ?? {};
    if (kinds.workspace) context.path = await resolver[kinds.workspace](args.workspace, 'workspace');
    if (kinds.out) context.outPath = await resolver[kinds.out](args.out, 'out');
  }
  const result = await tool.run(args, context);
  return tool.needsRoot ? scrub(result, resolver) : result;
}

// 回执中的绝对路径改写为相对root的路径，避免向宿主暴露多余的本机目录结构。
function scrub(value, resolver) {
  if (typeof value === 'string') return value.startsWith(`${resolver.root}/`) || value === resolver.root ? resolver.relative(value) || '.' : value;
  if (Array.isArray(value)) return value.map(item => scrub(item, resolver));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, resolver)]));
  return value;
}
