# 版本记录

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


## 0.1.0

- 需求格式、关键追问、约束冲突与13类路线。
- 能力状态、缺口、实施任务和验收指导。
- 多页中英文静态站与项目子路径。
- 内容源、局部修改、不可变版本、完整性核对和回退。
- 草稿交接包、版本关联人工证据和公开准备包。
- CLI、JS API、对话Agent入口、7类示例、行为测试和GitHub CI。

公网部署和交易等外部后台保留为实际实施项。
