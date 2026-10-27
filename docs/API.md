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

`planSite(brief)`返回：

- `route`：id、执行模式local/guided/discovery、说明、候选、guide路径。
- `reasons/questions/conflicts`：理由、关键追问和冲突。
- `capabilities/gaps/tasks/checklist`：当前能力、差距、动作及验收。
- `readiness`：指导、本地生成与公开发布分别计状态。

`planMarkdown(plan)`将同一个判断结果转成人可读指导，避免JSON与文档各维护一套规则。

`intakeRequest(text)`只保留原话并识别未确认线索。它不是模型推理；由用户或对话Agent确认后构成正式brief。

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
| buildWorkspace(path) | 仅本地可执行路线构建；写不可变版本；同资料重复构建幂等 |
| updateWorkspace(path, patch) | patch仅含brief/site；对象深合并，数组整体替换；随后需要build |
| checkWorkspace(path) | 核对当前版本内容、文件完整性及未构建修改 |
| rollbackWorkspace(path, revision, options?) | 回到已有可信版本；未构建草稿需先保存或明确discardDraft |
| recordReview(path, check, status, note) | 当前版本的人工自报证据；check为content/contact/domain |
| exportWorkspace(path, out, options?) | 新目录交付；forPublication=true产生经过准备检查的公开包 |

所有导出回执保持`published:false`。工作区内符号链接、目录穿越、损坏版本、手改生成文件、未构建资料或另一操作的锁会阻止继续。

## 常见错误

`INVALID_BRIEF`检查需求字段；`BUILD_NOT_SUPPORTED`补信息或按guide实施外部能力；`LANGUAGE_MISMATCH`补对应译文；`REVISION_CHANGED`保留并核对手工修改，不能强行覆盖；`UNBUILT_CHANGES`先构建草稿；`REVIEW_REQUIRED`补当前版本真实证据；`PLACEHOLDER_DOMAIN`替换演示域名；`WORKSPACE_BUSY`确认并发操作状态。

工作区锁异常残留时，不自动按时间删除。先确认没有运行操作，再手工移除`.site-core/lock`。不要跳过文件完整性检查。
