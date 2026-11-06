# dsh-shell-switch

[English](README.en.md) | 简体中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）加一个 **`bash` 工具**和一个 **设置 → Shell 选择器** 页面：bash 命令直接在本机真实存在的 shell（Niubash / Git Bash / MSYS2 / Cygwin / PATH 里的 `bash.exe`）里执行，不再被改写成 PowerShell 命令。

Windows 下还会隐藏官方 `pwsh` 工具，让 `bash` 成为唯一的 shell 工具。

```
之前：模型想跑 ls → 必须写成 Get-ChildItem（pwsh 工具），或依赖 dsh-ops 自带的 MSYS bash（沙箱里经常起不来）
之后：模型跑 ls → 直接在 Niubash bash 5.3 里执行，输出、退出码、后台任务、spill 与官方 bash 工具完全一致
```

---

## 目录

- [为什么需要它](#为什么需要它)
- [功能](#功能)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [工作原理](#工作原理)
- [配置](#配置)
- [HTTP 接口](#http-接口)
- [Shell 检测与兼容性](#shell-检测与兼容性)
- [沙箱与权限](#沙箱与权限)
- [已知限制](#已知限制)
- [卸载与恢复-pwsh](#卸载与恢复-pwsh)
- [故障排查](#故障排查)
- [开发](#开发)
- [License](#license)

---

## 为什么需要它

Windows 上的 DSH 默认有两条 shell 路径：

1. **官方 `pwsh` 工具** —— 模型必须把命令写成 PowerShell 语法；对习惯 bash 的模型/提示词来说，这是持续的翻译成本。
2. **`dsh-ops` 自带的 MSYS bash** —— 在 DSH 的 Windows 受限令牌沙箱里，cygwin 初始化会失败（`NtSetInformationToken` / `CreateFileMapping ... Win32 error 5`），`ops_bash` 往往直接不可用。

同时，Windows 上装了 Niubash、Git Bash、MSYS2 的用户，这些 bash 明明能正常跑（实测 Niubash 的 `bash.exe` 在 DSH 受限令牌下工作正常），但 DSH 并没有「选择本机 shell」的能力。

本插件补上这一层：**检测本机所有 shell → 在设置页选一个 → 官方 `bash` 工具就用它执行**。

## 功能

- **`bash` 工具**：复用官方 `@deepseek-ai/dsh-tool-bash` 与 `@deepseek-ai/dsh-bash-sandbox`，只把执行文件换成你选的 shell。因此后台任务（`run_in_background`）、超时、输出 spill、沙箱升级、`[exit code: N]` 标记等行为与官方完全一致。
- **设置 → Shell 选择器**：下拉框列出本机所有 shell（含版本、路径），支持保存、恢复默认、重新扫描；保存后**下一条命令即生效**，无需重启。
- **Windows 下隐藏 `pwsh`**：官方 `pwsh` 工具无法卸载，但只要本插件启用，就对每个 Agent 加作用域级屏蔽，`bash` 成为唯一 shell 工具；停用插件即恢复。
- **不破坏现有能力**：不改宿主的 `ctx.shell` 执行器，`pwsh` 执行器行原样保留；其他预设工具（文件、搜索、子代理等）不受影响。
- **尊重沙箱**：命令始终按当前会话的 `ctx.sandboxPolicy` 执行，插件不提供任何绕过。

## 环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10/11（主要目标；非 Windows 会退化为不过滤 `pwsh`，检测逻辑也面向 Windows） |
| DSH | `>=0.2.1-rc.2 <0.3.0`（见 `package.json` 的 `engines.dsh`；开发与验证于 `0.2.1-rc.5`） |
| Node | `>=20`（DSH 自带，无需单独安装） |
| 本机 shell | 至少一个 bash 兼容 shell：Niubash、Git Bash、MSYS2、Cygwin，或 PATH 上的 `bash.exe` |

### 兼容性声明

manifest 同时写入两处声明，市场与安装前检查都会读取：

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

- `engines.dsh` 说明支持的 DSH 版本线（`0.2.1` 系列），超出范围时市场会直接标记为不兼容；
- peer 只声明、不安装：这些包由宿主 DSH 提供，插件运行时通过宿主安装目录解析（见[工作原理](#工作原理)），所以全部标为 `optional`，避免被复制进 profile 造成两份实例；
- 升级到 DSH `0.3.x` 时需要同步放宽这两个范围后再发布新版本。

## 安装

### 方式一：从 npm 安装（推荐）

```bash
dsh plugin add dsh-shell-switch
```

或在 DSH 的 Agent 会话里：

```text
plugin_manager install_bundle  target = dsh-shell-switch
```

预构建包不需要构建授权，安装后为 `node_modules/dsh-shell-switch`。

### 方式二：从本地目录安装（开发 / 自用）

```text
plugin_manager install_bundle  target = <本仓库的绝对路径>
```

例如在 DSH 的 Agent 会话里：

```text
install_bundle: /path/to/dsh-shell-switch
```

安装后 profile 的 `dsh.profile.bundles` 会增加 `dsh-shell-switch`，`node_modules/dsh-shell-switch` 指向该目录（link），行 id 为 `shell-switch`。

### 方式三：从 GitHub 克隆后安装

```bash
git clone https://github.com/tianxingdao/dsh-shell-switch.git
```

然后把克隆出来的目录作为 `target`，按方式二安装。

### 安装后确认

- 新会话的工具列表里出现 `bash`；
- **更多 → 设置 → Shell** 出现「Shell 选择器」；
- （Windows）`pwsh` 不再出现在工具列表。

> 客户端页面在 Harness 启动时注册。安装后若设置页未出现，先刷新页面；仍未出现则重启一次 DSH。

## 使用

### `bash` 工具

```text
bash: {
  command:  "git status --short && npm test",
  workdir:  "<项目目录>",   // 可选，默认会话工作目录
  timeoutMs: 120000          // 可选，受配置上限约束
}
```

- 每次调用都是全新 shell，`cd` / 变量 / 函数不跨调用保留；
- 结果末尾是机器可读标记：`[exit code: N]`、`[killed by signal]` 或 `[timeout after N ms]`；
- 输出超限会截断并提示，完整流在 spill 文件里；
- 与官方 bash 工具一样支持 `run_in_background`（配合 `job_output` / `job_kill`）。

### 设置 → Shell 选择器

- 下拉框分两组：**可用于 bash**（可选择）与 **已检测到，但不是 bash 方言**（WSL bash、PowerShell、cmd、Niubash 的 `winuxsh.exe`，禁用并标注原因）；
- 每个 bash 显示版本（如 `5.3.0`）与完整路径；
- 卡片显示当前生效 shell、已保存选择、回退配置、沙箱模式；
- **保存**：写入 `%DSH_HOME%\shell-switch.json`，下一条命令生效；
- **恢复默认**：清除选择，回落到插件配置的 `shell` / `shellPath` / 自动检测；
- **重新扫描**：忽略 15 秒缓存重新检测（装了新 shell 后点一下）。

### 隐藏 `pwsh`（Windows）

本插件启用期间，Windows 下每个 Agent 的工具列表都会去掉 `pwsh`。这不是改组合、也不是卸载官方插件，而是在 Agent 作用域上加一条 deny 过滤，随插件卸载释放。

- 现存与新建 Agent 都生效，下一条模型请求即可看到新工具列表；
- 想恢复：**停用或卸载本插件**。

## 工作原理

```text
Agent 创建
  └─ agent.ctx.isolate('shell')                 每个 Agent 一个独立 shell 作用域
       ├─ ShellSwitchExecutor                   继承官方 SandboxBashExecutor
       │    ├─ confine(cmd) → ctx.sandbox.confine([<选中 shell>, '-c', cmd], policy)
       │    └─ execute()   → danger-full-access 时走 executeArgv
       └─ @deepseek-ai/dsh-tool-bash            官方工具，注册进该 Agent 的 tools 层
```

几个关键点：

1. **为什么每个 Agent 一份**：Web 端每个会话挂的是 agent preset，工具注册在 Agent 自己的作用域里；全局注册对 Session 不可见。所以插件监听 `agent/created`，并为已存在的 Agent 补挂。
2. **为什么不动 `ctx.shell`**：`ctx.shell` 是单例服务，替换它会连带破坏 `pwsh` 工具。这里改为在隔离作用域里提供自己的 `shell`，只有挂载的官方 bash 工具能看到它。
3. **为什么能加载官方包**：profile 里的插件无法直接 `import '@deepseek-ai/dsh-*'`。插件以宿主进程入口（`process.argv[1]`）为锚点 `createRequire`，再 `import()` 官方包的真实路径；解析失败时可用 `DSH_INSTALL` 指定安装根目录。
4. **为什么切换不用重启**：选择存在 `%DSH_HOME%\shell-switch.json`（按 mtime 缓存），执行器每次 `resolve()` 重新解析，所以保存后下一条命令就换 shell。

### 目录结构

```text
.
├─ index.js            Host 半：shell 检测、执行器、按 Agent 挂载、pwsh 屏蔽、设置 API
├─ client.js           Client 半：设置 → Shell 选择器（slot settings.section）
├─ cordis.patch.yml    bundle 补丁，只插入一行 shell-switch
├─ locale/             插件清单里的标题与描述（zh / en）
├─ icon.svg            插件图标
├─ package.json        bundle 清单（dsh.bundle.patch + dsh.client）
├─ README.md           中文说明
└─ README.en.md        英文说明
```

## 配置

profile patch 中的 `shell-switch` 行：

```yaml
- id: shell-switch
  name: dsh-shell-switch
  config:
    shell: auto
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `shell` | `auto` | 预设 shell id：`niubash`、`git-bash`、`msys2`、`cygwin`、`bash`、`wsl` 等；`auto` 取第一个 bash 兼容项 |
| `shellPath` | 空 | 显式可执行文件路径，优先于 `shell` |
| `timeoutMs` | `120000` | 前台命令默认超时 |
| `maxTimeoutMs` | `600000` | 单次 `timeoutMs` 上限 |
| `maxOutputBytes` | `64000` | 单流输出内存上限，超出转存 spill 文件 |
| `maxSpillBytes` | `67108864` | spill 文件上限 |
| `graceMs` | `3000` | 终止到强杀的宽限期 |

选择优先级：设置页保存的路径 → `shellPath` → `shell` → 自动检测。

`%DSH_HOME%\shell-switch.json`（设置页保存的值）：

```json
{
  "shell": {
    "path": "<bash.exe 的绝对路径>",
    "at": "2026-01-01T00:00:00.000Z"
  }
}
```

## HTTP 接口

Host 内部接口，仅同源页面可访问（供设置页使用；通过局域网 IP 或反向代理打开 GUI 同样可用）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/dsh-shell-switch/state` | 检测列表、当前选择、生效项、沙箱模式、pwsh 状态 |
| `POST` | `/api/dsh-shell-switch/select` | `{ "path": "…" }` 选择；`{ "action": "reset" }` 恢复默认 |

`/state` 示例（截断）：

```json
{
  "ok": true,
  "shells": [
    { "path": "<bash.exe 的绝对路径>", "label": "Niubash bash",
      "version": "5.3.0", "compatible": true, "source": "registry" }
  ],
  "selected": null,
  "effective": { "label": "Niubash bash", "version": "5.3.0" },
  "sandbox": { "mode": "workspace-write", "workspaceRoot": "<会话工作目录>" },
  "pwsh": { "hidden": true, "restrictedAgents": 1, "errorCode": null }
}
```

## Shell 检测与兼容性

检测顺序（按真实路径去重）：

1. 注册表 `...\CurrentVersion\Uninstall` 中 `DisplayName` 含 `Niubash` / `Winuxsh` 的 `InstallLocation` → `winuxcmd\usr\bin\bash.exe`、`winuxcmd\bin\bash.exe` 等；
2. Git for Windows 常见位置（`Program Files`、`Program Files (x86)`、`LocalAppData\Programs`）；
3. `%SystemDrive%\msys64`、`msys32`、`cygwin64`、`cygwin`；
4. `PATH` 里的 `bash.exe`、`pwsh.exe`、`nu.exe`；
5. 非 bash 方言也会列出但禁用：Niubash 的 `winuxsh.exe`、WSL `System32\bash.exe`、PowerShell 7 / 5.1、`cmd.exe`。

兼容性说明：

- **Niubash** 的 `bash.exe` 在 DSH 受限令牌沙箱内实测可用（bash 5.3.0）；
- **WSL bash** 虽然也是 bash，但 Windows 路径在 WSL 内不存在，默认标记为不兼容；
- 选中非 bash 方言会被接口拒绝（该工具只接受 bash 语法）。

## 沙箱与权限

- 命令按**当前会话**的权限预设执行：`read-only` / `workspace-write` / `danger-full-access`；
- 受限模式通过 `ctx.sandbox.confine(argv, policy)`（Windows 上为 ACL 受限令牌链）包装后才启动进程；
- 文件被拒绝时会在 stderr 出现拒绝信息，并带上沙箱模式说明；
- 插件本身不改变权限、不提供绕过，也不缓存特权结果。

## 已知限制

- 只影响模型侧的 `bash` 工具；**侧边栏终端**不跟随该选择。
- 只支持 bash 方言；WSL / PowerShell / cmd 只能展示，不能选。
- `pwsh` 屏蔽依赖 Agent 作用域的 `tools.restrict`，所以：
  - 对**已存在的会话**在下一条模型请求生效（不是当前正在流式输出的那条）；
  - 插件被停用/卸载后自动恢复。
- 客户端设置页在 DSH 启动时注册；插件热装后需要刷新页面（必要时重启 DSH）。
- 非 Windows 平台不做 `pwsh` 过滤（那些平台本来也不会组合 `pwsh`）。

## 卸载与恢复 pwsh

```text
plugin_manager remove_bundle  target = dsh-shell-switch
```

或停用条目 `shell-switch`。停用后：

- `bash` 工具消失（会话恢复官方工具集）；
- Windows 下 `pwsh` 工具恢复；
- `%DSH_HOME%\shell-switch.json` 保留，重新启用后继续生效；不需要时可手动删除。

## 故障排查

| 现象 | 处理 |
|---|---|
| 设置页没有「Shell」 | 插件是启动后安装的：刷新页面；仍没有则重启 DSH |
| 工具列表里没有 `bash` | 确认行 `shell-switch` 处于启用状态且无报错；查看 `%TEMP%\dsh-shell-switch-debug.log` |
| 报错找不到 DSH 安装 | 设置环境变量 `DSH_INSTALL` 指向 DSH 安装根目录后重启 |
| 报错「没有可用的 bash shell」 | 在设置页选择，或安装 Niubash/Git Bash/MSYS2 后点「重新扫描」 |
| 选中项显示「不是 bash 方言」 | 换一个「可用于 bash」分组里的 shell |
| 命令报文件拒绝 | 属于会话沙箱策略，不是插件；按 DSH 的权限提示处理 |
| pwsh 还在 | 该会话是在屏蔽前创建的：新开一个会话，或等下一次模型请求重算工具目录 |

日志：`%TEMP%\dsh-shell-switch-debug.log`（只在挂载、工具激活、屏蔽时写入）。

## 开发

- 修改后：`plugin_manager set_plugin` 先 `false` 再 `true` 触发热重载（客户端需刷新页面）；
- 语法检查：`npm run check`（等价于 `node --check index.js && node --check client.js`）；
- 调试端点：`GET /api/dsh-shell-switch/state`（在 DSH 进程所在机器上）。

### 发布到 npm

```bash
npm login --registry https://registry.npmjs.org/
npm version patch          # 或 minor / major
npm publish                # prepublishOnly 会先跑语法检查
```

包已声明 `publishConfig.registry`，因此即使用户 npmrc 指向镜像也会发布到 npmjs。发布后无需重新提交列表：市场按包名匹配，预构建安装会自动取代源码安装。

两点与新版 npm 相关：

- 账号开了 2FA 且为「仅登录（Authorization only）」时，OTP 不能用于发布，需要带 **Bypass 2FA** 的 granular access token；
- npm 对**新包**启用了分阶段发布（staged publishing），首次发布会自动生成一个公开的 `0.0.0-stage` 占位版本，真正版本随后写入；`npm view` 可能短暂显示 `0.0.0-stage`，属正常现象。

## License

MIT
