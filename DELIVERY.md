# dsh-code-pipeline — delivery notes

Status: v0.1.0, P0 languages only. Baseline commit `51060a7`.
This document is the delivery record for the plugin: every file and what it is for, the
preset inventory with counts verified against the code, how to install and use the
panel, what is skipped, and what the plugin does not do. `README.md` is the short
overview; `docs/DETAIL.md` is the text shown on the bundle's detail page.

## 1. File inventory

33 files (32 pre-existing plus this document), one line per file.

| Path | Purpose |
| --- | --- |
| `package.json` | Manifest: entry points (`index.js`, `client.js`), exports (client, locale, icon), npm scripts, Node >= 22.19.0, six runtime dependencies (Biome JS API + wasm-nodejs, and four `@wasm-fmt/*` formatters), and the `dsh.bundle` / `dsh.client` descriptors that make this a DSH bundle. |
| `cordis.patch.yml` | Bundle patch: inserts the `code-pipeline` row named `dsh-code-pipeline` into the profile. |
| `index.js` | Host half: resolves the workspace root, serves the panel API under `/dsh-code-pipeline/api` (state, preset, standardize) and registers the `code_list_files` / `code_standardize` agent tools. |
| `client.js` | Client half: registers the left-rail icon (`sidebar.panellist`, id `code-pipeline`, order 40) and the main panel (`main`, key `code-pipeline`); renders the file tree, picking controls, Check/Standardize buttons and the result view. |
| `lib/languages.js` | Language registry: ordered P0 table (10 languages, 35 extensions + 2 Makefile filename patterns), non-P0 code extensions, non-code extensions, skipped directory names; `classify()` is the single source of truth for support. |
| `lib/tree.js` | Workspace scanner and tree builder: depth-first walk, skip rules, `.gitignore` / `.dsh-code-pipeline-ignore` subset, file/size limits, and `resolveInside()` path confinement. |
| `lib/presets.js` | Preset loader over `presets/*.json`: `listPresets`, `describePreset`, category counting. A malformed preset is ignored instead of breaking the plugin. |
| `lib/standardize.js` | Orchestrator: classify → resolve path → read → binary check → engine run → idempotency gate → optional write; builds the report with stats, findings and skipped entries. |
| `lib/engines/index.js` | Engine adapter table (biome, gofmt, ruff-fmt, clang-format, shfmt, text), lazy imports, graceful degradation to text rules, and `probeEngines()` for the panel legend. |
| `lib/engines/text.js` | Built-in deterministic whitespace normalizer used by Makefile and PowerShell and as the degradation path for any missing engine. |
| `presets/go.json` | Go preset: gofmt (WASM), 10 rules. |
| `presets/typescript.json` | TypeScript preset: Biome (WASM), full depth, 9 rules. |
| `presets/javascript.json` | JavaScript preset: Biome (WASM), full depth, 8 rules. |
| `presets/python.json` | Python preset: ruff format (WASM), 9 rules. |
| `presets/html.json` | HTML preset: Biome (WASM) with experimental HTML formatter, 6 rules. |
| `presets/makefile.json` | Makefile preset: built-in text rules, 6 rules. |
| `presets/css.json` | CSS preset: Biome (WASM), 5 rules. |
| `presets/cpp.json` | C++ preset: clang-format (WASM), 5 rules. |
| `presets/shell.json` | Shell preset: shfmt (WASM), 5 rules. |
| `presets/powershell.json` | PowerShell preset: built-in text rules, 7 rules. |
| `locale/en.json` | Plugin Manager metadata (English title/description) and the `docs/DETAIL.md` detail-document pointer. |
| `locale/zh.json` | Same metadata in Chinese; the detail document is shared. |
| `docs/DETAIL.md` | The bundle detail document rendered by Plugin Manager: capability, usage, what it refuses to do, engine table. |
| `icon.svg` | Bundle icon exported as `./icon` and shown in Plugin Manager / plugin rows. |
| `test/pipeline.test.mjs` | 10 acceptance-mapped `node:test` cases: presets, classification, skip rules, tree/select-all, report-vs-fix writes, Makefile tabs, non-P0 skip, path escape, findings. |
| `test/client-sim.mjs` | Runs `client.js` against a fake `window.__ModuleLoader__` and a fake React to assert the two slot registrations and their ids; a self-contained script, not a `node:test` file. |
| `scripts/gen-presets.mjs` | Authoring source for all ten presets (rule text, category, tier, source URL, engine config); its output is committed. |
| `scripts/smoke.mjs` | End-to-end fixture run: engine probes, preset dump, scan, tree, report-mode standardization. |
| `scripts/fix-probe.mjs` | One-off exploratory probe that records how Biome 2.6 classifies candidate fixes as safe/unsafe; evidence for the style-finding design, not used by the plugin or the tests. |
| `README.md` | User-facing overview: install, repository map, preset table, panel and tool usage, limitations. |
| `DELIVERY.md` | This delivery record. |
| `pnpm-lock.yaml` | Lockfile for the WASM formatter dependencies and their transitive packages. |
| `.gitignore` | Ignores `node_modules/`, `*.log`, `.DS_Store`. |

## 2. Preset inventory (verified against the code)

Counts below were read from the committed `presets/*.json` through `lib/presets.js`
(`listPresets` / `describePreset`), and `node scripts/gen-presets.mjs` reproduces the
committed files byte-for-byte (it reported "wrote 10 presets, 70 rules" and left
`git status` clean). The README table matches these numbers.

| Language | Preset id | Extensions | Engine | Depth | Rules | F / S / X | In-process |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Go | `go` | `.go` | gofmt (WASM) | format | 10 | 4 / 5 / 1 | yes, WASM |
| TypeScript | `typescript` | `.ts .tsx .mts .cts` | Biome (WASM) | full | 9 | 3 / 5 / 1 | yes, WASM |
| JavaScript | `javascript` | `.js .jsx .mjs .cjs` | Biome (WASM) | full | 8 | 3 / 4 / 1 | yes, WASM |
| Python | `python` | `.py .pyi` | ruff format (WASM) | format | 9 | 5 / 4 / 0 | yes, WASM |
| HTML | `html` | `.html .htm` | Biome (WASM) | format | 6 | 5 / 0 / 1 | yes, WASM |
| Makefile | `makefile` | `.mk .make` + `makefile` / `gnumakefile` names | built-in text rules | text | 6 | 5 / 0 / 1 | yes, built-in JS |
| CSS | `css` | `.css .scss .less` | Biome (WASM) | format | 5 | 4 / 0 / 1 | yes, WASM |
| C++ | `cpp` | `.c .h .cc .cpp .cxx .hh .hpp .hxx .inl .ipp` | clang-format (WASM) | format | 5 | 3 / 1 / 1 | yes, WASM |
| Shell | `shell` | `.sh .bash .zsh .ksh` | shfmt (WASM) | format | 5 | 2 / 2 / 1 | yes, WASM |
| PowerShell | `powershell` | `.ps1 .psm1 .psd1` | built-in text rules | text | 7 | 5 / 1 / 1 | yes, built-in JS |
| **Total** | **10 presets** | **35 extensions + 2 names** | **6 engine ids** | — | **70** | **39 / 22 / 9** | **no external binary** |

Rule metadata across all 70 rules: tiers T0 7 / T1 27 / T2 23 / T3 13; intended handling
`fix: auto` 40 / `fix: report` 21 / `fix: none` 9. The seven T0 rules (local decisions)
deliberately carry an empty `source`.

- **Depth** is what actually runs: `full` = formatted **and** Biome lint diagnostics
  collected (TypeScript, JavaScript only); `format` = formatted only; `text` = built-in
  whitespace rules only.
- **In-process** means the formatter is an npm WASM package imported by
  `lib/engines/index.js` in the Host process. No external formatter binary is executed and
  no network access is needed. `probeEngines()` reports readiness for the six engine ids
  (`biome`, `gofmt`, `ruff-fmt`, `clang-format`, `shfmt`, `text`); all six were ready in
  this checkout during the smoke run.

## 3. Install and use

### Install into a DSH profile

The bundle is a linked local checkout, not a published npm package. Install it through
DeepSeek Harness's **Plugin Manager** with the link spec:

```
link:D:/05_Code/code-pipeline
```

The profile used for this checkout already has it installed and enabled:
`plugin_manager.list_bundles` reports `dsh-code-pipeline` v0.1.0,
`source: link:D:\05_Code\code-pipeline`, `enabled: true`, row `code-pipeline`.

A linked directory is used in place, so `node_modules/` in the checkout must exist
(`pnpm install`) for the WASM engines to resolve; the installed profile runs this
checkout directly.

Reload the GUI page once after installing — the Client half is injected into the boot
graph at page load, so a newly installed bundle appears only after a refresh. Plugin
Manager reads `locale/*.json` for the title/description and `docs/DETAIL.md` for the
detail page without activating the plugin.

### Open the panel

Open the left rail and choose **Code pipeline** (icon `code-pipeline`). The panel shows:

- the workspace root, or a workspace selector when more than one root is registered;
- a file tree of the workspace, with directories first;
- a header with `selected / selectable`, **Select all**, **Clear**, **Check** and
  **Standardize**.

If the panel cannot reach the Host it prints an error and suggests checking that the
plugin row is enabled. The `main` panel key and the rail icon id are both
`code-pipeline`, so they are one panel.

### Select files (single / multi / select all)

- **Single:** tick one file's checkbox.
- **Multi:** tick any number of files, or tick several folder checkboxes.
- **Folder:** a directory checkbox is tri-state — it selects or clears every
  **supported** code file below that directory (nested folders included), not just the
  files directly inside it. The caret expands/collapses the folder; the number after a
  folder name is the count of selectable files below it.
- **All:** **Select all** selects every supported file in the tree. **Clear** empties the
  selection.
- Unsupported files (non-P0 code, too large, etc.) have a disabled checkbox and a
  `跳过` badge; the badge's tooltip shows the reason.

### Run and read the result

- **Check** runs the pipeline in `report` mode: it computes what would change and writes
  nothing. A report-only note appears when changes were found.
- **Standardize** runs it in `fix` mode: it writes only files whose content changed and
  that pass the idempotency gate (a second engine pass must be a no-op).
- The result shows stats — Processed, Changed, Unchanged, Written (fix) or Report only
  (report), Style findings, Skipped, Failed — then three tables (Changed / Unchanged /
  Failed) with File, Language, Preset, Engine, Depth, Findings and Status/reason.
- **Style findings** (TypeScript / JavaScript only) are listed with file, line, rule and
  message; they are reported, never auto-applied.
- **Skipped** lists every selected file that was not processed, with its reason
  (`outside-p0`, `not-code`, `binary-content`, `too-large`, …).
- A **degraded** line appears when a file fell back to the built-in text rules because
  its formatter engine was unavailable.

### From a conversation

| Tool | Arguments | Result |
| --- | --- | --- |
| `code_list_files` | `root?`, `onlySupported` (default `true`) | root, counts by language, up to 300 paths |
| `code_standardize` | `paths: [...]` or `all: true`, `mode: "report" \| "fix"`, `root?` | text summary: counts, written files, failures, skipped |

`code_standardize` with no `paths` and `all` unset behaves like `all: true`. The panel
itself talks to three Host routes: `GET /dsh-code-pipeline/api/state?root=`,
`GET /dsh-code-pipeline/api/preset?id=` and `POST /dsh-code-pipeline/api/standardize`
(body `{ root, paths, mode }`).

## 4. What is skipped

### Language support

- **P0 languages only get a preset** — the ten in the table above. Every other code file
  is classified with `supported: false` and reason `outside-p0`: it stays visible in the
  tree with a `跳过` badge, its checkbox is disabled, and `standardize` records it in the
  skipped list without touching it.
- The non-P0 registry names **38 extensions**: Rust, Java, Kotlin, C#, F#, Ruby, PHP,
  Swift, Dart, Lua, Perl, R, Scala, Elixir, Erlang, Haskell, Clojure, Zig, Nim, Vue,
  Svelte, Astro, SQL, GraphQL, JSON/JSONC, YAML, TOML, INI, XML, Markdown, source maps
  and Protobuf. Note that this includes documentation and configuration formats, so a
  `.md` or `.json` file is shown with the `跳过` badge rather than hidden.
- **Non-code files (60 extensions)** are never returned by the scanner and never appear
  in the tree: images, fonts, archives, native binaries, media, PDFs/Office documents,
  databases, `.lock` and `.map` files.
- **Unknown extensions** are treated as non-code and hidden, so select-all can never
  reach them.

### Directories and files

- **29 directory names are never entered**: VCS metadata (`.git`, `.hg`, `.svn`),
  dependencies (`node_modules`, `bower_components`, `vendor`), build output (`dist`,
  `build`, `out`, `obj`, `bin`, `target`, `coverage`), framework caches (`.next`,
  `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `__pycache__`), Python/Java tooling
  (`.venv`, `venv`, `.tox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.gradle`,
  `.idea`, `.vs`) and the plugin's own `.dsh-code-pipeline` directory.
- **Five generated/minified suffixes** are hidden: `.min.js`, `.min.css`, `.min.mjs`,
  `.bundle.js`, `.chunk.js`.
- **Ignore files:** the workspace root's `.gitignore` and `.dsh-code-pipeline-ignore` are
  honoured for exact names, leading-slash anchors and `*` wildcards. Negation (`!`) and
  `**` are not supported; an unsupported pattern simply fails to exclude, which is the
  safe direction for a formatter.
- **Limits:** the scan stops at 4,000 files and code files over 2 MiB are listed with
  reason `too-large` instead of being processed (the Host reports a `truncated` flag).
  Both limits default as above and can be overridden by the plugin row's `maxFiles` /
  `maxBytes` config values.
- **Defense in depth at run time:** a selected file whose content contains a NUL byte in
  the first 4 KiB is skipped with reason `binary-content`; a path that resolves outside
  the workspace root fails with reason `path-escape`; a path whose preset file is missing
  is skipped with `missing-preset`.

## 5. Known limitations

1. **No external formatter binaries.** All formatters are WASM npm packages imported
   in-process. If one is missing from `node_modules`, every affected file degrades to the
   built-in text rules, the report counts it as `degraded` and its depth becomes `text`;
   the plugin never claims a full pass for work it did not do.
2. **Only formatter output is written.** No preset enables Biome's unsafe-fix pass
   (`allowUnsafeFixes` is absent from all ten presets), so:
   - TypeScript and JavaScript run a lint pass and report findings, never apply them;
   - the four S-category rules whose preset metadata says `fix: auto`
     (`js/S/eqeqeq`, `js/S/use-const`, `py/S/compare-none`, `ts/S/use-const`) are **not**
     applied — the metadata and the behaviour disagree;
   - the three F-category rules marked `fix: report` (`css/F/zero-unit`,
     `html/F/lowercase`, `html/F/doctype`) are declared, not enforced, and format-depth
     languages have no lint pass that could report them.
3. **Makefile and PowerShell have no real formatter.** They get deterministic whitespace
   rules only (recipe-line tab conversion for Make via a target-line heuristic; tab
   expansion, line endings, trailing whitespace, blank-line runs and final newline for
   PowerShell). Rule coverage there is correspondingly small.
4. **HTML formatting is upstream-experimental.** The HTML preset enables Biome's
   experimental HTML formatter (`experimentalHtml: true` plus an `html.formatter` config);
   it worked in the smoke run, but it is Biome's experimental path, not a stable API.
5. **Style rules beyond the formatter stay declarative.** Rules such as Go doc comments,
   Python docstrings, C++ naming or TypeScript `strict` mode cannot be checked by the
   embedded engines; they are listed with tier and source in the preset detail but never
   enforced. Interface and function normalization is out of scope entirely.
6. **A second pass must be a no-op.** Files whose engine output is not a fixed point are
   reported as `failed` / `not-idempotent` and are not written. This is deliberate safety
   over coverage.
7. **One root at a time.** The Host uses the registered workspaces (`workspaceRegistry`)
   or the default working directory; a requested root that is not registered is rejected
   with `root-not-registered`, and the panel only offers the registered roots.
8. **The panel does not surface `truncated`.** The Host state carries the flag, but the
   panel's empty state only shows `files scanned`; on a workspace beyond the 4,000-file
   cap, the tree is silently partial.
9. **`npm test` is broken on Node 22.19.0 / Windows.** The script is
   `node --test test/`; that directory argument makes Node treat `test` as a module and
   fail with `Error: Cannot find module 'D:\05_Code\code-pipeline\test'` (
   exit 1). Use `node --test test/pipeline.test.mjs` or
   `node --test "test/**/*.test.mjs"` instead, as `README.md` already documents. This is
   a repository defect; it was reported, not fixed, in this documentation change.
10. **No test exercises the Host HTTP routes.** `test/pipeline.test.mjs` covers the
    library layer, `test/client-sim.mjs` covers slot registration, and `scripts/smoke.mjs`
    covers the orchestrator; `index.js`'s route/tool registration is not directly tested.

## 6. Verification performed for this document

Environment: Node v22.19.0, Windows, repository at `D:\05_Code\code-pipeline`.

| Command | Result |
| --- | --- |
| `node --test test/pipeline.test.mjs` | 10 tests, 10 pass, 0 fail |
| `node --test "test/**/*.test.mjs"` | 10 tests, 10 pass, 0 fail (glob excludes `client-sim.mjs`) |
| `node --test` (no arguments) | 11 tests, 11 pass — Node's default discovery also executes `test/client-sim.mjs` as a file-level test |
| `node test/client-sim.mjs` | OK: `sidebar.panellist` id `code-pipeline` and `main` key `code-pipeline` registered; report printed |
| `node scripts/smoke.mjs` | all six engine ids ready; 10 presets; 12 files scanned (10 P0 + 2 non-P0); 10 processed: 9 changed, 1 unchanged, 0 failed, 0 degraded, 1 lint finding; exit 0 |
| `node scripts/gen-presets.mjs` | "wrote 10 presets, 70 rules"; `git status` unchanged (committed presets match the authoring source) |
| `npm test` | **fails**: `Error: Cannot find module 'D:\05_Code\code-pipeline\test'`, exit 1 — see limitation 9 |

## 7. Documentation notes

- The README preset table was checked number by number against `presets/*.json`: all ten
  rule counts and every F/S/X split match, and the total is 70 rules.
- Two README claims were too loose and were corrected in this pass: "F format (applied
  automatically)" (three F rules are declared-only) and "every rule carries … a source
  URL" (the seven T0 rules deliberately have none). The README install line was replaced
  with the Plugin Manager / linked-checkout method that this profile actually uses.
- `docs/DETAIL.md` and `locale/*.json` were checked for stale counts; they contain no
  numeric rule claims, so no edit was needed.
