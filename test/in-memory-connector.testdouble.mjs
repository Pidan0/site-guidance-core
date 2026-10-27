// TEST DOUBLE ONLY. This is an in-memory stand-in used to exercise verifyConnector; it is NOT a connector, talks to no backend,
// and its passing proves nothing about any real system. It is driven by the contract itself and can inject faults so tests can show
// that the harness tells compliant implementations from violating ones. Never import it from src/ or ship it as an adapter.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadContract } from '../src/contracts.mjs';
import { validateSchema } from '../src/schema.mjs';

export const IS_TEST_DOUBLE = true;

/**
 * faults: omit[] (operation or ingestEvent names to delete), noKeyDedupe, noEventDedupe, allowIllegal, acceptAnySignature,
 * skipEmit, emitTwice, wrongTarget, noState (create output lacks state), noValidation.
 */
export function createTestDoubleConnector(kind, { faults = {}, secret = 'contract-test-secret', clock = Date.now } = {}) {
  const contract = loadContract(kind), lc = contract.lifecycle;
  const entities = new Map(), keyed = new Map(), seenEvents = new Set(), listeners = new Set();
  const op = name => contract.operations.find(o => o.name === name);
  const fail = (code, message) => Object.assign(new Error(message), { code });
  let counter = 0;

  const emit = (type, entity) => {
    if (faults.skipEmit) return;
    const envelope = { id: `out-${(counter += 1)}`, type, entityId: entity.id, occurredAt: new Date(clock()).toISOString(), data: {} };
    for (const handler of listeners) {
      queueMicrotask(() => handler(envelope));
      if (faults.emitTwice) queueMicrotask(() => handler({ ...envelope }));
    }
  };
  const need = (id, ...rest) => { if (!entities.has(id)) throw fail('NOT_FOUND', `未找到 ${id}`); return entities.get(id); };
  const checkInput = (name, input) => {
    const problems = faults.noValidation ? [] : validateSchema(input ?? {}, op(name).input);
    if (problems.length) throw fail('VALIDATION_FAILED', problems.join('；'));
  };
  // Same key + same input returns the stored result; same key + different input conflicts.
  const once = (name, input, action) => {
    if (!input.idempotencyKey || faults.noKeyDedupe) return action();
    const slot = `${name}:${input.idempotencyKey}`, print = JSON.stringify(input);
    if (keyed.has(slot)) {
      if (keyed.get(slot).print !== print) throw fail('IDEMPOTENCY_CONFLICT', '同一幂等键用于不同输入');
      return keyed.get(slot).result;
    }
    const result = action();
    keyed.set(slot, { print, result });
    return result;
  };
  const move = (entity, via) => {
    const t = lc.transitions.find(x => x.from === entity.state && (via.event ? x.via.event === via.event : x.via.operation === via.operation));
    if (!t) {
      if (faults.allowIllegal) return;
      throw fail('ILLEGAL_TRANSITION', `${entity.state} 状态不允许 ${via.event ?? via.operation}`);
    }
    entity.state = faults.wrongTarget ? lc.states.find(s => s !== t.to && s !== t.from) : t.to;
    if (t.emits) emit(t.emits, entity);
  };
  const view = entity => ({ id: entity.id, state: entity.state });

  const connector = {
    onEvent(handler) { listeners.add(handler); return () => listeners.delete(handler); },
    async ingestEvent(rawBody, headers = {}) {
      const given = String(headers['x-signature'] ?? '').replace(/^v1=/, ''), at = Number(headers['x-timestamp']);
      if (!faults.acceptAnySignature) {
        const expected = createHmac('sha256', secret).update(`${at}.${rawBody}`).digest('hex');
        const ok = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
        if (!headers['x-signature'] || !ok) throw fail('SIGNATURE_INVALID', '签名无效');
        if (Math.abs(clock() / 1000 - at) > contract.signature.toleranceSeconds) throw fail('SIGNATURE_EXPIRED', '时间戳超出容忍窗口');
      }
      const env = JSON.parse(rawBody), entity = need(env.entityId);
      if (seenEvents.has(env.id) && !faults.noEventDedupe) return { status: 'duplicate', entityId: entity.id, state: entity.state };
      move(entity, { event: env.type });
      seenEvents.add(env.id);
      return { status: 'applied', entityId: entity.id, state: entity.state };
    }
  };

  for (const o of contract.operations) {
    connector[o.name] = async (input = {}) => {
      checkInput(o.name, input);
      if (o.creates) {
        return once(o.name, input, () => {
          const { idempotencyKey, ...data } = input, entity = { id: `${kind}-${(counter += 1)}`, state: lc.initial };
          entities.set(entity.id, entity);
          return faults.noState ? { id: entity.id, ...data } : { ...data, ...view(entity) };
        });
      }
      if (o.query) return {};
      const entity = need(input.id);
      if (o.name === lc.read) return view(entity);
      if (!lc.transitions.some(t => t.via.operation === o.name)) return view(entity);
      return once(o.name, input, () => { move(entity, { operation: o.name }); return view(entity); });
    };
  }
  for (const name of faults.omit ?? []) delete connector[name];
  return connector;
}
