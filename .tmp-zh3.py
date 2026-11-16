import pathlib

p = pathlib.Path('README.md')
s = p.read_text(encoding='utf-8')

old = """- 下拉框分两组：**可用于 bash**（可选择，含 WSL bash）与 **已检测到，但不是 bash 方言**（PowerShell、cmd、Niubash 的 `winuxsh.exe`，禁用并标注原因）；
- 每个 bash 显示版本（如 `5.3.0`）与完整路径；"""
new = """- 下拉框分三组：**可用于 bash**（Git Bash、Niubash、MSYS2、Cygwin、WSL bash）、**PowerShell系列**（`pwsh.exe`、Microsoft Store 别名、Windows PowerShell 5.1）、**已检测到但不可用**（`cmd.exe`、Niubash 的 `winuxsh.exe`、没有 bash 的 WSL 发行版，禁用并标注原因）；
- 每一项显示版本与完整路径；"""
assert old in s, 'group anchor'
s = s.replace(old, new)

old2 = """### 选择 PowerShell（Windows）

下拉框第三组「PowerShell（命令需为 PowerShell 语法）」里可以选择 PowerShell，此时 `bash` 工具改用该 PowerShell 执行命令。注意语义变化：

- **命令必须是 PowerShell 语法**。`echo hi` 仍能工作（`echo` 是 `Write-Output` 的别名），但 `pwd` 返回的是 `Get-Location` 的表对象、`ls` 是 `Get-ChildItem`，管道语义也按 PowerShell 走；写 bash 语法会得到 PowerShell 的报错或意外结果；
- 支持 PowerShell 7（`pwsh.exe`，含 Microsoft Store 别名）与 Windows PowerShell 5.1；未安装 PowerShell 7 时 5.1 也能选，但缺少 `&&` 等新特性；
- 实现方式参考 [@4fu/pi-pwsh](https://pi.dev/packages/@4fu/pi-pwsh)：UTF-8 源码经 stdin 以 base64 传入（不拼进命令行，避免引用错误被当成命令执行），`-NoLogo -NoProfile -NonInteractive`，并在执行前把 `$OutputEncoding` / `[Console]::OutputEncoding` 设为无 BOM 的 UTF-8，避免中文路径或原生程序输出乱码；
- 想保留自己的 `$PROFILE`：把插件配置 `loadProfile` 设为 `true`（默认 `false`，以免个人配置影响工具输出）。

切换用法：

```text
设置 → Shell → PowerShell 分组 → 选一个 → 保存
```

### 隐藏 `pwsh`（Windows）

本插件启用期间，Windows 下每个 Agent 的工具列表都会去掉官方 `pwsh` 工具。这不是改组合、也不是卸载官方插件，而是在 Agent 作用域上加一条 deny 过滤，随插件卸载释放。

- 现存与新建 Agent 都生效，下一条模型请求即可看到新工具列表；
- 想恢复：**停用或卸载本插件**；
- 若你在上面选择了 PowerShell 作为 shell，插件会用 `bash` 这个名字执行 PowerShell，官方 `pwsh` 依旧隐藏，因此模型只会看到一个 shell 工具。"""

new2 = """### 选择 PowerShell（Windows）

下拉框第二组「PowerShell系列」里可以选择 PowerShell。此时**由官方 `pwsh` 工具执行命令**（不是换掉 `bash` 的执行器）：

- 选中 PowerShell 后，插件在 Agent 上挂载官方 `@deepseek-ai/dsh-tool-pwsh`，并隐藏 `bash`；选中 bash 系列时反过来，挂载 `bash` 并隐藏 `pwsh`。模型始终只看到一个 shell 工具；
- 命令走官方 `pwsh` 工具，因此参数、沙箱事实、提示词说明都是 PowerShell 原生的，不会有「工具叫 bash 却要写 PowerShell」的错位；
- **命令必须是 PowerShell 语法**。`echo hi` 可用（别名），但 `pwd` 是 `Get-Location` 的表对象、`ls` 是 `Get-ChildItem`；
- 支持 PowerShell 7（`pwsh.exe`，含 Microsoft Store 应用别名）与 Windows PowerShell 5.1；未装 7 时 5.1 也能选，但缺 `&&` 等新特性；
- 想保留自己的 `$PROFILE`：把插件配置 `loadProfile` 设为 `true`（默认 `false`，以免个人配置影响工具输出）。该设置作用于插件自带的执行器；官方 `pwsh` 工具按它自己的约定加载配置。

切换用法：

```text
设置 → Shell → PowerShell系列 → 选一个 → 保存
```

切换是即时的：保存后插件会重新给现有 Agent 安装工具筛选，下一条模型请求就能看到新的工具。

### 工具可见性（Windows）

同一时刻只保留一个 shell 工具：

| 当前选择 | 挂载并可见 | 隐藏 |
|---|---|---|
| Git Bash / Niubash / MSYS2 / Cygwin / WSL bash | `bash` | `pwsh` |
| PowerShell系列 | `pwsh`（官方） | `bash` |

- 现存与新建 Agent 都生效，下一条模型请求即可看到新工具列表；
- `pwsh` 的隐藏是 Agent 作用域上的一条 deny 过滤，随插件卸载/停用释放；
- 未选择时（`auto`）按可用项自动选一个 bash 系列，因此默认隐藏 `pwsh`。"""
assert old2 in s, 'powershell section anchor'
s = s.replace(old2, new2)
p.write_text(s, encoding='utf-8')
print('zh ok')
