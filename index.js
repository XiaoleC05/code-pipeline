/**
 * Host half of the code pipeline bundle.
 *
 * Responsibilities:
 * - serve the panel's HTTP API under /dsh-code-pipeline/api
 * - expose two agent tools: code_list_files and code_standardize
 *
 * All file access is confined to a workspace root resolved here, never to a
 * path the panel invents: every incoming relative path is re-checked by
 * resolveInside() before it is read or written.
 */
import { resolve } from 'node:path'
import { scanTree, buildTree } from './lib/tree.js'
import { listPresets, describePreset } from './lib/presets.js'
import { standardize } from './lib/standardize.js'
import { probeEngines } from './lib/engines/index.js'
import { P0_LANGUAGES } from './lib/languages.js'

const API_PREFIX = '/dsh-code-pipeline/api'

export const inject = ['tools', 'webServer']

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function textBlock(text) {
  return [{ type: 'text', text }]
}

/** Bounded body reader for the raw Node handler that owns POST /standardize. */
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        rejectPromise(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectPromise)
  })
}

function summarize(result) {
  const { stats } = result
  const lines = [
    `${result.mode === 'fix' ? 'Applied' : 'Checked'} ${stats.processed} file(s): ${stats.changed} changed, ${stats.unchanged} unchanged, ${stats.skipped} skipped, ${stats.failed} failed.`,
  ]
  if (result.mode === 'fix') lines.push(`Wrote ${stats.written} file(s) to disk.`)
  else if (stats.changed > 0) lines.push('Report-only run: no file was modified.')
  if (stats.degraded > 0) lines.push(`${stats.degraded} file(s) used the built-in text rules because a formatter engine was unavailable.`)
  if (stats.lintFindings > 0) {
    lines.push(`${stats.lintFindings} style finding(s) were reported but not applied: the engine classifies those fixes as unsafe.`)
    const sample = result.files
      .flatMap((file) => (file.findings ?? []).map((finding) => ({ path: file.path, ...finding })))
      .slice(0, 10)
    for (const finding of sample) lines.push(`  - ${finding.path}:${finding.line} ${finding.rule} — ${finding.message}`)
  }
  const changed = result.files.filter((f) => f.status === 'changed').slice(0, 20)
  if (changed.length > 0) {
    lines.push('', 'Files:')
    for (const file of changed) lines.push(`- ${file.path} (${file.language}, ${file.engine})`)
  }
  const failed = result.files.filter((f) => f.status === 'failed')
  if (failed.length > 0) {
    lines.push('', 'Failures:')
    for (const file of failed) lines.push(`- ${file.path}: ${file.reason}`)
  }
  if (result.skipped.length > 0) {
    const outside = result.skipped.filter((s) => s.reason === 'outside-p0')
    if (outside.length > 0) lines.push('', `Skipped ${outside.length} file(s) outside the P0 language list.`)
  }
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  const maxFiles = Number.isFinite(config.maxFiles) ? config.maxFiles : 4000
  const maxBytes = Number.isFinite(config.maxBytes) ? config.maxBytes : 2 * 1024 * 1024

  /** Registered workspaces, or the host default directory. */
  function listRoots() {
    const roots = []
    try {
      const registry = ctx.get('workspaceRegistry')
      if (registry && typeof registry.list === 'function') {
        for (const workspace of registry.list()) {
          const path = workspace?.path ?? workspace?.directory ?? workspace?.root
          if (typeof path === 'string' && path.length > 0) {
            roots.push({ path, title: workspace.title ?? path })
          }
        }
      }
    } catch {
      // Registry is optional; fall through to the default directory.
    }
    if (roots.length === 0) {
      try {
        const workingDirectory = ctx.get('workingDirectory')
        const fallback = workingDirectory?.defaultDirectory
        if (typeof fallback === 'string' && fallback.length > 0) roots.push({ path: fallback, title: fallback })
      } catch {
        // Ignore: no candidate root is reported as an empty list.
      }
    }
    return roots
  }

  function pickRoot(requested) {
    const roots = listRoots()
    if (typeof requested === 'string' && requested.length > 0) {
      const resolved = resolve(requested)
      if (roots.length === 0) return { root: resolved, roots }
      const match = roots.find((candidate) => resolve(candidate.path) === resolved)
      return match ? { root: match.path, roots } : { root: null, roots, error: 'root-not-registered' }
    }
    return { root: roots[0]?.path ?? null, roots }
  }

  async function stateFor(requestedRoot) {
    const { root, roots, error } = pickRoot(requestedRoot)
    const engines = await probeEngines()
    const base = {
      roots,
      presets: listPresets(),
      p0: P0_LANGUAGES.map((lang) => ({ id: lang.id, label: lang.label, preset: lang.preset })),
      engines,
      limits: { maxFiles, maxBytes },
    }
    if (!root) return { ...base, root: null, error: error ?? 'no-workspace', tree: [], files: [] }

    const scan = await scanTree(root, { maxFiles, maxBytes })
    return {
      ...base,
      root,
      truncated: scan.truncated,
      dirCount: scan.dirCount,
      tree: buildTree(scan.files),
      files: scan.files,
      selectable: scan.files.filter((file) => file.supported).map((file) => file.path),
    }
  }

  // ------------------------------------------------------------ routes

  // Resource routes answer GET/HEAD only, so the read endpoints and the writing
  // endpoint use distinct registration forms and distinct paths.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}/state`,
      resource: async (request) => {
        const url = new URL(request.url)
        try {
          return jsonResponse(await stateFor(url.searchParams.get('root')))
        } catch (cause) {
          return jsonResponse({ error: 'internal', message: cause instanceof Error ? cause.message : String(cause) }, 500)
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}/preset`,
      resource: async (request) => {
        const url = new URL(request.url)
        try {
          const preset = describePreset(url.searchParams.get('id'))
          return preset ? jsonResponse(preset) : jsonResponse({ error: 'unknown-preset' }, 404)
        } catch (cause) {
          return jsonResponse({ error: 'internal', message: cause instanceof Error ? cause.message : String(cause) }, 500)
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}/standardize`,
      handler: async (req, res) => {
        const send = (status, value) => {
          if (res.headersSent) return
          res.statusCode = status
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(value))
        }
        try {
          if (req.method !== 'POST') {
            res.setHeader('allow', 'POST')
            return send(405, { error: 'method-not-allowed' })
          }
          const raw = await readBody(req)
          let body = {}
          try {
            body = raw ? JSON.parse(raw) : {}
          } catch {
            return send(400, { error: 'bad-json' })
          }
          const { root, error } = pickRoot(body.root)
          if (!root) return send(400, { error: error ?? 'no-workspace' })
          if (!Array.isArray(body.paths) || body.paths.length === 0) return send(400, { error: 'no-paths' })
          const mode = body.mode === 'fix' ? 'fix' : 'report'
          const result = await standardize({ root, paths: body.paths, mode })
          return send(200, result)
        } catch (cause) {
          return send(500, { error: 'internal', message: cause instanceof Error ? cause.message : String(cause) })
        }
      },
    }),
  )

  // ------------------------------------------------------------- tools

  ctx.effect(() =>
    ctx.tools.register({
      name: 'code_list_files',
      description:
        'List the code files in the current workspace with their language and whether the P0 preset supports them. Use it before code_standardize to see what can be standardized.',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'Absolute workspace root. Defaults to the session working directory.' },
          onlySupported: { type: 'boolean', description: 'Return only files the P0 presets can standardize.', default: true },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', description: 'File inventory.' },
        render(_args, value) {
          const text = value && typeof value.text === 'string' ? value.text : 'no files'
          return textBlock(text)
        },
      },
      async execute(args, exec) {
        const requested = typeof args?.root === 'string' ? args.root : undefined
        const root = requested ?? (await resolveAgentRoot(ctx, exec))
        if (!root) return { text: 'No workspace directory is available for this session.' }
        const scan = await scanTree(root, { maxFiles, maxBytes })
        const onlySupported = args?.onlySupported !== false
        const files = onlySupported ? scan.files.filter((file) => file.supported) : scan.files
        const byLanguage = new Map()
        for (const file of files) {
          const key = file.supported ? file.language : `unsupported:${file.reason ?? 'other'}`
          byLanguage.set(key, (byLanguage.get(key) ?? 0) + 1)
        }
        const lines = [`Root: ${root}`, `Files: ${files.length}`, '']
        for (const [language, count] of [...byLanguage.entries()].sort()) lines.push(`- ${language}: ${count}`)
        lines.push('', 'Paths:')
        for (const file of files.slice(0, 300)) lines.push(`- ${file.path}`)
        if (files.length > 300) lines.push(`... ${files.length - 300} more`)
        return { text: lines.join('\n'), count: files.length }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'code_standardize',
      description:
        'Apply the built-in per-language style presets to code files. mode="report" only diffs, mode="fix" writes changes. Only the ten P0 languages have presets; other files are skipped and reported.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative file paths.' },
          all: { type: 'boolean', description: 'Standardize every P0 code file in the workspace.', default: false },
          mode: { type: 'string', enum: ['report', 'fix'], default: 'report' },
          root: { type: 'string', description: 'Absolute workspace root. Defaults to the session working directory.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', description: 'Standardization summary.' },
        render(_args, value) {
          const text = value && typeof value.text === 'string' ? value.text : 'done'
          return textBlock(text)
        },
      },
      async execute(args, exec) {
        const requested = typeof args?.root === 'string' ? args.root : undefined
        const root = requested ?? (await resolveAgentRoot(ctx, exec))
        if (!root) return { text: 'No workspace directory is available for this session.' }

        let paths = Array.isArray(args?.paths) ? args.paths.filter((p) => typeof p === 'string') : []
        if (args?.all === true || paths.length === 0) {
          const scan = await scanTree(root, { maxFiles, maxBytes })
          paths = scan.files.filter((file) => file.supported).map((file) => file.path)
        }
        if (paths.length === 0) return { text: 'No P0 code files were found to standardize.' }

        const mode = args?.mode === 'fix' ? 'fix' : 'report'
        const result = await standardize({ root, paths, mode })
        return { text: summarize(result), runId: result.runId, stats: result.stats }
      },
    }),
  )
}

async function resolveAgentRoot(ctx, exec) {
  try {
    const agent = exec?.agent
    const workingDirectory = ctx.get('workingDirectory')
    if (agent && workingDirectory && typeof workingDirectory.ensure === 'function') {
      return await workingDirectory.ensure(agent, exec.signal)
    }
    if (workingDirectory && typeof workingDirectory.defaultDirectory === 'string') {
      return workingDirectory.defaultDirectory
    }
  } catch {
    // Fall through to null; the caller reports it.
  }
  return null
}


