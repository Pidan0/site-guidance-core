#!/usr/bin/env node
import { StringDecoder } from 'node:string_decoder';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE_VERSION } from '../src/version.mjs';
import { createResolver } from '../src/mcp-paths.mjs';
import { listTools, runTool } from '../src/mcp-tools.mjs';

// 零依赖MCP服务：stdio，按行分隔的JSON-RPC 2.0。stdout只输出协议消息，日志一律写stderr。
// 协议依据 modelcontextprotocol.io 的 2026-07-28 修订（无状态，请求_meta携带版本与能力，server/discover）。
// 同时兼容基于initialize握手的旧版本（2025-11-25、2025-06-18、2025-03-26、2024-11-05），按客户端请求的版本回退。
const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CAPS_KEY = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO = { name: 'site-core', title: 'Site Guidance Core', version: ENGINE_VERSION };
const INSTRUCTIONS = '建站核心：intake/plan/answer/catalog做需求判断（纯计算）；workspace_*在受限root内本地建站、核对、回退、导出。'
  + '先向用户确认需求再plan，回答追问后用answer写回；review只记录用户提供的真实证据（自报）；不提供也不代替上传、部署、付款、DNS。';
const MAX_LINE = 16 * 1024 * 1024;

const log = (...parts) => process.stderr.write(`[site-core-mcp] ${parts.join(' ')}\n`);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });

class RpcError extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data; }
}

function toolText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function successResult(name, data) {
  const content = (name === 'plan' || name === 'answer') ? [{ type: 'text', text: data.markdown }, { type: 'text', text: toolText(data.plan) }] : [{ type: 'text', text: toolText(data) }];
  return { content, structuredContent: data, isError: false };
}
// 系统错误（fs）带errno/syscall；核心的fail错误只有code/message/details。
function failureResult(error) {
  const system = error?.errno !== undefined || error?.syscall !== undefined;
  const known = error && typeof error.code === 'string' && !system;
  if (!known && !system) log('内部错误', error?.stack ?? String(error));
  const code = known ? error.code : system ? 'IO_ERROR' : 'INTERNAL_ERROR';
  const message = known ? error.message : system ? `文件系统操作失败（${error.code ?? 'unknown'}）` : '内部错误，详情见服务stderr日志';
  const report = { error: code, message, ...(known && error.details ? { details: error.details } : {}) };
  return { content: [{ type: 'text', text: `错误 ${code}：${message}${report.details ? `\n${JSON.stringify(report.details, null, 2)}` : ''}` }], structuredContent: report, isError: true };
}

export function createServer({ resolver = null } = {}) {
  const hasRoot = Boolean(resolver);

  function initialize(params) {
    if (!isObject(params) || typeof params.protocolVersion !== 'string') throw new RpcError(-32602, 'initialize需要字符串protocolVersion');
    const requested = params.protocolVersion;
    // 客户端请求的版本我们支持就原样返回；否则返回服务端支持的最新旧版本，由客户端决定是否继续。
    const protocolVersion = LEGACY.includes(requested) ? requested : LEGACY[0];
    return { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS };
  }

  // 新版请求在_meta携带版本与能力；旧版（无该字段）不要求先initialize，宽松服务。
  function eraOf(params) {
    const meta = isObject(params) ? params._meta : undefined;
    if (!isObject(meta) || meta[VERSION_KEY] === undefined) return { modern: false };
    const version = meta[VERSION_KEY];
    if (typeof version !== 'string' || !MODERN.includes(version)) {
      throw new RpcError(-32022, 'Unsupported protocol version', { supported: MODERN, requested: version });
    }
    if (!isObject(meta[CAPS_KEY])) throw new RpcError(-32602, `新版请求的_meta缺少必填的${CAPS_KEY}`);
    return { modern: true };
  }

  async function callTool(params) {
    if (!isObject(params) || typeof params.name !== 'string' || !params.name) throw new RpcError(-32602, 'tools/call需要字符串name');
    if (params.arguments !== undefined && !isObject(params.arguments)) throw new RpcError(-32602, 'arguments必须是对象');
    if (!listTools(true).some(tool => tool.name === params.name)) throw new RpcError(-32602, `未知工具：${params.name}`);
    try {
      return successResult(params.name, await runTool(params.name, params.arguments ?? {}, resolver));
    } catch (error) { return failureResult(error); }
  }

  async function dispatch(method, params) {
    switch (method) {
      case 'initialize': return { result: initialize(params), legacyOnly: true };
      case 'ping': return { result: {} };
      case 'server/discover': {
        eraOf(params);
        return { result: { supportedVersions: MODERN, capabilities: { tools: {} }, instructions: INSTRUCTIONS }, modernOnly: true };
      }
      case 'tools/list': return { result: { tools: listTools(hasRoot) } };
      case 'tools/call': return { result: await callTool(params) };
      default: throw new RpcError(-32601, `方法不存在：${method}`);
    }
  }

  async function handleRequest(message) {
    const { id, method, params } = message;
    try {
      const era = method === 'initialize' ? { modern: false } : eraOf(params);
      const { result, modernOnly, legacyOnly } = await dispatch(method, params);
      const modern = era.modern || modernOnly;
      if (legacyOnly || !modern) return { jsonrpc: '2.0', id, result };
      return { jsonrpc: '2.0', id, result: { resultType: 'complete', ...result, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO } } };
    } catch (error) {
      if (error instanceof RpcError) return rpcError(id, error.code, error.message, error.data);
      log('请求处理异常', error?.stack ?? String(error));
      return rpcError(id, -32603, '内部错误');
    }
  }

  // 返回要写出的响应；通知与客户端响应返回undefined。
  async function handleMessage(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0') return rpcError(null, -32600, '无效请求：需要jsonrpc:"2.0"对象');
    if (typeof message.method !== 'string') {
      // 客户端对（本服务不会发出的）请求的响应：忽略。
      return Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error') ? undefined : rpcError(null, -32600, '无效请求：缺少method');
    }
    const hasId = Object.hasOwn(message, 'id');
    if (hasId && (message.id === null || !['string', 'number'].includes(typeof message.id))) return rpcError(null, -32600, '无效请求：id必须是字符串或整数');
    if (message.params !== undefined && !isObject(message.params)) return hasId ? rpcError(message.id, -32602, 'params必须是对象') : undefined;
    if (!hasId) {
      if (!message.method.startsWith('notifications/')) log('忽略未知通知', message.method);
      return undefined;
    }
    return handleRequest(message);
  }

  async function handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return rpcError(null, -32700, '解析错误：不是合法的JSON'); }
    if (Array.isArray(message)) {
      if (message.length === 0) return rpcError(null, -32600, '无效请求：空批量');
      const replies = (await Promise.all(message.map(handleMessage))).filter(Boolean);
      return replies.length ? replies : undefined;
    }
    return handleMessage(message);
  }

  return { handleLine };
}

function parseArgs(argv, env) {
  const options = { root: env.SITE_CORE_ROOT || undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--root需要目录参数');
      options.root = argv[++i];
    } else if (argv[i].startsWith('--root=')) options.root = argv[i].slice(7);
    else if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--version' || argv[i] === '-v') options.version = true;
    else throw new Error(`未知参数：${argv[i]}`);
  }
  return options;
}

const HELP = `site-core-mcp ${ENGINE_VERSION}（MCP stdio服务）

用法：node bin/site-core-mcp.mjs [--root <目录>]
  --root <目录>   工作区根目录；也可用环境变量 SITE_CORE_ROOT。工作区工具只在该目录内读写。
                  未配置时只提供 intake/plan/answer/catalog。
`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try { options = parseArgs(argv, env); } catch (error) { log(error.message); process.stderr.write(HELP); return 2; }
  if (options.help) { process.stdout.write(HELP); return 0; }
  if (options.version) { process.stdout.write(`${ENGINE_VERSION}\n`); return 0; }
  let resolver = null;
  if (options.root) {
    try { resolver = await createResolver(options.root); } catch (error) { log(`root不可用：${error.message ?? error}`); return 1; }
  }
  log(`启动 ${ENGINE_VERSION}，root=${resolver ? resolver.root : '未配置（仅需求判断工具）'}`);
  const server = createServer({ resolver });
  const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  process.stdout.on('error', () => process.exit(0));
  const decoder = new StringDecoder('utf8');
  let buffer = '', skipping = false, queue = Promise.resolve();
  const enqueue = line => {
    if (!line.trim()) return;
    queue = queue.then(async () => { const reply = await server.handleLine(line); if (reply) write(reply); })
      .catch(error => log('处理失败', error?.stack ?? String(error)));
  };
  const feed = chunk => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
      if (skipping) skipping = false; else enqueue(line);
    }
    if (buffer.length > MAX_LINE) { // 超长行：丢弃到下一个换行
      buffer = ''; if (!skipping) { skipping = true; write(rpcError(null, -32700, '消息过长，已丢弃')); }
    }
  };
  process.stdin.on('data', chunk => feed(decoder.write(chunk)));
  await new Promise(done => process.stdin.on('end', done));
  feed(decoder.end()); if (buffer && !skipping) enqueue(buffer);
  await queue;
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main().then(code => { process.exitCode = code; }, error => { log('致命错误', error?.stack ?? String(error)); process.exitCode = 1; });
