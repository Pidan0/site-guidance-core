# 同事上手指南

## 先确定怎么用

现在可以用它讨论客户需求、选择建站路线、拆实施任务，或生成可持续修改的文本展示站原型。商城、票务、预约和客户后台仍需要外部接入。完整边界见[当前能力与差距](MATURITY.md)。

## 跑通一次演示

安装Node.js 22或以上，然后执行：

```sh
git clone https://github.com/Pidan0/site-guidance-core.git
cd site-guidance-core
npm test
node bin/site-core.mjs demo --out .output/first-demo
```

无需安装依赖。输出目录必须是新的；重复演示时换一个目录名。

- `.output/first-demo/plans/`：七类需求的不同指导结果。
- `.output/first-demo/workspace/GUIDANCE.md`：展示站示例的建站指导。
- `.output/first-demo/workspace/project.json`：可以继续修改的资料源。
- `.output/first-demo/handoff/site/`：中英文草稿样站，可从index.html开始查看。
- `.output/first-demo/handoff/HANDOFF.md`：交接说明。

示例是虚构资料，没有完成真实上线或业务后台接入。

## 带一条客户需求使用

可以直接把下面这段交给自己的对话Agent：

> 先读建站核心仓库的AGENTS.md和README.md。客户需求是：【填写原始需求】。整理已确认的目标，只追问会改变路线的信息，再调用核心判断。输出推荐路线、理由、能力缺口、实施顺序和验收标准。适用本地路线时继续生成网站；其他路线读取对应guide，保留尚未接入的能力。

人不需要手写JSON；Agent负责整理确认后的需求。原话关键词采集只提供线索，不会自动替客户做决定。

也可先看已有正式需求示例：

```sh
node bin/site-core.mjs plan --brief examples/b2b.brief.json
node bin/site-core.mjs plan --brief examples/commerce.brief.json
node bin/site-core.mjs plan --brief examples/tourism.brief.json
```

## 一次试用至少检查这些结果

1. 指导是否反映客户真正要完成的事，是否遗漏复合需求。
2. 缺失信息有没有先问，未知条件有没有被误写成false。
3. 已实现、待接入与待开发有没有混淆。
4. 资料修改后能否构建、检查并交接，是否保留旧版本。
5. 不能直接执行的需求是否有清楚的下一步与验收依据。

反馈Issue时提供脱敏需求、命令、预期结果与实际结果。修改代码走Pull Request；不要上传真实客户文件、密钥或整个工作区。
