# site-guidance-core 待办清单

仓库：[Pidan0/site-guidance-core](https://github.com/Pidan0/site-guidance-core)（公开，MIT）
更新：2026-10-27
状态：0.2.0 已合入 main；0.3.0 已暂停，只完成了部分工作。

---

## 一、0.2.0 收尾

- [x] PR #5 `integration/0.2.0 → main` 已合并，同时合入了 main 上的 MIT 开源提交。
- [x] 已关闭 #1 到 #4，它们的内容已包含在 #5 中。
- [x] 已删除临时分支：`release/0.2.0`、`feat/foundation`、`feat/mcp`、`feat/execution`、`feat/playbooks`、`integration/0.2.0`。
- [ ] 通知使用方以下三项行为变化：
  - 卖货、票务或预约已有外部入口承接时，不再要求接入对应后台。
  - `questions[].options` 从字符串数组改为对象数组，是破坏性变化。
  - 引擎升到 0.2.0 后，同一份资料会生成新的 revision id。

## 二、0.2.0 遗留项

- [ ] **人工验收**：在真实仓库部署一次 GitHub Pages 工作流，记录部署 ID、URL 和实测结果。
- [ ] **人工验收**：用真实接收服务提交一次询盘表单，确认邮件已送达。
- [ ] MCP 增加 `playbook` 工具（查询实施手册）和 `media_add` 工具（添加图片）。
- [ ] MCP 对照 2026-07-28 规范的 schema，逐字核对 annotations 字段，决定是否需要 `ttlMs` 和 `cacheScope`。
- [ ] 补测：在旧实现上逐个跑新增的回归测试，确认它们原本会失败。
- [ ] 代码可读性：`renderer.mjs` 中整页 HTML 仍然写在一行里，可以拆成模板片段。

## 三、0.3.0 补强（已暂停）

集成分支 `integration/0.3.0` 已创建，基于 0.2.0。恢复开发前先把 main 合并进来。

额度用完时，四项开发都中断了。只有 `feat/calibration` 推送了提交，其余三项**没有推送任何内容**。当时的本地工作目录已经不可用，那部分进度应视为丢失，需要重做。

### P0-1 竞品知识库：`feat/vendors`（未推送，需重做）

- [ ] 新增 `knowledge/vendors.json`，联网核实，每个候选附 `sources` 和 `verifiedAt`，不写价格。字段包括：类别、适用路线、市场、模式、优势、限制、成本结构、锁定程度、数据导出、支付准入、生态、运维负担、AI 能力、合规要求。
- [ ] 覆盖以下类别，每类 3 到 6 个，合计约 35 到 50 个：
  - [ ] 通用建站 SaaS：Wix、Squarespace、Webflow、Framer、Hostinger
  - [ ] AI 建站：Wix AI、Framer AI、Durable、10Web、Hostinger AI
  - [ ] 出海电商：Shopify、SHOPLINE、Shoplazza、BigCommerce
  - [ ] 开源与自托管：WooCommerce、Medusa、Saleor、Vendure、PrestaShop
  - [ ] CMS 与无头 CMS：Payload、Strapi、Sanity、Contentful、WordPress
  - [ ] 国内生态：有赞、微店、微信小程序或视频号小店、凡科、上线了、云厂商建站；ICP 备案和支付资质
  - [ ] 平台店铺：Amazon、阿里国际站、Etsy、抖店、淘宝、拼多多。用于回答"是否需要独立站"
  - [ ] 预约与票务：Calendly、Acuity、SimplyBook.me、Square Appointments、Eventbrite、Ticket Tailor，以及国内常见方案
  - [ ] 表单：Formspree、Getform、Tally、Jotform、HubSpot Forms
  - [ ] 静态托管：GitHub Pages、Cloudflare Pages、Netlify、Vercel；国内对象存储加 CDN（需备案）
- [ ] 新增 `docs/COMPETITORS.md`：分析竞品如何引导需求（问卷、行业模板、AI 首稿、onboarding），本核心可借鉴什么，每条结论附来源。
- [ ] 新增 `src/vendors.mjs`：
  - `validateVendors`，接入 `validateCatalog`
  - `staleVendors`，超过 30 天提示复核
  - `shortlistVendors(brief, routeId)`，按需求过滤并排序，给出理由
- [ ] 计划结果新增 `vendors` 字段和"候选方案"一节；CLI 新增 `vendors [--route] [--stale]`。

### P0-2 业务策略层：`feat/strategy`（未推送，需重做）

- [ ] 扩展需求维度：
  - [ ] 新增需求目标：`recruitment`、`events`、`portfolio`、`docs`、`local`、`leadgen`
  - [ ] 市场：`targetMarkets`、`currencies`
  - [ ] 规模：SKU 数、流量、内容量（按档位）
  - [ ] 获客渠道：`acquisition`
  - [ ] 合规：个人数据、Cookie 同意、ICP 备案
  - [ ] 预算档位 `budgetBand`、上线时限 `launchWithin`（目前 `budget` 和 `deadline` 已收集但没有被使用）
- [ ] 新增维度对应的规则：
  - 目标市场含中国内地 → 备案、托管、支付资质
  - 目标市场含欧盟 → GDPR、Cookie
  - 预算低但要求自托管 → 冲突
  - 时间紧但需要定制应用 → 冲突
  - 主要靠平台获客 → 追问"是否需要独立站"
- [ ] 推荐取舍 `plan.alternatives`：每条路线配 `profile`（上线速度、成本结构、锁定程度、运维负担、所有权、扩展性、适合与不适合的场景）。在主推荐之外给出 1 到 3 个可行备选，逐维度对比，并说明为什么选 A 而不是 B。
- [ ] 业务价值层 `knowledge/strategies.json` 和 `plan.strategy`：按场景写出业务结果、关键页面、信任要素（必须有真实证据）、转化设计、获客要点、衡量指标（不承诺数值）、上线检查、上线后 90 天的运营动作。场景包括外贸 B2B、本地服务、品牌、零售电商、文旅票务、预约、内容、招聘、SaaS 落地页。
- [ ] 在展示类路线的实施手册中，加入"确认信任要素证据"和"定义指标与采集方式"两个步骤及对应验收。
- [ ] 新增示例：外贸 B2B、内地本地门店、欧盟零售。

### P1 渲染业务模块：`feat/site-modules`（未推送，需重做）

- [ ] 信任模块：评价（必须有授权）、案例（数字必须有证据）、资质证书、数据（必须有证据）、团队与工厂。缺少证据时拒绝构建。
- [ ] 文章和新闻：列表页、详情页、Article 结构化数据、sitemap 中的 lastmod。
- [ ] 本地门店：地址、营业时间、地图外链（不嵌入 iframe）、LocalBusiness 结构化数据。
- [ ] 无 Cookie 统计：Plausible、Umami、Cloudflare，CSP 只放行这一个来源。GA4 登记为需接入，并写对应手册。
- [ ] 结构化数据：FAQPage、BreadcrumbList、Organization 的 logo 和 sameAs、OG 图片。
- [ ] 有表单或统计时，生成隐私页。文本必须由客户提供，不生成模板法律文本。
- [ ] 无障碍检查：lang、alt、标题层级、表单 label、链接文本、跳到主内容的链接。

### P1 校准与审核：`feat/calibration`（已推送 1 个提交，未完成）

已完成：36 个模拟案例、案例 schema、真实案例模板、`calibration/README.md`、`src/calibration.mjs`、CLI、`docs/REVIEW.md`、手册审核字段、测试。

- [ ] 拉取分支，检查已提交内容，跑测试、`catalog` 和 `calibrate`。
- [ ] 查看校准报告中的 `knownMismatch` 清单，它们很可能就是规则缺陷，逐条确认是案例的问题还是规则的问题。
- [ ] 在 CI 中加入 `calibrate` 步骤（需确认是否已完成）。
- [ ] 为商城、票务、预约、上线手册中可查证的步骤补上官方来源（需确认是否已完成）。
- [ ] 向 `integration/0.3.0` 提 PR。
- [ ] 业务策略层扩展需求格式后，同步更新案例。

### P2 合规与其他

- [ ] 合规包：GDPR 与 Cookie、个人信息保护法、ICP 备案，形成检查清单和实施手册。
- [ ] 视频、多尺寸图片、中英文以外的语言，目前状态为 planned。
- [ ] 拖拽编辑器、多人协作，目前状态为 planned。

## 四、需要你提供或决定的事

- [ ] **客户主要在国内还是出海？** 这决定竞品库和策略层先覆盖哪一侧。目前按两侧都覆盖来规划。
- [ ] **10 到 20 个脱敏后的真实客户需求**，用于校准路线判断。脱敏要求见 `calibration/README.md`。
- [ ] **请业务专家复核实施手册**：目前全部是草稿状态，是智能体编写的，没有联网核实。复核流程见 `docs/REVIEW.md`。
- [x] 许可证已定为 MIT，仓库已公开。公开仓库中不得提交真实客户资料或脱敏不充分的案例。

## 五、额度与执行备注

- 上一轮四个子智能体并行运行，大约用掉了一整个 5 小时额度窗口。建议恢复时先做两个 P0 项，再做 P1。
- 子智能体设置为云端模式，但实际是在本机 scratchpad 目录中运行的，进度保存在本地。scratchpad 失效后，未推送的进度就丢失了。之后开发要求每完成一个阶段就推送一次。
