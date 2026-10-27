import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/site-core.mjs', import.meta.url));
test('真实CLI进程可以启动并返回能力目录', () => {
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'catalog'], { encoding: 'utf8' }));
  assert.equal(result.routes.length, 13); assert.ok(result.capabilities.find(c => c.id === 'revisions' && c.status === 'implemented'));
});
test('真实CLI进程失败返回非零退出码和结构化错误', () => {
  const result = spawnSync(process.execPath, [cli, 'build'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).error, 'INVALID_ARGUMENTS');
});
