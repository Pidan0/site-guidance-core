# 版本记录

## 0.3.0（开发中）

### 路线校准与手册复核

- 新增`calibration/`：`case.schema.json`、36个`synthetic`校准案例（覆盖外贸B2B、国内门店、品牌官网、零售电商、外链商城、文旅门票、服务预约、内容、会员应用、已有平台与迁移、目标不明、复合与冲突约束）、`_TEMPLATE.real.json`与收集说明`README.md`。合成案例标注为`synthetic-draft`，待业务专家复核；`real-anonymized`只提供模板，不含任何真实数据。
- 新增`src/calibration.mjs`（`loadCases`／`validateCase`／`scoreCase`／`runCalibration`／`calibrationMarkdown`）、CLI`calibrate [--dir] [--json]`与`npm run calibrate`：路线命中／可接受／错误，追问、冲突、能力覆盖，路线混淆矩阵，按source分开统计。存在未标注`knownMismatch`的失败时以`CALIBRATION_FAILED`退出。CI步骤（`- run: node bin/site-core.mjs calibrate`）待有workflow权限者添加到`.github/workflows/ci.yml`。
- 当前3个案例标为`knownMismatch`（疑似规则缺陷，未改规则迎合）：sales-path追问在未填支付／订单字段时不触发；customerLogin使custom-app抢先于商城与票务路线（见各案例说明）。
- `knowledge/playbooks.json`每份手册新增`review`（当前全部`draft`），关键步骤可带`sources:[{url,claim,checkedAt?}]`；为Stripe Webhook／退款与GitHub Pages自定义工作流／域名的8个步骤补充了已核对的官方出处。`validatePlaybooks`校验新字段；`playbookMarkdown`标题标注“草稿·待专家复核”；`planSite`／`planMarkdown`不变。
- 新增`docs/REVIEW.md`：专家复核流程与案例校准接入CI。
- 修复：`playbooks.json`的`notes`曾被误写成逐字符对象，改回字符串。

## 0.2.0（底座阶段）

规则数据化与追问闭环，为后续图片／表单／GitHub Pages渲染、结构化实施手册和MCP服务提供稳定接口。

- 路线选择迁移到`knowledge/routes.json`的有序`when`规则；追问、冲突、复合需求能力、提醒迁移到`knowledge/rules.json`。planner改为条件DSL求值器（all/any/not/ref/goal/feature/field，测试is/exists/minItems/subsetOf，选后可用execution/rule/capability）。
- `plan.decision`决策轨迹：命中规则、被跳过的更高优先级规则及原因、被已有平台覆盖的基础路线；`planMarkdown`新增「判断依据」。
- `validateCatalog`校验DSL结构、brief字段与goal枚举、能力/规则/具名条件引用、兜底规则和选项patch；可传入部分目录检查候选修改。
- 追问增加`field`和`options:[{id,label,patch,input?}]`；新增`answerQuestions(brief, answers)`与CLI`answer`；`intakeRequest`的hint附带未确认patch与`suggestedPatch`。
- 新增`src/version.mjs`，`ENGINE_VERSION`统一读取package.json；版本ID哈希仍包含引擎版本，因此0.2.0会产生与0.1.0不同的版本ID。
- 修复：公开准备包也拒绝占位的externalCheckoutUrl/externalBookingUrl；外部入口已承接卖货／票务／预约时不再追加commerce/tickets/booking能力和代码归属追问（如票务+卖货共用外部入口不再被阻塞）；构建开始时清理中断构建遗留的staging与未登记版本目录，构建失败时删除本次staging；`updateWorkspace`对null/数组patch抛`INVALID_PATCH`；站点地图按`<loc>`集合精确比较；`intakeRequest`空输入抛`INVALID_REQUEST`。
- 行为变化：业务应用等其他路线下，若卖货／票务／预约已由外部入口承接，同样只追加external-checkout而不追加对应交易能力。
- 代码按小函数拆分，单行控制在约160字符内；渲染输出逐字节不变。

### MCP服务

- 新增`bin/site-core-mcp.mjs`（package.json bin：`site-core-mcp`）：零依赖MCP服务，stdio，按行分隔JSON-RPC 2.0。依据当前规范2026-07-28实现无状态请求（`_meta`携带版本与能力、`server/discover`、`-32022`），并兼容`initialize`握手的2025-11-25、2025-06-18、2025-03-26、2024-11-05，按客户端请求的版本回退。serverInfo版本取自`ENGINE_VERSION`。
- 11个工具：`intake`、`plan`、`answer`、`catalog`、`workspace_init/build/update/check/rollback/review/export`，均带inputSchema、中文边界说明和annotations。不提供上传、部署、付款、DNS工具；回执保持`published:false`，`workspace_review`结果恒为`selfReported:true`。
- 路径安全：`--root <目录>`或`SITE_CORE_ROOT`；workspace与out必须是root内的相对路径，拒绝`..`、绝对路径、符号链接；未配置root时只提供判断类工具。
- 核心错误以`isError:true`的工具结果返回错误码、信息和details。新增`src/mcp-tools.mjs`、`src/mcp-paths.mjs`、`test/mcp.test.mjs`、`adapters/mcp.md`；核心API与渲染输出不变。

### 执行能力：图片、询盘表单与GitHub Pages

让“企业展示 + 产品图 + 询盘表单 + 发布到GitHub Pages”端到端可跑通。详见docs/API.md「图片、询盘表单与GitHub Pages发布包」。

- 工作区改为Buffer全链路：站点文件读取、指纹、完整性核对与导出不再按utf8转码；`checkFiles`只对.html/.xml/.txt/.css做文本检查，图片按魔数与哈希文件名核对，未知类型报`file-type`。
- 图片（`media-assets` → implemented）：`addMedia`／CLI`media add`按魔数识别png/jpeg/webp/avif（拒绝SVG，5MB上限）；`site.media`登记逐语言alt与自报授权，`heroImage`与条目`image`引用；输出`assets/media/<哈希前缀>.<ext>`，带尺寸与lazy。版本源快照记录`mediaFingerprints`，换图即新版本；版本目录保存原件，回退恢复，手改即`REVISION_CHANGED`；交付包source/含原件。
- 询盘表单（`forms` → implemented，送达人工验收）：`site.form`渲染无脚本POST表单（label、必填、蜜罐），CSP`form-action`只放行接收地址origin；需求确认forms=true才接受表单，确认了却没提供即拒绝。新增review检查项`form`（仅有表单时），公开包需要它通过，且接收地址不能是占位域名。
- 404页：每次构建输出，链接各语言首页，始终noindex，纳入检查。
- GitHub Pages发布包（新增`github-pages-package`，implemented）：`export`／`prepare-publish --target github-pages [--cname]`产出`repository/`（site/、.nojekyll、CNAME、固定提交SHA的pages.yml），校验用户站／项目站／自定义域名与cname一致；HANDOFF写明Settings→Pages、推送、DNS与上线实测；回执仍`published:false`并记录target。`live-deployment`仍为manual_verification。
- 示例`examples/b2b-full.*`与两张自制纯色PNG；demo额外构建该示例并导出Pages草稿包，plans列出其路线为ready。
- knowledge：forms与media需求不再阻塞本地构建，新增表单送达与图片授权提醒；原先断言阻塞的测试改为正向测试，并保留缺内容即拒绝的负向测试。
- 行为变化：所有站点多出`404.html`与少量CSS，页面HTML不变。不含图片的项目版本ID不变：此前0.2.0开发版已记录的同一资料版本仍按原样通过核对（没有404页），修改资料后重建才会带上404页；公开准备包重新渲染，总是包含404页。

### 结构化实施手册与连接器契约

- 新增`knowledge/playbooks.json`：13条路线和10个非implemented能力各一份手册（阶段与步骤含执行方、输入、产出、决策与阻塞项，选型标准、验收用例、风险、交接物）；候选供应商仅为待核实线索，不含价格。guides文末注明结构化版本。
- `planSite`新增`playbook`（路线手册加缺口能力手册，去重、按阶段排序）；integration任务改为引用具体步骤ID与验收用例ID（新增`steps`、`acceptanceIds`，保留`补充或接入：`措辞与原有字段）；新增`route-playbook`任务。`planMarkdown`在原有各节之后追加「实施手册」「验收用例」。
- `validateCatalog`校验手册引用的路线／能力存在、每条路线和每个非implemented能力都有手册、ID全局唯一、阶段顺序、guide一致、不含价格；返回值新增`playbooks`计数。
- 新增CLI`playbook --route <id>|--capability <id> [--json]`。
- 新增`adapters/contracts/`下forms、commerce、tickets、booking、cms五份契约（操作、事件、状态机、幂等与签名、错误语义、自测样例）和`src/contracts.mjs`：`loadContract`、`validateContract`、`verifyConnector`。`capabilities.json`相关能力增加`contract`字段，状态保持不变（契约不等于已接通）。
- 新增`test/in-memory-connector.testdouble.mjs`（仅测试用的内存替身）及行为测试，证明harness能识别合规与违规实现。


## 0.1.0

- 需求格式、关键追问、约束冲突与13类路线。
- 能力状态、缺口、实施任务和验收指导。
- 多页中英文静态站与项目子路径。
- 内容源、局部修改、不可变版本、完整性核对和回退。
- 草稿交接包、版本关联人工证据和公开准备包。
- CLI、JS API、对话Agent入口、7类示例、行为测试和GitHub CI。

公网部署和交易等外部后台保留为实际实施项。
