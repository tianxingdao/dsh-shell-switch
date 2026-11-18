# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-11-18

### Added

- **Persistent background sessions** — a self-contained alternative to
  `@deepseek-ai/dsh-tool-jobs`. Four model tools (`bg_start`, `bg_output`,
  `bg_list`, `bg_kill`) spawn **real detached processes** (surviving the tool
  call and a harness restart), stream their output from a per-job log file, and
  stop the whole process tree. No dependency on the DSH job packages.
- **Background-jobs sidebar tab** in `dsh-better-sidebar` (optional): this
  conversation / all conversations views, tree grouped by conversation, a
  readable session label with an **Open conversation** jump button, and a
  per-job streaming log.
- **Terminal-style log viewer**: dark palette, line-number gutter, ANSI SGR
  color parsing (java/Spring logs render in their real colors), light syntax
  tints and error/warning row highlighting for plain logs, plus follow-latest,
  search-highlight, copy, download, and fullscreen.
- HTTP surface for the panel: `GET /jobs`, `GET /jobs/:id/log`,
  `POST /jobs/:id/kill`.

### Changed

- The `bash` tool no longer exposes `run_in_background` (disabled on purpose);
  background work is unified on the plugin's own `bg_*` tools.
- `background.{enabled,maxLogBytes,maxJobs}` config added.

### Fixed

- `Config` failed to construct because `background` was a volatile object with
  volatile fields (schemastery rejects that), which made the whole plugin fail
  to load and every route return 404.
- The jobs tab never registered because the optional `betterSidebar` service was
  looked up with a racing `ctx.get`; it now uses `ctx.inject`.
- The "Go to" button opened the subagent Tasks page; it now opens the owning
  conversation via the workspace face's `openSession`.

## [0.2.2] — 2026-11-06

- De-duplicate detected shells to one row per installation (not per file).
- WSL distribution probing and Git Bash detection.
- PowerShell selection runs commands through the official `pwsh` tool.

## [0.2.0]

- Settings → Shell selector; hide the shipped `pwsh` tool while active.
- Shell detection: registry, Scoop, standard paths, PATH, WSL.

## [0.1.0]

- Initial release: run the `bash` tool through a locally selected shell.
