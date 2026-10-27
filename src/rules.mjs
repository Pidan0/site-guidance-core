import { fail, invariant } from './errors.mjs';
import { briefSchema, validateSchema } from './schema.mjs';
import { isPlainObject, valueAt } from './patch.mjs';

// Condition DSL shared by knowledge/routes.json and knowledge/rules.json. See docs/API.md「规则DSL」.
// A node is exactly one of:
//   { all: [node...] }  { any: [node...] }  { not: node }  { ref: 'namedCondition' }
//   { goal: 'tickets' }                          brief.goals contains the goal
//   { feature: 'onlinePayment', <test> }         shorthand for field 'features.<name>'
//   { field: 'ownership.selfHost', <test> }      dotted path into the brief
//   { execution: 'local' } { rule: 'route.rule-id' } { capability: 'commerce' }   only after routing
// <test> is exactly one of: is (strict equality), exists (true/false; '', [] and undefined count as missing),
// minItems (array length >= n), subsetOf (every array item is listed).
const COMBINATORS = ['all', 'any', 'not'];
const TESTS = ['is', 'exists', 'minItems', 'subsetOf'];
const LEAVES = ['ref', 'goal', 'feature', 'field', 'execution', 'rule', 'capability'];

// Which leaves each knowledge section may use. Brief-only scopes cannot depend on routing results.
export const SCOPES = {
  brief: ['ref', 'goal', 'feature', 'field'],
  capabilities: ['ref', 'goal', 'feature', 'field', 'execution', 'rule'],
  post: ['ref', 'goal', 'feature', 'field', 'execution', 'rule', 'capability']
};

const kind = node => Object.keys(node).find(key => COMBINATORS.includes(key) || LEAVES.includes(key));
const pathOf = node => (node.feature !== undefined ? `features.${node.feature}` : node.field);
const missing = value => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

function test(node, value) {
  if (Object.hasOwn(node, 'is')) return Object.is(value, node.is);
  if (Object.hasOwn(node, 'exists')) return missing(value) !== node.exists;
  if (Object.hasOwn(node, 'minItems')) return Array.isArray(value) && value.length >= node.minItems;
  return (Array.isArray(value) ? value : []).every(item => node.subsetOf.includes(item));
}

// ctx: { brief, conditions, execution?, matched?: Set<ruleId>, capabilities?: Set<capabilityId> }
export function evaluate(node, ctx) {
  switch (kind(node)) {
    case 'all': return node.all.every(child => evaluate(child, ctx));
    case 'any': return node.any.some(child => evaluate(child, ctx));
    case 'not': return !evaluate(node.not, ctx);
    case 'ref': return evaluate(ctx.conditions[node.ref], ctx);
    case 'goal': return (ctx.brief.goals ?? []).includes(node.goal);
    case 'execution': return ctx.execution === node.execution;
    case 'rule': return ctx.matched?.has(node.rule) ?? false;
    case 'capability': return ctx.capabilities?.has(node.capability) ?? false;
    default: return test(node, valueAt(ctx.brief, pathOf(node)));
  }
}

function describeTest(node) {
  const path = pathOf(node);
  if (Object.hasOwn(node, 'is')) return `${path}=${JSON.stringify(node.is)}`;
  if (Object.hasOwn(node, 'exists')) return `${path}${node.exists ? '已填写' : '未填写'}`;
  if (Object.hasOwn(node, 'minItems')) return `${path}至少${node.minItems}项`;
  return `${path}只含${node.subsetOf.join('/')}`;
}

export function describe(node) {
  switch (kind(node)) {
    case 'all': return node.all.length ? node.all.map(describe).join(' 且 ') : '无条件';
    case 'any': return `(${node.any.map(describe).join(' 或 ')})`;
    case 'not': return `非(${describe(node.not)})`;
    case 'ref': return `「${node.ref}」`;
    case 'goal': return `goals含${node.goal}`;
    case 'execution': return `路线执行模式=${node.execution}`;
    case 'rule': return `命中规则${node.rule}`;
    case 'capability': return `需要能力${node.capability}`;
    default: return describeTest(node);
  }
}

// Human-readable reason why `node` did not evaluate to `expected`; points at the first deciding leaf when possible.
export function explain(node, ctx, expected = true) {
  const type = kind(node);
  if (type === 'not') return explain(node.not, ctx, !expected);
  if (type === 'ref') return `「${node.ref}」${explain(ctx.conditions[node.ref], ctx, expected)}`;
  if ((type === 'all' && expected) || (type === 'any' && !expected)) {
    return explain(node[type].find(child => evaluate(child, ctx) !== expected), ctx, expected);
  }
  if (type === 'all' || type === 'any') return `${expected ? '需满足其一' : '不应全部满足'}：${node[type].map(describe).join('；')}`;
  return `${expected ? '需要' : '需排除'}${describe(node)}`;
}

export function schemaAt(path) {
  let schema = briefSchema;
  for (const key of path.split('.')) {
    schema = schema?.type === 'object' && Object.hasOwn(schema.properties ?? {}, key) ? schema.properties[key] : undefined;
  }
  return schema;
}

function checkTest(node, where) {
  const path = pathOf(node), schema = typeof path === 'string' ? schemaAt(path) : undefined;
  invariant(schema, 'INVALID_CATALOG', `${where}: 字段 ${path} 不在brief格式中`);
  const tests = Object.keys(node).filter(key => TESTS.includes(key));
  invariant(tests.length === 1 && Object.keys(node).length === 2, 'INVALID_CATALOG', `${where}: 字段条件需要且只能有一个 ${TESTS.join('/')}`);
  const value = node[tests[0]], isArray = schema.type === 'array';
  const ok = {
    is: () => !isPlainObject(value) && !Array.isArray(value) && !validateSchema(value, schema).length,
    exists: () => typeof value === 'boolean',
    minItems: () => isArray && Number.isInteger(value) && value > 0,
    subsetOf: () => isArray && Array.isArray(value) && value.every(item => !validateSchema(item, schema.items ?? {}).length)
  }[tests[0]]();
  invariant(ok, 'INVALID_CATALOG', `${where}: ${path} 的 ${tests[0]} 取值与brief格式不符`);
}

// known: { conditions, executions, rules: Set, capabilities: Set }
export function checkCondition(node, scope, known, where) {
  invariant(isPlainObject(node), 'INVALID_CATALOG', `${where}: 条件必须是对象`);
  const type = kind(node);
  invariant(type, 'INVALID_CATALOG', `${where}: 未知条件 ${Object.keys(node).join(',')}`);
  if (type === 'all' || type === 'any') {
    invariant(Object.keys(node).length === 1 && Array.isArray(node[type]), 'INVALID_CATALOG', `${where}: ${type} 需要数组`);
    node[type].forEach((child, i) => checkCondition(child, scope, known, `${where}.${type}[${i}]`));
    return;
  }
  invariant(Object.keys(node).length === 1 || ['feature', 'field'].includes(type), 'INVALID_CATALOG', `${where}: ${type} 不接受其他键`);
  if (type === 'not') return checkCondition(node.not, scope, known, `${where}.not`);
  invariant(scope.includes(type), 'INVALID_CATALOG', `${where}: 此处不允许使用 ${type}`);
  if (type === 'feature' || type === 'field') return checkTest(node, where);
  const valid = {
    ref: () => Object.hasOwn(known.conditions, node.ref),
    goal: () => briefSchema.properties.goals.items.enum.includes(node.goal),
    execution: () => known.executions.includes(node.execution),
    rule: () => known.rules.has(node.rule),
    capability: () => known.capabilities.has(node.capability)
  }[type]();
  if (!valid) throw fail('INVALID_CATALOG', `${where}: 引用的${type} ${JSON.stringify(node[type])} 不存在`);
}

export function refsOf(node) {
  const type = kind(node);
  if (type === 'all' || type === 'any') return node[type].flatMap(refsOf);
  if (type === 'not') return refsOf(node.not);
  return type === 'ref' ? [node.ref] : [];
}
