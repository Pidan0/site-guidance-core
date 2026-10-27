# 验证记录

验证版本：0.1.0（下文按日期追加0.2.0各阶段记录）。运行环境：Node.js v24.22.1。

## 已执行

- 43项核心测试全部通过，涵盖需求路线、关键追问、复合目标、约束冲突、真实CLI进程、内容验证、转义、站内链接、版本保留、手改保护、并发锁、回退与交接。
- 另用真实Node CLI运行完整demo，生成中英文共10页站点、7种场景指导和草稿交付包。
- 当前演示版本的文件与页面检查通过，未发现未构建资料变化；回执保持published:false。
- 能力和路线指向的实现、测试与guide文件均已核对存在。

## 2026-10-27 GitHub远程验证

已发布到团队私有仓库[Pidan0/site-guidance-core](https://github.com/Pidan0/site-guidance-core)。首批完整源码提交为`65defc40e5d90257207a56e45837f5ec540691a2`，其51个文件的Git树与本地源文件一致。

[Core checks运行记录](https://github.com/Pidan0/site-guidance-core/actions/runs/40435763223)中，Node.js 22与24两组任务均已成功，分别执行了`npm test`、能力目录校验与完整demo。此记录来自实际GitHub Actions结果，区别于本地验证。

## 2026-10-27 执行阶段（图片、表单、GitHub Pages）

- 本地Node.js v22.23.4：`node --test test/*.test.mjs`共88项通过，`catalog`与`demo`通过；demo额外构建`examples/b2b-full`（两张自制PNG、询盘表单）并导出GitHub Pages草稿包。
- 不含图片的b2b示例：版本ID与页面HTML与此前逐字节一致，仅site.css变化并新增404.html。
- 提交`6251c52`的[Core checks运行记录](https://github.com/Pidan0/site-guidance-core/actions/runs/40441215304)：Node.js 22与24均成功。
- Pages工作流中的四个action SHA于同日用`gh api repos/actions/<repo>/git/ref/tags/<tag>`查得（均为指向提交的轻量标签）；工作流本身未在真实仓库中部署过。

## 2026-10-27 0.2.0集成

- 分支`integration/0.2.0`合并foundation、mcp、execution、playbooks四支；解决文档与能力目录冲突，并修正图片手册与已实现状态的一致性。
- 本地Node.js v22.12.0：`node --test test/*.test.mjs`共120项通过；`catalog`与`demo`通过，demo中8个示例路线符合预期。GitHub Actions结果见对应PR。

## 尚未执行

本地站点的浏览器视觉与真机检查、真实部署、DNS、邮件或表单送达、支付／预约／票务后台。

本地结构检查和模拟业务测试不替代上述实网或人工验收。能力目录中的planned与integration_required保留为待实现／待接入。
