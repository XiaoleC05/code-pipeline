window.__ModuleLoader__.load({
  id: 'dsh-code-pipeline',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const API = '/dsh-code-pipeline/api'
    const PANEL_ID = 'code-pipeline'

    // ------------------------------------------------------------ styles

    const S = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        fontSize: 13,
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        flexWrap: 'wrap',
      },
      title: { fontSize: 14, fontWeight: 600, marginRight: 4 },
      spacer: { flex: 1 },
      button: {
        font: 'inherit',
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      primaryButton: {
        font: 'inherit',
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: '#fff',
        cursor: 'pointer',
      },
      select: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 6px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        maxWidth: 360,
      },
      body: { display: 'flex', flex: 1, minHeight: 0 },
      treePane: {
        width: '46%',
        minWidth: 260,
        overflow: 'auto',
        borderRight: '1px solid var(--dsw-alias-border-l1)',
        padding: '8px 6px',
      },
      resultPane: { flex: 1, overflow: 'auto', padding: '10px 14px', minWidth: 0 },
      row: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', borderRadius: 4 },
      caret: {
        width: 14,
        textAlign: 'center',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        userSelect: 'none',
        flex: 'none',
      },
      name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: {
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 4,
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        flex: 'none',
      },
      badgeWarn: {
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 4,
        border: '1px solid var(--dsw-alias-state-warn-primary)',
        color: 'var(--dsw-alias-state-warn-primary)',
        flex: 'none',
      },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, whiteSpace: 'pre-wrap' },
      success: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12 },
      statGrid: { display: 'flex', gap: 16, flexWrap: 'wrap', margin: '8px 0 14px' },
      stat: { display: 'flex', flexDirection: 'column', gap: 2 },
      statValue: { fontSize: 18, fontWeight: 600 },
      statLabel: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
      th: {
        textAlign: 'left',
        padding: '4px 6px',
        borderBottom: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontWeight: 500,
      },
      td: { padding: '4px 6px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11 },
      sectionTitle: { fontSize: 12, fontWeight: 600, margin: '14px 0 6px' },
      empty: { padding: 24, textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
    }

    const LANGUAGE_COLORS = {
      go: '#00add8',
      typescript: '#3178c6',
      javascript: '#f1e05a',
      python: '#3572a5',
      html: '#e34c26',
      makefile: '#427819',
      css: '#563d7c',
      cpp: '#f34b7d',
      shell: '#89e051',
      powershell: '#012456',
    }

    // ------------------------------------------------------------ helpers

    function collectSelectable(nodes, out = []) {
      for (const node of nodes ?? []) {
        if (node.type === 'dir') collectSelectable(node.children, out)
        else if (node.supported) out.push(node.path)
      }
      return out
    }

    function collectDirFiles(node, out = []) {
      if (!node) return out
      if (node.type === 'file') {
        if (node.supported) out.push(node.path)
        return out
      }
      for (const child of node.children ?? []) collectDirFiles(child, out)
      return out
    }

    async function getJson(url, options) {
      const response = await fetch(url, options)
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        throw new Error(`Unexpected response from ${url}`)
      }
      if (!response.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${response.status}`)
      return data
    }

    // ------------------------------------------------------------ tree row

    function FileRow(props) {
      const { node, depth, selected, onToggleFile } = props
      const checked = selected.has(node.path)
      const unsupported = !node.supported
      const badge = unsupported
        ? h('span', { style: S.badgeWarn, title: node.reason ?? '' }, node.display ? `跳过 · ${node.display}` : '跳过')
        : h(
            'span',
            {
              style: {
                ...S.badge,
                borderColor: LANGUAGE_COLORS[node.language] ?? 'var(--dsw-alias-border-l1)',
                color: LANGUAGE_COLORS[node.language] ?? 'var(--dsw-alias-label-secondary)',
              },
            },
            node.language,
          )

      return h(
        'label',
        {
          style: {
            ...S.row,
            paddingLeft: 4 + depth * 14,
            opacity: unsupported ? 0.6 : 1,
            cursor: unsupported ? 'not-allowed' : 'pointer',
          },
          title: unsupported ? `${node.path} — not in the P0 language list, no preset is applied` : node.path,
        },
        h('span', { style: S.caret }),
        h('input', {
          type: 'checkbox',
          checked,
          disabled: unsupported,
          onChange: () => onToggleFile(node.path),
        }),
        h('span', { style: S.name }, node.name),
        badge,
      )
    }

    function DirRow(props) {
      const { node, depth, expanded, onToggleDir, selected, onToggleMany } = props
      const children = node.children ?? []
      const files = collectDirFiles(node)
      const selectedCount = files.filter((path) => selected.has(path)).length
      const allChecked = files.length > 0 && selectedCount === files.length
      const someChecked = selectedCount > 0 && !allChecked
      const isOpen = expanded.has(node.path)

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { style: { ...S.row, paddingLeft: 4 + depth * 14 } },
          h(
            'span',
            { style: S.caret, onClick: () => onToggleDir(node.path), role: 'button', 'aria-label': isOpen ? 'collapse' : 'expand' },
            isOpen ? '▾' : '▸',
          ),
          h('input', {
            type: 'checkbox',
            checked: allChecked,
            disabled: files.length === 0,
            ref: (element) => {
              if (element) element.indeterminate = someChecked
            },
            onChange: () => onToggleMany(files, !allChecked),
            title: `${selectedCount}/${files.length} in this folder`,
          }),
          h(
            'span',
            { style: { ...S.name, fontWeight: 500, cursor: 'pointer' }, onClick: () => onToggleDir(node.path) },
            `${node.name}/`,
          ),
          h('span', { style: S.muted }, `${files.length}`),
        ),
        isOpen ? children.map((child) => renderNode(child, depth + 1, props)) : null,
      )
    }

    function renderNode(node, depth, props) {
      if (node.type === 'dir') return h(DirRow, { key: node.path, node, depth, ...props })
      return h(FileRow, { key: node.path, node, depth, ...props })
    }

    // ------------------------------------------------------------ page

    function PipelinePage(props) {
      const [state, setState] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [root, setRoot] = useState(null)
      const [expanded, setExpanded] = useState(() => new Set())
      const [selected, setSelected] = useState(() => new Set())
      const [result, setResult] = useState(null)
      const [running, setRunning] = useState(null)

      const load = useCallback(
        async (nextRoot) => {
          setLoading(true)
          setError(null)
          try {
            const query = nextRoot ? `?root=${encodeURIComponent(nextRoot)}` : ''
            const data = await getJson(`${API}/state${query}`)
            setState(data)
            setRoot(data.root ?? null)
            if (data.error) setError(data.error)
            const initial = new Set()
            for (const node of data.tree ?? []) {
              if (node.type === 'dir') initial.add(node.path)
            }
            setExpanded(initial)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setLoading(false)
          }
        },
        [],
      )

      useEffect(() => {
        load()
      }, [load])

      const tree = state?.tree ?? []
      const allSelectable = useMemo(() => collectSelectable(tree), [tree])
      const selectedCount = selected.size
      const selectedList = useMemo(() => [...selected], [selected])

      const toggleDir = useCallback((path) => {
        setExpanded((previous) => {
          const next = new Set(previous)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }, [])

      const toggleFile = useCallback((path) => {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }, [])

      const toggleMany = useCallback((paths, on) => {
        setSelected((previous) => {
          const next = new Set(previous)
          for (const path of paths) {
            if (on) next.add(path)
            else next.delete(path)
          }
          return next
        })
      }, [])

      const selectAll = useCallback(() => {
        setSelected(new Set(allSelectable))
      }, [allSelectable])

      const clearAll = useCallback(() => setSelected(new Set()), [])

      const run = useCallback(
        async (mode) => {
          if (selectedList.length === 0) return
          setRunning(mode)
          setError(null)
          try {
            const data = await getJson(`${API}/standardize`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ root, paths: selectedList, mode }),
            })
            setResult(data)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setRunning(null)
          }
        },
        [root, selectedList],
      )

      const treeProps = { expanded, selected, onToggleDir: toggleDir, onToggleFile: toggleFile, onToggleMany: toggleMany }

      return h(
        'div',
        { style: S.page },
        h(
          'div',
          { style: S.header },
          h('span', { style: S.title }, 'Code pipeline'),
          (state?.roots ?? []).length > 1
            ? h(
                'select',
                {
                  style: S.select,
                  value: root ?? '',
                  onChange: (event) => load(event.target.value),
                },
                state.roots.map((candidate) => h('option', { key: candidate.path, value: candidate.path }, candidate.title)),
              )
            : h('span', { style: S.muted }, root ?? 'no workspace'),
          h('span', { style: S.spacer }),
          h('span', { style: S.muted }, `${selectedCount} / ${allSelectable.length} selected`),
          h('button', { style: S.button, onClick: selectAll, disabled: allSelectable.length === 0 }, 'Select all'),
          h('button', { style: S.button, onClick: clearAll, disabled: selectedCount === 0 }, 'Clear'),
          h(
            'button',
            {
              style: S.button,
              onClick: () => run('report'),
              disabled: selectedCount === 0 || running !== null,
            },
            running === 'report' ? 'Checking…' : 'Check',
          ),
          h(
            'button',
            {
              style: S.primaryButton,
              onClick: () => run('fix'),
              disabled: selectedCount === 0 || running !== null,
            },
            running === 'fix' ? 'Applying…' : 'Standardize',
          ),
        ),
        h(
          'div',
          { style: S.body },
          h(
            'div',
            { style: S.treePane },
            loading
              ? h('div', { style: S.empty }, 'Scanning workspace…')
              : tree.length === 0
                ? h('div', { style: S.empty }, error ? 'Workspace unavailable' : 'No code files found')
                : tree.map((node) => renderNode(node, 0, treeProps)),
          ),
          h('div', { style: S.resultPane }, h(ResultView, { result, error, state, selectedCount, presetCount: state?.presets?.length ?? 0 })),
        ),
      )
    }

    function ResultView({ result, error, state, selectedCount, presetCount }) {
      if (error) {
        return h(
          'div',
          null,
          h('div', { style: S.error }, `Error: ${error}`),
          h('div', { style: { ...S.muted, marginTop: 8 } }, 'The panel could not reach the host. Check that the plugin row is enabled.'),
        )
      }
      if (!result) {
        return h(
          'div',
          null,
          h('div', { style: S.empty }, 'Pick files on the left, then Check or Standardize.'),
          h(
            'div',
            { style: { ...S.muted, marginTop: 4 } },
            `${presetCount} language presets loaded · ${state?.files?.length ?? 0} files scanned · ${selectedCount} selected`,
          ),
          h(Legend, { state }),
        )
      }

      const { stats } = result
      const failed = result.files.filter((file) => file.status === 'failed')
      const changed = result.files.filter((file) => file.status === 'changed')
      const unchanged = result.files.filter((file) => file.status === 'unchanged')
      const findings = result.files.flatMap((file) => (file.findings ?? []).map((finding) => ({ path: file.path, ...finding })))

      return h(
        'div',
        null,
        h(
          'div',
          { style: S.statGrid },
          [
            ['Processed', stats.processed],
            ['Changed', stats.changed],
            ['Unchanged', stats.unchanged],
            [result.mode === 'fix' ? 'Written' : 'Report only', result.mode === 'fix' ? stats.written : stats.changed],
            ['Style findings', stats.lintFindings ?? 0],
            ['Skipped', stats.skipped],
            ['Failed', stats.failed],
          ].map(([label, value]) =>
            h('div', { key: label, style: S.stat }, h('span', { style: S.statValue }, String(value)), h('span', { style: S.statLabel }, label)),
          ),
        ),
        result.mode === 'report' && stats.changed > 0
          ? h('div', { style: S.muted }, 'Report-only run: no file was modified. Press Standardize to write these changes.')
          : null,
        result.mode === 'fix' && stats.written > 0
          ? h('div', { style: S.success }, `${stats.written} file(s) standardized on disk.`)
          : null,
        stats.degraded > 0
          ? h('div', { style: { ...S.muted, marginTop: 6 } }, `${stats.degraded} file(s) fell back to the built-in text rules: the formatter engine was unavailable.`)
          : null,
        changed.length > 0 ? h('div', { style: S.sectionTitle }, `Changed (${changed.length})`) : null,
        changed.length > 0 ? h(FileTable, { rows: changed }) : null,
        unchanged.length > 0 ? h('div', { style: S.sectionTitle }, `Unchanged (${unchanged.length})`) : null,
        unchanged.length > 0 ? h(FileTable, { rows: unchanged }) : null,
        failed.length > 0 ? h('div', { style: S.sectionTitle }, `Failed (${failed.length})`) : null,
        failed.length > 0 ? h(FileTable, { rows: failed }) : null,
        findings.length > 0 ? h('div', { style: S.sectionTitle }, `Style findings — reported, never auto-applied (${findings.length})`) : null,
        findings.length > 0
          ? h(
              'ul',
              { style: { margin: 0, paddingLeft: 18, ...S.mono, lineHeight: 1.7 } },
              findings.slice(0, 40).map((finding, index) =>
                h(
                  'li',
                  { key: `${finding.path}:${finding.line}:${index}`, style: { color: finding.severity === 'error' ? 'var(--dsw-alias-state-error-primary)' : undefined } },
                  `${finding.path}:${finding.line}  ${finding.rule}  ${finding.message}`,
                ),
              ),
              findings.length > 40 ? h('li', { style: S.muted }, `… ${findings.length - 40} more`) : null,
            )
          : null,
        result.skipped?.length > 0 ? h('div', { style: S.sectionTitle }, `Skipped (${result.skipped.length})`) : null,
        result.skipped?.length > 0
          ? h(
              'ul',
              { style: { margin: 0, paddingLeft: 18, ...S.mono } },
              result.skipped.map((item) =>
                h('li', { key: item.path }, `${item.path} — ${item.reason === 'outside-p0' ? `outside P0 (${item.display ?? 'unknown'})` : item.reason}`),
              ),
            )
          : null,
      )
    }

    function FileTable({ rows }) {
      return h(
        'table',
        { style: S.table },
        h('thead', null, h('tr', null, h('th', { style: S.th }, 'File'), h('th', { style: S.th }, 'Language'), h('th', { style: S.th }, 'Preset'), h('th', { style: S.th }, 'Engine'), h('th', { style: S.th }, 'Depth'), h('th', { style: S.th }, 'Findings'), h('th', { style: S.th }, 'Status'))),
        h(
          'tbody',
          null,
          rows.map((row) =>
            h(
              'tr',
              { key: row.path },
              h('td', { style: { ...S.td, ...S.mono } }, row.path),
              h('td', { style: S.td }, row.language ?? '—'),
              h('td', { style: S.td }, row.preset ?? '—'),
              h('td', { style: S.td }, row.engine ?? '—'),
              h('td', { style: S.td }, row.depth ?? '—'),
              h('td', { style: S.td }, String(row.findingCount ?? 0)),
              h('td', { style: { ...S.td, color: row.status === 'failed' ? 'var(--dsw-alias-state-error-primary)' : undefined } }, row.reason ?? row.status),
            ),
          ),
        ),
      )
    }

    function Legend({ state }) {
      const engines = state?.engines ?? {}
      const p0 = state?.p0 ?? []
      return h(
        'div',
        { style: { marginTop: 18 } },
        h('div', { style: S.sectionTitle }, 'Languages with a preset'),
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          p0.map((language) => h('span', { key: language.id, style: S.badge }, language.label)),
        ),
        h('div', { style: S.sectionTitle }, 'Formatter engines'),
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          Object.entries(engines).map(([id, present]) =>
            h(
              'span',
              { key: id, style: present ? S.badge : S.badgeWarn },
              `${id}: ${present ? 'ready' : 'missing (text rules)'}`,
            ),
          ),
        ),
        h(
          'div',
          { style: { ...S.muted, marginTop: 10, lineHeight: 1.6 } },
          'Files outside the ten P0 languages are listed with a 跳过 badge and are never modified. ' +
            'A missing engine degrades that language to whitespace-level rules, shown as depth "text" in the result.',
        ),
      )
    }

    // ------------------------------------------------------------ icon

    function PanelIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M14 4v5h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M8 13h8M8 17h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    // ------------------------------------------------------------ apply

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        const slots = ctx && ctx.slots
        if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return undefined

        const disposers = []

        disposers.push(
          slots.inject('sidebar.panellist', () =>
            slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 40,
                label: () => 'Code pipeline',
              },
              PanelIcon,
            ),
          ),
        )

        disposers.push(
          slots.inject('main', function* () {
            yield slots.register(
              {
                name: 'main',
                key: PANEL_ID,
              },
              PipelinePage,
            )
          }),
        )

        return () => {
          for (const dispose of disposers) {
            try {
              if (typeof dispose === 'function') dispose()
            } catch {
              // Presentation-only cleanup.
            }
          }
        }
      },
    }
  },
})
