/**
 * Workspace file-tree scanner.
 *
 * Design notes:
 * - Only relative POSIX-style paths leave this module; absolute paths stay here.
 * - Directories in SKIPPED_DIRECTORIES are never entered, so select-all can
 *   never reach node_modules or a build output.
 * - Binary/asset files are not returned at all; unknown-extension files are
 *   returned as `non-code` only when `includeNonCode` is on.
 */
import { readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { classify, SKIPPED_DIRECTORIES } from './languages.js'

const DEFAULT_MAX_FILES = 4000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

/**
 * Minimal .gitignore support: exact names, leading-slash anchors and `*`
 * wildcards are honoured; negation and `**` are not. Anything unsupported
 * simply fails to exclude, which is the safe direction for a formatter.
 */
async function readIgnoreRules(root) {
  const rules = []
  for (const name of ['.gitignore', '.dsh-code-pipeline-ignore']) {
    try {
      const text = await readFileText(join(root, name))
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        rules.push(line)
      }
    } catch {
      // Absent ignore file is normal.
    }
  }
  return rules
}

async function readFileText(path) {
  const { readFile } = await import('node:fs/promises')
  return readFile(path, 'utf8')
}

function matchesIgnore(rules, relPath, name, isDir) {
  for (const rule of rules) {
    const anchored = rule.startsWith('/')
    const body = anchored ? rule.slice(1) : rule
    const dirOnly = body.endsWith('/')
    const pattern = dirOnly ? body.slice(0, -1) : body
    if (dirOnly && !isDir) continue

    const regex = new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    )
    const target = anchored || pattern.includes('/') ? relPath : name
    if (regex.test(target)) return true
  }
  return false
}

/** Resolve a relative path, refusing anything that escapes the root. */
export function resolveInside(root, relPath) {
  const base = resolve(root)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(base + sep)) return null
  return target
}

/**
 * Walk a workspace and return { files, dirCount, truncated, root }.
 * `files` is flat; the panel builds the nested view from it.
 */
export async function scanTree(root, options = {}) {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const includeNonCode = options.includeNonCode ?? false
  const ignoreRules = await readIgnoreRules(root)

  const files = []
  let dirCount = 0
  let truncated = false

  async function walk(dirAbs, dirRel) {
    if (truncated) return
    let entries
    try {
      entries = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (truncated) return
      const relPath = dirRel ? `${dirRel}/${entry.name}` : entry.name
      const absPath = join(dirAbs, entry.name)

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue
        if (matchesIgnore(ignoreRules, relPath, entry.name, true)) continue
        dirCount += 1
        await walk(absPath, relPath)
        continue
      }
      if (!entry.isFile()) continue
      if (matchesIgnore(ignoreRules, relPath, entry.name, false)) continue

      const info = classify(relPath)
      if (info.kind === 'non-code' && !includeNonCode) continue

      let size = 0
      try {
        size = (await stat(absPath)).size
      } catch {
        continue
      }
      if (info.kind === 'code' && size > maxBytes) {
        files.push({
          path: relPath,
          name: entry.name,
          size,
          kind: 'code',
          supported: false,
          reason: 'too-large',
          display: null,
        })
        continue
      }

      if (files.length >= maxFiles) {
        truncated = true
        return
      }

      files.push({
        path: relPath,
        name: entry.name,
        size,
        kind: info.kind,
        supported: info.kind === 'code' && info.supported === true,
        language: info.language ?? null,
        preset: info.preset ?? null,
        display: info.display ?? null,
        reason: info.reason ?? null,
      })
    }
  }

  await walk(resolve(root), '')
  return { root: resolve(root), files, dirCount, truncated }
}

/** Group a flat file list into a nested tree for the panel. */
export function buildTree(files) {
  const rootNode = { name: '', path: '', type: 'dir', children: [] }
  const dirs = new Map([['', rootNode]])

  function ensureDir(dirPath) {
    const existing = dirs.get(dirPath)
    if (existing) return existing
    const index = dirPath.lastIndexOf('/')
    const parentPath = index === -1 ? '' : dirPath.slice(0, index)
    const parent = ensureDir(parentPath)
    const node = { name: dirPath.slice(index + 1), path: dirPath, type: 'dir', children: [] }
    parent.children.push(node)
    dirs.set(dirPath, node)
    return node
  }

  for (const file of files) {
    const index = file.path.lastIndexOf('/')
    const parentPath = index === -1 ? '' : file.path.slice(0, index)
    const parent = ensureDir(parentPath)
    parent.children.push({
      name: file.name,
      path: file.path,
      type: 'file',
      size: file.size,
      language: file.language ?? null,
      preset: file.preset ?? null,
      supported: file.supported,
      display: file.display ?? null,
      reason: file.reason ?? null,
    })
  }

  function sortNode(node) {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const child of node.children) if (child.type === 'dir') sortNode(child)
  }
  sortNode(rootNode)
  return rootNode.children
}
