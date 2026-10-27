import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, symlink, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { temporary, example, content } from './helpers.mjs';

const server = fileURLToPath(new URL('../bin/site-core-mcp.mjs', import.meta.url));

// 最小MCP客户端：spawn真实子进程，逐行收发JSON-RPC，并断言stdout每一行都是合法JSON-RPC消息。
function start(t, args = [], env = {}) {
  const child = spawn(process.execPath, [server, ...args], { env: { ...process.env, SITE_CORE_ROOT: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [], waiting = new Map(), stderr = [];
  let buffer = '', nextId = 1;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => stderr.push(chunk));
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const text = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      const messages = [].concat(JSON.parse(text)); // 任何非JSON行都会在此抛错使测试失败
      lines.push(text);
      for (const message of messages) { assert.equal(message.jsonrpc, '2.0'); waiting.get(message.id)?.(message); }
    }
  });
  t.after(() => child.kill());
  const raw = text => child.stdin.write(`${text}\n`);
  const request = (method, params, id = nextId++) => new Promise(resolve => { waiting.set(id, resolve); raw(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })); });
  const call = async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result;
  const exited = new Promise(resolve => child.on('close', (code) => resolve(code)));
  return { child, lines, stderr, raw, request, call, exited, notify: (method, params) => raw(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })) };
}
async function handshake(client, protocolVersion = '2025-11-25') {
  const reply = await client.request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  client.notify('notifications/initialized');
  return reply;
}
const textOf = result => result.content.map(item => item.text).join('\n');
const errorCode = result => { assert.equal(result.isError, true); return result.structuredContent.error; };

test('initialize协商版本、声明tools能力、serverInfo取自ENGINE_VERSION', async t => {
  const { ENGINE_VERSION } = await import('../src/version.mjs');
  const client = start(t), reply = await handshake(client);
  assert.equal(reply.result.protocolVersion, '2025-11-25');
  assert.deepEqual(Object.keys(reply.result.capabilities), ['tools']);
  assert.equal(reply.result.serverInfo.name, 'site-core'); assert.equal(reply.result.serverInfo.version, ENGINE_VERSION);
  assert.deepEqual((await client.request('ping')).result, {});
});

test('版本回退：客户端请求的旧版本原样返回，未知版本返回服务端最新旧版本', async t => {
  const old = start(t); assert.equal((await handshake(old, '2024-11-05')).result.protocolVersion, '2024-11-05');
  const middle = start(t); assert.equal((await handshake(middle, '2025-06-18')).result.protocolVersion, '2025-06-18');
  const future = start(t); assert.equal((await handshake(future, '2099-01-01')).result.protocolVersion, '2025-11-25');
  const bad = start(t); assert.equal((await bad.request('initialize', { capabilities: {} })).error.code, -32602);
});

test('新版无握手：server/discover、per-request _meta、不支持的版本返回-32022', async t => {
  const client = start(t), V = 'io.modelcontextprotocol/protocolVersion', C = 'io.modelcontextprotocol/clientCapabilities';
  const found = (await client.request('server/discover', { _meta: { [V]: '2026-07-28', [C]: {} } })).result;
  assert.equal(found.resultType, 'complete'); assert.deepEqual(found.supportedVersions, ['2026-07-28']);
  assert.equal(found._meta['io.modelcontextprotocol/serverInfo'].name, 'site-core'); assert.ok(found.capabilities.tools);
  const listed = (await client.request('tools/list', { _meta: { [V]: '2026-07-28', [C]: {} } })).result;
  assert.equal(listed.resultType, 'complete'); assert.ok(listed.tools.length > 0);
  const unsupported = (await client.request('tools/list', { _meta: { [V]: '1900-01-01', [C]: {} } })).error;
  assert.equal(unsupported.code, -32022); assert.equal(unsupported.data.requested, '1900-01-01'); assert.deepEqual(unsupported.data.supported, ['2026-07-28']);
  assert.equal((await client.request('tools/list', { _meta: { [V]: '2026-07-28' } })).error.code, -32602);
});

test('未配置root：只列出判断类工具，工作区工具调用返回ROOT_NOT_CONFIGURED', async t => {
  const client = start(t); await handshake(client);
  const names = (await client.request('tools/list')).result.tools.map(tool => tool.name);
  assert.deepEqual(names, ['intake', 'plan', 'answer', 'catalog']);
  assert.equal(errorCode(await client.call('workspace_init', { workspace: 'a', brief: {} })), 'ROOT_NOT_CONFIGURED');
});

test('tools/list：全部工具有schema、中文描述、annotations，且没有上传/部署/付款/DNS类工具', async t => {
  const root = await temporary(t), client = start(t, ['--root', root]); await handshake(client);
  const tools = (await client.request('tools/list')).result.tools;
  assert.deepEqual(tools.map(tool => tool.name), ['intake', 'plan', 'answer', 'catalog', 'workspace_init', 'workspace_build', 'workspace_update',
    'workspace_check', 'workspace_rollback', 'workspace_review', 'workspace_export']);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object'); assert.match(tool.description, /[\u4e00-\u9fff]/);
    for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) assert.equal(typeof tool.annotations[key], 'boolean', `${tool.name}.${key}`);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.doesNotMatch(tool.name, /upload|deploy|publish|pay|dns|domain/i);
  }
  const by = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  assert.equal(by.plan.annotations.readOnlyHint, true); assert.equal(by.workspace_check.annotations.readOnlyHint, true);
  assert.equal(by.workspace_update.annotations.destructiveHint, true); assert.equal(by.workspace_rollback.annotations.destructiveHint, true);
  assert.match(by.workspace_review.description, /用户提供的真实/); assert.match(by.workspace_review.description, /selfReported/);
  assert.match(by.workspace_export.description, /published:false/);
});

test('intake / plan / answer / catalog 返回核心判断与Markdown', async t => {
  const client = start(t); await handshake(client);
  const hints = await client.call('intake', { text: '我想做一个卖门票的网站' });
  assert.ok(hints.structuredContent.hints.length > 0); assert.ok(hints.structuredContent.hints.every(hint => hint.confirmed === false));
  const planned = await client.call('plan', { brief: await example('commerce') });
  assert.equal(planned.isError, false);
  assert.equal(planned.structuredContent.plan.route.id, 'managed-commerce'); assert.match(planned.content[0].text, /判断依据/);
  assert.equal(JSON.parse(planned.content[1].text).route.id, 'managed-commerce');
  const unknown = JSON.parse(await readFile(new URL('../examples/unknown.brief.json', import.meta.url), 'utf8'));
  const answers = JSON.parse(await readFile(new URL('../examples/unknown.answers.json', import.meta.url), 'utf8'));
  const answered = (await client.call('answer', { brief: unknown, answers })).structuredContent;
  assert.ok(answered.applied.length >= 2); assert.deepEqual(unknown.goals, []); assert.ok(answered.brief.goals.includes('brand')); assert.ok(answered.markdown);
  const catalog = (await client.call('catalog')).structuredContent;
  assert.equal(catalog.routes.length, 13); assert.ok(catalog.capabilities.some(item => item.id === 'revisions' && item.status === 'implemented'));
});

test('核心fail错误以isError返回：错误码、信息、details', async t => {
  const client = start(t); await handshake(client);
  const result = await client.call('plan', { brief: { schemaVersion: 1 } });
  assert.equal(errorCode(result), 'INVALID_BRIEF'); assert.ok(result.structuredContent.message); assert.match(textOf(result), /INVALID_BRIEF/);
  assert.equal(errorCode(await client.call('plan', {})), 'INVALID_ARGUMENTS');
  assert.equal(errorCode(await client.call('plan', { brief: {}, extra: 1 })), 'INVALID_ARGUMENTS');
  assert.equal(errorCode(await client.call('workspace_review', { workspace: 'a', check: 'x', status: 'pass', note: 'n' })), 'INVALID_ARGUMENTS');
});

test('root内 init→build→check→update→build→review→export 全流程，回执保持published:false', async t => {
  const root = await temporary(t), client = start(t, ['--root', root]); await handshake(client);
  const init = await client.call('workspace_init', { workspace: 'customer', brief: await example('b2b'), site: await content() });
  assert.equal(init.isError, false); assert.equal(init.structuredContent.workspace, 'customer'); assert.equal(init.structuredContent.built, false);
  assert.ok((await readdir(join(root, 'customer'))).includes('project.json'));
  assert.equal(errorCode(await client.call('workspace_init', { workspace: 'customer', brief: await example('b2b') })), 'TARGET_EXISTS');
  const built = (await client.call('workspace_build', { workspace: 'customer' })).structuredContent;
  assert.equal(built.published, false); assert.equal(built.checks.passed, true);
  const checked = await client.call('workspace_check', { workspace: 'customer' });
  assert.equal(checked.isError, false); assert.equal(checked.structuredContent.published, false);
  const patch = JSON.parse(await readFile(new URL('../examples/patch-summary.json', import.meta.url), 'utf8'));
  assert.equal((await client.call('workspace_update', { workspace: 'customer', patch })).isError, false);
  assert.equal(errorCode(await client.call('workspace_export', { workspace: 'customer', out: 'handoff' })), 'UNBUILT_CHANGES');
  const second = (await client.call('workspace_build', { workspace: 'customer' })).structuredContent;
  assert.notEqual(second.revision, built.revision);
  const review = (await client.call('workspace_review', { workspace: 'customer', check: 'content', status: 'pass', note: '用户提供：测试用核对记录' })).structuredContent;
  assert.equal(review.selfReported, true); assert.equal(review.published, false);
  const exported = await client.call('workspace_export', { workspace: 'customer', out: 'handoff' });
  assert.equal(exported.isError, false); assert.equal(exported.structuredContent.published, false); assert.equal(exported.structuredContent.preparedForPublication, false);
  assert.equal(exported.structuredContent.destination, 'handoff');
  assert.ok((await readdir(join(root, 'handoff'))).includes('receipt.json'));
  assert.equal(errorCode(await client.call('workspace_export', { workspace: 'customer', out: 'handoff' })), 'TARGET_EXISTS');
  assert.equal(errorCode(await client.call('workspace_export', { workspace: 'customer', out: 'public', forPublication: true })), 'PLACEHOLDER_DOMAIN');
  assert.equal((await readdir(root)).includes('public'), false);
  assert.equal(errorCode(await client.call('workspace_rollback', { workspace: 'customer', revision: 'r-nope' })), 'INVALID_REVISION');
  const back = (await client.call('workspace_rollback', { workspace: 'customer', revision: built.revision })).structuredContent;
  assert.equal(back.restored, true); assert.equal(back.published, false);
});

test('路径越界被拒：.. / 绝对路径 / 反斜杠 / 符号链接逃逸 / 输出与工作区重叠', async t => {
  const base = await temporary(t), root = join(base, 'root'), outside = join(base, 'outside');
  await mkdir(root); await mkdir(outside);
  await symlink(outside, join(root, 'escape')); await mkdir(join(root, 'real')); await symlink(join(root, 'real'), join(root, 'inner-link'));
  const client = start(t, ['--root', root]); await handshake(client);
  const brief = await example('b2b');
  const init = path => client.call('workspace_init', { workspace: path, brief });
  assert.equal(errorCode(await init('../x')), 'PATH_ESCAPES_ROOT');
  assert.equal(errorCode(await init('a/../../x')), 'PATH_ESCAPES_ROOT');
  assert.equal(errorCode(await init(join(outside, 'abs'))), 'PATH_NOT_RELATIVE');
  assert.equal(errorCode(await init('/tmp/abs')), 'PATH_NOT_RELATIVE');
  assert.equal(errorCode(await init('C:/abs')), 'PATH_NOT_RELATIVE');
  assert.equal(errorCode(await init('a\\b')), 'INVALID_PATH');
  assert.equal(errorCode(await init('.')), 'INVALID_PATH');
  assert.equal(errorCode(await init('escape/new')), 'PATH_ESCAPES_ROOT');
  assert.equal(errorCode(await init('inner-link/new')), 'PATH_SYMLINK');
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(join(root, 'real')), []);
  assert.equal(errorCode(await client.call('workspace_check', { workspace: 'escape' })), 'PATH_ESCAPES_ROOT');
  assert.equal(errorCode(await client.call('workspace_build', { workspace: '/etc' })), 'PATH_NOT_RELATIVE');
  assert.equal(errorCode(await client.call('workspace_build', { workspace: 'missing' })), 'PATH_NOT_FOUND');
  assert.equal((await init('ws')).isError, false);
  for (const out of ['../leak', '/tmp/leak', 'escape/leak', 'ws/inside']) {
    assert.equal(errorCode(await client.call('workspace_export', { workspace: 'ws', out })).startsWith('PATH_'), true, out);
  }
  assert.deepEqual(await readdir(outside), []);
});

test('未知方法-32601、畸形JSON-32700、参数错误-32602、无效请求-32600，通知不回复', async t => {
  const client = start(t); await handshake(client);
  assert.equal((await client.request('resources/list')).error.code, -32601);
  assert.equal((await client.request('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
  assert.equal((await client.request('tools/call', { arguments: {} })).error.code, -32602);
  assert.equal((await client.request('tools/call', { name: 'plan', arguments: [] })).error.code, -32602);
  const parse = new Promise(resolve => client.child.stdout.once('data', chunk => resolve(JSON.parse(String(chunk)))));
  client.raw('{"jsonrpc":"2.0","id":9,"method":'); const reply = await parse;
  assert.equal(reply.error.code, -32700); assert.equal(reply.id, null);
  assert.equal((await client.request('ping', undefined, 'string-id')).id, 'string-id');
  const bad = new Promise(resolve => client.child.stdout.once('data', chunk => resolve(JSON.parse(String(chunk)))));
  client.raw('{"id":1,"method":"ping"}'); assert.equal((await bad).error.code, -32600);
  const before = client.lines.length;
  client.notify('notifications/initialized'); client.notify('notifications/unknown-thing');
  assert.equal((await client.request('ping')).jsonrpc, '2.0'); assert.equal(client.lines.length, before + 1);
});

test('批量请求按数组应答；stdout只有协议消息，stdin关闭后进程正常退出', async t => {
  const client = start(t); await handshake(client);
  const batch = new Promise(resolve => client.child.stdout.once('data', chunk => resolve(JSON.parse(String(chunk)))));
  client.raw(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'x' }]));
  const replies = await batch; assert.equal(replies.length, 2); assert.equal(replies[1].error.code, -32601);
  assert.ok(client.stderr.join('').includes('[site-core-mcp] 启动'));
  assert.ok(client.lines.every(line => { JSON.parse(line); return true; }));
  client.child.stdin.end(); assert.equal(await client.exited, 0);
});

test('启动参数：SITE_CORE_ROOT环境变量、不存在的root拒绝启动、未知参数退出码2', async t => {
  const root = await temporary(t), viaEnv = start(t, [], { SITE_CORE_ROOT: root }); await handshake(viaEnv);
  assert.equal((await viaEnv.request('tools/list')).result.tools.length, 11);
  const missing = start(t, ['--root', join(root, 'nope')]); assert.equal(await missing.exited, 1);
  const unknown = start(t, ['--bogus']); assert.equal(await unknown.exited, 2);
});
