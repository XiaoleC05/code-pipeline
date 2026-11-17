# Code pipeline

A sidebar panel plus two agent tools that apply one fixed set of code-style presets
to the code files you pick.

## What it does

- **File tree** — scans the workspace root, shows directories and code files nested
  by folder, and labels every file with its language.
- **Picking** — check one file, check several, check a folder (selects everything
  selectable below it), or press **Select all** to pick every file the presets cover.
  The header always shows `selected / selectable`.
- **Presets** — ten languages ship with a preset: Go, TypeScript, JavaScript, Python,
  HTML, Makefile, CSS, C++, Shell, PowerShell. Each rule carries its source and a tier
  (T1 official text, T2 official tool default, T3 de-facto standard, T0 local decision).
- **Check** reports what would change and never touches the disk. **Standardize**
  writes the changes.

## How to use it

1. Open the left rail and pick **Code pipeline**.
2. Choose a workspace if more than one is registered.
3. Check the files you want, or press **Select all**.
4. **Check** first to review the result, then **Standardize** to write it.

From a conversation, the same work is available through the tools
`code_list_files` and `code_standardize` (`mode: "report"` or `"fix"`).

## What it will not do

- **Only the ten P0 languages get a preset.** Any other code file is listed with a
  `跳过` badge, its checkbox is disabled, and it is never modified. Reports also carry
  a skipped list with the reason.
- **Non-code files never appear.** Binary assets, images, archives and lock files are
  filtered out before the tree is built; `node_modules`, `dist`, `build`, `target`,
  `.venv` and similar directories are never walked, so select-all cannot reach them.
- **Interface and function normalization is out of scope.** The presets carry only the
  rules listed in each preset file; nothing beyond those rules is applied.
- **Style findings are reported, not rewritten.** Biome 2.6 classifies essentially every
  style fix it offers (`useConst`, `noDoubleEquals`, `useTemplate`) as *unsafe*, so a
  full-depth preset formats the file and then lists the remaining lint diagnostics with
  file, line, rule and message. Nothing is auto-applied for those rules. The preset rules
  that cannot be enforced this way are still listed with their source and tier, so the
  panel never implies a rule was checked when it was only declared.
- **Makefile and PowerShell have no formatter engine.** They use deterministic
  whitespace rules only (recipe-line tabs for Make, indentation and line endings for
  PowerShell) and report depth `text`. When an optional formatter engine is missing,
  the affected language degrades to the same text rules and the report shows it as
  `degraded` — it never reports a full pass for work it did not do.

## Engines

| Engine | Languages | Package |
| --- | --- | --- |
| Biome (WASM) | TypeScript, JavaScript, HTML, CSS | `@biomejs/wasm-nodejs` |
| gofmt (WASM) | Go | `@wasm-fmt/gofmt` |
| ruff format (WASM) | Python | `@wasm-fmt/ruff_fmt` |
| clang-format (WASM) | C++ | `@wasm-fmt/clang-format` |
| shfmt (WASM) | Shell | `@wasm-fmt/shfmt` |
| built-in text rules | Makefile, PowerShell | — |

Every run re-checks its own output: if a second pass would change the file again, that
file is reported as `not-idempotent` and is not written.
