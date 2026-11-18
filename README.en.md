# dsh-shell-switch

English | [简体中文](README.md)

Adds a **`bash` tool** and a **Settings → Shell** page to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): bash commands run in a real shell installed on the machine (Niubash, Git Bash, MSYS2, Cygwin, or any `bash.exe` on `PATH`) instead of being rewritten as PowerShell.

On Windows the shipped `pwsh` tool is hidden as well, leaving `bash` as the only shell tool.

```
Before: "ls" had to be written as Get-ChildItem (pwsh tool), or rely on dsh-ops' bundled
        MSYS bash, which often fails inside the DSH sandbox.
After:  "ls" runs in Niubash bash 5.3 directly, with the same output, exit codes
        and spill files as the official bash tool; long-lived background
        processes use the plugin's own bg_* tools.
```

---

## Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
  - [Background jobs (persistent sessions)](#background-jobs-persistent-sessions)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [HTTP API](#http-api)
- [Shell detection and compatibility](#shell-detection-and-compatibility)
- [Sandbox and permissions](#sandbox-and-permissions)
- [Known limitations](#known-limitations)
- [Uninstalling and restoring pwsh](#uninstalling-and-restoring-pwsh)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## Why this exists

On Windows, DSH offers two shell paths out of the box:

1. **The official `pwsh` tool** — the model has to write PowerShell syntax, which is a constant translation cost for bash-oriented prompts and models.
2. **The MSYS bash bundled with `dsh-ops`** — inside DSH's restricted-token sandbox on Windows, the cygwin runtime fails to initialize (`NtSetInformationToken` / `CreateFileMapping ... Win32 error 5`), so `ops_bash` is frequently unusable.

Meanwhile, users who installed Niubash, Git Bash or MSYS2 already have a perfectly working bash — verified: Niubash's `bash.exe` runs fine under DSH's restricted token — but DSH has no way to pick it.

This plugin fills that gap: **detect every local shell → choose one in Settings → the official `bash` tool uses it**.

## Features

- **A `bash` tool built on the shipped packages**: it reuses `@deepseek-ai/dsh-tool-bash` and `@deepseek-ai/dsh-bash-sandbox` and only swaps the executable. Timeouts, output spill files, sandbox escalation and the `[exit code: N]` marker all behave exactly like the official tool.
- **Persistent background sessions**: four self-contained tools — `bg_start` / `bg_output` / `bg_list` / `bg_kill` — that spawn **real detached processes** (they outlive the tool call and a harness restart), stream their log incrementally, and stop the whole process tree. **No dependency on `@deepseek-ai/dsh-tool-jobs`**. When `dsh-better-sidebar` is installed, a "Background jobs" sidebar tab is registered too (This conversation / All, tree grouped by conversation, streaming log, one-click stop).
- **Settings → Shell selector**: a dropdown listing every detected shell with version and path, plus Save, Reset and Rescan. The change applies to the **next command** — no restart.
- **`pwsh` hidden on Windows**: the shipped `pwsh` tool cannot be uninstalled, so while this plugin is active a scope-level deny filter removes it from every Agent, making `bash` the only shell tool. Disabling the plugin restores it.
- **Nothing else disturbed**: the host's `ctx.shell` executor is untouched and the `pwsh-sandbox` row stays composed; other preset tools (files, search, subagents, …) are unaffected.
- **Sandbox respected**: `bash` commands always run under the session's `ctx.sandboxPolicy`; the plugin provides no bypass (**exception**: detached `bg_start` processes are not sandbox-confined, see below).

## Requirements

| Item | Requirement |
|---|---|
| OS | Windows 10/11 (primary target; other platforms simply skip the `pwsh` filter, and shell detection targets Windows) |
| DSH | `>=0.2.1-rc.2 <0.3.0` (see `engines.dsh`; developed and verified against `0.2.1-rc.5`) |
| Node | `>=20` (provided by DSH; no separate install) |
| Local shell | At least one bash-compatible shell: Niubash, Git Bash, MSYS2, Cygwin, or a `bash.exe` on `PATH` |

### Compatibility declaration

The manifest states the host requirement in both places the market and the pre-install check read:

```jsonc
{
  "engines": { "node": ">=20", "dsh": ">=0.2.1-rc.2 <0.3.0" },
  "peerDependencies": {
    "@deepseek-ai/dsh-bash-sandbox": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-tool-bash": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-client-locale": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-client-ui-settings": "^0.2.1-rc.2",
    "@deepseek-ai/schemastery": "^3.18.0"
  },
  "peerDependenciesMeta": { "…": { "optional": true } }
}
```

- `engines.dsh` names the supported DSH release line (the `0.2.1` series); outside it the market marks the plugin incompatible;
- the peers are declarative only: those packages come from the host DSH and are resolved at runtime from the host installation (see [How it works](#how-it-works)), so all of them are marked `optional` to keep npm/pnpm from copying them into the profile and creating a second instance;
- moving to DSH `0.3.x` means widening both ranges and publishing a new version.

## Installation

### Option 1: install from npm (recommended)

```bash
dsh plugin add dsh-shell-switch
```

Or from a DSH Agent session:

```text
plugin_manager install_bundle  target = dsh-shell-switch
```

A prebuilt package needs no build approval; it lands in `node_modules/dsh-shell-switch`.

### Option 2: install from a local directory (development / personal use)

```text
plugin_manager install_bundle  target = <absolute path to this repository>
```

For example, from a DSH Agent session:

```text
install_bundle: /path/to/dsh-shell-switch
```

After installation the profile's `dsh.profile.bundles` gains `dsh-shell-switch`, `node_modules/dsh-shell-switch` links to that directory, and the row id is `shell-switch`.

### Option 3: clone from GitHub, then install

```bash
git clone https://github.com/tianxingdao/dsh-shell-switch.git
```

Then install the cloned directory as the `target`, as in Option 2.

### After installing

- `bash` appears in a new session's tool list;
- **More → Settings → Shell** shows the Shell selector;
- On Windows, `pwsh` is no longer in the tool list.

> The client page is registered when Harness starts. If the Settings page does not appear right after installing, refresh the page; if it is still missing, restart DSH once.

## Usage

### The `bash` tool

```text
bash: {
  command:  "git status --short && npm test",
  workdir:  "<project directory>",   // optional, defaults to the session working directory
  timeoutMs: 120000                   // optional, capped by the plugin config
}
```

- Every call is a fresh shell; `cd`, variables and functions do not persist across calls;
- The result ends with a machine-readable marker: `[exit code: N]`, `[killed by signal]` or `[timeout after N ms]`;
- Oversized output is truncated with a note; the full stream lives in a spill file;
- `run_in_background` is **disabled**: background work is provided by the plugin's own `bg_*` tools (below), not the DSH job registry.

### Background jobs (persistent sessions)

The plugin ships its own **persistent background sessions**, so a "fire-and-forget" tool call can still run long-lived processes (dev servers, watchers, daemons). It does **not** depend on `@deepseek-ai/dsh-tool-jobs`; instead it spawns genuinely detached processes:

| Tool | Purpose |
|---|---|
| `bg_start` | Start a **detached** process under the currently selected shell (bash / WSL / PowerShell syntax adapted), returning a `jobId` immediately |
| `bg_output` | Read the job's log incrementally by offset; `follow:true` waits up to `timeout_ms` (never blocks forever) |
| `bg_list` | List jobs (all by default; `this_conversation:true` for this conversation only) |
| `bg_kill` | Terminate a job and its **whole process tree** (Windows `taskkill /T /F`, POSIX process-group signals) |

Key points:

- **Truly persistent**: the process is `spawn(..., { detached: true })` + `unref()`, output redirected to `%DSH_HOME%\shell-switch-jobs\<id>.log`. It keeps running after the tool call and even after a harness restart; a job still alive across a restart is marked `orphan` and can still be killed.
- **Not sandbox-confined**: `bg_start` runs outside the managed `ctx.subprocess`, so it is **not** confined by the session sandbox — background daemons and read-only confinement contradict each other. The tool description states this explicitly.
- **Log rotation**: per-job log cap `maxLogBytes` (default 8 MB, dropped from the head); retained-job cap `maxJobs` (default 50, oldest settled first).

#### Sidebar panel (`dsh-better-sidebar`)

With [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) installed, the plugin registers a "Background jobs" tab via `ctx.betterSidebar.registerTab`: **This conversation / All conversations** views (this-conversation shows only its own jobs, with a hint to switch; all groups by conversation, this one first and collapsible), a readable **session label** per group/row (cwd basename + short id) with an **Open conversation** button that jumps to the owning conversation, and a per-job **streaming log** rendered as a **terminal** (dark background, line numbers, ANSI colors / syntax tints, error-row highlighting) with **follow-latest**, **search highlight**, **copy**, **download**, and **fullscreen**; a running job can be stopped in one click. Without that plugin the tab is simply not registered.

> Note: `bg_*` tools and the sidebar tab come from the Host half, so **restarting DSH (reloading this bundle) is required after changing the plugin**; `client.js` is read from disk on demand at `/plugins/<id>/client.js`, so a page refresh picks up client changes.

### Settings → Shell selector

- The dropdown has three groups: **Bash-compatible** (Git Bash, Niubash, MSYS2, Cygwin, WSL bash), **PowerShell series** (`pwsh.exe`, the Microsoft Store alias, Windows PowerShell 5.1), and **Detected but unusable** (`cmd.exe`, Niubash's `winuxsh.exe`, WSL distributions without bash; disabled with a reason);
- Every entry shows its version and full path;
- The card shows the effective shell, the saved choice, the fallback config, and the sandbox mode;
- **Save** writes `%DSH_HOME%\shell-switch.json`; the next command uses it;
- **Reset** clears the choice and falls back to the plugin's `shell` / `shellPath` / auto-detection;
- **Rescan** re-reads the registry and refreshes versions (useful after installing a new shell; this one waits for the scan, every other call is served from cache).

### Choosing PowerShell (Windows)

The second group in the dropdown, **PowerShell series**, runs commands through the **official `pwsh` tool** (it does not swap the `bash` executor):

- selecting a PowerShell mounts the shipped `@deepseek-ai/dsh-tool-pwsh` on the Agent and hides `bash`; selecting a bash-family shell does the reverse. The model always sees exactly one shell tool;
- because the official `pwsh` tool runs the command, its parameters, sandbox facts and prompt guidance are PowerShell-native — there is no "tool called bash that wants PowerShell" mismatch;
- **commands must be PowerShell syntax**. `echo hi` works (an alias), but `pwd` is a `Get-Location` table object and `ls` is `Get-ChildItem`;
- PowerShell 7 (`pwsh.exe`, including the Microsoft Store app alias) and Windows PowerShell 5.1 are both offered; without PowerShell 7 the 5.1 entry works but lacks `&&` and other new features;
- to keep your own `$PROFILE`, set the plugin's `loadProfile` to `true` (default `false`). It applies to the plugin's own executor; the official `pwsh` tool loads profiles by its own convention.

To switch:

```text
Settings → Shell → PowerShell series → pick one → Save
```

Switching is immediate: the plugin reinstalls the tool filter on every live Agent, so the next model request sees the new tool.

### Tool visibility (Windows)

Exactly one shell tool is visible at a time:

| Selection | Mounted and visible | Hidden |
|---|---|---|
| Git Bash / Niubash / MSYS2 / Cygwin / WSL bash | `bash` | `pwsh` |
| PowerShell series | `pwsh` (official) | `bash` |

- Applies to existing and future Agents; the next model request sees the new catalog;
- hiding `pwsh` is a scope-level deny filter released when the plugin is disabled;
- with no explicit choice (`auto`) a bash-family shell is picked, so `pwsh` is hidden by default.

## How it works

```text
Agent created
  └─ agent.ctx.isolate('shell')                 one private shell scope per Agent
       ├─ ShellSwitchExecutor                   extends the shipped SandboxBashExecutor
       │    ├─ confine(cmd) → ctx.sandbox.confine(argvFor(...), policy)
       │    ├─ argvFor()    → bash: [shell, '-c', cmd]
       │    │                  WSL launcher: [shell, '-l', '-c', 'cd /mnt/c/... && <translated cmd>']
       │    └─ execute()   → local confined and full-access paths, mirroring the shipped executor
       └─ @deepseek-ai/dsh-tool-bash            official tool, registered in that Agent's tools layer
```

Key decisions:

1. **One mount per Agent** — in the Web surface each session mounts an agent preset, and tools are registered in the Agent's own scope; a context-global registration is invisible to a Session. The plugin listens for `agent/created` and also attaches to Agents that already exist.
2. **`ctx.shell` is not replaced** — it is a singleton service, and replacing it would break the `pwsh` tool. Instead the plugin provides its own `shell` inside an isolated scope, visible only to the bash tool it mounts.
3. **Shipped packages are resolved through the host** — a profile-installed plugin cannot `import '@deepseek-ai/dsh-*'` directly. The plugin anchors `createRequire` at the host process entry (`process.argv[1]`) and `import()`s the real package paths; set `DSH_INSTALL` to the installation root if resolution fails.
4. **Switching needs no restart** — the choice lives in `%DSH_HOME%\shell-switch.json` (cached by mtime) and the executor re-resolves it on every `resolve()`, so the next command uses the new shell.

### Layout

```text
.
├─ index.js             Host half: shell detection, executor, per-Agent mount, pwsh filter, settings/jobs API
├─ background.js        Persistent background-session manager (detached procs, log files, index, orphan sweep)
├─ background-tools.js  bg_start / bg_output / bg_list / bg_kill tool definitions
├─ client.js            Client half: Settings → Shell selector + better-sidebar "Background jobs" tab
├─ cordis.patch.yml     Bundle patch: inserts the single `shell-switch` row
├─ locale/             Inventory title and description (zh / en)
├─ icon.svg            Plugin icon
├─ package.json        Bundle manifest (dsh.bundle.patch + dsh.client)
├─ README.md           Chinese documentation
└─ README.en.md        English documentation
```

## Configuration

The `shell-switch` row in the profile patch:

```yaml
- id: shell-switch
  name: dsh-shell-switch
  config:
    shell: auto
```

| Field | Default | Meaning |
|---|---|---|
| `shell` | `auto` | Preset shell id: `niubash`, `git-bash`, `msys2`, `cygwin`, `bash`, `wsl`, …; `auto` picks the first bash-compatible entry |
| `shellPath` | empty | Explicit executable path; takes precedence over `shell` |
| `timeoutMs` | `120000` | Default foreground timeout |
| `maxTimeoutMs` | `600000` | Upper bound for a per-call `timeoutMs` |
| `maxOutputBytes` | `64000` | In-memory cap per stream; beyond it output spills to a file |
| `maxSpillBytes` | `67108864` | Spill-file cap |
| `graceMs` | `3000` | Grace period between termination and a forced kill |
| `loadProfile` | `false` | Load the user's `$PROFILE` for the plugin's own PowerShell executor (the official `pwsh` tool follows its own convention) |
| `background.enabled` | `true` | Enable persistent background sessions (the `bg_*` tools and the sidebar tab) |
| `background.maxLogBytes` | `8388608` | Per-job log cap (dropped from the head when exceeded) |
| `background.maxJobs` | `50` | Retained job count (oldest settled jobs pruned first) |

Resolution order: the Settings choice → `shellPath` → `shell` → auto-detection.

`%DSH_HOME%\shell-switch.json` (written by the Settings page):

```json
{
  "shell": {
    "path": "<absolute path to bash.exe>",
    "at": "2026-01-01T00:00:00.000Z"
  }
}
```

## HTTP API

Host-internal endpoints, reachable only from the same origin (used by the Settings page; opening the GUI through a LAN address or a reverse proxy works too):

| Method | Path | Meaning |
|---|---|---|
| `GET` | `/api/dsh-shell-switch/state` | Detected shells, current choice, effective shell, sandbox mode, pwsh status |
| `POST` | `/api/dsh-shell-switch/select` | `{ "path": "…" }` to select; `{ "action": "reset" }` to reset |
| `GET` | `/api/dsh-shell-switch/jobs?session=<id>` | Background jobs grouped: this conversation + others |
| `GET` | `/api/dsh-shell-switch/jobs?all=1` | All background jobs (flat list) |
| `GET` | `/api/dsh-shell-switch/jobs/<id>/log?offset=N&limit=M` | Incremental log read from byte offset |
| `POST` | `/api/dsh-shell-switch/jobs/<id>/kill` | `{ "reason": "…" }` stop the job and its tree (JSON content type) |

Abridged `/state` example:

```json
{
  "ok": true,
  "shells": [
    { "path": "<absolute path to bash.exe>", "label": "Niubash bash",
      "version": "5.3.0", "compatible": true, "source": "registry" }
  ],
  "selected": null,
  "effective": { "label": "Niubash bash", "version": "5.3.0" },
  "sandbox": { "mode": "workspace-write", "workspaceRoot": "<session workspace>" },
  "pwsh": { "hidden": true, "restrictedAgents": 1, "errorCode": null }
}
```

## Shell detection and compatibility

Detection order (de-duplicated by real path):

1. Registry `...\CurrentVersion\Uninstall`: `DisplayName` matching `Niubash` / `Winuxsh` → `winuxcmd\usr\bin\bash.exe` and friends; `DisplayName` of `Git version x.y.z` (Git for Windows' own name) → `bin\bash.exe`, `usr\bin\bash.exe`, `git-bash.exe`;
2. Common Git for Windows locations (`Program Files`, `Program Files (x86)`, `LocalAppData\Programs`);
3. **Scoop and portable installs**: `$SCOOP\apps\git\<version>\bin\bash.exe` (a Scoop git lives outside the standard paths and usually has no uninstall entry, so the roots are probed directly; when `$SCOOP` is unset, `~/scoop`, `%SystemDrive%\scoop` and `%SystemDrive%\software\scoop` are tried too);
4. `%SystemDrive%\msys64`, `msys32`, `cygwin64`, `cygwin`;
5. `bash.exe`, `pwsh.exe` and `nu.exe` on `PATH`;
6. **WSL distributions**: `wsl -l -v` produces one entry per distribution (`WSL · Ubuntu`, …), each probed for an actual `bash`; utility VMs such as `docker-desktop` are skipped;
7. PowerShell 7 / 7-preview (including the Microsoft Store `pwsh.exe` alias) and Windows PowerShell 5.1 form their own selectable group;
8. remaining dialects are listed but disabled: Niubash's `winuxsh.exe`, `cmd.exe`, and any WSL distribution where the probe found no bash.

Compatibility notes:

- **Niubash**'s `bash.exe` was verified inside DSH's restricted-token sandbox (bash 5.3.0);
- **WSL bash** (`%SystemRoot%\System32\bash.exe`) is a bash dialect, but that binary is the WSL launcher: bash runs inside the distro, where `C:\` does not exist. Selecting it makes the plugin translate the working directory and any absolute Windows path written in the command to `/mnt/<drive>/...`, and start with a login shell (`-l`). Commands then work, with caveats:
  - only literal paths in the command are translated; runtime values (e.g. paths inside environment variables) are not;
  - file permissions, line endings and path case follow Linux semantics;
  - every distribution is its own entry (launched with `wsl -d <name> -e bash`), labelled with whether it is running;
  - the plugin probes each distribution for `bash`, so one without it (for example a machine with only `docker-desktop`) is labelled "no bash" and cannot be selected — instead of failing later at command time with `execvpe(/bin/bash) ... No such file or directory`;
  - a newly installed distribution appears after pressing Rescan (Rescan clears the WSL and registry caches);
- Selecting a non-bash shell is rejected by the API (the tool only accepts bash syntax).

## Sandbox and permissions

- Commands run under the **current session's** permission preset: `read-only` / `workspace-write` / `danger-full-access`;
- In confined modes the process is wrapped by `ctx.sandbox.confine(argv, policy)` (an ACL restricted-token chain on Windows) before it starts;
- A denied file operation shows up in stderr together with the sandbox mode;
- The plugin never changes permissions, never offers a bypass, and never caches privileged results.

**The `bg_start` exception**: `bg_start` launches a **detached** process (`detached` + `unref()`) that lives outside the managed `ctx.subprocess`, so it is **not** confined by the session sandbox and runs with the current user's privileges. This is intentional — a long-lived background daemon and read-only confinement are mutually exclusive; the tool description states it explicitly. The `bash` tool's foreground commands remain sandbox-confined.

## Known limitations

- Only the model-facing `bash` tool is affected; the **sidebar terminal** does not follow the choice.
- Bash dialects (including WSL distributions that actually contain bash) and PowerShell (7 or 5.1) can be selected; `cmd.exe` and `winuxsh.exe` are listed but cannot be.
- With PowerShell selected, the official `pwsh` tool is the visible one and `bash` is hidden — prompts and skills written for bash need adjusting.
- The `pwsh` filter relies on a scope-level `tools.restrict`, therefore:
  - it applies to **existing sessions** from the next model request (not the one currently streaming);
  - disabling or removing the plugin restores `pwsh`.
- The client Settings page is registered at DSH startup; after a hot install, refresh the page (restart DSH if needed).
- Non-Windows platforms skip the `pwsh` filter (they never compose `pwsh` anyway).
- Versions can be briefly empty on the first visit to the Settings page: version probing and the registry scan warm up in the background and the page re-reads itself about a second later; an explicit **Rescan** waits for the scan synchronously.
- The registry scan (`reg query /s` over three hives) takes seconds on a real machine, so its result is cached for ten minutes and only the first use waits.

## Uninstalling and restoring pwsh

```text
plugin_manager remove_bundle  target = dsh-shell-switch
```

Or disable the `shell-switch` row. After that:

- the `bash` tool disappears (the session returns to the official tool set);
- `pwsh` comes back on Windows;
- `%DSH_HOME%\shell-switch.json` is kept and reused if the plugin is enabled again; delete it manually if not needed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No "Shell" page in Settings | The plugin was installed after startup: refresh the page, then restart DSH if it is still missing |
| No `bash` tool | Make sure row `shell-switch` is enabled and error-free; check `%TEMP%\dsh-shell-switch-debug.log` |
| "Cannot locate the DeepSeek Harness installation" | Set `DSH_INSTALL` to the DSH installation root and restart |
| "No usable bash shell" | Pick one in Settings, or install Niubash / Git Bash / MSYS2 and press Rescan |
| The selected entry is "not bash-compatible" | Choose a shell from the "Bash-compatible" group |
| A WSL distribution is labelled "no bash" and cannot be selected | That distro has no bash (e.g. `docker-desktop`); `wsl -d <name> -e bash -c 'exit 0'` fails there. Use a distro that ships bash, or Niubash / Git Bash |
| A freshly installed Git Bash or WSL distro does not appear | Press Rescan; a Scoop git needs `$SCOOP` or a default scoop root, and WSL must list the distro in `wsl -l -v` |
| A command reports a file denial | That is the session sandbox policy, not the plugin; follow DSH's permission guidance |
| `pwsh` is still there | That session predates the filter: open a new session, or wait for the next model request to rebuild the catalog |

Logs: `%TEMP%\dsh-shell-switch-debug.log` (written only on mount, tool activation and pwsh filtering).

## Development

- After an edit: `plugin_manager set_plugin` with `false` then `true` triggers a hot reload (the client half needs a page refresh);
- Syntax check: `npm run check` (equivalent to `node --check index.js && node --check client.js`);
- Debug endpoint: `GET /api/dsh-shell-switch/state` (on the machine running DSH).

## License

MIT
