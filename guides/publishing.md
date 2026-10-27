# 上线准备与实际发布

本核心准备静态文件和核对记录，不访问托管账户、不改DNS、不自动创建GitHub仓库，也不执行支付。

## 本核心完成的准备

1. 以实际HTTPS地址配置baseUrl，支持项目子路径。
2. build并check；确认当前资料已构建、版本完整。
3. 对当前版本完成真实内容核对、联系路径与域名条件检查，用review记录证据。记录属于人工自报。
4. prepare-publish导出公开准备包，去掉草稿noindex与禁止抓取（404页始终noindex）。只上传site/，内部source和回执不作为网站根公开。有表单时还需要form审核项，表单接收地址也不能是占位域名。

## GitHub Pages发布包

`prepare-publish --target github-pages [--cname 域名]`在普通准备包的基础上产出`repository/`：`site/`（含`.nojekyll`，有自定义域名时含`CNAME`）和`.github/workflows/pages.yml`。工作流使用官方checkout、configure-pages、upload-pages-artifact、deploy-pages，均以提交SHA固定，注释写明版本与核对日期；升级前用`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`重新查SHA。

地址规则：用户站`https://<用户>.github.io/`（仓库须名为`<用户>.github.io`），项目站`https://<用户>.github.io/<仓库>/`；自定义域名时baseUrl为该域名根，`--cname`必须与它一致。不符合即`PAGES_URL_MISMATCH`。

推送与上线由用户或授权的部署工具完成：

1. 确认仓库可见性：免费账户的Pages需要公开仓库。只把`repository/`里的内容推送进去，source/与回执不要公开。
2. 仓库 Settings → Pages → Build and deployment → Source 选 GitHub Actions。
3. 推送到main（或修改工作流分支），在Actions页确认部署成功并记录运行ID与URL。
4. 自定义域名：用Actions发布时CNAME文件会被忽略，需在 Settings → Pages → Custom domain 填写；子域名用CNAME记录指向`<用户>.github.io`，根域名按GitHub文档当前列出的A/AAAA记录配置，生效后启用HTTPS。
5. 上线后实测HTTPS、各语言页面、图片、404、表单提交与收件、移动显示和目标地区访问。

核心不创建仓库、不改Pages设置或DNS；回执始终`published:false`，`target`字段只说明包的格式。

## 交给部署工具继续做

按客户授权选择托管账户，核对费用、地区、域名与维护人。使用供应商官方部署路径上传site/，保留版本、部署ID、URL和时间。涉及域名和账号操作时遵循当前宿主的授权规则。

上线后检查HTTPS、跳转、页面、静态资源与图片、404、移动布局、目标地区访问、联系、表单或业务路径。把部署与后续实测回执关联到同一版本。准备包的published:false不能改写成完成状态来充当部署证据。

## GitHub中的两件事

将本核心代码放到GitHub，是分享与维护建站依据；将客户生成的网站发布到GitHub Pages，是客户站部署。两者的仓库、隐私、域名、费用与权限分别确认。

GitHub Pages支持方式按当前官方文档核实。代码仓库中不能包含客户真实资料、凭据、私有源码或完整项目工作区。公开代码前由所有者选定许可证。
