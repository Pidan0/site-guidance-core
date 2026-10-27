import test from 'node:test';
import assert from 'node:assert/strict';
import { planSite, answerQuestions, intakeRequest } from '../src/index.mjs';
import { example } from './helpers.mjs';

test('追问带有brief字段路径和可直接应用的选项patch', async () => {
  const plan = planSite(await example('unknown'));
  const goal = plan.questions.find(q => q.id === 'primary-goal');
  assert.equal(goal.field, 'goals'); assert.deepEqual(goal.options.find(o => o.id === 'brand').patch, { goals: ['brand'] });
  assert.equal(plan.questions.find(q => q.id === 'maintenance').field, 'operations.maintenanceOwner');
});
test('unknown示例经过多轮回答走到static-owned且可本地生成', async () => {
  const first = answerQuestions(await example('unknown'), { 'primary-goal': 'brand' });
  assert.deepEqual(first.brief.goals, ['brand']); assert.equal(first.plan.route.id, 'static-owned');
  assert.equal(first.plan.readiness.localBuild, 'blocked');
  const second = answerQuestions(first.brief, { languages: 'zh-CN+en', maintenance: '品牌市场部' });
  assert.equal(second.plan.route.id, 'static-owned'); assert.equal(second.plan.readiness.localBuild, 'ready');
  assert.deepEqual(second.brief.languages, ['zh-CN', 'en']); assert.equal(second.brief.operations.maintenanceOwner, '品牌市场部');
  assert.deepEqual(second.applied, [{ question: 'languages', option: 'zh-CN+en' }, { question: 'maintenance', value: '品牌市场部' }]);
  assert.equal(second.brief.request, '帮我做个网站'); assert.ok(!('features' in second.brief), '未回答的布尔项仍然省略');
});
test('一次给出的回答按新出现的追问继续应用，未被问到的回答单独列出', async () => {
  const answers = { 'primary-goal': 'sales', ownership: 'managed', languages: ['zh-CN'], maintenance: 'client', 'ticket-fulfillment': 'onsite' };
  const result = answerQuestions(await example('unknown'), answers);
  assert.equal(result.plan.route.id, 'managed-commerce'); assert.deepEqual(result.brief.ownership, { sourceCode: false, selfHost: false });
  assert.deepEqual(result.unused, ['ticket-fulfillment']);
});
test('需要输入值的选项写入对应字段，并经过brief校验', async () => {
  const b = await example('tourism'); delete b.features.onlinePayment; delete b.features.externalCheckoutUrl;
  const result = answerQuestions(b, { 'ticket-fulfillment': { option: 'external', value: 'https://tickets.customer.tld/a' } });
  assert.equal(result.plan.route.id, 'tourism-referral'); assert.equal(result.brief.features.externalCheckoutUrl, 'https://tickets.customer.tld/a');
  assert.throws(() => answerQuestions(b, { 'ticket-fulfillment': 'external' }), { code: 'INVALID_ANSWER' });
  assert.throws(() => answerQuestions(b, { 'ticket-fulfillment': { option: 'external', value: 'javascript:alert(1)' } }), { code: 'INVALID_URL' });
});
test('卖货改为只需询价时从goals移除sales并加入inquiry', () => {
  const b = { schemaVersion: 1, name: 'x', goals: ['brand', 'sales'], languages: ['en'], features: { onlinePayment: false, internalOrders: false } };
  const result = answerQuestions(b, { 'sales-path': 'inquiry-only' });
  assert.deepEqual(result.brief.goals, ['brand', 'inquiry']);
});
test('拼错问题、非选项值和错误回答格式失败而不猜测', async () => {
  const unknown = await example('unknown');
  assert.throws(() => answerQuestions(unknown, { 'primary-gaol': 'brand' }), { code: 'INVALID_ANSWER' });
  assert.throws(() => answerQuestions(unknown, null), { code: 'INVALID_ANSWER' });
  const commerce = await example('commerce'); delete commerce.ownership;
  assert.throws(() => answerQuestions(commerce, { ownership: 'mine' }), { code: 'INVALID_ANSWER' });
  assert.throws(() => answerQuestions(unknown, { 'primary-goal': { option: 'brand', extra: 1 } }), { code: 'INVALID_ANSWER' });
  assert.throws(() => answerQuestions(unknown, { 'primary-goal': ['shopping'] }), { code: 'INVALID_BRIEF' });
});
test('原话采集给出未确认的建议patch', () => {
  const result = intakeRequest('做一个门票和品牌官网');
  assert.deepEqual(result.hints.find(h => h.candidate === 'tickets').patch, { goals: ['tickets'] });
  assert.ok(result.hints.every(h => h.confirmed === false)); assert.deepEqual(result.suggestedPatch, { goals: ['tickets', 'brand'] });
  assert.equal(result.suggestedPatchConfirmed, false); assert.deepEqual(result.brief.goals, []);
  assert.throws(() => intakeRequest(' '), { code: 'INVALID_REQUEST' });
});
