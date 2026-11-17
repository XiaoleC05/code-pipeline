/**
 * Standardization orchestrator.
 *
 * Contract: `mode: 'report'` never writes; `mode: 'fix'` writes only files whose
 * content actually changed and that pass the idempotency gate (a second engine
 * run must be a no-op). A file failing the gate is reported, not written.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { classify } from './languages.js'
import { getPreset } from './presets.js'
import { resolveInside } from './tree.js'
import { runEngine } from './engines/index.js'

const CONCURRENCY = 4

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  for (const byte of sample) if (byte === 0) return true
  return false
}

function decode(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), bom: true }
  }
  return { text: buffer.toString('utf8'), bom: false }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function runner() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return results
}

/**
 * @param {object} input
 * @param {string} input.root        absolute workspace root
 * @param {string[]} input.paths     relative paths chosen in the panel
 * @param {'report'|'fix'} input.mode
 */
export async function standardize({ root, paths, mode = 'report' }) {
  const started = Date.now()
  const selected = Array.isArray(paths) ? [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))] : []
  const outcomes = []
  const skipped = []

  const work = []
  for (const relPath of selected) {
    const info = classify(relPath)
    if (info.kind !== 'code') {
      skipped.push({ path: relPath, reason: 'not-code', display: null })
      continue
    }
    if (info.supported !== true) {
      skipped.push({ path: relPath, reason: 'outside-p0', display: info.display ?? null })
      continue
    }
    const preset = getPreset(info.preset)
    if (!preset) {
      skipped.push({ path: relPath, reason: 'missing-preset', display: info.language })
      continue
    }
    work.push({ relPath, info, preset })
  }

  const processed = await mapLimit(work, CONCURRENCY, async ({ relPath, info, preset }) => {
    const absPath = resolveInside(root, relPath)
    if (!absPath) {
      return { path: relPath, status: 'failed', reason: 'path-escape' }
    }
    let buffer
    try {
      buffer = await readFile(absPath)
    } catch {
      return { path: relPath, status: 'failed', reason: 'unreadable' }
    }
    if (looksBinary(buffer)) {
      return { path: relPath, status: 'skipped', reason: 'binary-content' }
    }
    const { text: before, bom } = decode(buffer)

    const first = await runEngine(preset, { path: relPath, content: before })
    if (typeof first.content !== 'string') {
      return { path: relPath, status: 'failed', reason: 'engine-error' }
    }

    // Idempotency gate: the engine must be a fixed point on its own output.
    const second = await runEngine(preset, { path: relPath, content: first.content })
    if (typeof second.content !== 'string' || second.content !== first.content) {
      return {
        path: relPath,
        status: 'failed',
        reason: 'not-idempotent',
        language: info.language,
        preset: preset.id,
      }
    }

    const after = bom ? `\uFEFF${first.content}` : first.content
    const changed = after !== (bom ? `\uFEFF${before}` : before)

    if (mode === 'fix' && changed) {
      try {
        await writeFile(absPath, after, 'utf8')
      } catch {
        return { path: relPath, status: 'failed', reason: 'unwritable', language: info.language, preset: preset.id }
      }
    }

    return {
      path: relPath,
      status: changed ? 'changed' : 'unchanged',
      changed,
      written: mode === 'fix' && changed,
      language: info.language,
      preset: preset.id,
      engine: first.engine,
      depth: first.depth,
      degraded: first.degraded === true,
      findings: first.findings ?? [],
      findingCount: (first.findings ?? []).length,
      before,
      after,
      deltaLines: lineDelta(before, after),
    }
  })

  for (const item of processed) outcomes.push(item)

  const stats = {
    selected: selected.length,
    processed: outcomes.filter((o) => o.status === 'changed' || o.status === 'unchanged').length,
    changed: outcomes.filter((o) => o.status === 'changed').length,
    unchanged: outcomes.filter((o) => o.status === 'unchanged').length,
    written: outcomes.filter((o) => o.written === true).length,
    skipped: skipped.length + outcomes.filter((o) => o.status === 'skipped').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    degraded: outcomes.filter((o) => o.degraded === true).length,
    // Style findings are reported, never auto-applied: engine fixes for these
    // rules are classified unsafe, so a count here is information, not a change.
    lintFindings: outcomes.reduce((sum, o) => sum + (o.findingCount ?? 0), 0),
  }

  return {
    runId: `run-${started.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    root,
    finishedAt: new Date(started).toISOString(),
    elapsedMs: Date.now() - started,
    stats,
    files: outcomes,
    skipped,
    ok: stats.failed === 0,
  }
}

function lineDelta(before, after) {
  const a = before.split('\n').length
  const b = after.split('\n').length
  return b - a
}
