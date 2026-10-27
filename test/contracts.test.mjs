import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { capabilities, validateCatalog, CONTRACT_KINDS, loadContract, validateContract, verifyConnector } from '../src/index.mjs';
import { createTestDoubleConnector, IS_TEST_DOUBLE } from './in-memory-connector.testdouble.mjs';

const failing = report => report.results.filter(r => !r.passed).map(r => r.id);

test('五类契约可加载、结构完整，且返回副本', () => {
  assert.deepEqual([...CONTRACT_KINDS].sort(), ['booking', 'cms', 'commerce', 'forms', 'tickets']);
  for (const kind of CONTRACT_KINDS) {
    const c = loadContract(kind);
    assert.equal(c.kind, kind); assert.ok(c.operations.length >= 5 && c.events.length && c.lifecycle.transitions.length);
    for (const o of c.operations) assert.ok(o.name && o.input.type === 'object' && o.output.type === 'object' && o.errors.length);
    assert.ok(c.errors.some(e => e.code === 'ILLEGAL_TRANSITION') && c.idempotency.events && c.idempotency.operations);
    assert.equal(c.signature.required, c.events.some(e => e.direction === 'inbound'));
    c.operations.length = 0; assert.ok(loadContract(kind).operations.length);
  }
  assert.throws(() => loadContract('payments'), { code: 'UNKNOWN_CONTRACT' });
});
test('契约包含约定的事件与状态机，终态没有出口', () => {
  const commerce = loadContract('commerce'), names = commerce.events.map(e => e.name);
  for (const n of ['payment.succeeded', 'payment.failed', 'refund.completed']) assert.ok(names.includes(n));
  assert.ok(loadContract('booking').events.some(e => e.name === 'booking.cancelled' && e.direction === 'outbound'));
  assert.ok(commerce.signature.scheme === 'hmac-sha256' && commerce.signature.toleranceSeconds === 300);
  for (const kind of CONTRACT_KINDS) {
    const { lifecycle } = loadContract(kind);
    for (const s of lifecycle.terminal) assert.ok(!lifecycle.transitions.some(t => t.from === s));
  }
});
// forms已实现的是渲染与提交；契约约束的是接收端连接器，所以它是唯一可为implemented的例外。
test('能力目录用contract字段指向契约文件，且契约不改变接入状态', async () => {
  const withContract = capabilities.filter(c => c.contract);
  assert.deepEqual(withContract.map(c => c.id).sort(), ['booking', 'cms', 'commerce', 'forms', 'tickets']);
  for (const c of withContract) {
    await access(new URL(`../${c.contract}`, import.meta.url));
    assert.equal(c.status, c.id === 'forms' ? 'implemented' : 'integration_required'); assert.equal(c.id, loadContract(c.id).capability);
  }
  assert.deepEqual((await readdir(new URL('../adapters/contracts/', import.meta.url))).sort(), CONTRACT_KINDS.map(k => `${k}.contract.json`).sort());
  const bad = structuredClone(capabilities); bad.find(c => c.id === 'forms').contract = 'adapters/contracts/cms.contract.json';
  assert.throws(() => validateCatalog({ capabilities: bad }), { code: 'INVALID_CATALOG' });
});
test('validateContract拒绝不可达状态、终态出口、悬空引用和缺失样例', () => {
  const mutated = fn => { const c = loadContract('commerce'); fn(c); return () => validateContract(c); };
  assert.throws(mutated(c => c.lifecycle.states.push('orphan')), { code: 'INVALID_CONTRACT' });
  assert.throws(mutated(c => c.lifecycle.transitions.push({ from: 'refunded', to: 'paid', via: { operation: 'fulfillOrder' } })), { code: 'INVALID_CONTRACT' });
  assert.throws(mutated(c => { c.lifecycle.transitions[0].via = { event: 'no.such.event' }; }), { code: 'INVALID_CONTRACT' });
  assert.throws(mutated(c => { c.lifecycle.transitions[0].emits = 'no.such.event'; }), { code: 'INVALID_CONTRACT' });
  assert.throws(mutated(c => { delete c.conformance.events['payment.succeeded']; }), { code: 'INVALID_CONTRACT' });
  assert.throws(mutated(c => { c.operations[0].errors.push('MADE_UP'); }), { code: 'INVALID_CONTRACT' });
  assert.throws(mutated(c => { c.signature.required = false; }), { code: 'INVALID_CONTRACT' });
});
test('测试替身清楚标明仅用于测试，且不被src引用', async () => {
  assert.equal(IS_TEST_DOUBLE, true);
  assert.match(await readFile(new URL('./in-memory-connector.testdouble.mjs', import.meta.url), 'utf8'), /^\/\/ TEST DOUBLE ONLY/);
  for (const file of await readdir(new URL('../src/', import.meta.url))) {
    assert.ok(!(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')).includes('testdouble'));
  }
});
test('合规的内存测试替身通过全部五类契约自测', async () => {
  for (const kind of CONTRACT_KINDS) {
    const report = await verifyConnector(kind, createTestDoubleConnector(kind));
    assert.deepEqual(failing(report), [], kind); assert.equal(report.passed, true); assert.equal(report.failed, 0); assert.equal(report.kind, kind);
    assert.equal(report.total, report.results.length); assert.ok(report.total > 30);
  }
});
test('自测序列覆盖操作存在、合法与非法转换、事件幂等、签名与出站事件', async () => {
  const report = await verifyConnector('commerce', createTestDoubleConnector('commerce')), ids = report.results.map(r => r.id);
  for (const id of [
    'operation.createOrder', 'interface.ingestEvent', 'interface.onEvent', 'errors.validation', 'errors.not-found', 'create.output',
    'idempotency.create.same-key', 'idempotency.create.conflict', 'lifecycle.legal.pending_payment->paid.payment.succeeded',
    'lifecycle.legal.refund_pending->partially_refunded.refund.partially_completed', 'idempotency.event.payment.succeeded',
    'idempotency.operation.cancelOrder', 'lifecycle.illegal.cancelled.payment.succeeded', 'lifecycle.illegal.refunded.requestRefund',
    'signature.invalid', 'signature.tampered', 'signature.expired', 'signature.missing'
  ]) assert.ok(ids.includes(id), id);
  assert.ok(ids.filter(id => id.startsWith('lifecycle.legal.')).length === loadContract('commerce').lifecycle.transitions.length);
  const exhaustive = await verifyConnector('booking', createTestDoubleConnector('booking'), { exhaustive: true });
  assert.equal(exhaustive.passed, true); assert.ok(exhaustive.total > (await verifyConnector('booking', createTestDoubleConnector('booking'))).total);
});
test('违反契约的实现被逐项识别', async () => {
  const run = (faults, kind = 'commerce') => verifyConnector(kind, createTestDoubleConnector(kind, { faults }));
  const cases = [
    [{ omit: ['cancelOrder'] }, 'operation.cancelOrder'], [{ omit: ['ingestEvent'] }, 'interface.ingestEvent'],
    [{ omit: ['getOrder'] }, 'lifecycle.skipped'], [{ noKeyDedupe: true }, 'idempotency.create.same-key'],
    [{ noKeyDedupe: true }, 'idempotency.create.conflict'], [{ noEventDedupe: true }, 'idempotency.event.payment.succeeded'],
    [{ allowIllegal: true }, 'lifecycle.illegal.cancelled.payment.succeeded'], [{ acceptAnySignature: true }, 'signature.invalid'],
    [{ acceptAnySignature: true }, 'signature.expired'], [{ skipEmit: true }, 'lifecycle.legal.pending_payment->paid.payment.succeeded'],
    [{ emitTwice: true }, 'lifecycle.legal.pending_payment->paid.payment.succeeded'],
    [{ wrongTarget: true }, 'lifecycle.legal.pending_payment->paid.payment.succeeded'],
    [{ noState: true }, 'create.output'], [{ noValidation: true }, 'errors.validation']
  ];
  for (const [faults, id] of cases) {
    const report = await run(faults);
    assert.equal(report.passed, false, JSON.stringify(faults)); assert.ok(failing(report).includes(id), `${JSON.stringify(faults)} -> ${id}`);
  }
  assert.ok(failing(await run({ allowIllegal: true }, 'booking')).some(id => id.startsWith('lifecycle.illegal.')));
  assert.ok(failing(await run({ noEventDedupe: true }, 'tickets')).includes('idempotency.event.payment.succeeded'));
  assert.ok(failing(await run({ wrongTarget: true }, 'cms')).length > 5);
  const detail = (await run({ allowIllegal: true })).results.find(r => r.id === 'lifecycle.illegal.cancelled.payment.succeeded').detail;
  assert.match(detail, /ILLEGAL_TRANSITION/);
});
test('verifyConnector校验连接器类型，并使用调用方给出的签名密钥', async () => {
  await assert.rejects(() => verifyConnector('commerce', null), { code: 'INVALID_CONNECTOR' });
  await assert.rejects(() => verifyConnector('payments', {}), { code: 'UNKNOWN_CONTRACT' });
  const own = createTestDoubleConnector('forms', { secret: 'my-secret' });
  assert.equal((await verifyConnector('forms', own, { secret: 'my-secret' })).passed, true);
  assert.equal((await verifyConnector('forms', own)).passed, false);
  const empty = await verifyConnector('cms', {});
  assert.equal(empty.passed, false); assert.ok(failing(empty).includes('lifecycle.skipped'));
});
