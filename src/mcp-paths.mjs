import { lstat, realpath, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, dirname, sep } from 'node:path';
import { fail, invariant } from './errors.mjs';

// MCP宿主传入的路径一律是相对于root的POSIX风格路径。这里在文件系统层面拒绝：绝对路径、盘符/UNC、反斜杠、NUL、"..",
// 以及任何符号链接（无论指向root内还是root外）。检查与实际写入之间无法完全消除竞态，因此root应是只有当前用户可写的目录。
const DRIVE = /^[A-Za-z]:/;

export function segmentsOf(value, label = '路径') {
  invariant(typeof value === 'string' && value.length > 0, 'INVALID_PATH', `${label}必须是非空字符串`);
  invariant(!value.includes('\0') && !value.includes('\\'), 'INVALID_PATH', `${label}含有不允许的字符（NUL或反斜杠）`);
  invariant(!isAbsolute(value) && !DRIVE.test(value) && !value.startsWith('~'), 'PATH_NOT_RELATIVE', `${label}必须是相对root的相对路径，不接受绝对路径`);
  const parts = value.split('/').filter(part => part !== '' && part !== '.');
  invariant(parts.length > 0, 'INVALID_PATH', `${label}不能指向root本身，请给出root下的子目录`);
  invariant(!parts.includes('..'), 'PATH_ESCAPES_ROOT', `${label}不能包含..`);
  return parts;
}

const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };

async function lstatOrNull(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// 逐级检查：存在的组件不能是符号链接。符号链接指向root之外报PATH_ESCAPES_ROOT，指向root之内也拒绝（PATH_SYMLINK）。
async function walk(root, parts, label) {
  let current = root, missingFrom = null;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const info = await lstatOrNull(current);
    if (!info) { missingFrom = index; break; }
    if (info.isSymbolicLink()) {
      const target = await realpath(current).catch(() => null);
      invariant(target && inside(root, target), 'PATH_ESCAPES_ROOT', `${label}经符号链接指向root之外，已拒绝`);
      throw fail('PATH_SYMLINK', `${label}包含符号链接，已拒绝`);
    }
    if (index < parts.length - 1) invariant(info.isDirectory(), 'INVALID_PATH', `${label}的上级不是目录`);
  }
  return missingFrom;
}

export async function createResolver(rootInput) {
  const root = await realpath(resolve(rootInput));
  invariant((await stat(root)).isDirectory(), 'INVALID_ROOT', 'root必须是目录');
  invariant(dirname(root) !== root, 'INVALID_ROOT', 'root不能是文件系统根目录');
  const finish = async (parts, label) => {
    const path = join(root, ...parts);
    const real = await realpath(await deepestExisting(path));
    invariant(real === root || inside(root, real), 'PATH_ESCAPES_ROOT', `${label}解析后位于root之外，已拒绝`);
    return path;
  };
  return {
    root,
    // 已存在的目录（工作区）
    async existing(value, label = '路径') {
      const parts = segmentsOf(value, label);
      const missing = await walk(root, parts, label);
      invariant(missing === null, 'PATH_NOT_FOUND', `${label}不存在：${parts.join('/')}`);
      return finish(parts, label);
    },
    // 将要新建的目录（init工作区、export输出）：已存在的上级必须在root内且不是符号链接
    async fresh(value, label = '路径') {
      const parts = segmentsOf(value, label);
      const missing = await walk(root, parts, label);
      invariant(missing !== null, 'TARGET_EXISTS', `${label}已存在，不覆盖：${parts.join('/')}`);
      return finish(parts, label);
    },
    relative: path => relative(root, path).split(sep).join('/')
  };
}

async function deepestExisting(path) {
  let current = path;
  while (!(await lstatOrNull(current))) current = dirname(current);
  return current;
}

// 导出目录与工作区互不包含，避免把交付包写进工作区或覆盖其上级。
export function assertDisjoint(a, b, message) {
  invariant(!inside(a, b) && !inside(b, a) && a !== b, 'PATH_OVERLAP', message);
}
