# dsh-shell-switch

English | [简体中文](README.md)

Adds a **`bash` tool** and a **Settings → Shell** page to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): bash commands run in a real shell installed on the machine (Niubash, Git Bash, MSYS2, Cygwin, or any `bash.exe` on `PATH`) instead of being rewritten as PowerShell.

On Windows the shipped `pwsh` tool is hidden as well, leaving `bash` as the only shell tool.

```
Before: "ls" had to be written as Get-ChildItem (pwsh tool), or rely on dsh-ops' bundled
        MSYS bash, which often fails inside the DSH sandbox.
After:  "ls" runs in Niubash bash 5.3 directly, with the same output, exit codes,
        background jobs and spill files as the official bash tool.
```

---

## Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
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

- **A `bash` tool built on the shipped packages**: it reuses `@deepseek-ai/dsh-tool-bash` and `@deepseek-ai/dsh-bash-sandbox` and only swaps the executable. Background jobs (`run_in_background`), timeouts, output spill files, sandbox escalation and the `[exit code: N]` marker all behave exactly like the official tool.
- **Settings → Shell selector**: a dropdown listing every detected shell with version and path, plus Save, Reset and Rescan. The change applies to the **next command** — no restart.
- **`pwsh` hidden on Windows**: the shipped `pwsh` tool cannot be uninstalled, so while this plugin is active a scope-level deny filter removes it from every Agent, making `bash` the only shell tool. Disabling the plugin restores it.
- **Nothing else disturbed**: the host's `ctx.shell` executor is untouched and the `pwsh-sandbox` row stays composed; other preset tools (files, search, subagents, …) are unaffected.
- **Sandbox respected**: commands always run under the session's `ctx.sandboxPolicy`; the plugin provides no bypass.

## Requirements

| Item | Requirement |
|---|---|
| OS | Windows 10/11 (primary target; other platforms simply skip the `pwsh` filter, and shell detection targets Windows) |
| DSH | `0.2.1-rc.2` or newer (developed against `0.2.1-rc.2`) |
| Local shell | At least one bash-compatible shell: Niubash, Git Bash, MSYS2, Cygwin, or a `bash.exe` on `PATH` |
| Node | Provided by DSH; no separate install |

## Installation

### Option 1: install from a local directory (development / personal use)

```text
plugin_manager install_bundle  target = <absolute path to this repository>
```

For example, from a DSH Agent session:

```text
install_bundle: /path/to/dsh-shell-switch
```

After installation the profile's `dsh.profile.bundles` gains `dsh-shell-switch`, `node_modules/dsh-shell-switch` links to that directory, and the row id is `shell-switch`.

### Option 2: clone from GitHub, then install

```bash
git clone https://github.com/tianxingdao/dsh-shell-switch.git
```

Then install the cloned directory as the `target`, as in Option 1.

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
- Like the official bash tool, it supports `run_in_background` (paired with `job_output` / `job_kill`).

### Settings → Shell selector

- The dropdown has two groups: **Bash-compatible** (selectable) and **Detected, not bash-compatible** (WSL bash, PowerShell, cmd, Niubash's `winuxsh.exe`; disabled with a reason);
- Each bash shows its version (e.g. `5.3.0`) and full path;
- The card shows the effective shell, the saved choice, the fallback config, and the sandbox mode;
- **Save** writes `%DSH_HOME%\shell-switch.json`; the next command uses it;
- **Reset** clears the choice and falls back to the plugin's `shell` / `shellPath` / auto-detection;
- **Rescan** bypasses the 15-second cache (useful after installing a new shell).

### Hiding `pwsh` (Windows)

While this plugin is active, every Agent's tool list omits `pwsh` on Windows. This is not a composition edit and not an uninstall of the official plugin: it is a scope-level deny filter released when the plugin is disabled.

- Applies to existing and future Agents; the next model request sees the new catalog;
- To restore it: **disable or remove this plugin**.

## How it works

```text
Agent created
  └─ agent.ctx.isolate('shell')                 one private shell scope per Agent
       ├─ ShellSwitchExecutor                   extends the shipped SandboxBashExecutor
       │    ├─ confine(cmd) → ctx.sandbox.confine([<selected shell>, '-c', cmd], policy)
       │    └─ execute()   → executeArgv for danger-full-access
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
├─ index.js            Host half: shell detection, executor, per-Agent mount, pwsh filter, settings API
├─ client.js           Client half: Settings → Shell selector (slot settings.section)
├─ cordis.patch.yml    Bundle patch: inserts the single `shell-switch` row
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

Host-internal endpoints, reachable only from loopback and the same origin (used by the Settings page):

| Method | Path | Meaning |
|---|---|---|
| `GET` | `/api/dsh-shell-switch/state` | Detected shells, current choice, effective shell, sandbox mode, pwsh status |
| `POST` | `/api/dsh-shell-switch/select` | `{ "path": "…" }` to select; `{ "action": "reset" }` to reset |

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

1. Registry `...\CurrentVersion\Uninstall` entries whose `DisplayName` matches `Niubash` / `Winuxsh` → `winuxcmd\usr\bin\bash.exe`, `winuxcmd\bin\bash.exe`, and so on;
2. Common Git for Windows locations (`Program Files`, `Program Files (x86)`, `LocalAppData\Programs`);
3. `%SystemDrive%\msys64`, `msys32`, `cygwin64`, `cygwin`;
4. `bash.exe`, `pwsh.exe` and `nu.exe` on `PATH`;
5. Non-bash shells are listed but disabled: Niubash's `winuxsh.exe`, WSL `System32\bash.exe`, PowerShell 7 / 5.1, and `cmd.exe`.

Compatibility notes:

- **Niubash**'s `bash.exe` was verified inside DSH's restricted-token sandbox (bash 5.3.0);
- **WSL bash** is still bash, but Windows paths do not exist inside WSL, so it is marked incompatible;
- Selecting a non-bash shell is rejected by the API (the tool only accepts bash syntax).

## Sandbox and permissions

- Commands run under the **current session's** permission preset: `read-only` / `workspace-write` / `danger-full-access`;
- In confined modes the process is wrapped by `ctx.sandbox.confine(argv, policy)` (an ACL restricted-token chain on Windows) before it starts;
- A denied file operation shows up in stderr together with the sandbox mode;
- The plugin never changes permissions, never offers a bypass, and never caches privileged results.

## Known limitations

- Only the model-facing `bash` tool is affected; the **sidebar terminal** does not follow the choice.
- Only bash dialects are supported; WSL / PowerShell / cmd are listed but cannot be selected.
- The `pwsh` filter relies on a scope-level `tools.restrict`, therefore:
  - it applies to **existing sessions** from the next model request (not the one currently streaming);
  - disabling or removing the plugin restores `pwsh`.
- The client Settings page is registered at DSH startup; after a hot install, refresh the page (restart DSH if needed).
- Non-Windows platforms skip the `pwsh` filter (they never compose `pwsh` anyway).

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
| A command reports a file denial | That is the session sandbox policy, not the plugin; follow DSH's permission guidance |
| `pwsh` is still there | That session predates the filter: open a new session, or wait for the next model request to rebuild the catalog |

Logs: `%TEMP%\dsh-shell-switch-debug.log` (written only on mount, tool activation and pwsh filtering).

## Development

- After an edit: `plugin_manager set_plugin` with `false` then `true` triggers a hot reload (the client half needs a page refresh);
- Syntax check: `node --check index.js && node --check client.js`;
- Debug endpoint: `GET /api/dsh-shell-switch/state` (on the machine running DSH).

## License

MIT
