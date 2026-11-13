/**
 * dsh-shell-switch — Host half.
 *
 * Adds a `bash` tool that runs commands in a shell this machine actually has
 * (Niubash, Git Bash, MSYS2, Cygwin, or any `bash.exe` on PATH) instead of
 * rewriting them for PowerShell, plus a **Settings → Shell** page that lists
 * every local shell so the choice can change without a restart.
 *
 * The PowerShell tool and the host's own `ctx.shell` executor stay untouched:
 * each Agent gets a private `shell` service scope and its own copy of the
 * shipped `@deepseek-ai/dsh-tool-bash`, so background jobs, spill files and the
 * sandbox escalation surface keep working exactly as the official tool does.
 *
 * Settings API (loopback, same origin):
 *   GET  /api/dsh-shell-switch/state     detected shells + the effective one
 *   POST /api/dsh-shell-switch/select    { path } or { action: 'reset' }
 *
 * The choice lives in `$DSH_HOME/shell-switch.json` and is re-read per command.
 *
 * @module dsh-shell-switch
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = '/api/dsh-shell-switch';
const SETTINGS_FILE = 'shell-switch.json';
const DEFAULT_SHELL = 'auto';
const isWin = process.platform === 'win32';

/**
 * Resolve a package that ships with the running DeepSeek Harness installation.
 * A profile-installed bundle cannot resolve `@deepseek-ai/dsh-*` on its own, so
 * the host process's own entry point is used as the resolution anchor.
 * @returns {NodeRequire} a require anchored inside the DSH installation.
 */
function dshRequire() {
  const anchors = [];
  if (process.argv[1] !== undefined) anchors.push(process.argv[1]);
  if (process.env.DSH_INSTALL !== undefined) anchors.push(path.join(process.env.DSH_INSTALL, 'package.json'));
  anchors.push(path.join(process.cwd(), 'package.json'));
  const probes = [];
  for (const anchor of anchors) {
    try {
      const req = createRequire(anchor);
      req.resolve('@deepseek-ai/dsh-shell');
      return req;
    } catch (error) {
      probes.push(`${anchor}: ${error?.code ?? error}`);
    }
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-shell', 'lib', 'index.js');
    if (fs.existsSync(candidate)) return createRequire(candidate);
    dir = path.dirname(dir);
  }
  throw new Error(
    `dsh-shell-switch: cannot locate the DeepSeek Harness installation (tried ${probes.join('; ')}); set DSH_INSTALL to its directory`,
  );
}

const dsh = dshRequire();
const loadShipped = (id) => import(pathToFileURL(dsh.resolve(id)).href);

/**
 * The shipped packages, loaded once and reused.
 *
 * Loading is deferred until {@link shipped} is first awaited: creating an
 * Agent must not pay for three dynamic imports, and only attaching an Agent
 * actually needs these modules. A second Agent reuses the same promise.
 * @returns {Promise<{ SandboxBashExecutor: Function, toolBash: object }>} the loaded modules.
 */
let shippedPromise;
function shipped() {
  shippedPromise ??= Promise.all([
    loadShipped('@deepseek-ai/dsh-bash-sandbox'),
    loadShipped('@deepseek-ai/dsh-tool-bash'),
  ]).then(([sandbox, tool]) => ({ SandboxBashExecutor: sandbox.SandboxBashExecutor, toolBash: tool }));
  return shippedPromise;
}

/** The schemastery instance, loaded in parallel with the first Agent attach. */
let schemasteryPromise;
function schemastery() {
  schemasteryPromise ??= loadShipped('@deepseek-ai/schemastery').then((module) => module.default ?? module);
  return schemasteryPromise;
}

const z = await schemastery();

/** Plugin config: the bash executor's budgets plus the shell choice. */
export const Config = z.object({
  shell: z.string().default(DEFAULT_SHELL).volatile(),
  shellPath: z.string().default('').volatile(),
  cwd: z.string().volatile(),
  timeoutMs: z.number().default(120000).volatile(),
  maxTimeoutMs: z.number().default(600000).volatile(),
  maxOutputBytes: z.number().default(64000).volatile(),
  maxSpillBytes: z.number().default(64 * 1024 * 1024).volatile(),
  graceMs: z.number().default(3000).volatile(),
});

/** Append one line to a debug log; diagnostics must never break activation. */
function debug(...parts) {
  try {
    const line = `${new Date().toISOString()} [${process.pid}] ${parts
      .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
      .join(' ')}\n`;
    fs.appendFileSync(path.join(os.tmpdir(), 'dsh-shell-switch-debug.log'), line, 'utf8');
  } catch {
    // ignore
  }
}

/** Read a config value that may be a plain value or a schemastery Volatile cell. */
function valueOf(cell, fallback) {
  if (cell !== undefined && cell !== null && typeof cell.get === 'function') return cell.get();
  return cell ?? fallback;
}

/**
 * Normalize a row config into the Volatile shape the shipped executor reads.
 * The executor is constructed by hand here, so wrapping is this plugin's job.
 * @param {Record<string, unknown>} config - the row config.
 * @returns {Record<string, { get: () => unknown }>} the executor config.
 */
function executorConfig(config) {
  const cell = (value, fallback) => {
    const resolved = value ?? fallback;
    if (resolved !== null && typeof resolved === 'object' && typeof resolved.get === 'function') return resolved;
    return { get: () => resolved };
  };
  return {
    shell: cell(config?.shell, DEFAULT_SHELL),
    shellPath: cell(config?.shellPath, ''),
    cwd: cell(config?.cwd, undefined),
    timeoutMs: cell(config?.timeoutMs, 120000),
    maxTimeoutMs: cell(config?.maxTimeoutMs, 600000),
    maxOutputBytes: cell(config?.maxOutputBytes, 64000),
    maxSpillBytes: cell(config?.maxSpillBytes, 64 * 1024 * 1024),
    graceMs: cell(config?.graceMs, 3000),
  };
}

/** The per-user preferences file, outside any session so every agent sees it. */
function selectionFile() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, SETTINGS_FILE);
}

let storeCache = { at: -1, value: null };

/**
 * Read the preferences store.
 *
 * Shape: `{ shell: { path, at } | null }`. Version 0.1 wrote the shell path at
 * the top level, and 0.2 added a now-removed `disablePwsh` flag; both older
 * shapes are tolerated on read and normalized on the next write.
 * @returns {{ shell: { path: string, at?: string } | null }} the store.
 */
function readStore() {
  const file = selectionFile();
  let stamp = 0;
  try {
    stamp = fs.statSync(file).mtimeMs;
  } catch {
    stamp = 0;
  }
  if (storeCache.at === stamp) return storeCache.value;
  let shell = null;
  if (stamp !== 0) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const candidate = parsed?.shell ?? parsed;
      if (typeof candidate?.path === 'string' && candidate.path.length > 0) {
        shell = { path: candidate.path, at: candidate.at ?? parsed?.at };
      }
    } catch {
      // A corrupt file behaves like an empty one.
    }
  }
  storeCache = { at: stamp, value: { shell } };
  return storeCache.value;
}

/**
 * Merge a patch into the store and persist it.
 * @param {{ shell?: { path: string, at?: string } | null }} patch - fields to replace.
 * @returns {{ shell: { path: string, at?: string } | null }} the new store.
 */
function writeStore(patch) {
  const next = { ...readStore(), ...patch };
  const payload = next.shell === null || next.shell === undefined
    ? {}
    : { shell: { path: next.shell.path, at: next.shell.at ?? new Date().toISOString() } };
  const file = selectionFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  storeCache = { at: -1, value: null };
  return readStore();
}

/** The stored shell choice, if any. */
const readSelection = () => readStore().shell;
/** Remember one shell path. */
const writeSelection = (shellPath) => writeStore({ shell: { path: shellPath, at: new Date().toISOString() } });
/** Forget the shell choice. */
const clearSelection = () => writeStore({ shell: null });

/** Installed programs whose `InstallLocation` names a shell family. */
/**
 * Installed programs whose `InstallLocation` names a shell family.
 *
 * Querying each hive recursively costs seconds on a real machine (HKLM alone
 * measured ~5 s), so it is warmed once in the background and cached for ten
 * minutes. The first page load may therefore show only the well-known and PATH
 * shells; the next refresh adds registered installs.
 * @param {boolean} [wait] - block until the scan finishes (only for explicit rescans).
 * @returns {string[]} install locations of shell-family programs.
 */
let registryCache = { at: 0, locations: [], promise: null };

function registryScan() {
  if (!isWin) return { at: Date.now(), locations: [] };
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const locations = [];
  for (const key of keys) {
    let output = '';
    try {
      output = execFileSync('reg.exe', ['query', key, '/s'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch {
      continue;
    }
    for (const block of output.split(/\r?\n\s*\r?\n/)) {
      if (!/niubash|winuxsh/i.test(block)) continue;
      const match = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(block);
      if (match !== null && match[1].trim().length > 0) locations.push(match[1].trim());
    }
  }
  return { at: Date.now(), locations };
}

/**
 * Non-blocking view of the registry scan: start one pass if the cache is cold,
 * return whatever is known right now.
 * @returns {string[]} cached install locations (empty while the first scan runs).
 */
function uninstallLocations() {
  if (!isWin) return [];
  const fresh = Date.now() - registryCache.at < 600000;
  if (fresh || registryCache.promise !== null) return registryCache.locations;
  registryCache.promise = new Promise((resolve) => {
    setImmediate(() => {
      try {
        registryCache = registryScan();
      } catch {
        registryCache = { at: Date.now(), locations: [] };
      } finally {
        if (registryCache.promise !== null) registryCache.promise = null;
        resolve(undefined);
      }
    });
  });
  return registryCache.locations;
}

/** Wait for the registry scan (explicit rescan only). */
async function uninstallLocationsSettled() {
  uninstallLocations();
  if (registryCache.promise !== null) await registryCache.promise;
  return registryCache.locations;
}

/** Well-known shell executables on Windows. */
function knownShells() {
  const t0 = Date.now();
  const env = process.env;
  const winRoot = env.SystemRoot ?? 'C:\\Windows';
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const systemDrive = env.SystemDrive ?? 'C:';
  const entries = [];
  const add = (candidate, meta) => entries.push({ path: candidate, ...meta });

  const tReg = Date.now();
  const locations = uninstallLocations();
  debug('known-shells', 'registry=' + (Date.now() - tReg) + 'ms', 'locations=' + locations.length);
  for (const location of locations) {
    for (const relative of [
      'winuxcmd\\usr\\bin\\bash.exe',
      'winuxcmd\\bin\\bash.exe',
      'usr\\bin\\bash.exe',
      'bin\\bash.exe',
      'bash.exe',
    ]) {
      add(path.join(location, relative), {
        id: 'niubash',
        label: 'Niubash bash',
        kind: 'bash',
        compatible: true,
        source: 'registry',
      });
    }
    add(path.join(location, 'winuxsh.exe'), {
      id: 'niubash-interactive',
      label: 'Niubash winuxsh.exe',
      kind: 'interactive',
      compatible: false,
      source: 'registry',
    });
  }

  for (const candidate of [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
  ]) {
    add(candidate, { id: 'git-bash', label: 'Git Bash', kind: 'bash', compatible: true, source: 'well-known' });
  }

  for (const candidate of [
    path.join(`${systemDrive}\\`, 'msys64', 'usr', 'bin', 'bash.exe'),
    path.join(`${systemDrive}\\`, 'msys32', 'usr', 'bin', 'bash.exe'),
  ]) {
    add(candidate, { id: 'msys2', label: 'MSYS2 bash', kind: 'bash', compatible: true, source: 'well-known' });
  }

  for (const candidate of [
    path.join(`${systemDrive}\\`, 'cygwin64', 'bin', 'bash.exe'),
    path.join(`${systemDrive}\\`, 'cygwin', 'bin', 'bash.exe'),
  ]) {
    add(candidate, { id: 'cygwin', label: 'Cygwin bash', kind: 'bash', compatible: true, source: 'well-known' });
  }

  add(path.join(winRoot, 'System32', 'bash.exe'), {
    id: 'wsl',
    label: 'WSL bash',
    kind: 'wsl',
    compatible: false,
    source: 'well-known',
  });
  add(path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'), {
    id: 'pwsh',
    label: 'PowerShell 7',
    kind: 'powershell',
    compatible: false,
    source: 'well-known',
  });
  add(path.join(programFiles, 'PowerShell', '7-preview', 'pwsh.exe'), {
    id: 'pwsh-preview',
    label: 'PowerShell 7 Preview',
    kind: 'powershell',
    compatible: false,
    source: 'well-known',
  });
  add(path.join(winRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), {
    id: 'powershell',
    label: 'Windows PowerShell 5.1',
    kind: 'powershell',
    compatible: false,
    source: 'well-known',
  });
  add(path.join(winRoot, 'System32', 'cmd.exe'), { id: 'cmd', label: 'cmd.exe', kind: 'cmd', compatible: false, source: 'well-known' });
  return entries;
}

/** Executables named on PATH. */
function pathShells() {
  const entries = [];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter((item) => item.length > 0)) {
    const base = path.basename(dir);
    for (const exe of ['bash.exe', 'pwsh.exe', 'nu.exe']) {
      const candidate = path.join(dir, exe);
      if (!fs.existsSync(candidate)) continue;
      if (exe === 'bash.exe') {
        const id = /git/i.test(dir)
          ? 'git-bash'
          : /niubash|winuxsh/i.test(dir)
            ? 'niubash'
            : /msys/i.test(dir)
              ? 'msys2'
              : /cygwin/i.test(dir)
                ? 'cygwin'
                : 'bash';
        entries.push({ path: candidate, id, label: `bash · ${base}`, kind: 'bash', compatible: true, source: 'path' });
      } else if (exe === 'nu.exe') {
        entries.push({ path: candidate, id: 'nushell', label: 'Nushell', kind: 'nu', compatible: false, source: 'path' });
      } else {
        entries.push({ path: candidate, id: 'pwsh', label: 'PowerShell 7 (PATH)', kind: 'powershell', compatible: false, source: 'path' });
      }
    }
  }
  return entries;
}

let discovery = { at: 0, shells: [] };

/**
 * Detect every local shell, de-duplicated by real path.
 * @param {boolean} refresh - ignore the short-lived cache.
 * @returns {Array<Record<string, unknown>>} the detected shells.
 */
async function discoverShells(refresh = false) {
  if (!refresh && Date.now() - discovery.at < 15000) return discovery.shells;
  // Wait for the registry scan only while it is on its very first pass: the
  // result is what lets a Niubash install be discovered at all, and waiting
  // once (a few seconds) is better than a list that silently misses it.
  if (registryCache.at === 0) await uninstallLocationsSettled();
  const t0 = Date.now();
  const tKnown = Date.now();
  const known = knownShells();
  const tPath = Date.now();
  const onPath = pathShells();
  debug('discover', 'known=' + (tPath - tKnown) + 'ms', 'path=' + (Date.now() - tPath) + 'ms', 'total=' + (Date.now() - t0) + 'ms');
  const shells = [];
  const seen = new Set();
  for (const entry of [...known, ...onPath]) {
    let real;
    try {
      real = fs.realpathSync.native(entry.path);
      if (!fs.statSync(real).isFile()) continue;
    } catch {
      continue;
    }
    const key = real.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    shells.push({
      path: real,
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      compatible: entry.compatible === true,
      source: entry.source ?? '',
      version: '',
    });
  }
  shells.sort((a, b) => Number(b.compatible) - Number(a.compatible) || a.label.localeCompare(b.label));
  discovery = { at: Date.now(), shells };
  return shells;
}

const versions = new Map();
let versionsWarming = false;

/**
 * Best-effort version probe for one shell; cached for ten minutes.
 * @param {Record<string, unknown>} shell - a detected shell.
 * @returns {string} the version, or an empty string when it cannot be read.
 */
function probeVersion(shell) {
  const cached = versions.get(shell.path);
  if (cached !== undefined && Date.now() - cached.at < 600000) return cached.version;
  let version = '';
  try {
    if (shell.kind === 'bash') {
      const output = execFileSync(shell.path, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1200,
        maxBuffer: 64 * 1024,
      });
      version = /version\s+([0-9][^\s(]*)/i.exec(output)?.[1] ?? (output.split(/\r?\n/)[0] ?? '').trim();
    }
  } catch {
    version = '';
  }
  versions.set(shell.path, { at: Date.now(), version });
  return version;
}

/**
 * Fill in versions for compatible shells without blocking the request.
 *
 * Running `bash --version` costs tens of milliseconds per shell and the probe
 * is synchronous, so probing inside the request makes the page wait every time
 * it opens. Instead the response carries whatever is cached (empty on the first
 * call) and one background pass fills the cache; the page's next refresh shows
 * the versions.
 * @param {Array<Record<string, unknown>>} shells - detected shells.
 * @returns {Array<Record<string, unknown>>} shells annotated with cached versions.
 */
function withVersions(shells) {
  const pending = shells.filter((shell) => shell.compatible && !versions.has(shell.path));
  if (pending.length > 0 && !versionsWarming) {
    versionsWarming = true;
    setImmediate(() => {
      try {
        for (const shell of pending) probeVersion(shell);
      } finally {
        versionsWarming = false;
      }
    });
  }
  return shells.map((shell) => {
    const cached = versions.get(shell.path);
    return { ...shell, version: cached?.version ?? '' };
  });
}

/** Does this path name one of the detected shells? */
function findByPath(shells, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return undefined;
  let real;
  try {
    real = fs.realpathSync.native(candidate);
  } catch {
    return undefined;
  }
  return (
    shells.find((shell) => shell.path.toLowerCase() === real.toLowerCase()) ?? {
      path: real,
      id: 'custom',
      label: path.basename(real),
      kind: 'bash',
      compatible: true,
      source: 'custom',
      version: '',
    }
  );
}

/**
 * Decide which shell the next command runs in: the Settings choice, then the
 * row's `shellPath`, then `shell`, then the first bash-compatible shell.
 * @param {Record<string, { get: () => unknown }>} config - the executor config.
 * @param {Array<Record<string, unknown>>} shells - detected shells.
 * @returns {{ shell: Record<string, unknown> | undefined, source: string, warning?: string }} the decision.
 */
function resolveShell(config, shells) {
  const selected = readSelection();
  const configuredPath = String(valueOf(config.shellPath, '') ?? '');
  const configuredId = String(valueOf(config.shell, DEFAULT_SHELL) ?? DEFAULT_SHELL);
  if (selected !== null) {
    const hit = findByPath(shells, selected.path);
    if (hit !== undefined) return { shell: hit, source: 'selection' };
    return {
      shell: shells.find((shell) => shell.compatible),
      source: 'fallback',
      warning: `保存的 shell 已不存在：${selected.path}`,
    };
  }
  if (configuredPath.length > 0) {
    const hit = findByPath(shells, configuredPath);
    if (hit !== undefined) return { shell: hit, source: 'config' };
    return {
      shell: shells.find((shell) => shell.compatible),
      source: 'fallback',
      warning: `配置的 shellPath 不存在：${configuredPath}`,
    };
  }
  if (configuredId.length > 0 && configuredId !== DEFAULT_SHELL) {
    const hit = shells.find((shell) => shell.id === configuredId);
    if (hit !== undefined) return { shell: hit, source: 'config' };
  }
  return { shell: shells.find((shell) => shell.compatible), source: 'auto' };
}

/**
 * The bash executor: the shipped sandbox-aware executor with one change — every
 * invocation names the resolved shell explicitly instead of `bash` on PATH.
 *
 * The base class comes from the shipped package, which is loaded lazily, so
 * this class is built on first use rather than declared with `extends`.
 */
let ShellSwitchExecutor = null;

/** Build the executor class once the shipped package is available. */
async function shellSwitchExecutor() {
  if (ShellSwitchExecutor !== null) return ShellSwitchExecutor;
  const { SandboxBashExecutor } = await shipped();
  ShellSwitchExecutor = class extends SandboxBashExecutor {
    static Config = Config;
    static inject = ['subprocess', 'sandbox', 'sandboxPolicy'];

    /** The shell every command runs through, resolved per call. */
    async current() {
      const decision = resolveShell(this.config, await discoverShells());
      if (decision.shell === undefined) {
        throw new Error('dsh-shell-switch: 没有可用的 bash shell；请在 设置 → Shell 选择器 中选择，或安装 Niubash / Git Bash / MSYS2');
      }
      if (decision.shell.compatible === false) {
        throw new Error(`dsh-shell-switch: ${decision.shell.label} 不是 bash 方言，无法执行 bash 命令`);
      }
      return decision;
    }

    /**
     * Wrap the chosen shell's argv through the sandbox provider.
     * @param {string} command - the bash command source.
     * @param {object} policy - resolved confined execution policy.
     * @param {AbortSignal} [signal] - cancellation of confinement preparation.
     * @returns {Promise<object>} the confined argv and classification facts.
     */
    async confine(command, policy, signal) {
      const { shell } = await this.current();
      return this.ctx.sandbox.confine([shell.path, '-c', command], policy, signal);
    }

    /**
     * Run one resolved spec. Full-access runs bypass confinement and therefore
     * need their own argv; confined runs go through `confine` above.
     * @param {object} spec - the resolved execution spec.
     * @returns {Promise<object>} the execution handle.
     */
    async execute(spec) {
      const policy = spec.sandboxPolicy;
      if (policy?.mode === 'danger-full-access') {
        const { shell } = await this.current();
        const execution = await this.executeArgv(spec, [shell.path, '-c', spec.command]);
        return SandboxBashExecutor.decorateResult(execution, (result) => ({
          ...result,
          sandbox: { mode: 'danger-full-access', denied: false },
        }));
      }
      return super.execute(spec);
    }
  };
  return ShellSwitchExecutor;
}

/** JSON response helper. */
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Only the page served by this harness may read or change the shell choice.
 *
 * A remote-address check is wrong here: the GUI is reachable over a LAN or a
 * reverse proxy, so legitimate calls arrive from a non-loopback address. The
 * boundary that matters is same-origin — a cross-site page must not be able to
 * drive this API — plus the browser's `Sec-Fetch-Site` hint when present.
 * Mutating requests additionally require a JSON content type, which forces a
 * CORS preflight that this route never answers.
 */
function trusted(req) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && !['same-origin', 'none'].includes(site)) return false;
  return true;
}

/** Read a small JSON request body. */
async function readJson(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The state the Settings page renders.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {Record<string, unknown>} config - the row config.
 * @param {boolean} refresh - bypass the discovery cache.
 * @param {boolean} settle - wait for the registry scan (explicit rescan only).
 * @returns {Promise<object>} the payload.
 */
async function statePayload(ctx, config, refresh, settle = false) {
  if (settle) {
    await uninstallLocationsSettled();
    refresh = true;
  }
  const shells = withVersions(await discoverShells(refresh));
  const selected = readSelection();
  const decision = resolveShell(config, shells);
  let policy;
  try {
    const resolved = ctx.sandboxPolicy?.resolve?.();
    policy = resolved === undefined ? undefined : { mode: resolved.mode, workspaceRoot: resolved.workspaceRoot };
  } catch {
    policy = undefined;
  }
  return {
    ok: true,
    shells,
    selected,
    effective:
      decision.shell === undefined
        ? null
        : {
            path: decision.shell.path,
            label: decision.shell.label,
            kind: decision.shell.kind,
            version: decision.shell.version ?? '',
            compatible: decision.shell.compatible,
            exists: fs.existsSync(decision.shell.path),
          },
    source: decision.source,
    warning: decision.warning ?? null,
    sandbox: policy ?? null,
    settingsFile: selectionFile(),
    defaults: { shell: String(valueOf(config.shell, DEFAULT_SHELL) ?? DEFAULT_SHELL) },
    pwsh: {
      hidden: isWin,
      restrictedAgents: diagnostics.restricted,
      errorCode: diagnostics.pwshError ?? null,
    },
    diagnostics: {
      agentsAttached: diagnostics.attached,
      toolMounted: diagnostics.tool,
      error: diagnostics.error,
    },
  };
}

/** Register the Settings page's HTTP surface. */
function registerRoutes(ctx, config) {
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      try {
        if (!trusted(req)) return json(res, 403, { ok: false, error: 'forbidden' });
        const url = new URL(req.url ?? '/', 'http://localhost');
        const tail = url.pathname.slice(API.length) || '/';
        if (req.method === 'GET' && (tail === '/' || tail === '/state')) {
          return json(res, 200, await statePayload(ctx, config, url.searchParams.get('refresh') === '1', url.searchParams.get('settle') === '1'));
        }
        if (req.method === 'POST' && tail === '/select') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body;
          try {
            body = await readJson(req);
          } catch {
            return json(res, 400, { ok: false, error: 'invalid JSON body' });
          }
          if (body?.action === 'reset') {
            clearSelection();
            return json(res, 200, await statePayload(ctx, config, false));
          }
          const shells = await discoverShells(true);
          const hit = findByPath(shells, body?.path);
          if (hit === undefined) return json(res, 400, { ok: false, error: `未找到该 shell：${String(body?.path ?? '')}` });
          if (hit.compatible !== true) {
            return json(res, 400, { ok: false, error: `${hit.label} 不是 bash 方言，无法执行 bash 命令` });
          }
          writeSelection(hit.path);
          return json(res, 200, await statePayload(ctx, config, false));
        }
        return json(res, 404, { ok: false, error: 'not found' });
      } catch (error) {
        return json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  });
  return () => {
    if (typeof dispose === 'function') dispose();
  };
}

/** Plugin row name, used by the Loader and the settings page. */
export const name = 'shell-switch';
/** Services this row touches directly. */
export const inject = ['webServer', 'subprocess', 'sandbox', 'sandboxPolicy'];

/** Mount-time facts the settings page surfaces when a mount fails. */
const diagnostics = { tool: 'idle', attached: 0, restricted: 0, error: null, pwshError: null };
const attached = new WeakMap();
/** Agent → disposer of the `pwsh` deny filter this plugin installed. */
const pwshFilters = new WeakMap();

/**
 * Hide the shipped `pwsh` tool for one Agent on Windows.
 *
 * The tool belongs to the Agent's preset, so it cannot be uninstalled; a
 * scope-level deny filter removes it from the model's catalog while leaving the
 * tool row itself untouched. Other platforms never compose `pwsh`, so nothing
 * is filtered there. Removing or disabling this plugin releases the filter and
 * brings `pwsh` back.
 * @param {object} agent - the Agent whose catalog is adjusted.
 */
function applyPwshPolicy(agent) {
  if (!isWin) return;
  if (agent === null || agent === undefined || agent.ctx === undefined) return;
  if (pwshFilters.has(agent)) return;
  try {
    const dispose = agent.ctx.tools.restrict({ deny: ['pwsh'] });
    pwshFilters.set(agent, dispose);
    diagnostics.restricted += 1;
    diagnostics.pwshError = null;
    debug('pwsh-hidden', agent.id ?? 'unknown');
  } catch (error) {
    diagnostics.pwshError = String(error?.message ?? error);
    debug('pwsh-hide-failed', diagnostics.pwshError);
  }
}

/** Remove one Agent's `pwsh` deny filter, if this plugin installed it. */
function releasePwshPolicy(agent) {
  const dispose = pwshFilters.get(agent);
  if (dispose === undefined) return;
  pwshFilters.delete(agent);
  diagnostics.restricted = Math.max(0, diagnostics.restricted - 1);
  try {
    dispose?.();
  } catch {
    // Already released with the Agent's scope.
  }
}

/**
 * Give one Agent its own shell scope, executor, and shipped bash tool. The
 * tool is registered inside `agent.ctx`, where every preset tool lives; a
 * context-global registration would not be visible to a Session.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {Record<string, unknown>} config - the row config.
 * @param {object} agent - the Agent being attached.
 */
function attachAgent(ctx, config, agent) {
  if (agent === null || agent === undefined || attached.has(agent) || agent.ctx === undefined) return;
  try {
    const branch = agent.ctx.isolate('shell');
    const fiber = branch.plugin({
      name: 'shell-switch-agent',
      inject: ['subprocess', 'sandbox', 'sandboxPolicy'],
      async apply(inner) {
        // Deferred here so creating an Agent costs nothing until it really needs
        // the bash tool; both calls are memoized after the first Agent.
        const [Executor, tool] = await Promise.all([shellSwitchExecutor(), shipped().then((m) => m.toolBash)]);
        new Executor(inner, executorConfig(config));
        const toolFiber = inner.plugin(tool, { enableRunInBackground: true });
        Promise.resolve(toolFiber).then(
          () => {
            diagnostics.tool = 'active';
            debug('tool-active', agent.id ?? 'unknown');
          },
          (error) => {
            diagnostics.tool = 'failed';
            diagnostics.error = String(error?.stack ?? error);
            debug('tool-failed', diagnostics.error);
          },
        );
      },
    });
    attached.set(agent, fiber);
    diagnostics.attached += 1;
    applyPwshPolicy(agent);
  } catch (error) {
    diagnostics.tool = 'threw';
    diagnostics.error = String(error?.stack ?? error);
    debug('attach-threw', diagnostics.error);
  }
}

/** Drop one Agent's scope, executor, and tool. */
function detachAgent(agent) {
  releasePwshPolicy(agent);
  const fiber = attached.get(agent);
  if (fiber === undefined) return;
  attached.delete(agent);
  diagnostics.attached = Math.max(0, diagnostics.attached - 1);
  try {
    fiber?.dispose?.();
  } catch {
    // The Agent's own teardown already released it.
  }
}

/**
 * Mount the settings API and give every Agent (existing and future) its own
 * configurable bash tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {Record<string, unknown>} config - the validated row config.
 */
export function apply(ctx, config) {
  ctx.effect(() => {
    const agents = ctx.get('agents');
    for (const agent of agents?.list?.() ?? []) attachAgent(ctx, config, agent);
    const offCreated = ctx.on('agent/created', ({ agent }) => {
      attachAgent(ctx, config, agent);
    });
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
      detachAgent(agent);
    });
    return () => {
      try {
        offCreated?.();
      } catch {
        // already disposed
      }
      try {
        offDisposed?.();
      } catch {
        // already disposed
      }
      for (const agent of [...attached.keys()]) detachAgent(agent);
    };
  }, 'dsh-shell-switch: per-agent bash tool');
  ctx.effect(() => registerRoutes(ctx, config), 'dsh-shell-switch: settings API');
  // Warm the registry scan and the version cache at mount so the first visit to
  // the Settings page is answered from cache instead of waiting for them.
  ctx.effect(() => {
    uninstallLocations();
    const timer = setTimeout(() => {
      try {
        for (const shell of discovery.shells) {
          if (shell.compatible) probeVersion(shell);
        }
      } catch {
        // best effort
      }
    }, 1500);
    timer.unref?.();
    return () => clearTimeout(timer);
  }, 'dsh-shell-switch: shell cache warm-up');
  debug('row-apply');
}
