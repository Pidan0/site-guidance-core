# 验证记录

验证版本：0.1.0。运行环境：Node.js v24.22.1。

## 已执行

- 43项核心测试全部通过，涵盖需求路线、关键追问、复合目标、约束冲突、真实CLI进程、内容验证、转义、站内链接、版本保留、手改保护、并发锁、回退与交接。
- 另用真实Node CLI运行完整demo，生成中英文共10页站点、7种场景指导和草稿交付包。
- 当前演示版本的文件与页面检查通过，未发现未构建资料变化；回执保持published:false。
- 能力和路线指向的实现、测试与guide文件均已核对存在。

## 2026-10-27 GitHub远程验证

已发布到团队私有仓库[Pidan0/site-guidance-core](https://github.com/Pidan0/site-guidance-core)。首批完整源码提交为`65defc40e5d90257207a56e45837f5ec540691a2`，其51个文件的Git树与本地源文件一致。

以上记录对应首次私有发布。所有者后续要求公开分享，当前可见性以GitHub仓库页面为准；许可证见仓库根目录LICENSE。

[Core checks运行记录](https://github.com/Pidan0/site-guidance-core/actions/runs/40435763223)中，Node.js 22与24两组任务均已成功，分别执行了`npm test`、能力目录校验与完整demo。此记录来自实际GitHub Actions结果，区别于本地验证。

## 尚未执行

本地站点的浏览器视觉与真机检查、真实部署、DNS、邮件或表单送达、支付／预约／票务后台。

本地结构检查和模拟业务测试不替代上述实网或人工验收。能力目录中的planned与integration_required保留为待实现／待接入。
