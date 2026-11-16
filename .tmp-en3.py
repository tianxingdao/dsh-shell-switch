import pathlib

p = pathlib.Path('README.en.md')
s = p.read_text(encoding='utf-8')

old = """- The dropdown has two groups: **Bash-compatible** (selectable, including WSL bash) and **Detected, not bash-compatible** (PowerShell, cmd, Niubash's `winuxsh.exe`; disabled with a reason);
- Each bash shows its version (e.g. `5.3.0`) and full path;"""
new = """- The dropdown has three groups: **Bash-compatible** (Git Bash, Niubash, MSYS2, Cygwin, WSL bash), **PowerShell series** (`pwsh.exe`, the Microsoft Store alias, Windows PowerShell 5.1), and **Detected but unusable** (`cmd.exe`, Niubash's `winuxsh.exe`, WSL distributions without bash; disabled with a reason);
- Every entry shows its version and full path;"""
assert old in s, 'groups anchor'
s = s.replace(old, new)

old2 = """### Choosing PowerShell (Windows)

The third group in the dropdown, **PowerShell (commands must be PowerShell syntax)**, lets the `bash` tool run its commands through PowerShell instead. The semantics change:

- **commands must be PowerShell syntax**. `echo hi` still works (`echo` is an alias of `Write-Output`), but `pwd` returns a `Get-Location` table object, `ls` is `Get-ChildItem`, and pipelines follow PowerShell rules; bash syntax produces PowerShell errors or surprising output;
- PowerShell 7 (`pwsh.exe`, including the Microsoft Store alias) and Windows PowerShell 5.1 are both offered; without PowerShell 7 the 5.1 entry works but lacks `&&` and other new features;
- the transport follows [@4fu/pi-pwsh](https://pi.dev/packages/@4fu/pi-pwsh): UTF-8 source is sent to stdin as base64 (never spliced into the command line, so a quoting mistake cannot execute half a command), with `-NoLogo -NoProfile -NonInteractive`, and `$OutputEncoding` / `[Console]::OutputEncoding` are set to BOM-less UTF-8 first so non-ASCII paths and native output are not mangled;
- to keep your own `$PROFILE`, set the plugin's `loadProfile` to `true` (default `false`, so a personal profile cannot pollute tool output).

To switch:

```text
Settings → Shell → PowerShell group → pick one → Save
```

### Hiding `pwsh` (Windows)

While this plugin is active, every Agent's tool list omits the official `pwsh` tool on Windows. This is not a composition edit and not an uninstall of the official plugin: it is a scope-level deny filter released when the plugin is disabled.

- Applies to existing and future Agents; the next model request sees the new catalog;
- To restore it: **disable or remove this plugin**;
- if you selected PowerShell as the shell above, that PowerShell runs under the `bash` tool name while the official `pwsh` stays hidden, so the model still sees exactly one shell tool."""

new2 = """### Choosing PowerShell (Windows)

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
- with no explicit choice (`auto`) a bash-family shell is picked, so `pwsh` is hidden by default."""

assert old2 in s, 'powershell section anchor'
s = s.replace(old2, new2)

s = s.replace(
  "- With PowerShell selected, the tool name is still `bash` but the syntax requirement becomes PowerShell — prompts and skills written for bash need adjusting.",
  "- With PowerShell selected, the official `pwsh` tool is the visible one and `bash` is hidden — prompts and skills written for bash need adjusting.",
)
s = s.replace(
  "| `loadProfile` | `false` | Load the user's `$PROFILE` when PowerShell is the selected shell |",
  "| `loadProfile` | `false` | Load the user's `$PROFILE` for the plugin's own PowerShell executor (the official `pwsh` tool follows its own convention) |",
)
p.write_text(s, encoding='utf-8')
print('en ok')
