import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { invariant } from './errors.mjs';
import { validateSchema } from './schema.mjs';

// Connector contracts (adapters/contracts/*.contract.json) and the conformance harness that tests a connector against them.
// A passing run proves the connector obeys the contract; it does not prove a real backend is connected or paid for.
export const CONTRACT_KINDS = ['forms', 'commerce', 'tickets', 'booking', 'cms'];
const cache = new Map();
const DIRECTIONS = ['inbound', 'outbound'];
const check = (condition, where, message) => invariant(condition, 'INVALID_CONTRACT', `${where}: ${message}`);
const text = value => typeof value === 'string' && value.trim().length > 0;
const viaName = via => via.operation ?? via.event;
const viaKey = via => (via.operation !== undefined ? `operation:${via.operation}` : `event:${via.event}`);
const sample = (op, extra = {}) => ({ idempotencyKey: 'contract-key-0001', ...extra, ...op });

function checkOperations(contract, errorCodes) {
  const names = contract.operations.map(op => op.name);
  check(names.length > 0 && new Set(names).size === names.length && names.every(text), 'operations', '需要名称唯一的操作');
  for (const op of contract.operations) {
    check(op.input?.type === 'object' && op.output?.type === 'object', op.name, 'input和output需要是object结构');
    check(Array.isArray(op.errors) && op.errors.every(code => errorCodes.has(code)), op.name, 'errors引用了未定义的错误码');
  }
}

function checkEvents(contract) {
  const names = contract.events.map(e => e.name);
  check(new Set(names).size === names.length && names.every(text), 'events', '事件名称需唯一');
  for (const e of contract.events) check(DIRECTIONS.includes(e.direction) && e.data?.type === 'object', e.name, '需要direction和object结构的data');
}

function reachable(lifecycle) {
  const seen = new Set([lifecycle.initial]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of lifecycle.transitions) if (seen.has(t.from) && !seen.has(t.to)) { seen.add(t.to); grew = true; }
  }
  return seen;
}

function checkLifecycle(contract) {
  const { lifecycle: lc, operations, events } = contract, op = name => operations.find(o => o.name === name);
  const named = direction => new Set(events.filter(e => e.direction === direction).map(e => e.name));
  const inbound = named('inbound'), outbound = named('outbound');
  check(op(lc.create)?.creates === true && op(lc.read), 'lifecycle', 'create和read需要指向已定义的操作（create需标记creates）');
  check(new Set(lc.states).size === lc.states.length && lc.states.includes(lc.initial), 'lifecycle', 'states需唯一且包含initial');
  check(lc.terminal.every(s => lc.states.includes(s)), 'lifecycle', 'terminal必须是已定义状态');
  const pairs = new Set();
  for (const t of lc.transitions) {
    const where = `lifecycle ${t.from}->${t.to}`;
    check(lc.states.includes(t.from) && lc.states.includes(t.to), where, '状态未定义');
    check((t.via.operation === undefined) !== (t.via.event === undefined), where, 'via需要且只能指定operation或event');
    check(t.via.operation === undefined ? inbound.has(t.via.event) : op(t.via.operation) && t.via.operation !== lc.create, where, 'via引用无效');
    check(t.emits === undefined || outbound.has(t.emits), where, 'emits需引用出站事件');
    check(!lc.terminal.includes(t.from), where, '终态不能有出口');
    check(!pairs.has(`${t.from}|${viaKey(t.via)}`), where, '同一状态下同一触发只能有一条转换');
    pairs.add(`${t.from}|${viaKey(t.via)}`);
  }
  check(lc.states.every(s => reachable(lc).has(s)), 'lifecycle', '存在从initial不可达的状态');
}

function checkConformance(contract) {
  const { conformance: cf, lifecycle: lc, operations, events } = contract, op = name => operations.find(o => o.name === name);
  const bad = (value, schema) => validateSchema(value, schema).length > 0;
  for (const key of ['create', 'createAlt']) check(!bad(sample(cf[key]), op(lc.create).input), `conformance.${key}`, '样例不符合create输入格式');
  for (const t of lc.transitions) {
    const name = viaName(t.via), where = `conformance ${name}`;
    if (t.via.operation) check(cf.operations[name] && !bad(sample(cf.operations[name], { id: 'x' }), op(name).input), where, '缺少或不符合输入格式的样例');
    else check(cf.events[name] && !bad(cf.events[name], events.find(e => e.name === name).data), where, '缺少或不符合事件data格式的样例');
  }
}

export function validateContract(contract) {
  check(contract?.schemaVersion === 1 && CONTRACT_KINDS.includes(contract.kind) && contract.capability === contract.kind, 'contract', '头部无效');
  check(text(contract.version) && text(contract.summary), 'contract', '需要version和summary');
  const errorCodes = new Set(contract.errors.map(e => e.code));
  const basics = ['VALIDATION_FAILED', 'NOT_FOUND', 'ILLEGAL_TRANSITION'];
  check(errorCodes.size === contract.errors.length && basics.every(c => errorCodes.has(c)), 'errors', '错误码需唯一并包含基础错误');
  checkOperations(contract, errorCodes);
  checkEvents(contract);
  checkLifecycle(contract);
  checkConformance(contract);
  const hasInbound = contract.events.some(e => e.direction === 'inbound');
  check(!hasInbound || (contract.signature.required === true && contract.signature.toleranceSeconds > 0), 'signature', '含入站事件的契约必须要求签名');
  return contract;
}

export function loadContract(kind) {
  invariant(CONTRACT_KINDS.includes(kind), 'UNKNOWN_CONTRACT', `没有「${kind}」连接器契约`, { available: CONTRACT_KINDS });
  if (!cache.has(kind)) {
    const file = new URL(`../adapters/contracts/${kind}.contract.json`, import.meta.url);
    cache.set(kind, validateContract(JSON.parse(readFileSync(file, 'utf8'))));
  }
  return structuredClone(cache.get(kind));
}

// Shortest transition path from the initial state to every state.
function pathsOf(lifecycle) {
  const paths = new Map([[lifecycle.initial, []]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of lifecycle.transitions) if (paths.has(t.from) && !paths.has(t.to)) { paths.set(t.to, [...paths.get(t.from), t]); grew = true; }
  }
  return paths;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

async function rejectsWith(fn, codes) {
  try { await fn(); } catch (error) { return codes.includes(error?.code) ? undefined : `期望错误码 ${codes.join('/')}，实际 ${error?.code ?? error?.message}`; }
  return `期望抛出 ${codes.join('/')}，实际调用成功`;
}

const summarize = (kind, contract, results) => {
  const failed = results.filter(r => !r.passed).length;
  return { kind, contractVersion: contract.version, passed: failed === 0, total: results.length, failed, results };
};

// Builds the helpers that talk to the connector under test: signing, event delivery, state reads and entity setup.
function toolkit(contract, connector, { secret, now }) {
  const { lifecycle: lc, conformance: cf } = contract, paths = pathsOf(lc), emitted = [];
  let counter = 0;
  const key = () => `ck-${(counter += 1)}-${randomUUID().slice(0, 8)}`;
  const create = (input = cf.create, k = key()) => connector[lc.create]({ idempotencyKey: k, ...input });
  const stateOf = async id => (await connector[lc.read]({ id })).state;
  const envelope = (name, entityId) => ({ id: `evt-${randomUUID()}`, type: name, entityId, occurredAt: new Date(now()).toISOString(), data: cf.events[name] });
  const wire = (env, { signWith = secret, at = Math.floor(now() / 1000), tamper = false } = {}) => {
    const raw = JSON.stringify(env), digest = createHmac('sha256', signWith).update(`${at}.${raw}`).digest('hex');
    return { raw: tamper ? raw.replace(/"data":\{/, '"data":{"tampered":true,') : raw, headers: { 'x-signature': `v1=${digest}`, 'x-timestamp': String(at) } };
  };
  const deliver = (env, options) => { const { raw, headers } = wire(env, options); return connector.ingestEvent(raw, headers); };
  const apply = async (via, id) => {
    if (via.event) { const env = envelope(via.event, id); return { env, result: await deliver(env) }; }
    const input = { ...cf.operations[via.operation], id, idempotencyKey: key() };
    return { input, result: await connector[via.operation](input) };
  };
  const reach = async state => {
    const entity = await create();
    for (const t of paths.get(state)) await apply(t.via, entity.id);
    await tick();
    return entity.id;
  };
  return { key, create, stateOf, envelope, deliver, apply, reach, emitted, emissionsFor: id => emitted.filter(e => e.entityId === id) };
}

/**
 * Runs the contract test sequence against a connector object and returns per-check results; connector faults never throw.
 * options: { secret: signing secret the connector under test is configured with, now: () => ms, exhaustive: test every illegal pair }.
 * Test connectors need enough capacity/stock for repeated creates; each state check starts from a fresh entity.
 */
export async function verifyConnector(kind, connector, options = {}) {
  const contract = loadContract(kind), { lifecycle: lc } = contract;
  invariant(connector !== null && typeof connector === 'object', 'INVALID_CONNECTOR', '连接器必须是对象');
  const { secret = 'contract-test-secret', now = Date.now, exhaustive = false } = options;
  const results = [], op = name => contract.operations.find(o => o.name === name), seen = new Set();
  const kit = toolkit(contract, connector, { secret, now }), { create, stateOf, apply, reach, emissionsFor } = kit;
  const hasInbound = contract.events.some(e => e.direction === 'inbound'), hasOutbound = contract.events.some(e => e.direction === 'outbound');
  const lacks = (name, message) => (typeof connector[name] === 'function' ? undefined : message);
  const run = async (id, name, fn) => {
    try { const problem = await fn(); results.push({ id, name, passed: !problem, ...(problem ? { detail: String(problem) } : {}) }); }
    catch (error) { results.push({ id, name, passed: false, detail: `抛出异常：${[error?.code, error?.message ?? error].filter(Boolean).join(' ')}` }); }
    return results.at(-1).passed;
  };

  async function legal(t) {
    const name = viaName(t.via);
    let done;
    const ok = await run(`lifecycle.legal.${t.from}->${t.to}.${name}`, `合法转换 ${t.from} -> ${t.to}（${name}）`, async () => {
      const entity = await reach(t.from), before = emissionsFor(entity).length;
      done = { entity, ...(await apply(t.via, entity)) };
      if (t.via.event && done.result?.status !== 'applied') return `事件应返回applied，实际${done.result?.status}`;
      const problems = t.via.operation ? validateSchema(done.result, op(name).output) : [];
      if (problems.length) return problems.join('；');
      const state = await stateOf(entity); await tick();
      if (state !== t.to) return `转换后状态应为${t.to}，实际${state}`;
      const fresh = emissionsFor(entity).slice(before).filter(e => e.type === t.emits);
      if (t.emits && fresh.length !== 1) return `应恰好发出一次${t.emits}，实际${fresh.length}次`;
      return fresh.length ? validateSchema(fresh[0], contract.interface.envelope).join('；') : undefined;
    });
    if (ok && !seen.has(viaKey(t.via))) { seen.add(viaKey(t.via)); await replay(t, done); }
  }

  // Replaying the same event envelope or the same operation call must not change state or emit twice.
  async function replay(t, { entity, env, input, result }) {
    const name = viaName(t.via), before = emissionsFor(entity).length;
    await run(`idempotency.${t.via.event ? 'event' : 'operation'}.${name}`, `${t.via.event ? '重复事件' : '同键重复调用'}${name}保持幂等`, async () => {
      if (t.via.event) { const again = await kit.deliver(env); if (again?.status !== 'duplicate') return `重复投递应返回duplicate，实际${again?.status}`; }
      else { const again = await connector[name](input); if (again?.id !== result?.id || again?.state !== result?.state) return '同键重放应返回相同结果'; }
      await tick();
      if ((await stateOf(entity)) !== t.to) return '重放改变了状态';
      return emissionsFor(entity).length !== before && '重放产生了额外的出站事件';
    });
  }

  async function illegal() {
    const vias = new Map(lc.transitions.map(t => [viaKey(t.via), t.via]));
    for (const state of lc.states) {
      const allowed = new Set(lc.transitions.filter(t => t.from === state).map(t => viaKey(t.via)));
      const candidates = [...vias].filter(([k]) => !allowed.has(k)).map(([, via]) => via);
      for (const via of exhaustive || lc.terminal.includes(state) ? candidates : candidates.slice(0, 1)) {
        await run(`lifecycle.illegal.${state}.${viaName(via)}`, `非法转换被拒：${state} 状态下的 ${viaName(via)}`, async () => {
          const entity = await reach(state), before = emissionsFor(entity).length;
          const problem = await rejectsWith(() => apply(via, entity), ['ILLEGAL_TRANSITION']);
          await tick();
          if (problem) return problem;
          if ((await stateOf(entity)) !== state) return '被拒后状态发生了变化';
          return emissionsFor(entity).length !== before && '被拒的请求仍发出了出站事件';
        });
      }
    }
  }

  async function signatures() {
    const t = lc.transitions.find(x => x.via.event), name = t.via.event;
    const attempt = (id, label, wireOptions, code) => run(id, label, async () => {
      const entity = await reach(t.from), problem = await rejectsWith(() => kit.deliver(kit.envelope(name, entity), wireOptions), [code]);
      return problem || ((await stateOf(entity)) !== t.from && '签名无效的事件改变了状态');
    });
    await attempt('signature.invalid', '错误密钥的签名被SIGNATURE_INVALID拒绝', { signWith: 'wrong-secret' }, 'SIGNATURE_INVALID');
    await attempt('signature.tampered', '正文被篡改的事件被SIGNATURE_INVALID拒绝', { tamper: true }, 'SIGNATURE_INVALID');
    await attempt('signature.expired', '时间戳超窗的事件被SIGNATURE_EXPIRED拒绝', { at: Math.floor(now() / 1000) - 3600 }, 'SIGNATURE_EXPIRED');
    await run('signature.missing', '缺少签名头的事件被SIGNATURE_INVALID拒绝', async () => {
      const entity = await reach(t.from);
      return rejectsWith(() => connector.ingestEvent(JSON.stringify(kit.envelope(name, entity)), {}), ['SIGNATURE_INVALID']);
    });
  }

  for (const o of contract.operations) await run(`operation.${o.name}`, `操作存在：${o.name}`, () => lacks(o.name, '缺少该操作'));
  if (hasInbound) await run('interface.ingestEvent', '提供ingestEvent(rawBody, headers)', () => lacks('ingestEvent', '缺少ingestEvent'));
  if (hasOutbound) await run('interface.onEvent', '提供onEvent(handler)', () => lacks('onEvent', '缺少onEvent'));
  const usable = [lc.create, lc.read].every(name => typeof connector[name] === 'function') && (!hasInbound || typeof connector.ingestEvent === 'function');
  if (!usable) {
    results.push({ id: 'lifecycle.skipped', name: '状态机检查', passed: false, detail: '缺少创建、读取操作或ingestEvent，无法继续状态机检查' });
    return summarize(kind, contract, results);
  }
  const off = hasOutbound && typeof connector.onEvent === 'function' ? connector.onEvent(e => kit.emitted.push(e)) : undefined;
  try {
    await run('errors.validation', '非法输入被VALIDATION_FAILED拒绝', () => rejectsWith(() => connector[lc.create]({}), ['VALIDATION_FAILED']));
    await run('errors.not-found', '未知id被NOT_FOUND拒绝', () => rejectsWith(() => connector[lc.read]({ id: `missing-${randomUUID()}` }), ['NOT_FOUND']));
    await run('create.output', `创建后状态为${lc.initial}且输出符合契约`, async () => {
      const out = await create(), problems = validateSchema(out, op(lc.create).output);
      if (problems.length) return problems.join('；');
      if (out.state !== lc.initial) return `初始状态应为${lc.initial}，实际${out.state}`;
      return (await stateOf(out.id)) !== lc.initial && '读取到的状态与创建输出不一致';
    });
    await run('idempotency.create.same-key', '同键同输入创建返回同一对象', async () => {
      const k = kit.key(), a = await create(contract.conformance.create, k), b = await create(contract.conformance.create, k);
      return a.id !== b.id && `两次创建得到不同id：${a.id} / ${b.id}`;
    });
    await run('idempotency.create.conflict', '同键不同输入被IDEMPOTENCY_CONFLICT拒绝', async () => {
      const k = kit.key(); await create(contract.conformance.create, k);
      return rejectsWith(() => create(contract.conformance.createAlt, k), ['IDEMPOTENCY_CONFLICT']);
    });
    for (const t of lc.transitions) await legal(t);
    await illegal();
    if (hasInbound) await signatures();
  } finally { if (typeof off === 'function') off(); }
  return summarize(kind, contract, results);
}
