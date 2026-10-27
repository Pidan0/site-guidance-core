# Site Guidance Core

**把用户的不同建站需求，变成有理由、有能力边界、能执行和验收的建站方案。**

这是一套可独立放入GitHub的建站核心，包含可运行代码、需求格式、路线规则、能力清单、执行指引和测试。它不依赖原有业务插件，也不调用收费模型或远程服务。

## 一次使用会拿到什么

用户说“我想建一个网站”后，先整理需求，再得到：

- 适合的路线，以及为什么这么选。
- 哪些信息必须先问，哪些约束相互冲突。
- 当前可以直接做的能力，仍需接入或开发的能力。
- 按顺序排列的实施任务与验收依据。
- 适用时生成的多页网站、可修改资料、历史版本和交付包。

## 快速运行

需要Node.js 22或以上。不需要安装依赖。

```sh
npm test
node bin/site-core.mjs demo --out .output/first-demo
```

演示产生：

```text
.output/first-demo/
  plans/                  七种需求的不同指导结果
  workspace/
    project.json          可持续修改的客户资料
    GUIDANCE.md           当前项目的执行指导
    plan.json             机器可读的路线、缺口和任务
    revisions/r-.../site/  中英文、多页的静态样站
  handoff/                草稿交付包，包含网站和资料源
```

演示数据全部虚构，邮箱、域名和外部入口均为示例。生成结果仍是草稿，没有上线或处理真实交易。

## 根据真实需求获得指导

```sh
# 原话采集：识别线索，不替用户做决定
node bin/site-core.mjs intake --text "我想做一个卖门票的网站"

# 对话Agent或用户确认需求后，用结构化资料做正式判断
node bin/site-core.mjs plan --brief examples/tourism.brief.json
node bin/site-core.mjs plan --brief examples/commerce.brief.json

# 用户回答追问后写回需求（选项ID见plan的「必须先回答」）
node bin/site-core.mjs answer --brief examples/unknown.brief.json --answers examples/unknown.answers.json --out .output/answered.brief.json
```

路线、追问、冲突和复合需求的规则是`knowledge/routes.json`与`knowledge/rules.json`中的数据，每份计划都带`decision`判断依据（命中规则与被跳过的更高优先级规则）。

可以把本仓库交给对话Agent，先让它读`AGENTS.md`。人类不需要记住JSON字段；Agent负责把确认后的自然语言需求转换成brief，再调用核心判断。CLI的关键词采集仅提供未确认线索，不冒充通用自然语言理解。

## 当前实际能做什么

| 层 | 已实现的内容 | 完成边界 |
|---|---|---|
| 需求与判断 | 输入校验、关键追问、路线选择、约束冲突、能力缺口、任务和验收输出 | 确定性规则；原话由人或Agent确认 |
| 本地建站 | 中英文、文本多页介绍、产品和服务目录、联系方式、外部购买或预约链接 | 静态站；媒体管理、交易、表单和CMS按目录列为待补或接入项 |
| 持续交付 | 单一资料源、局部修改、不可变版本、完整性核对、回退、交接包 | 文件工作区，不是多人在线管理系统 |
| 上线准备 | 草稿与公开包分开、版本对应的人工证据、待上传包 | 不自动上传、改DNS或宣称公网可用 |
| 外部路线 | 商城、自托管商城、票务、预约、CMS、业务应用、已有平台与迁移指导 | 已沉淀流程和验收；对应业务连接器尚需实施 |

能力状态与实现位置由`knowledge/capabilities.json`维护。新增功能要同时补实现和测试，不能只改状态。

## 本地建站与修改

```sh
node bin/site-core.mjs init --brief examples/b2b.brief.json --site examples/b2b.site.json --out .output/customer
node bin/site-core.mjs build --workspace .output/customer
node bin/site-core.mjs update --workspace .output/customer --patch examples/patch-summary.json
node bin/site-core.mjs build --workspace .output/customer
node bin/site-core.mjs check --workspace .output/customer
node bin/site-core.mjs export --workspace .output/customer --out .output/customer-handoff
```

更新对象时深合并，数组整体替换。每个新版本保留旧版本，重复构建同一资料返回同一版本。若生成文件被手改，核心会拒绝把它当作可信旧版本；资料应在project.json中修改。有未构建修改时，回退和交接会明确拦截。

## 如何判断已经可以上线

先完成真实内容核对、联系路径送达和域名条件检查。用`review`记录当前版本的实际证据，再生成公开准备包：

```sh
node bin/site-core.mjs review --workspace .output/customer --check content --status pass --note "填写真实内容核对记录"
node bin/site-core.mjs review --workspace .output/customer --check contact --status pass --note "填写真实联系路径测试记录"
node bin/site-core.mjs review --workspace .output/customer --check domain --status pass --note "填写真实域名配置核对记录"
node bin/site-core.mjs prepare-publish --workspace .output/customer --out .output/customer-public-package
```

不要照抄示例文字当验收证据。演示域名会阻止公开准备包；先在资料中配置实际地址并构建。审核属于人工自报，核心不会自动核实DNS或邮件。任何回执都保持`published:false`，直到由外部发布工具完成实际部署并返回可验证结果。只有`site/`应作为静态网站根上传，内部资料另行交接。

## 在其他项目或插件中复用

```js
import { planSite, createWorkspace, buildWorkspace } from './src/index.mjs';

const plan = planSite(confirmedBrief);
if (plan.readiness.localBuild === 'ready') {
  await createWorkspace(outputDirectory, confirmedBrief, confirmedSiteContent);
  const result = await buildWorkspace(outputDirectory);
  // result是本地构建结果，不是已发布回执
}
```

各接口的输入、输出和错误见[接口说明](docs/API.md)，不同路线见[指引目录](guides/README.md)。现有插件可通过适配层调用核心；不需要复制客户项目或把业务源码带入此仓库。

## 团队私有仓库

仓库：[Pidan0/site-guidance-core](https://github.com/Pidan0/site-guidance-core)，可见性为Private。2026-10-27用户确认采用团队私有方式；具体成员由所有者按需授权，当前没有代为邀请成员。

包含Node测试CI、需求示例、贡献规则、能力目录、版本及安全说明。`UNLICENSED`表示尚未授予公开分发许可。所有代码均为本次独立编写，未复制原业务插件代码。

```sh
# 使用已获仓库访问权限的GitHub账号：
git clone https://github.com/Pidan0/site-guidance-core.git
cd site-guidance-core
npm test
```

GitHub保存核心代码和指导资料；客户网站仍按独立项目交付和部署。请勿将真实客户资料、凭据或构建工作区提交到核心仓库。

## 继续看

- [能力重新评估与产品目标](docs/PRODUCT.md)
- [当前实现、接入项与后续路线](docs/ROADMAP.md)
- [API与数据格式](docs/API.md)
- [接入其他宿主](adapters/README.md)
- [知识来源与更新](knowledge/SOURCES.md)
- [贡献规则](CONTRIBUTING.md)

当前版本：0.2.0。完整含义是“需求指导、本地静态执行、版本交付以及外部能力接入契约”的闭环；支付、票务、预约、客户后台和拖拽编辑器均按能力目录中的状态处理。
