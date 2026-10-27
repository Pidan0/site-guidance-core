import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planSite, planMarkdown, validateCatalog, playbooks, getPlaybook, capabilities, routes, PHASES } from '../src/index.mjs';
import { runCLI } from '../bin/site-core.mjs';
import { example, temporary } from './helpers.mjs';

const cli = async args => { const out = []; await runCLI(args, { stdout: x => out.push(x) }); return out.join('\n'); };
const stepIds = playbook => playbook.phases.flatMap(p => p.steps.map(s => s.id));
const clone = () => structuredClone(playbooks);
const rejects = (mutate, pattern) => {
  const copy = clone(); mutate(copy);
  assert.throws(() => validateCatalog({ playbooks: copy }), error => error.code === 'INVALID_CATALOG' && pattern.test(error.message));
};

test('每条路线和每个非implemented能力都有手册，ID全局唯一，阶段顺序固定', () => {
  assert.deepEqual(playbooks.routes.map(p => p.route).sort(), routes.map(r => r.id).sort());
  const required = capabilities.filter(c => c.status !== 'implemented').map(c => c.id);
  for (const id of required) assert.ok(playbooks.capabilities.some(p => p.capability === id), `${id}缺少手册`);
  const all = [...playbooks.routes, ...playbooks.capabilities];
  const ids = all.flatMap(p => [...stepIds(p), ...p.acceptance.map(a => a.id), ...p.vendorCriteria.map(v => v.id)]);
  assert.equal(new Set(ids).size, ids.length);
  const order = PHASES.map(p => p.id);
  for (const p of [...playbooks.routes, ...playbooks.capabilities]) {
    const phaseIds = p.phases.map(x => order.indexOf(x.id));
    assert.deepEqual(phaseIds, [...phaseIds].sort((a, b) => a - b)); assert.ok(!phaseIds.includes(-1));
    for (const step of p.phases.flatMap(x => x.steps)) assert.ok(['client', 'delivery', 'vendor'].includes(step.owner));
  }
  assert.equal(validateCatalog().playbooks.routes, routes.length);
});
test('商城手册覆盖成功付款、失败、重复回调、部分退款、库存并发与对账', () => {
  const ids = getPlaybook({ capability: 'commerce' }).acceptance.map(a => a.id);
  for (const id of ['pay-success', 'pay-failed', 'callback-duplicate', 'refund-partial', 'stock-concurrency', 'reconciliation-clean']) {
    assert.ok(ids.includes(`commerce.${id}`), id);
  }
  for (const a of getPlaybook({ capability: 'commerce' }).acceptance) assert.ok(a.scenario && a.expected && a.evidence);
});
test('手册与guide一致：guide文件存在并在文末注明结构化版本', async () => {
  const guides = new Set();
  for (const p of [...playbooks.routes, ...playbooks.capabilities]) {
    await access(new URL(`../${p.guide}`, import.meta.url));
    if (p.guide.startsWith('guides/')) guides.add(p.guide);
  }
  assert.ok(guides.size >= 8);
  for (const guide of guides) assert.match(await readFile(new URL(`../${guide}`, import.meta.url), 'utf8'), /结构化版本见 knowledge\/playbooks\.json/);
});
test('validateCatalog拒绝缺失、悬空、重复、乱序和含价格的手册', () => {
  rejects(c => c.routes.pop(), /缺少实施手册/);
  rejects(c => c.capabilities.splice(c.capabilities.findIndex(p => p.capability === 'commerce'), 1), /commerce 缺少实施手册/);
  rejects(c => { c.capabilities[0].capability = 'teleport'; }, /不存在的能力/);
  rejects(c => { c.routes[0].route = 'nowhere'; }, /不存在的路线/);
  rejects(c => { c.routes.push(structuredClone(c.routes[0])); }, /重复的手册/);
  rejects(c => { c.routes[2].phases[0].steps.push(structuredClone(c.routes[2].phases[0].steps[0])); }, /重复的ID/);
  rejects(c => c.capabilities[1].phases.reverse(), /顺序错误/);
  rejects(c => { c.capabilities[1].phases[0].steps[0].owner = 'robot'; }, /owner/);
  rejects(c => { c.capabilities[1].guide = 'guides/other.md'; }, /guide/);
  rejects(c => { c.capabilities[1].acceptance[0].expected = '收款99元'; }, /价格/);
  rejects(c => { c.capabilities[1].acceptance[0].id = 'wrong-prefix'; }, /验收ID/);
});
test('plan.playbook合并路线手册与缺口能力手册，按阶段排序且去重', async () => {
  const plan = planSite(await example('commerce')), pb = plan.playbook;
  assert.deepEqual(pb.sources.map(s => s.source), ['route:managed-commerce', 'capability:commerce', 'capability:live-deployment']);
  assert.deepEqual(pb.phases.map(p => p.id), PHASES.map(p => p.id));
  const ids = pb.phases.flatMap(p => p.steps.map(s => s.id));
  assert.equal(new Set(ids).size, ids.length); assert.ok(ids.includes('commerce.webhook-handler') && ids.includes('managed-commerce.configure-store'));
  assert.ok(pb.acceptance.every(a => a.source && a.scenario && a.expected && a.evidence));
  assert.ok(pb.vendorCriteria.length && pb.risks.length && pb.handoff.length);
  const again = planSite(await example('commerce'));
  assert.deepEqual(again.playbook, pb);
});
test('integration任务引用具体步骤和验收用例编号，并保留原有字段', async () => {
  const plan = planSite(await example('commerce')), known = new Set(plan.playbook.phases.flatMap(p => p.steps.map(s => s.id)));
  const acceptance = new Set(plan.playbook.acceptance.map(a => a.id)), task = plan.tasks.find(t => t.id === 'commerce');
  assert.equal(task.stage, 'integration'); assert.equal(task.guide, 'guides/commerce.md');
  assert.ok(task.action.startsWith('补充或接入：') && task.action.includes('commerce.scope-facts') && task.acceptance.includes('commerce.pay-success'));
  assert.ok(task.steps.length > 5 && task.steps.every(id => known.has(id) && id.startsWith('commerce.')));
  assert.ok(task.acceptanceIds.every(id => acceptance.has(id)));
  const route = plan.tasks.find(t => t.id === 'route-playbook');
  assert.equal(route.stage, 'integration'); assert.ok(route.steps.every(id => id.startsWith('managed-commerce.')));
  for (const t of plan.tasks) for (const key of ['id', 'stage', 'action', 'acceptance']) assert.equal(typeof t[key], 'string');
  assert.deepEqual(plan.tasks.at(-1).acceptanceIds.filter(id => !id.startsWith('live-deployment.')), []);
  assert.ok(!plan.tasks.some(t => t.id === 'live-deployment'), '人工核验能力不生成integration任务');
});
test('复合需求保留各自手册，已有平台沿用核验措辞，本地路线任务在build阶段', async () => {
  const b = await example('commerce'); b.goals.push('booking', 'membership');
  const plan = planSite(b);
  for (const id of ['commerce', 'booking', 'application']) assert.ok(plan.tasks.find(t => t.id === id)?.steps.length, id);
  assert.ok(plan.playbook.sources.some(s => s.source === 'route:custom-app'));
  const e = await example('commerce'); e.existing = { platform: '已有商城', meetsNeeds: true };
  assert.ok(planSite(e).tasks.find(t => t.id === 'commerce').action.startsWith('核验已有平台能力：'));
  const local = planSite(await example('b2b'));
  assert.equal(local.tasks.find(t => t.id === 'route-playbook').stage, 'build');
});
test('所有示例的任务引用都能在plan.playbook中找到', async () => {
  for (const name of ['b2b', 'commerce', 'self-hosted-commerce', 'tourism', 'booking', 'content', 'unknown']) {
    const plan = planSite(await example(name)), steps = new Set(plan.playbook.phases.flatMap(p => p.steps.map(s => s.id)));
    const acceptance = new Set(plan.playbook.acceptance.map(a => a.id));
    for (const t of plan.tasks) {
      for (const id of t.steps ?? []) assert.ok(steps.has(id), `${name}:${id}`);
      for (const id of t.acceptanceIds ?? []) assert.ok(acceptance.has(id), `${name}:${id}`);
    }
  }
});
test('planMarkdown在原有各节之后追加实施手册与验收用例，原顺序不变', async () => {
  const md = planMarkdown(planSite(await example('commerce')));
  const headings = [...md.matchAll(/^## (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(headings, ['建议路线', '判断依据', '当前能执行到哪里', '必须先回答', '约束冲突', '能力与缺口', '执行任务', '验收', '条件与边界', '实施手册', '验收用例']);
  assert.ok(md.includes('[commerce.pay-success]') && md.includes('### 选型标准') && md.includes('### 交接物'));
});
test('playbook命令输出Markdown或JSON，并拒绝无效参数', async () => {
  const md = await cli(['playbook', '--route', 'managed-commerce']);
  assert.ok(md.startsWith('# 成熟平台建店') && md.includes('## 实施手册') && md.includes('## 验收用例') && md.includes('managed-commerce.test-order-flow'));
  const json = JSON.parse(await cli(['playbook', '--capability', 'booking', '--json']));
  assert.equal(json.capability, 'booking'); assert.ok(json.phases.length && json.acceptance.length);
  await assert.rejects(() => cli(['playbook']), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(() => cli(['playbook', '--route', 'static-owned', '--capability', 'forms']), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(() => cli(['playbook', '--route', 'nowhere']), { code: 'UNKNOWN_PLAYBOOK' });
  await assert.rejects(() => cli(['playbook', '--capability', 'intake']), { code: 'UNKNOWN_PLAYBOOK' });
  await assert.rejects(() => cli(['playbook', '--route', 'static-owned', '--json', 'yes']), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(() => cli(['playbook', '--route']), { code: 'INVALID_ARGUMENTS' });
});
test('demo的plans/*.md包含实施手册与验收用例', async t => {
  const root = await temporary(t);
  await cli(['demo', '--out', join(root, 'demo')]);
  for (const name of ['b2b', 'commerce', 'tourism', 'booking', 'content', 'unknown']) {
    const md = await readFile(join(root, 'demo/plans', `${name}.md`), 'utf8');
    assert.ok(md.includes('## 实施手册') && md.includes('## 验收用例'), name);
  }
  assert.ok((await readFile(join(root, 'demo/plans/commerce.md'), 'utf8')).includes('commerce.callback-duplicate'));
});
