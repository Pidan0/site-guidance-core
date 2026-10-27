# 专家复核流程

本核心的路线规则（`knowledge/routes.json`、`rules.json`）与实施手册（`knowledge/playbooks.json`）最初由智能体编写，未经业务专家复核。手册在复核前只能当作“草稿线索”，不能当作指导依据。

## 谁复核

熟悉对应业务的人，且不是该内容的作者：电商／支付、票务、预约、内容与CMS、上线与合规各一位即可。复核人对结论负责，在记录里写角色或可追溯的账号，不写客户信息。

## 复核什么

手册（每份单独复核）：

1. 步骤是否完整、顺序和执行方（client/delivery/vendor）是否合理，有无遗漏的准入、合规或对账环节。
2. 事实性步骤是否有出处：支付回调签名与去重、退款上限、平台发布与域名等，需有`sources`并确认`claim`确与官方文档一致。
3. 验收用例的场景、预期、证据是否真能证明该能力可用。
4. 选型标准只写核实方式，不含价格；候选供应商仅为待核实线索。

路线规则：用 `calibration/` 案例检验。对每个`synthetic`案例判断标注是否正确；对`knownMismatch`案例判断是规则缺陷还是标注错误。

## 如何把 status 改为 expert-reviewed

1. 在分支上修改该手册的`review`：

   ```json
   "review": { "status": "expert-reviewed", "reviewedBy": "电商专家（账号或角色）", "reviewedAt": "2026-11-01", "notes": "已核对退款与回调相关步骤；对账周期按客户实际调整" }
   ```

2. `expert-reviewed`必须同时有`reviewedBy`与`reviewedAt`；`draft`不得带这两项（`validateCatalog`会拒绝）。
3. 复核中改动的内容与`review`改动放在同一个PR，由复核人本人在PR中确认。手册内容之后再改，应把`status`改回`draft`重新复核。
4. 运行`node --test test/*.test.mjs`与`node bin/site-core.mjs catalog`，确认通过。

## 如何添加 sources

在步骤上加：

```json
"sources": [{ "url": "https://docs.example.com/page", "claim": "该出处支持的具体事实", "checkedAt": "2026-10-27" }]
```

- 只写亲自打开官方文档并确认过的事实；`claim`用自己的话概括，范围是某供应商时写明（例如“以Stripe为例”）。
- `url`必须是HTTPS；`checkedAt`为核对日期。外部文档会变，超过30天应重新核对。
- 没有查证过的步骤不要加`sources`。

## 案例校准如何接入 CI

- `.github/workflows/ci.yml`应在测试之后运行`node bin/site-core.mjs calibrate`（若尚未加入，在`demo`步骤后追加一行`- run: node bin/site-core.mjs calibrate`）；存在未标注`knownMismatch`的失败时CI失败。`test/calibration.test.mjs`同样断言`synthetic`案例通过。
- 修改规则后若案例失败：先判断是规则退步还是标注需更新，不要为了通过而改标注或随手加`knownMismatch`。确实暂时无法解决时，加`knownMismatch`并写明原因，让它在报告里持续可见。
- `knownMismatch`案例意外通过时报告会提示移除标记。
- 真实案例放入`calibration/cases/real-*.json`（脱敏要求见`calibration/README.md`）。`real-anonymized`的统计单独列出，是规则校准的依据；`synthetic`只作回归。建议真实案例达到一定数量后，再讨论把它的命中率纳入合并门槛。
