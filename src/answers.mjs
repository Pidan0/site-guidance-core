import { fail, invariant } from './errors.mjs';
import { rules } from './catalog.mjs';
import { planSite } from './planner.mjs';
import { validateBrief } from './schema.mjs';
import { isPlainObject, mergePatch, patchAt } from './patch.mjs';

const knownQuestions = new Set(rules.questions.map(q => q.id));

// answer forms: 'optionId' | { option: 'optionId', value? } | { value } | bare custom value (non-option string, array, ...)
function resolveAnswer(question, answer) {
  const wrapped = isPlainObject(answer);
  if (wrapped) {
    const extra = Object.keys(answer).filter(key => !['option', 'value'].includes(key));
    invariant(!extra.length && (Object.hasOwn(answer, 'option') || Object.hasOwn(answer, 'value')), 'INVALID_ANSWER', `${question.id} 的回答只接受option和value`);
  }
  const optionId = wrapped ? answer.option : typeof answer === 'string' ? answer : undefined;
  const option = optionId === undefined ? undefined : question.options.find(o => o.id === optionId);
  if (option) {
    if (!option.input) return { patch: option.patch, record: { question: question.id, option: option.id } };
    invariant(wrapped && Object.hasOwn(answer, 'value'), 'INVALID_ANSWER', `${question.id}.${option.id} 需要value：${option.input.label}`);
    const patch = mergePatch(option.patch, patchAt(option.input.field, answer.value));
    return { patch, record: { question: question.id, option: option.id, value: answer.value } };
  }
  const ids = question.options.map(o => o.id).join('/');
  if (wrapped && Object.hasOwn(answer, 'option')) throw fail('INVALID_ANSWER', `${question.id} 没有选项 ${answer.option}，可选：${ids}`);
  invariant(question.custom, 'INVALID_ANSWER', `${question.id} 只能选择：${ids}`);
  const value = wrapped ? answer.value : answer;
  return { patch: patchAt(question.field, value), record: { question: question.id, value } };
}

// Applies answers to the questions the current plan asks, re-plans, and repeats while newly asked questions
// have answers. Answers to known questions that never get asked are returned in `unused`, not applied.
export function answerQuestions(input, answers) {
  invariant(isPlainObject(answers), 'INVALID_ANSWER', 'answers必须是以问题ID为键的对象');
  for (const id of Object.keys(answers)) invariant(knownQuestions.has(id), 'INVALID_ANSWER', `未知问题：${id}`);
  let brief = validateBrief(input), plan = planSite(brief);
  const pending = new Set(Object.keys(answers)), applied = [];
  for (let asked = plan.questions.filter(q => pending.has(q.id)); asked.length; asked = plan.questions.filter(q => pending.has(q.id))) {
    for (const question of asked) {
      const { patch, record } = resolveAnswer(question, answers[question.id]);
      brief = mergePatch(brief, patch); applied.push(record); pending.delete(question.id);
    }
    brief = validateBrief(brief); plan = planSite(brief);
  }
  return { brief, plan, applied, unused: [...pending] };
}
