import { readFileSync } from 'node:fs';
import { invariant } from './errors.mjs';
import { briefSchema, validateSchema } from './schema.mjs';
import { isPlainObject } from './patch.mjs';
import { SCOPES, checkCondition, refsOf, schemaAt } from './rules.mjs';
import { playbooks, validatePlaybooks } from './playbooks.mjs';
import { CONTRACT_KINDS, loadContract } from './contracts.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../knowledge/${name}.json`, import.meta.url), 'utf8'));
export const capabilities = read('capabilities').capabilities;
export const routes = read('routes').routes;
export const rules = read('rules');

const STATUSES = ['implemented', 'integration_required', 'manual_verification', 'planned'];
const EXECUTIONS = ['local', 'guided', 'discovery'];
const ALWAYS = { all: [] };
const check = (condition, code, message) => invariant(condition, 'INVALID_CATALOG', `${code}: ${message}`);
const text = value => typeof value === 'string' && value.trim().length > 0;

function uniqueIds(list, label) {
  check(Array.isArray(list) && list.every(item => text(item?.id)), label, '条目需要id');
  check(new Set(list.map(x => x.id)).size === list.length, label, '重复的知识条目ID');
}

function checkCapabilityIds(ids, known, where) {
  check(Array.isArray(ids), where, '能力列表必须是数组');
  for (const id of ids) check(known.capabilities.has(id), where, `能力 ${id} 不存在`);
}

function checkRoutes(list, known) {
  uniqueIds(list, 'routes');
  for (const route of list) {
    check(EXECUTIONS.includes(route.execution), route.id, '执行模式无效');
    check(route.override === undefined || typeof route.override === 'boolean', route.id, 'override必须是布尔值');
    check(Array.isArray(route.when) && route.when.length, route.id, '需要有序的when规则');
    for (const rule of route.when) {
      check(text(rule.id) && rule.id.startsWith(`${route.id}.`), route.id, `规则ID需以"${route.id}."开头`);
      check(text(rule.reason), rule.id, '需要reason');
      checkCondition(rule.if, SCOPES.brief, known, `${rule.id}.if`);
      if (rule.capabilities !== undefined) checkCapabilityIds(rule.capabilities, known, rule.id);
    }
  }
  const fallback = list.filter(r => !r.override).at(-1)?.when.at(-1);
  check(JSON.stringify(fallback?.if) === JSON.stringify(ALWAYS), 'routes', '最后一条基础路线必须以{"all":[]}兜底');
}

function checkConditionGraph(conditions, known) {
  check(isPlainObject(conditions), 'conditions', '必须是对象');
  for (const [name, node] of Object.entries(conditions)) checkCondition(node, SCOPES.brief, known, `conditions.${name}`);
  const visit = (name, stack) => {
    check(!stack.includes(name), 'conditions', `循环引用 ${[...stack, name].join(' -> ')}`);
    for (const ref of refsOf(conditions[name])) visit(ref, [...stack, name]);
  };
  for (const name of Object.keys(conditions)) visit(name, []);
}

// Checks only the keys a patch touches; every value must satisfy the brief schema at that path.
function checkPatch(patch, schema, where) {
  check(isPlainObject(patch), where, 'patch必须是对象');
  for (const [key, value] of Object.entries(patch)) {
    const sub = schema.properties?.[key];
    check(sub && Object.hasOwn(schema.properties, key), where, `${key} 不在brief格式中`);
    if (isPlainObject(value) && sub.type === 'object') checkPatch(value, sub, `${where}.${key}`);
    else check(!validateSchema(value, sub).length, where, `${key} 的取值与brief格式不符`);
  }
}

function checkQuestion(question, known) {
  const where = `questions.${question.id}`;
  check(text(question.question) && schemaAt(question.field ?? ''), where, '需要question文本和brief中存在的field');
  check(question.custom === undefined || typeof question.custom === 'boolean', where, 'custom必须是布尔值');
  checkCondition(question.if, SCOPES.post, known, `${where}.if`);
  uniqueIds(question.options, `${where}.options`);
  const goals = briefSchema.properties.goals.items.enum;
  for (const option of question.options) {
    check(text(option.label), `${where}.${option.id}`, '需要label');
    checkPatch(option.patch, briefSchema, `${where}.${option.id}.patch`);
    if (option.input !== undefined) check(text(option.input.label) && schemaAt(option.input.field ?? ''), `${where}.${option.id}`, 'input需要label和有效field');
    if (option.goals !== undefined) {
      const { add = [], remove = [] } = option.goals;
      check([...add, ...remove].every(goal => goals.includes(goal)), `${where}.${option.id}`, 'goals变换引用了未知目标');
    }
  }
}

function checkRules(set, known) {
  checkConditionGraph(set.conditions, known);
  checkCapabilityIds(set.baseCapabilities, known, 'baseCapabilities');
  for (const section of ['capabilities', 'questions', 'conflicts', 'warnings']) uniqueIds(set[section], section);
  for (const rule of set.capabilities) {
    checkCondition(rule.if, SCOPES.capabilities, known, `capabilities.${rule.id}.if`);
    checkCapabilityIds(rule.add, known, `capabilities.${rule.id}`);
  }
  for (const question of set.questions) checkQuestion(question, known);
  for (const conflict of set.conflicts) {
    check(text(conflict.message) && text(conflict.action), `conflicts.${conflict.id}`, '需要message和action');
    checkCondition(conflict.if, SCOPES.post, known, `conflicts.${conflict.id}.if`);
  }
  for (const warning of set.warnings) {
    check(text(warning.text), `warnings.${warning.id}`, '需要text');
    checkCondition(warning.if, SCOPES.post, known, `warnings.${warning.id}.if`);
  }
}

// A capability's contract field must point at the contract file of the same kind; having a contract never changes its status.
function checkContracts(list) {
  for (const item of list.filter(c => c.contract !== undefined)) {
    const kind = CONTRACT_KINDS.find(k => item.contract === `adapters/contracts/${k}.contract.json`);
    check(kind === item.id, item.id, `contract需指向adapters/contracts/${item.id}.contract.json`);
    check(loadContract(kind).capability === item.id, item.id, '契约的capability与能力ID不一致');
  }
}

// Pass a partial catalog to validate a candidate change; omitted parts use the loaded knowledge files.
export function validateCatalog(catalog = {}) {
  const set = { capabilities, routes, rules, playbooks, ...catalog };
  uniqueIds(set.capabilities, 'capabilities');
  for (const item of set.capabilities) check(STATUSES.includes(item.status), item.id, '能力状态无效');
  const known = {
    conditions: set.rules.conditions ?? {}, executions: EXECUTIONS, capabilities: new Set(set.capabilities.map(c => c.id)),
    rules: new Set((Array.isArray(set.routes) ? set.routes : []).flatMap(r => (Array.isArray(r.when) ? r.when.map(w => w.id) : [])))
  };
  checkRoutes(set.routes, known);
  checkRules(set.rules, known);
  checkContracts(set.capabilities);
  const lookup = { routes: new Map(set.routes.map(r => [r.id, r])), capabilities: new Map(set.capabilities.map(c => [c.id, c])) };
  const playbookCount = validatePlaybooks(set.playbooks, lookup);
  const ruleCount = set.routes.reduce((sum, r) => sum + r.when.length, 0);
  return {
    capabilities: set.capabilities.length, routes: set.routes.length, routeRules: ruleCount, questions: set.rules.questions.length,
    playbooks: playbookCount
  };
}
validateCatalog();
