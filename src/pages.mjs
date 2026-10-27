import { fail, invariant } from './errors.mjs';

export const TARGETS = ['github-pages'];
// Each SHA was resolved with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (all four are lightweight tags pointing at commits).
export const PAGES_ACTIONS = {
  checkout: { uses: 'actions/checkout', sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1' },
  configure: { uses: 'actions/configure-pages', sha: '45bfe0192ca1faeb007ade9deae92b16b8254a0d', version: 'v6.0.0' },
  upload: { uses: 'actions/upload-pages-artifact', sha: 'fc324d3547104276b827a68afc52ff2a11cc49c9', version: 'v5.0.0' },
  deploy: { uses: 'actions/deploy-pages', sha: '368f82528645a54fb793d4d04e342629a3f51346', version: 'v5.0.1' }
};
export const ACTIONS_CHECKED = '2026-10-27';
const USER = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const HOST = /^(?=.{1,253}$)([a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/;

// GitHub Pages serves https://<user>.github.io/ (repo <user>.github.io), https://<user>.github.io/<repo>/,
// or a custom domain at its root. The package refuses any baseUrl/cname combination Pages cannot serve.
export function pagesTarget(baseUrl, cname) {
  const url = new URL(baseUrl), host = url.hostname.toLowerCase(), segments = url.pathname.split('/').filter(Boolean);
  if (host.endsWith('.github.io')) {
    const user = host.slice(0, -'.github.io'.length);
    invariant(USER.test(user), 'PAGES_URL_MISMATCH', 'baseUrl 的 github.io 用户名格式不正确', { baseUrl });
    invariant(cname === undefined, 'PAGES_URL_MISMATCH', 'github.io地址不使用--cname；使用自定义域名时baseUrl应为该域名', { baseUrl, cname });
    invariant(segments.length <= 1, 'PAGES_URL_MISMATCH', 'github.io地址只能是用户站根路径或单层项目路径', { baseUrl });
    const repo = segments[0] ?? `${user}.github.io`;
    invariant(REPO.test(repo) && repo !== '.' && repo !== '..', 'PAGES_URL_MISMATCH', 'baseUrl 中的仓库名格式不正确', { baseUrl });
    return { kind: segments.length ? 'project' : 'user', repository: `${user}/${repo}`, cname: null, url: url.href };
  }
  invariant(typeof cname === 'string' && cname, 'PAGES_URL_MISMATCH', 'baseUrl 不是github.io地址时需要 --cname 指定同一自定义域名', { baseUrl });
  const domain = cname.trim().toLowerCase();
  invariant(HOST.test(domain), 'PAGES_URL_MISMATCH', '--cname 需为不含协议和路径的域名', { cname });
  invariant(domain === host, 'PAGES_URL_MISMATCH', '--cname 必须与baseUrl主机一致', { baseUrl, cname });
  invariant(!segments.length, 'PAGES_URL_MISMATCH', '自定义域名的Pages站点位于域名根路径，baseUrl不能带子路径', { baseUrl });
  return { kind: 'custom-domain', repository: null, cname: domain, url: url.href };
}

const step = (action, extra = '') => `      - uses: ${action.uses}@${action.sha} # ${action.version}，SHA核对于${ACTIONS_CHECKED}\n${extra}`;

export function pagesWorkflow() {
  const a = PAGES_ACTIONS;
  return [
    '# 由 Site Guidance Core 生成：把 site/ 部署到 GitHub Pages。',
    '# 使用前在仓库 Settings → Pages → Build and deployment 选择 GitHub Actions。',
    'name: Deploy site to GitHub Pages', 'on:', '  push:', '    branches: [main]', '  workflow_dispatch:',
    'permissions:', '  contents: read', '  pages: write', '  id-token: write',
    'concurrency:', '  group: pages', '  cancel-in-progress: false',
    'jobs:', '  deploy:', '    runs-on: ubuntu-latest', '    environment:', '      name: github-pages',
    '      url: ${{ steps.deployment.outputs.page_url }}', '    steps:'
  ].join('\n') + '\n'
    + step(a.checkout, '        with:\n          persist-credentials: false\n')
    + step(a.configure)
    + step(a.upload, '        with:\n          path: site\n          include-hidden-files: true\n')
    + `      - id: deployment\n        uses: ${a.deploy.uses}@${a.deploy.sha} # ${a.deploy.version}，SHA核对于${ACTIONS_CHECKED}\n`;
}

export function pagesHandoff(target, forPublication) {
  const repo = target.repository
    ? `仓库须为 \`${target.repository}\`${target.kind === 'user' ? '（用户站要求仓库名为 <用户名>.github.io）' : '（项目站）'}。`
    : '仓库名不限；站点通过自定义域名访问。';
  const dns = target.cname
    ? `\n5. 在 Settings → Pages → Custom domain 填写 \`${target.cname}\` 并保存。GitHub文档说明用Actions发布时site/CNAME会被忽略，`
      + '此文件仅作记录。DNS：子域名用CNAME指向 <用户名>.github.io；根域名按GitHub官方文档当前列出的A/AAAA记录配置。生效后勾选Enforce HTTPS。\n'
    : '\n';
  const stage = forPublication ? '' : '\n注意：这是草稿包，页面仍为noindex且robots禁止抓取，只适合预览部署，不作为正式上线。\n';
  return '\n## GitHub Pages\n\n'
    + `repository/ 目录即仓库内容（site/ 与 .github/workflows/pages.yml）。只推送repository/里的内容；source/、receipt.json等内部资料不要放进公开仓库。${stage}\n`
    + `1. ${repo}免费账户的Pages要求公开仓库，私有仓库需对应付费方案，请先确认可见性。\n`
    + '2. 在仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。\n'
    + '3. 把repository/的内容推送到main分支（工作流默认监听main；使用其他分支时改pages.yml）。\n'
    + '4. 在Actions页确认 Deploy site to GitHub Pages 成功，记下部署URL与运行ID。'
    + dns
    + `${target.cname ? '6' : '5'}. 上线后实测：HTTPS、各语言页面、图片、404页、表单真实提交与送达、移动显示、目标地区访问。`
    + '把运行ID、URL和实测记录与本版本关联。本包回执保持published:false，部署结果以GitHub返回为准。\n';
}

export function assertTarget(target) {
  if (target !== undefined && !TARGETS.includes(target)) throw fail('INVALID_TARGET', `不支持的发布目标：${target}；当前只有github-pages`);
}
