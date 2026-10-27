# 路线校准案例

用真实（脱敏）需求检验 `knowledge/routes.json` / `rules.json` 的判断是否合理。运行：`npm run calibrate`（或 `node bin/site-core.mjs calibrate [--dir calibration/cases] [--json]`）。

## 案例格式

每个 `calibration/cases/*.json` 一个案例，格式见 `case.schema.json`：`{ id, source, request, brief, expected, rationale, labeledBy, labeledAt }`，可选 `knownMismatch`（字符串说明）。文件名以 `_` 开头的是模板，不参与运行。`id` 必须与文件名（去掉 `.json`）一致。

- `expected.route`：业务专家认为正确的路线；`acceptableAlternatives`：也算合理的路线（算“可接受”，不算“命中”）。
- `mustAsk`：规划结果必须包含的追问ID（`rules.json` questions）；`mustConflict`：必须报告的冲突ID；`mustHaveCapabilities`：必须出现的能力ID。
- `brief` 只能使用当前 `schemas/brief.schema.json` 的字段；`request` 保留客户原话。
- `knownMismatch`：已知当前规则判断不符合标注，写明原因。带它的案例失败不会使校准失败；若它意外通过，报告会提示移除标记。

## source

- `synthetic`：合成草稿，由 `labeledBy: "synthetic-draft"` 标注，**未经业务专家复核**，只能证明规则对已想到的情形自洽，不能证明对真实客户有效。
- `real-anonymized`：真实需求脱敏后的案例，由业务专家标注。**这才是校准依据。** 报告按 source 分开统计，两类不混算。

## 收集真实案例（脱敏要求）

1. 复制 `cases/_TEMPLATE.real.json` 为 `cases/real-NNN-简短英文名.json`。
2. 必须去除：姓名、电话/邮箱/微信等联系方式、公司名与品牌名、域名与网址（URL 字段用 `https://example.com/...`）、地址、账号、订单号。
3. 不要提交客户原始资料：合同、报价、聊天截图、产品图、资质文件、原始文档一律不进仓库；`request` 只保留去标识后的需求原话。
4. 由熟悉该业务的专家填写 `expected` 与 `rationale`，`labeledBy` 写角色而非真实姓名。必须有客户或业务方同意用于脱敏留档。
5. 提交前自查：全文搜索公司名、人名、域名、手机号；评审人确认后再合并。
