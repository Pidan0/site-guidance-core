export function fail(code, message, details) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}
export function invariant(condition, code, message, details) {
  if (!condition) throw fail(code, message, details);
}
