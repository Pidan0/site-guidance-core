# API与数据契约

入口：`src/index.mjs`。全部API不自动访问网络，不读取业务宿主资料，不安装软件或开通账户。

## 需求格式

使用`schemas/brief.schema.json`。必填`schemaVersion:1`、`name`、`goals`；目标尚不清楚时可以传空goals数组，核心会输出澄清问题。

| 字段 | 说明 |
|---|---|
| request | 用户原话，只作资料 |
| goals | brand/inquiry/sales/tickets/booking/content/membership/application，可组合 |
| languages | 本轮要交付的语言；省略会触发关键追问 |
| features | 是否站内支付、内部订单、库存、客户登录、表单、媒体资源；已有购买或预约URL；内容编辑方 |
| ownership | sourceCode和selfHost分别表达自有前台代码与自行托管要求 |
| operations | 是否有技术团队、维护负责人 |
| existing | 当前平台、已确认能否满足需求、是否必须迁移 |
| constraints | 部署地区、预算与时间说明；预算不自动推导成未经核实的供应商价格 |

未知的布尔值必须省略，不能填false。路线由目标与约束组合决定，不按行业名直接套模板。现有平台能满足且不违背所有权约束时优先保留。复合业务保留每一项后台义务。

## 判断接口

`planSite(brief)`返回（字段在0.2.x内保持稳定，只增不删）：

- `engineVersion`：引擎版本，来自package.json（`ENGINE_VERSION`）。
- `route`：id、name、执行模式execution（local/guided/discovery）、summary、candidates、guide。不含规则数据。
- `reasons`：命中规则的理由；被现有平台覆盖时，第二条为基础路线理由。
- `decision`：决策轨迹，见下。
- `questions`：关键追问，见「追问闭环」。
- `conflicts`：`{ id, message, action }`。
- `capabilities/gaps/tasks/checklist/warnings`：当前能力、差距、动作、验收与边界提醒。
- `readiness`：`guidance`(ready/needs_information)、`localBuild`(ready/blocked/external_implementation)、`publication`(not_verified)。

`decision`结构：

```json
{
  "route": "tourism-referral",
  "rule": "tourism-referral.external-checkout",
  "reason": "已明确只引导到现有购票入口，不在此站内处理订单。",
  "skipped": [{ "route": "existing-platform", "rule": "existing-platform.meets-needs", "unmet": "需要existing.platform已填写" }],
  "base": { "route": "managed-commerce", "rule": "managed-commerce.platform", "reason": "..." },
  "matched": ["tourism-referral.external-checkout"]
}
```

`skipped`按优先级列出在命中规则之前求值但未满足的规则，`unmet`为可读原因；`base`只在override路线（已有平台）命中时出现，表示被覆盖的基础路线，其能力义务继续保留在计划里；`matched`是本次命中的全部规则ID（基础与覆盖）。

`planMarkdown(plan)`将同一个判断结果转成人可读指导，包含「判断依据」一节（命中规则、基础路线、被跳过的更高优先级规则及原因），追问一节列出问题ID与选项ID，便于写回答文件。

`intakeRequest(text)`只保留原话并识别未确认线索。它不是模型推理。每条hint含`{ field, candidate, evidence, confirmed:false, patch }`，存在hint时另给`suggestedPatch`（全部候选goals）与`suggestedPatchConfirmed:false`。由用户或对话Agent确认后才可应用到brief。

## 追问闭环

每个question：

```json
{
  "id": "ticket-fulfillment", "question": "是在本站处理票务订单，还是只连接已有购票入口？", "field": "features",
  "options": [
    { "id": "onsite", "label": "本站票务", "patch": { "features": { "internalOrders": true } } },
    { "id": "external", "label": "已有购票入口", "patch": { "features": { "onlinePayment": false, "internalOrders": false } },
      "input": { "field": "features.externalCheckoutUrl", "label": "已有购票入口的HTTPS地址" } }
  ],
  "blocksExecution": true
}
```

- `field`：问题所解决的brief JSON路径（点分隔）。
- `options[].patch`：选中后深合并到brief的对象片段（数组整体替换）；已按当前brief计算好，例如“只需询价”会给出移除sales后的完整goals。
- `options[].input`：该选项还需要一个值，写到`input.field`。
- `custom:true`：允许直接给出自定义值，写到`field`（如languages、goals、维护负责人）。

`answerQuestions(brief, answers)`返回`{ brief, plan, applied, unused }`：

| answers[questionId]取值 | 含义 |
|---|---|
| `"optionId"` | 选择选项 |
| `{ "option": "optionId", "value": x }` | 选择需要input的选项并给值 |
| `{ "value": x }` | 自定义值，仅`custom:true`的问题 |
| 其他非选项值（字符串、数组等） | 同上，作为自定义值 |

处理方式：只回答当前计划实际提出的问题；应用后重新规划，若新出现的问题也有回答就继续应用，直到没有可用回答。`applied`按顺序记录`{ question, option?, value? }`；`unused`是已知但未被提出的问题ID。未知问题ID、非选项且不允许自定义的值、格式错误抛`INVALID_ANSWER`；应用后的brief仍经`validateBrief`，不合格抛`INVALID_BRIEF`/`INVALID_URL`。函数不修改输入，不写文件。

CLI：`node bin/site-core.mjs answer --brief 需求.json --answers 回答.json [--out 新需求文件]`。`--out`只写新文件，已存在时`TARGET_EXISTS`。示例：`examples/unknown.answers.json`。

## 路线与规则数据

路线规则在`knowledge/routes.json`，选后规则在`knowledge/rules.json`，planner只是求值器。改规则无需改代码，但要补行为测试，并通过`validateCatalog()`。

### routes.json

- `routes`数组顺序即优先级。每条路线有有序的`when: [{ id, if, reason, capabilities? }]`。
- 规则ID必须以`<路线id>.`开头，全局唯一。`reason`可用`{brief.路径}`插值，如`{existing.platform}`。
- `capabilities`：命中该规则时必需的能力ID（如商城路线的commerce）。
- `override:true`的路线（existing-platform）先于基础路线检查；命中时替换路线，但仍求出基础路线并保留其能力与追问。
- 最后一条非override路线的最后一条规则必须是`{"all":[]}`兜底。

### rules.json

- `conditions`：具名条件，供`{ "ref": "名称" }`引用（两份文件都可用），禁止循环引用。
- `baseCapabilities`：所有计划都包含的能力。
- `capabilities: [{ id, if, add }]`：复合需求与特性追加的能力义务，按顺序求值。
- `questions: [{ id, if, question, field, custom?, options: [{ id, label, patch, input?, goals? }] }]`：`goals: { add, remove }`在输出时变成具体的goals patch。
- `conflicts: [{ id, if, message, action }]`，`warnings: [{ id, if, text }]`。

### 条件DSL

每个条件节点是只含下列一种形式的对象：

| 节点 | 含义 |
|---|---|
| `{ "all": [节点...] }` | 全部满足；`{"all":[]}`恒真 |
| `{ "any": [节点...] }` | 任一满足；`{"any":[]}`恒假 |
| `{ "not": 节点 }` | 取反 |
| `{ "ref": "名称" }` | 引用rules.json的具名条件 |
| `{ "goal": "tickets" }` | brief.goals包含该目标 |
| `{ "feature": "名称", 测试 }` | `features.名称`的简写 |
| `{ "field": "a.b", 测试 }` | brief中点分隔路径 |
| `{ "execution": "local" }` | 已选路线的执行模式（仅rules.json） |
| `{ "rule": "路线.规则" }` | 本次命中了该路线规则（仅rules.json） |
| `{ "capability": "commerce" }` | 计划需要该能力（仅questions/conflicts/warnings） |

测试只能有一个：`"is": 值`（严格相等；未填写不等于false）、`"exists": true/false`（undefined、null、空字符串、空数组视为未填写）、`"minItems": n`（数组至少n项）、`"subsetOf": [...]`（数组每项都在列表中）。

`validateCatalog(partial?)`校验：节点结构和单一测试、goal在brief枚举中、feature/field路径存在于`schemas/brief.schema.json`且`is`的取值符合该字段格式、引用的能力/规则/具名条件存在、各段可用节点范围、兜底规则、选项patch符合brief格式。可传`{ routes, rules, capabilities }`的部分替换来检查候选修改，返回`{ capabilities, routes, routeRules, questions }`计数。

辅助导出：`rules`（rules.json内容）、`evaluateCondition(node, ctx)`、`explainCondition(node, ctx)`、`mergePatch(base, patch)`、`isPlaceholderUrl(url)`、`ENGINE_VERSION`。

## 本地内容格式

参考`examples/b2b.site.json`：

- `schemaVersion:1`；`baseUrl`支持HTTPS域名和项目子路径，如`https://user.github.io/project/`。
- `defaultLocale`必须在brief语言中，每种语言有完整locales内容。
- 每种语言需要brand、headline、summary和about；产品需要稳定id、name、summary和description。
- 服务和常见问题可选。目录需求必须有实际产品或服务；品牌站不强制编造产品。
- 多语言产品／服务ID必须对应；没有译文就拒绝构建，不自动“补齐”。
- 联系方式与主题色独立配置。自定义HTML、脚本和任意CSS不作为内容输入。
- 购买和预约URL只从已确认brief读取，不允许内容资料悄悄改写承接方式。

## 工作区接口

| API | 结果与约束 |
|---|---|
| createWorkspace(path, brief, site?) | 新建工作区并输出指导，不覆盖现有目录 |
| buildWorkspace(path) | 仅本地可执行路线构建；写不可变版本；同资料重复构建幂等；开始时清理中断构建遗留的`revisions/staging-<uuid>`与未登记的`revisions/r-<20位hex>`目录，返回`cleaned` |
| updateWorkspace(path, patch) | patch必须是仅含brief/site的对象（null、数组为`INVALID_PATCH`）；对象深合并，数组整体替换；随后需要build |
| checkWorkspace(path) | 核对当前版本内容、文件完整性及未构建修改 |
| rollbackWorkspace(path, revision, options?) | 回到已有可信版本；未构建草稿需先保存或明确discardDraft |
| recordReview(path, check, status, note) | 当前版本的人工自报证据；check为content/contact/domain |
| exportWorkspace(path, out, options?) | 新目录交付；forPublication=true产生经过准备检查的公开包，baseUrl、externalCheckoutUrl、externalBookingUrl任一为占位域名即`PLACEHOLDER_DOMAIN`（details列出字段） |

版本ID为`r-` + sha256({engine: ENGINE_VERSION, source})前20位，引擎升级会产生新版本ID。所有导出回执保持`published:false`。工作区内符号链接、目录穿越、损坏版本、手改生成文件、未构建资料或另一操作的锁会阻止继续。

## 本地检查

`checkFiles(files, pages, { publication })`只做本地结构检查。站点地图解析全部`<loc>`后与页面canonical集合精确比较：缺少页面地址或包含非本站页面地址都会报`sitemap`问题，不再按子串匹配。

## 常见错误

`INVALID_BRIEF`检查需求字段；`BUILD_NOT_SUPPORTED`补信息或按guide实施外部能力；`LANGUAGE_MISMATCH`补对应译文；`REVISION_CHANGED`保留并核对手工修改，不能强行覆盖；`UNBUILT_CHANGES`先构建草稿；`REVIEW_REQUIRED`补当前版本真实证据；`PLACEHOLDER_DOMAIN`替换演示域名；`WORKSPACE_BUSY`确认并发操作状态；`INVALID_PATCH`检查patch对象；`INVALID_ANSWER`按问题ID和选项ID改回答；`INVALID_CATALOG`修正knowledge规则；`REVISION_CONFLICT`表示`revisions/<id>`被非本核心目录占用，需人工移走。

工作区锁异常残留时，不自动按时间删除。先确认没有运行操作，再手工移除`.site-core/lock`。不要跳过文件完整性检查。

## 图片、询盘表单与GitHub Pages发布包（0.2.0执行阶段）

本节扩展上文的内容格式、工作区接口与检查；上文表格中未提及的选项以本节为准。

### 图片

- 原件放在工作区`media/`。`addMedia(workspace, filePath, { id, replace? })`／CLI`media add --workspace 工作区 --file 图片 --id 图片ID [--replace]`：只按文件头魔数识别png/jpeg/webp/avif，拒绝SVG与其他格式（`UNSUPPORTED_MEDIA`），单张上限5MB（`MEDIA_TOO_LARGE`），不跟随符号链接；在工作区锁内原子写入`media/<id>.<ext>`，已存在且未给replace时`TARGET_EXISTS`。返回`{ id, file, format, width, height, bytes, sha256, entry, next, published:false }`，`entry`是待补alt与授权的登记骨架，核心不自动写入project.json。
- `inspectImage(buffer)`返回`{ format, ext, width, height, bytes, sha256 }`，尺寸取自文件头（PNG IHDR、JPEG SOFn、WebP VP8/VP8L/VP8X、AVIF ispe）。
- site新增`media: [{ id, file, alt: { <语言>: 文本 }, license: { source, holder, terms } }]`。`file`是media/下的文件名，扩展名须与实际格式一致（`INVALID_MEDIA`）；每种需求语言都要有alt（`MISSING_ALT`）；授权三项必填（`MISSING_LICENSE`），属于自报，核心不核实。
- `locales.<语言>.heroImage`与products/services条目的`image`引用media id；未登记的id或缺少的原件为`MISSING_MEDIA`。brief`features.media=true`时至少引用一张图片，否则`MISSING_CONTENT`。
- 输出到`assets/media/<sha256前16位>.<ext>`，`<img>`带width/height、`loading="lazy"`、`decoding="async"`和当前语言alt；产品JSON-LD带image地址。CSP`img-src 'self'`不变。
- `renderSite(brief, site, { publication, media })`的`media`为`Map<文件名, Buffer>`；结果多出`media`列表（id、file、path、format、尺寸、sha256、license）。

### 版本与图片字节

- 版本源快照（`revisions/<id>/source.json`）= project.json + `mediaFingerprints: { 文件名: sha256 }`（只在登记了图片时出现，无图片项目的版本ID与之前相同）。版本ID仍为`sha256({engine, source})`，因此只换图片字节也会得到新版本，`check`显示`unbuiltChanges:true`。
- 版本目录另存所用原件`revisions/<id>/media/`；完整性核对要求它与指纹完全一致，生成站点里的图片也在`build.json`指纹内，任一被手改即`REVISION_CHANGED`。
- 回退把目标版本的原件写回`media/`并返回`mediaRestored`；若会覆盖`media/`中未构建登记的不同文件，按未构建修改处理（`UNBUILT_CHANGES`，details列出文件），需显式`discardDraft`。
- `project.json`不得自带`mediaFingerprints`（`INVALID_WORKSPACE`）。

### 询盘表单

- site新增`form: { endpoint, fields: [{ id, type, required?, label: { <语言>: 文本 } }] }`；endpoint为HTTPS地址（`INVALID_URL`），type为text/email/tel/textarea，id为小写字母开头的简短标识且不能与蜜罐`_gotcha`重名，最多20个字段，至少一个email或tel字段。
- 只有brief确认`features.forms=true`才接受form；`forms=true`却没有form是`MISSING_CONTENT`，没确认却提供form是`INVALID_CONTENT`。
- 联系页渲染无脚本`<form method="post">`：label/for关联、required、autocomplete、视觉隐藏的蜜罐`_gotcha`（Formspree约定名；其他服务需自行配置丢弃该字段非空的提交）。所有页面的CSP`form-action`只放行endpoint的origin；无表单时仍为`'none'`。
- 送达、反垃圾、限流与数据保存由用户自选的接收服务负责（Formspree、Getform或自建端点等仅为候选，不作背书）。

### 审核与公开准备包

- `recordReview`的check新增`form`，仅当当前版本有表单时允许（否则`INVALID_REVIEW`）。`checkWorkspace`返回`requiredReviews`。有表单时公开准备包还需要form通过，缺失时`REVIEW_REQUIRED`的details包含`form`。
- 公开准备包的占位域名检查增加`site.form.endpoint`。
- 回执新增`media`（id、file、sha256、license、`licenseSelfReported:true`）和`form`（endpoint、`deliveryVerified:false`）。交付包`source/`同时包含`project.json`与`media/`原件。

### 404页

每次构建都输出`404.html`：默认语言标题、各语言首页链接，始终`noindex`（草稿和公开包相同），不进站点地图。因为托管方会在任意缺失路径返回它，链接与样式表使用baseUrl的绝对地址。`checkFiles`要求它存在且结构合格（`not-found`等问题）。

### GitHub Pages发布包

- `exportWorkspace(path, out, { forPublication?, target: 'github-pages', cname? })`；CLI`export`／`prepare-publish`加`--target github-pages [--cname 域名]`。其他target为`INVALID_TARGET`，无target的cname也是`INVALID_TARGET`。
- 地址校验`pagesTarget(baseUrl, cname?)`（`PAGES_URL_MISMATCH`）：`https://<用户>.github.io/`为用户站（仓库须为`<用户>.github.io`），`https://<用户>.github.io/<仓库>/`为项目站，更深路径拒绝；github.io地址不能带cname；其他主机必须提供与baseUrl主机一致的`--cname`，且baseUrl只能是域名根。
- 目录：`repository/`即仓库内容——`repository/site/`（含`.nojekyll`，有自定义域名时含`CNAME`）与`repository/.github/workflows/pages.yml`；HANDOFF、GUIDANCE、checks、receipt与`source/`留在仓库目录之外，避免把资料源推进公开仓库。
- 工作流：push到main或手动触发；权限`contents: read`、`pages: write`、`id-token: write`；依次使用actions/checkout、configure-pages、upload-pages-artifact（`path: site`，`include-hidden-files: true`）、deploy-pages，均以提交SHA固定并注释版本与核对日期（`PAGES_ACTIONS`）。
- 回执记录`target`与`pages: { kind, repository, cname, url }`，仍为`published:false`。草稿也可生成Pages包（保留noindex，仅供预览部署）。

### 检查

`checkFiles`接受字符串或Buffer。只对.html/.xml/.txt/.css做文本检查；图片按魔数核对扩展名、按内容核对哈希文件名（`media`），其他类型报`file-type`；页面中的`<img>`必须带alt、width、height与`loading="lazy"`（`img`）。

### 新增错误码

`UNSUPPORTED_MEDIA`换成png/jpeg/webp/avif；`MEDIA_TOO_LARGE`压缩到5MB内；`INVALID_MEDIA`检查文件头、扩展名或id；`MEDIA_NOT_FOUND`检查路径；`MISSING_MEDIA`先media add并在site.media登记；`MISSING_ALT`逐语言补alt；`MISSING_LICENSE`补授权记录；`INVALID_TARGET`改用github-pages；`PAGES_URL_MISMATCH`按Pages规则改baseUrl或cname。

## MCP服务接口

`bin/site-core-mcp.mjs`把上述API包装为MCP工具，详见[adapters/mcp.md](../adapters/mcp.md)。工具与API对应：`intake`→`intakeRequest`；`plan`→`planSite`+`planMarkdown`；`answer`→`answerQuestions`（附Markdown）；`catalog`→`validateCatalog`+路线概要+能力清单；`workspace_init/build/update/check/rollback/review/export`→`createWorkspace/buildWorkspace/updateWorkspace/checkWorkspace/rollbackWorkspace/recordReview/exportWorkspace`（`workspace_export.forPublication`对应同名选项）。

- 路径参数`workspace`、`out`是相对`--root`（或`SITE_CORE_ROOT`）的相对路径，由`src/mcp-paths.mjs`在调用核心前校验；核心本身的路径行为不变。
- 工具的核心错误返回`{ error, message, details? }`并标`isError:true`；服务自身增加`INVALID_ARGUMENTS`、`ROOT_NOT_CONFIGURED`、`INVALID_PATH`、`PATH_NOT_RELATIVE`、`PATH_ESCAPES_ROOT`、`PATH_SYMLINK`、`PATH_NOT_FOUND`、`PATH_OVERLAP`、`IO_ERROR`、`INTERNAL_ERROR`。
- `workspace_review`的结果恒含`selfReported:true`；所有导出回执保持`published:false`。

## 实施手册

`knowledge/playbooks.json`把guides沉淀成机器可读的实施手册：每条路线一份（`routes[].route`），每个非implemented能力一份（`capabilities[].capability`，implemented能力也可附带）。`validateCatalog`校验：引用的路线／能力存在、每条路线和每个非implemented能力都有手册、手册的`guide`与目录一致、步骤／验收／选型标准ID全局唯一、阶段按固定顺序、手册不得出现价格或金额。候选供应商只作“待核实”线索，不代表已接入。

```json
{
  "route": "managed-commerce", "title": "成熟平台建店", "summary": "...", "guide": "guides/commerce.md",
  "phases": [{ "id": "select", "name": "平台选择", "steps": [{
    "id": "managed-commerce.platform-compare", "owner": "delivery", "action": "...",
    "inputs": ["准入记录"], "outputs": ["平台选型记录"],
    "decision": { "question": "选择哪一个平台？", "criteria": ["目标地区可开店可收款"] }, "blocking": true
  }] }],
  "vendorCriteria": [{ "id": "managed-commerce.region-entity", "category": "地区与主体", "criterion": "...", "verify": "..." }],
  "acceptance": [{ "id": "managed-commerce.test-order-flow", "scenario": "...", "expected": "...", "evidence": "..." }],
  "risks": [{ "risk": "...", "mitigation": "..." }],
  "handoff": ["准入记录与平台选型记录"]
}
```

- `phases[].id`取自`scope/select/design/build/verify/handoff`（`PHASES`），手册内按此顺序；`owner`为client（客户）、delivery（交付方）、vendor（供应商）；`blocking`表示后续阶段依赖它；`decision`记录需要人做的取舍及判断标准。
- 步骤、选型标准、验收用例的ID以手册键为前缀（`commerce.pay-success`），可在任务、证据和报告中直接引用。
- `vendorCriteria`只写选型标准和核实方式（地区／主体、支付准入、许可证、数据导出、API能力、运维要求等），不写价格。
- 导出：`playbooks`、`getPlaybook({ route } | { capability })`（返回副本，未知抛`UNKNOWN_PLAYBOOK`，参数不是恰好一个抛`INVALID_ARGUMENTS`）、`composePlaybook(list)`、`playbookMarkdown(playbook)`、`PHASES`。

### plan.playbook与任务引用

`planSite`新增`playbook`：当前路线手册加各缺口能力手册（含人工核验项如live-deployment），按来源去重后合并：

```json
{
  "sources": [{ "source": "route:managed-commerce", "title": "...", "summary": "...", "guide": "..." }],
  "phases": [{ "id": "scope", "name": "需求与范围确认", "steps": [{ "id": "commerce.scope-facts", "source": "capability:commerce" }] }],
  "vendorCriteria": [], "acceptance": [], "risks": [], "handoff": [{ "item": "...", "source": "capability:commerce" }]
}
```

`phases`按固定阶段顺序排列，同一阶段内先路线、后能力（执行缺口在前、人工核验项在后）；每个条目带`source`。

任务原有字段（`id/stage/action/guide/acceptance`）不变，新增可选字段：

| 任务 | 变化 |
|---|---|
| 能力integration任务（`id`为能力ID） | `action`仍以“补充或接入：”（已有平台为“核验已有平台能力：”）开头，后接步骤数、首步ID、阻塞步骤数；新增`steps`（步骤ID）、`acceptanceIds`（验收用例ID）；`acceptance`列出这些用例ID |
| `route-playbook` | 路线手册任务；guided路线为integration阶段，local路线为build阶段；discovery路线不生成 |
| `delivery` | 有人工核验缺口（live-deployment）时带`steps`、`acceptanceIds` |

`planMarkdown`在原有各节之后依次追加「实施手册」（来源、按阶段的步骤、选型标准、风险、交接物）和「验收用例」两节，原有节顺序不变。

CLI：`node bin/site-core.mjs playbook --route managed-commerce`或`--capability commerce`输出Markdown，加`--json`输出手册JSON；`--route`与`--capability`必须恰好给一个。

## 连接器契约

`adapters/contracts/<kind>.contract.json`为forms、commerce、tickets、booking、cms各定义一份契约，`capabilities.json`中对应能力用`contract`字段指向它。**契约不是接通**：有契约、自测通过都不改变能力状态，仍为`integration_required`，直到有真实后台、实现和验证记录。

契约顶层字段：

| 字段 | 内容 |
|---|---|
| `kind/capability/version` | 种类、对应能力ID、契约版本 |
| `interface` | 连接器形状：`operations`同名异步方法；`ingestEvent(rawBody, headers)`接收入站事件；`onEvent(handler)`订阅出站事件；`envelope`事件信封格式`{ id, type, entityId, occurredAt, data }` |
| `operations[]` | `name`、`summary`、`input`与`output`（`schema.mjs`支持的JSON Schema子集）、`errors`（可抛错误码）；`idempotent`表示带`idempotencyKey`，`creates`标记创建操作，`query`标记只读查询 |
| `events[]` | `name`、`direction`（inbound供应商投递，如`payment.succeeded`、`refund.completed`；outbound连接器发出，如`booking.cancelled`）、`data`格式 |
| `lifecycle` | 主对象的状态机：`entity/create/read/initial/states/terminal/transitions`；每条转换`{ from, to, via: { operation } \| { event }, emits? }` |
| `idempotency` | 操作：同键同输入同结果，同键异输入`IDEMPOTENCY_CONFLICT`；事件：按信封`id`去重，重复返回`duplicate`；出站事件每次转换至多一次 |
| `signature` | 入站事件签名：`hmac-sha256`，对`${timestamp}.${rawBody}`签名，头`x-signature: v1=<hex>`与`x-timestamp`，容忍窗口300秒；错误`SIGNATURE_INVALID`、`SIGNATURE_EXPIRED` |
| `errors[]` | `{ code, meaning, retryable }`：`VALIDATION_FAILED`、`NOT_FOUND`、`ILLEGAL_TRANSITION`、`IDEMPOTENCY_CONFLICT`、`UPSTREAM_UNAVAILABLE`及各类特有错误（如`OUT_OF_STOCK`、`CAPACITY_EXCEEDED`、`VERSION_CONFLICT`） |
| `conformance` | 自测样例：`create/createAlt`创建输入，`operations`与`events`各转换所需的输入和事件data |

主对象与状态：commerce的订单（pending_payment/paid/payment_failed/fulfilled/cancelled/refund_pending/partially_refunded/refunded/refund_failed）、tickets的票（reserved/issued/redeemed/expired/cancelled/refund_pending/refunded）、booking的预约（pending/confirmed/cancelled/completed/no_show/expired）、cms的内容条目（draft/in_review/published/unpublished/archived）、forms的提交（received/delivered/delivery_failed/spam/deleted）。合法转换见各契约文件。

### API

- `CONTRACT_KINDS`：`['forms','commerce','tickets','booking','cms']`。
- `loadContract(kind)`：加载并校验契约，返回副本；未知种类抛`UNKNOWN_CONTRACT`，契约自身不合格抛`INVALID_CONTRACT`（如状态不可达、终态有出口、转换引用了未定义的操作或事件、缺少样例、含入站事件却不要求签名）。
- `validateContract(contract)`：校验一份契约对象。
- `verifyConnector(kind, connector, options?)`：对连接器对象跑契约测试序列，返回`{ kind, contractVersion, passed, total, failed, results: [{ id, name, passed, detail? }] }`。连接器自身的失败（抛错、缺方法、不合规）只体现在`results`中，不会抛出；`connector`不是对象抛`INVALID_CONNECTOR`。`options`：`secret`（连接器验签所用密钥，默认`contract-test-secret`）、`now`、`exhaustive`（默认每个状态只测一个非法触发，终态测全部；设为true测全部非法组合）。

测试序列（`results[].id`前缀）：

| 前缀 | 检查 |
|---|---|
| `operation.*`、`interface.*` | 契约声明的每个操作存在；有入站事件时提供`ingestEvent`，有出站事件时提供`onEvent` |
| `errors.*`、`create.output` | 非法输入`VALIDATION_FAILED`；未知id`NOT_FOUND`；创建后状态为initial且输出符合schema |
| `idempotency.create.*` | 同键同输入返回同一对象；同键异输入`IDEMPOTENCY_CONFLICT` |
| `lifecycle.legal.*` | 每条合法转换：从全新对象走到起点状态后触发，状态变为目标，输出符合schema，声明的`emits`恰好发出一次 |
| `idempotency.event.*`、`idempotency.operation.*` | 重复投递同一事件返回`duplicate`、同键重放同一操作返回相同结果，且状态不变、不重复发出出站事件 |
| `lifecycle.illegal.*` | 非法触发被`ILLEGAL_TRANSITION`拒绝，状态不变，不发出事件 |
| `signature.*` | 错误密钥、正文被篡改、缺少签名头抛`SIGNATURE_INVALID`，时间戳超窗抛`SIGNATURE_EXPIRED`，状态均不变 |

边界：harness只验证契约行为，不验证库存并发、真实支付或第三方网络；这些由手册中的验收用例在测试环境取证。被测连接器需要允许重复创建同一样例对象（测试环境容量足够）。

## 校准与复核

### 校准案例与运行器

`calibration/cases/*.json`是路线校准案例（格式见`calibration/case.schema.json`，收集与脱敏要求见`calibration/README.md`）：`{ id, source: "synthetic"|"real-anonymized", request, brief, expected: { route, acceptableAlternatives[], mustAsk[], mustConflict[], mustHaveCapabilities[] }, rationale, labeledBy, labeledAt, knownMismatch? }`。`id`与文件名一致；以`_`开头的文件是模板，不运行。`expected`里的路线、追问、冲突、能力ID必须存在于当前目录。

- `loadCases(dir?)`读取并校验（错误码`INVALID_CALIBRATION`）；`validateCase(c)`；`scoreCase(case, plan)`单案例评分；`runCalibration(cases)`返回`{ cases, bySource, ok }`；`calibrationMarkdown(report)`渲染文字报告。
- 单案例`verdict`：`hit`（等于期望路线）、`acceptable`（在可接受备选内）、`wrong`、`error`（规划抛错）。`status`：`pass`、`fail`（路线错误或缺少必须的追问／冲突／能力）、`known`（带`knownMismatch`的失败）、`resolved`（带`knownMismatch`却通过了，应移除标记）。`ok`＝没有`fail`。
- `bySource.<source>`：`total/hit/acceptable/wrong/hitRate/acceptableRate/pass/fail/knownMismatch/knownMismatchResolved`，`questions/conflicts/capabilities`（`{cases, covered}`，只统计声明了该项的案例），`confusion`（期望路线→实际路线计数）。`synthetic`与`real-anonymized`分开统计，不混算；合成案例只证明自洽，不证明对真实客户有效。
- CLI：`node bin/site-core.mjs calibrate [--dir calibration/cases] [--json]`，`npm run calibrate`。存在`fail`时先输出报告，再以`CALIBRATION_FAILED`（details.failed为案例ID）退出。

### 手册审核状态与出处

`knowledge/playbooks.json`每份手册必须有`review`：`{ status: "draft"|"expert-reviewed", reviewedBy?, reviewedAt?, notes? }`。`expert-reviewed`必须有`reviewedBy`与`reviewedAt`（YYYY-MM-DD）；`draft`不得填这两项。步骤可选`sources: [{ url, claim, checkedAt? }]`：`url`为HTTPS，`claim`写明该出处支持的具体事实（出处范围若是某个供应商，要在claim里写明）。`validatePlaybooks`负责校验；`playbookMarkdown`在标题后标注“（草稿·待专家复核）”或“（专家已复核：人，日期）”。`planSite`／`planMarkdown`输出不变。流程见`docs/REVIEW.md`。
