import test from 'node:test';
import assert from 'node:assert/strict';
import { planSite, planMarkdown, validateCatalog, evaluateCondition, routes, rules } from '../src/index.mjs';
import { example } from './helpers.mjs';

const brief = (goals, extra = {}) => ({ schemaVersion: 1, name: '路线正例', goals, languages: ['zh-CN'], operations: { maintenanceOwner: '客户' }, ...extra });
const external = { onlinePayment: false, internalOrders: false, externalCheckoutUrl: 'https://shop.example.com/x' };
const POSITIVE = {
  'existing-platform.meets-needs': brief(['sales'], { existing: { platform: '已有商城', meetsNeeds: true } }),
  'discovery.no-goal': brief([]),
  'custom-app.accounts': brief(['membership']),
  'ticketing-integration.transactional': brief(['tickets'], { features: { onlinePayment: true } }),
  'ticketing-integration.unclear': brief(['tickets']),
  'tourism-referral.external-checkout': brief(['tickets'], { features: external }),
  'booking-referral.external-booking': brief(['booking'], {
    features: { onlinePayment: false, internalOrders: false, externalBookingUrl: 'https://book.example.com/x' }
  }),
  'managed-booking.booking': brief(['booking']),
  'commerce-referral.external-checkout': brief(['sales'], { features: external }),
  'owned-commerce.self-host': brief(['sales'], { ownership: { selfHost: true } }),
  'hybrid-commerce.source-code': brief(['sales'], { ownership: { sourceCode: true } }),
  'managed-commerce.platform': brief(['sales'], { ownership: { sourceCode: false, selfHost: false } }),
  'cms-owned.client-editor': brief(['brand'], { features: { contentEditor: 'client' } }),
  'static-owned.default': brief(['brand'])
};

test('每条路线规则都有正例，决策轨迹记录命中的规则', () => {
  const ruleIds = routes.flatMap(r => r.when.map(w => w.id));
  assert.deepEqual(Object.keys(POSITIVE).sort(), [...ruleIds].sort());
  for (const [ruleId, input] of Object.entries(POSITIVE)) {
    const plan = planSite(input);
    assert.equal(plan.decision.rule, ruleId); assert.equal(plan.route.id, ruleId.split('.')[0]);
    assert.ok(!('when' in plan.route) && !('override' in plan.route));
  }
});
test('决策轨迹列出被跳过的更高优先级规则及原因，Markdown有判断依据', async () => {
  const plan = planSite(await example('tourism'));
  assert.equal(plan.decision.rule, 'tourism-referral.external-checkout');
  const skipped = plan.decision.skipped.map(s => s.rule);
  assert.deepEqual(skipped, [
    'existing-platform.meets-needs', 'discovery.no-goal', 'custom-app.accounts', 'ticketing-integration.transactional', 'ticketing-integration.unclear'
  ]);
  assert.match(plan.decision.skipped[0].unmet, /existing\.platform已填写/);
  assert.match(plan.decision.skipped[4].unmet, /externalCheckoutHandles/);
  const md = planMarkdown(plan);
  assert.ok(md.includes('## 判断依据')); assert.ok(md.includes('tourism-referral.external-checkout')); assert.ok(md.includes('existing-platform.meets-needs'));
});
test('已有平台覆盖时保留基础路线及其能力义务', async () => {
  const b = await example('commerce'); b.existing = { platform: '已有商城', meetsNeeds: true };
  const plan = planSite(b);
  assert.equal(plan.route.id, 'existing-platform'); assert.equal(plan.decision.base.route, 'managed-commerce');
  assert.deepEqual(plan.decision.skipped, []); assert.ok(plan.reasons[0].includes('已有商城'));
  assert.ok(plan.gaps.find(c => c.id === 'commerce')); assert.ok(planMarkdown(plan).includes('基础路线'));
});
test('条件DSL：all/any/not/ref/exists/is/minItems/subsetOf按定义求值', () => {
  const sample = { goals: ['sales'], languages: ['zh-CN', 'ar'], features: { onlinePayment: false, externalCheckoutUrl: '' } };
  const ctx = { brief: sample, conditions: rules.conditions };
  assert.equal(evaluateCondition({ all: [] }, ctx), true); assert.equal(evaluateCondition({ any: [] }, ctx), false);
  assert.equal(evaluateCondition({ feature: 'onlinePayment', is: false }, ctx), true);
  assert.equal(evaluateCondition({ feature: 'internalOrders', is: false }, ctx), false, '未知不等于false');
  assert.equal(evaluateCondition({ feature: 'externalCheckoutUrl', exists: true }, ctx), false, '空字符串视为未填写');
  assert.equal(evaluateCondition({ field: 'languages', minItems: 2 }, ctx), true);
  assert.equal(evaluateCondition({ not: { field: 'languages', subsetOf: ['zh-CN', 'en'] } }, ctx), true);
  assert.equal(evaluateCondition({ ref: 'commerceSignals' }, ctx), true);
});
test('validateCatalog拒绝错误DSL、未知goal/feature字段和不存在的能力', () => {
  const withRule = (rule, extra = {}) => {
    const changed = structuredClone(routes); changed.find(r => r.id === 'custom-app').when[0] = { id: 'custom-app.accounts', reason: '测试', ...rule, ...extra };
    return () => validateCatalog({ routes: changed });
  };
  assert.throws(withRule({ if: { goal: 'shopping' } }), { code: 'INVALID_CATALOG' });
  assert.throws(withRule({ if: { feature: 'payment', is: true } }), { code: 'INVALID_CATALOG' });
  assert.throws(withRule({ if: { feature: 'onlinePayment', is: 'yes' } }), { code: 'INVALID_CATALOG' });
  assert.throws(withRule({ if: { feature: 'onlinePayment', is: true, exists: true } }), { code: 'INVALID_CATALOG' });
  assert.throws(withRule({ if: { some: [] } }), { code: 'INVALID_CATALOG' });
  assert.throws(withRule({ if: { capability: 'commerce' } }), { code: 'INVALID_CATALOG' }, '路线选择不能依赖选后能力');
  assert.throws(withRule({ if: { ref: 'missing' } }), { code: 'INVALID_CATALOG' });
  assert.throws(withRule({ if: { all: [] } }, { capabilities: ['teleport'] }), { code: 'INVALID_CATALOG' });
  const looped = structuredClone(rules); looped.conditions.a = { ref: 'b' }; looped.conditions.b = { ref: 'a' };
  assert.throws(() => validateCatalog({ rules: looped }), { code: 'INVALID_CATALOG' });
  const badPatch = structuredClone(rules); badPatch.questions[0].options[0].patch = { goals: ['shopping'] };
  assert.throws(() => validateCatalog({ rules: badPatch }), { code: 'INVALID_CATALOG' });
  const noFallback = structuredClone(routes); noFallback.at(-1).when[0].if = { goal: 'brand' };
  assert.throws(() => validateCatalog({ routes: noFallback }), { code: 'INVALID_CATALOG' });
});
test('票务和卖货都由外部入口承接时，不追加交易能力和代码归属追问', () => {
  const plan = planSite(brief(['tickets', 'sales'], { features: external }));
  assert.equal(plan.route.id, 'tourism-referral'); assert.equal(plan.readiness.localBuild, 'ready');
  assert.ok(!plan.capabilities.find(c => c.id === 'commerce')); assert.ok(!plan.questions.find(q => q.id === 'ownership'));
  const booking = planSite(brief(['booking', 'sales'], { features: { ...external, externalBookingUrl: 'https://book.example.com/x' } }));
  assert.equal(booking.route.id, 'booking-referral'); assert.equal(booking.readiness.localBuild, 'ready');
  assert.ok(!booking.capabilities.find(c => ['commerce', 'booking'].includes(c.id)));
  const onsiteSales = planSite(brief(['tickets', 'sales'], { features: { ...external, inventory: true } }));
  assert.ok(onsiteSales.capabilities.find(c => c.id === 'commerce'), '库存仍在本站时保留交易义务');
});
