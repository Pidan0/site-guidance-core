# 让不同宿主复用同一个核心

本地CLI和JavaScript API使用同一套判断与生成实现。宿主可以是对话Agent、现有业务插件、内部工具或后续网页界面。

## 最小调用契约

1. 宿主取得用户确认的brief与site内容，不把整段聊天日志、密钥或系统提示词写入客户资料。
2. 调用planSite，展示route、decision、questions、conflicts、gaps和tasks；用户回答后调用answerQuestions写回brief。
3. 仅本地可执行路线调用工作区API；其他路线展示相应guide并交给已授权的实施流程。
4. 文件写入路径由宿主在用户项目范围内明确传入，不从素材中的路径自动派生。
5. 发布由宿主或独立部署适配器执行；核心导出包不充当真实部署回执。

## 向现有插件接入

可以在插件中import本核心，或通过CLI传入JSON文件。先保留旧插件行为，逐项映射字段、语言、输出、错误和权限，并做契约测试。没有接入、没有实测的能力继续标注缺口。

本仓库不默认载入任意插件文件，也不依据用户输入动态import代码。以后新增适配器应由维护者显式注册。MCP或HTTP宿主是后续适配实现，本版本不宣称提供对应协议服务。

## 用 verifyConnector 自测连接器

forms、commerce、tickets、booking、cms五类业务连接器有机器可读的契约（`adapters/contracts/<kind>.contract.json`，格式见`docs/API.md`「连接器契约」）。开发连接器时：

1. 读契约：必需操作（名称、输入、输出）、入站／出站事件、状态机、幂等与签名要求、错误码。再读对应实施手册（`node bin/site-core.mjs playbook --capability commerce`）了解选型、验收用例和交接物。
2. 让连接器对象暴露与契约同名的异步方法；失败时抛带`code`的错误。有入站事件时实现`ingestEvent(rawBody, headers)`（先验签再解析）；有出站事件时实现`onEvent(handler)`。
3. 指向测试环境（沙盒商户、测试账户或本地替身），自测：

```js
import { verifyConnector } from '../src/index.mjs';

const report = await verifyConnector('commerce', myConnector, { secret: process.env.TEST_WEBHOOK_SECRET });
if (!report.passed) console.table(report.results.filter(r => !r.passed));
```

`results`逐项给出`id`、`passed`和失败原因，例如`lifecycle.illegal.cancelled.payment.succeeded`表示已取消的订单收到付款事件时没有被`ILLEGAL_TRANSITION`拒绝。把报告随验收记录一并保存。

注意：

- 通过只说明连接器符合契约，**不代表后台已接通，也不改变`capabilities.json`的状态**。状态改为implemented需要实现、真实沙盒或正式环境的验收证据（手册中的验收用例）和文档齐全。
- 自测会创建多个测试对象并触发退款、取消等操作，只能指向测试环境；密钥由宿主安全配置提供，不写入仓库。
- 仓库内的`test/in-memory-connector.testdouble.mjs`是**仅用于测试的内存替身**，由契约驱动并可注入违规（缺操作、不幂等、不验签、允许非法转换等），用来证明harness能区分合规与违规实现。它不是适配器，不应被`src/`引用或当作模板直接上线。
