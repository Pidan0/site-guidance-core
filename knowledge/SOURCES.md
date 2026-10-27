# 指导依据与复核日期

规则将用户目标、交易承接、所有权、编辑、维护和现有系统作为决策条件。候选产品用于进一步核验，不因名字出现就称为已集成。本核心不内置第三方采购价格。

下面是2026-10-26研究所用的一手入口；具体实施时按地区、商户、计划和版本重查。价格超过7天、能力与许可超过30天复用时应复核，高影响准入条件每次实施时核查。

| 主题 | 官方入口 | 使用边界 |
|---|---|---|
| 电商平台 | [Shopify](https://www.shopify.com/pricing)、[SHOPLINE](https://www.shopline.com/pricing)、[Shoplazza](https://www.shoplazza.com/pricing) | 核对商户、费用及实际后台功能 |
| 自有店面与结账 | [Shopify Storefront Cart](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage) | 代码与交易后台分别处理 |
| 自托管候选 | [WooCommerce](https://woocommerce.com/pricing/)、[Medusa](https://github.com/medusajs/medusa)、[Saleor](https://github.com/saleor/saleor)、[Vendure](https://github.com/vendurehq/vendure) | 所选版本许可、企业材料和运维分别核实 |
| CMS与编辑候选 | [Payload](https://github.com/payloadcms/payload)、[Puck](https://puckeditor.com/docs)、[GrapesJS](https://grapesjs.com/docs/) | CMS、画布编辑与交易不是同一能力 |
| 迁移边界 | [Webflow导出](https://help.webflow.com/hc/en-us/articles/33961386739347-How-do-I-export-my-Webflow-site-code)、[Framer导出](https://www.framer.com/help/articles/can-i-export-my-website-to-html-and-self-host-it/)、[Wix托管](https://support.wix.com/en/article/exporting-or-embedding-your-wix-site-elsewhere) | 不能把内容或静态代码导出当完整业务迁移 |
| 支付 | [Stripe Webhooks](https://docs.stripe.com/webhooks)、[Shopify支持地区](https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries) | 准入、签名、异步状态和重复事件需实际实施 |
| 多语言与性能 | [Google多语言](https://developers.google.com/search/docs/specialty/international/localized-versions)、[Web Vitals](https://web.dev/articles/vitals) | 基础结构检查不承诺排名或真实用户性能 |
| 运行时与CI | [Node测试](https://nodejs.org/api/test.html)、[Node文件系统](https://nodejs.org/api/fs.html)、[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node) | CI固定行动commit；运行时以测试环境为准 |

没有复制这些项目的源码或图像；本仓库实现为独立编写。既有内部插件不随仓库分发，其接口可在宿主另行适配。
