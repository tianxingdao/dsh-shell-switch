# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.2] — 2026-11-25

### Added

- **Embedded Niubash online update** — the built-in bash card now supports
  **check-for-update / one-click upgrade / rollback**:
  - *Check update* queries the GitHub Releases API and compares the latest tag
    to the installed version with a real semantic comparison (`1.10.0 > 1.9.0`);
  - *Upgrade* downloads the new version into its own directory, runs
    `niu --version` to verify it executes, then atomically flips a `current`
    pointer (a failed upgrade leaves the old version usable);
  - *Rollback* keeps the most recent previous version and offers a one-click
    rollback (an explicit pointer rewrite, not blocked by the downgrade guard);
  - **Downgrade guard**: `updateEmbedded` refuses to install an older version
    than the current one (unless `allowDowngrade`), so a future plugin build
    that pins a lower fallback `EMBEDDED_VERSION` can never downgrade a user who
    already upgraded;
  - *Startup check* (`embedded.checkOnStartup`, default on) notifies only, never
    downloads or switches;
  - New routes `POST /embedded/check`, `/embedded/update`, `/embedded/rollback`;
    config `embedded.{releasesApi,checkOnStartup}`.
- **Network-resilient downloads** — the embedded-bash download now streams to
  disk with resume-on-reset retries (up to 5 attempts, resuming from already
  received bytes via HTTP Range), so it completes on flaky links that reset
  (`ECONNRESET`) — verified against the real GitHub release asset.

### Fixed

- **Windows shell-detection cleanup** — `System32\bash.exe` and the Store
  `WindowsApps\bash.exe` are the legacy WSL launchers (they hardcode
  `/bin/bash`, absent on usrmerge distros like Ubuntu 24.04); they are no longer
  listed as broken "bash" rows next to the real `wsl.exe -d <distro>` entry.
- **WSL distro-name mojibake** — a UTF-16LE value misread as UTF-8 produced
  garbage like `WÖ°ØLÖ…`; distribution names are now sanitized and bad decodes
  dropped. The WSL row shows the distro's own bash version (e.g. `5.2.21`), and
  the picker option no longer inlines the long note.

- **Background jobs now work for every shell** (previously only the bundled
  Niubash produced logs when detached):
  - **Git Bash / MSYS2** — a detached launch now gets its own `usr/bin` +
    `mingw64/bin` on PATH, so `sleep`/`ls`/`date` resolve;
  - **WSL** — the command is written to a `.sh` and run as
    `wsl.exe -d <distro> bash <file>` (a `-lc "<cmd>"` argument mangles `$i`
    and `$(...)`, and without `-d` it fails with `exit 127 /bin/sh: bash: not
    found`); the distro is auto-resolved when not supplied; WSL detection no
    longer misclassifies a Git Bash `bash.exe` as WSL;
  - **PowerShell 7 / 5.1** — `spawn(detached)` exits without running the command
    on Windows, so PowerShell jobs launch through `cmd /c start "" /b` (which
    keeps a console context) and adopt the real `pwsh` PID from a pid file.
  All five shells (embedded Niubash, Git Bash, WSL, PowerShell 7, PowerShell
  5.1) now produce streaming background logs — verified on a live host.

### Changed

- README / README.en / package description / locale updated to cover the
  bundled bash, online update, and the background-jobs panel, with screenshots
  under `docs/screenshots/`.

## [0.4.1] — 2026-11-24

First public release of the embedded-bash feature. (0.4.0 was withdrawn before
publication and its version number is retired, so this ships as 0.4.1.)

### Added

- **Embedded Niubash** — the plugin can ship a self-contained bash so a machine
  with no bash (Windows) works out of the box. On Windows it is on by default;
  on Linux/macOS it is off by default (a system bash already exists) but
  selectable. It downloads the official Niubash (MIT) release for the current
  platform (win/linux/macos × x64/arm64) into `%DSH_HOME%/embedded-niubash` and
  runs commands via the project's `--ec` encoded-command handoff.
- **First-run default**: with no saved choice and the embedded bash installed,
  `auto` picks the embedded Niubash (ready out of the box); once you pick any
  shell and save, your choice wins and is never overridden.
- Settings: a "Built-in bash (bundled)" picker group and a download/remove card;
  new routes `GET /api/dsh-shell-switch/embedded`, `POST /embedded/install`,
  `POST /embedded/remove`.
- Config `embedded.{enabled,autoInstall,baseUrl}`.

### Changed

- A not-yet-installed embedded shell is never an automatic default
  (`firstUsable`): it must be selected explicitly, and only after install.
- The picker gives the embedded bash its own group; a locally-installed Niubash
  stays in the normal "can run bash" group alongside Git Bash / WSL.

### Fixed

- **WSL now works on modern distros**: the plugin launched WSL via the legacy
  `System32\bash.exe`, which hardcodes `/bin/bash` and fails on usrmerge distros
  (Ubuntu 24.04+) with `execvpe(/bin/bash): No such file or directory`. WSL
  entries now run through `System32\wsl.exe` as `wsl -d <distro> bash -lc <cmd>`.
  Verified on Ubuntu 24.04.

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
