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

import { BackgroundSessions, DEFAULT_MAX_JOBS, DEFAULT_MAX_LOG_BYTES, DEFAULT_AUTO_CLEANUP_KEEP } from './background.js';
import { buildBackgroundTools } from './background-tools.js';
import { installTerminalIntegration, terminalPathForShell } from './terminal.js';
import {
  assetFor as embeddedAssetFor,
  embeddedInstalled,
  installEmbedded,
  removeEmbedded,
  resolveEmbeddedExe,
  embeddedRoot,
  EMBEDDED_VERSION,
  activeVersion,
  installedVersions,
  checkUpdate,
  updateEmbedded,
  rollbackEmbedded,
  compareVersions,
} from './embedded.js';

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
 * @returns {Promise<{ SandboxBashExecutor: Function, toolBash: object, toolPwsh: object }>} the loaded modules.
 */
let shippedPromise;
function shipped() {
  shippedPromise ??= Promise.all([
    loadShipped('@deepseek-ai/dsh-bash-sandbox'),
    loadShipped('@deepseek-ai/dsh-tool-bash'),
    // The official PowerShell tool, used when a PowerShell shell is selected.
    loadShipped('@deepseek-ai/dsh-tool-pwsh'),
  ]).then(async ([sandbox, tool, pwshTool]) => {
    // The confined path is driven locally (see the executor below), so it also
    // needs the diagnostics the shipped executor imports from dsh-sandbox.
    const diagnostics = await loadShipped('@deepseek-ai/dsh-sandbox');
    return {
      SandboxBashExecutor: sandbox.SandboxBashExecutor,
      SandboxUnavailableError: diagnostics.SandboxUnavailableError,
      classifyRunnerFailure: diagnostics.classifyRunnerFailure,
      isRunnerSpawnFailure: diagnostics.isRunnerSpawnFailure,
      sandboxDenialMarker: diagnostics.sandboxDenialMarker,
      toolBash: tool,
      toolPwsh: pwshTool,
    };
  });
  return shippedPromise;
}

/** The schemastery instance, loaded in parallel with the first Agent attach. */
let schemasteryPromise;
function schemastery() {
  schemasteryPromise ??= loadShipped('@deepseek-ai/schemastery').then((module) => module.default ?? module);
  return schemasteryPromise;
}

const z = await schemastery();

/** The background-session manager, created once per row apply and shared. */
let backgroundSessions = null;
// True while the optional terminal-controller decoration is installed.
let terminalControllerIntegrated = false;
/** Lazily-loaded DSH tool-definition helpers for the `bg_*` tools. */
let toolKitPromise;
function toolKit() {
  toolKitPromise ??= loadShipped('@deepseek-ai/dsh-tools').then((module) => ({
    defineTool: module.defineTool,
    ToolArgsError: module.ToolArgsError,
  }));
  return toolKitPromise;
}

/**
 * Read the `background` sub-config, unwrapping the volatile cell around it and
 * the cells around each field, so plain values come back regardless of whether
 * the row config delivered a raw object or a schemastery cell.
 * @param {Record<string, unknown>} config - the row config.
 * @returns {{ enabled: boolean, maxLogBytes: number, maxJobs: number, autoCleanup: boolean, autoCleanupKeep: number }} resolved values.
 */
function backgroundConfig(config) {
  const raw = valueOf(config?.background, undefined);
  const inner = raw !== null && typeof raw === 'object' ? raw : {};
  const saved = readStore();
  return {
    enabled: valueOf(inner.enabled, true) !== false,
    maxLogBytes: Number(valueOf(inner.maxLogBytes, DEFAULT_MAX_LOG_BYTES)),
    maxJobs: Number(valueOf(inner.maxJobs, DEFAULT_MAX_JOBS)),
    // Runtime panel choices override Config and survive a restart. With no
    // saved choice, auto-cleanup defaults on (50 newest stopped jobs, global).
    autoCleanup: saved.autoCleanup ?? (valueOf(inner.autoCleanup, true) !== false),
    autoCleanupKeep: saved.autoCleanupKeep ?? Number(valueOf(inner.autoCleanupKeep, DEFAULT_AUTO_CLEANUP_KEEP)),
  };
}

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
  /** Load the user's PowerShell profile for PowerShell commands (default: no). */
  loadProfile: z.boolean().default(false).volatile(),
  /**
   * Persistent background sessions (a self-contained alternative to
   * `@deepseek-ai/dsh-tool-jobs`): `bg_start`/`bg_output`/`bg_list`/`bg_kill`
   * tools that run real detached processes surviving the call and a restart.
   *
   * Plain (non-volatile) fields: schemastery rejects volatile inside a volatile
   * object, and these are static config, not per-read runtime values.
   */
  background: z.object({
    enabled: z.boolean().default(true),
    /** Per-job log cap in bytes; older output is dropped on rotation. */
    maxLogBytes: z.number().default(DEFAULT_MAX_LOG_BYTES),
    /** How many settled jobs to retain; oldest pruned first. */
    maxJobs: z.number().default(DEFAULT_MAX_JOBS),
    /** Auto-delete old STOPPED jobs; when on, keep only `autoCleanupKeep`. */
    autoCleanup: z.boolean().default(true),
    /** How many newest stopped jobs auto-cleanup keeps. */
    autoCleanupKeep: z.number().default(DEFAULT_AUTO_CLEANUP_KEEP),
  }).default({}),
  /**
   * Embedded Niubash: ship a self-contained bash so a machine without one
   * (Windows) is ready out of the box. On Linux/macOS a system bash already
   * exists, so this is off by default there and the system bash is preferred.
   * `autoInstall` downloads the pinned release on first need; `baseUrl` points
   * at a mirror. Plain fields (no volatile nesting).
   */
  embedded: z.object({
    /** Offer the embedded shell in the picker. Default: on Windows, off elsewhere. */
    enabled: z.boolean().default(isWin),
    /** Auto-download + extract the embedded bash when it is missing (Windows). */
    autoInstall: z.boolean().default(true),
    /** Release host override; defaults to the project's GitHub releases. */
    baseUrl: z.string().default(''),
    /** GitHub Releases API base override (for the online update check). */
    releasesApi: z.string().default(''),
    /** Check GitHub for a newer Niubash on startup (prompt only, never auto-download). */
    checkOnStartup: z.boolean().default(true),
  }).default({}),
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
    loadProfile: cell(config?.loadProfile, false),
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
  let customPaths = [];
  let followTerminal = true;
  let autoCleanup;
  let autoCleanupKeep;
  if (stamp !== 0) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const candidate = parsed?.shell ?? parsed;
      if (typeof candidate?.path === 'string' && candidate.path.length > 0) {
        shell = {
          path: candidate.path,
          ...typeof candidate.distro === 'string' && candidate.distro.length > 0 ? { distro: candidate.distro } : {},
          at: candidate.at ?? parsed?.at,
        };
      }
      if (Array.isArray(parsed?.customPaths)) {
        customPaths = parsed.customPaths.filter((p) => typeof p === 'string' && p.length > 0);
      }
      // Absent means enabled for existing installs; only an explicit false
      // disables terminal following.
      if (parsed?.followTerminal === false) followTerminal = false;
      if (typeof parsed?.autoCleanup === 'boolean') autoCleanup = parsed.autoCleanup;
      if (Number.isFinite(parsed?.autoCleanupKeep)) autoCleanupKeep = Math.max(0, Math.floor(parsed.autoCleanupKeep));
    } catch {
      // A corrupt file behaves like an empty one.
    }
  }
  storeCache = { at: stamp, value: { shell, customPaths, followTerminal, autoCleanup, autoCleanupKeep } };
  return storeCache.value;
}

/**
 * Merge a patch into the store and persist it.
 * @param {{ shell?: { path: string, distro?: string, at?: string } | null, customPaths?: string[] }} patch - fields to replace.
 * @returns {{ shell: { path: string, at?: string } | null, customPaths: string[] }} the new store.
 */
function writeStore(patch) {
  const next = { ...readStore(), ...patch };
  const payload = {};
  if (next.shell !== null && next.shell !== undefined) {
    payload.shell = {
      path: next.shell.path,
      ...typeof next.shell.distro === 'string' && next.shell.distro.length > 0 ? { distro: next.shell.distro } : {},
      at: next.shell.at ?? new Date().toISOString(),
    };
  }
  if (Array.isArray(next.customPaths) && next.customPaths.length > 0) {
    payload.customPaths = next.customPaths;
  }
  payload.followTerminal = next.followTerminal !== false;
  if (typeof next.autoCleanup === 'boolean') payload.autoCleanup = next.autoCleanup;
  if (Number.isFinite(next.autoCleanupKeep)) payload.autoCleanupKeep = Math.max(0, Math.floor(next.autoCleanupKeep));
  const file = selectionFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  storeCache = { at: -1, value: null };
  return readStore();
}

/** The stored shell choice, if any. */
const readSelection = () => readStore().shell;
/** Remember one shell path. */
const writeSelection = (shellPath, distro) =>
  writeStore({
    shell: {
      path: shellPath,
      ...distro === undefined ? {} : { distro },
      at: new Date().toISOString(),
    },
  });
/** Forget the shell choice. */
const clearSelection = () => writeStore({ shell: null });

/** The list of manually-added shell paths. */
const readCustomPaths = () => readStore().customPaths ?? [];

/**
 * Add a manual shell path to the picker (idempotent). Does NOT select it; the
 * user picks it in the dropdown as usual.
 * @param {string} shellPath - absolute executable path.
 * @returns {string[]} the new list.
 */
function addCustomPath(shellPath) {
  const current = readCustomPaths();
  const norm = (p) => String(p).toLowerCase();
  if (current.some((p) => norm(p) === norm(shellPath))) return current;
  const next = [...current, shellPath];
  writeStore({ customPaths: next });
  return next;
}

/**
 * Remove a manual shell path from the picker.
 * @param {string} shellPath - the path to drop.
 * @returns {string[]} the new list.
 */
function removeCustomPath(shellPath) {
  const norm = (p) => String(p).toLowerCase();
  const next = readCustomPaths().filter((p) => norm(p) !== norm(shellPath));
  writeStore({ customPaths: next });
  return next;
}

/** Installed programs whose `InstallLocation` names a shell family. */
/**
 * Installed programs whose `InstallLocation` names a shell family.
 *
 * Querying each hive recursively costs seconds on a real machine (HKLM alone
 * measured ~5 s), so it is warmed once in the background and cached for ten
 * minutes. The first page load may therefore show only the well-known and PATH
 * shells; the next refresh adds registered installs.
 * @param {boolean} [wait] - block until the scan finishes (only for explicit rescans).
 * @returns {Array<{family: string, display: string, location: string}>} install locations of shell-family programs.
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
      // Both families matter: Niubash/Winuxsh for `winuxcmd`, Git for Windows
      // (stored as "Git version 2.4x.x") for `bin`/`usr/bin`, which is how a
      // scoop or portable install is found when it is not in a standard path.
      const family = /niubash|winuxsh/i.test(block)
        ? 'niubash'
        : /displayname\s+REG_SZ\s+git version/i.test(block)
          ? 'git'
          : null;
      if (family === null) continue;
      const display = /DisplayName\s+REG_SZ\s+(.+)/i.exec(block)?.[1].trim() ?? family;
      const match = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(block);
      const location = match !== null && match[1].trim().length > 0 ? match[1].trim() : '';
      if (location.length > 0) locations.push({ family, display, location });
    }
  }
  return { at: Date.now(), locations };
}

/**
 * Non-blocking view of the registry scan: start one pass if the cache is cold,
 * return whatever is known right now.
 * @returns {Array<{family: string, display: string, location: string}>} cached install locations (empty while the first scan runs).
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

/**
 * The WSL distributions installed on this machine, from `wsl -l -q`.
 *
 * `wsl.exe -l -q` writes UTF-16LE, so its output is decoded explicitly; a
 * machine without WSL (or with only the `docker-desktop` utility distro)
 * simply returns what it printed. Results are cached for ten minutes because
 * the command spawns a process.
 * @param {boolean} [refresh] - ignore the short-lived cache.
 * @returns {Array<{name: string, running: boolean, bash: boolean|null}>} installed distributions;
 *   `bash` is null until probed.
 */
let wslCache = { at: 0, distros: [] };

/**
 * Sanitize a WSL distribution name decoded from `wsl.exe` output.
 *
 * `wsl.exe` emits UTF-16LE, but some hosts/pipes deliver the bytes such that a
 * `utf8` decode is attempted, leaving a name like "WÖ°ØLÖ..." — UTF-16LE bytes
 * read as UTF-8 (classic mojibake). A real distro name is a short run of
 * printable `[A-Za-z0-9._-]` characters, so anything outside that set, plus any
 * lingering NUL / control / replacement characters, is stripped. When that
 * leaves nothing usable the caller drops the entry rather than showing garbage.
 * @param {string} raw - raw decoded name.
 * @returns {string} a cleaned name, possibly empty.
 */
function cleanDistroName(raw) {
  const text = String(raw ?? '');
  // A UTF-16LE sequence misread as UTF-8 (or vice versa) leaves Latin-1 /
  // Latin-Extended codepoints (e.g. "Ö°ØLÖ") in a name that should be plain
  // ASCII. That is a decode failure, not a real distro — reject it outright
  // instead of salvaging ASCII crumbs like "WLHrg".
  if (/[\u0080-\u024F]/.test(text)) return '';
  return text
    .replace(/\u0000|\uFFFD/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .trim();
}

function wslDistros(refresh = false) {
  if (!isWin) return [];
  if (!refresh && Date.now() - wslCache.at < 600000) return wslCache.distros;
  let verbose = '';
  try {
    const raw = execFileSync('wsl.exe', ['-l', '-v'], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    verbose = raw.includes(0) ? raw.toString('utf16le') : raw.toString('utf8');
  } catch {
    verbose = '';
  }
  let distros = [];
  if (verbose.length > 0) {
    // Rows are "  NAME  STATE  VERSION", the default one prefixed by "*".
    for (const line of verbose.split(/\r?\n/)) {
      const match = /^\s*\*?\s*(\S+)\s+(Running|Stopped|Installing|Uninstalling)\b/i.exec(line.replace(/\u0000/g, ''));
      if (match === null) continue;
      const name = cleanDistroName(match[1]);
      if (name.length === 0) continue;
      if (/^docker-desktop/i.test(name)) continue; // utility distro, no bash
      distros.push({ name, running: /^running$/i.test(match[2]), bash: null });
    }
  }
  if (distros.length === 0) {
    let quiet = '';
    try {
      const raw = execFileSync('wsl.exe', ['-l', '-q'], {
        encoding: 'buffer',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      quiet = raw.includes(0) ? raw.toString('utf16le') : raw.toString('utf8');
    } catch {
      quiet = '';
    }
    distros = quiet
      .split(/\r?\n/)
      .map((line) => cleanDistroName(line.replace(/\u0000/g, '').replace(/^\*/, '').trim()))
      .filter((name) => name.length > 0 && !/^docker-desktop/i.test(name))
      .map((name) => ({ name, running: false, bash: null }));
  }
  wslCache = { at: Date.now(), distros };
  debug('wsl-distros', JSON.stringify(distros));
  return distros;
}

/**
 * Does one WSL distribution actually have bash?
 *
 * A distro can exist without it (`docker-desktop` is a utility VM), and that
 * only surfaces at command time as `execvpe(/bin/bash) ... No such file`. One
 * cheap probe moves that answer into the list instead. Results are cached with
 * the distro cache; an unprobed or unknown result stays `null` and the entry is
 * still offered.
 * @param {{name: string, bash: boolean|null}} distro - a cached distro record.
 * @returns {boolean|null} whether bash exists there.
 */
function probeDistroBash(distro) {
  if (distro.bash !== null) return distro.bash;
  try {
    execFileSync('wsl.exe', ['-d', distro.name, '-e', 'bash', '-c', 'exit 0'], {
      windowsHide: true,
      timeout: 8000,
      stdio: 'ignore',
    });
    distro.bash = true;
  } catch {
    distro.bash = false;
  }
  return distro.bash;
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
  for (const { family, display, location } of locations) {
    if (family === 'niubash') {
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
      continue;
    }
    // Git for Windows: `bin\bash.exe` is the small launcher, `usr\bin\bash.exe`
    // the real one; both work, the first is what Integrations register.
    const version = /git version\s+([0-9][\w.]*)/i.exec(display)?.[1];
    for (const relative of ['bin\\bash.exe', 'usr\\bin\\bash.exe', 'git-bash.exe']) {
      add(path.join(location, relative), {
        id: 'git-bash',
        label: version === undefined ? 'Git Bash' : `Git Bash ${version}`,
        kind: 'bash',
        compatible: true,
        source: 'registry',
      });
    }
  }

  for (const candidate of [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
  ]) {
    add(candidate, { id: 'git-bash', label: 'Git Bash', kind: 'bash', compatible: true, source: 'well-known' });
  }

  // Scoop and other portable layouts never register a `bash.exe` on PATH and
  // often have no uninstall entry, so the known roots are probed directly:
  // `<root>/apps/git/<version>/bin/bash.exe` plus the `current` junction that
  // Scoop keeps. `SCOOP` is honoured when set; the default root is checked
  // anyway, because Scoop is frequently installed without that variable.
  for (const scoopRoot of [env.SCOOP, path.join(os.homedir(), 'scoop'), path.join(`${systemDrive}\\`, 'scoop'), path.join(`${systemDrive}\\`, 'software', 'scoop')]) {
    if (typeof scoopRoot !== 'string' || scoopRoot.length === 0) continue;
    const appsRoot = path.join(scoopRoot, 'apps', 'git');
    let versions = [];
    try {
      versions = fs.readdirSync(appsRoot, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        // `current` is Scoop's junction to the active version: keep the real
        // version directories first so the default entry names a version.
        .sort((a, b) => (a === 'current' ? 1 : b === 'current' ? -1 : b.localeCompare(a, undefined, { numeric: true })));
    } catch {
      versions = [];
    }
    for (const version of versions) {
      for (const relative of ['bin\\bash.exe', 'usr\\bin\\bash.exe']) {
        add(path.join(appsRoot, version, relative), {
          id: 'git-bash',
          label: version === 'current' ? 'Git Bash (scoop)' : `Git Bash ${version} (scoop)`,
          kind: 'bash',
          compatible: true,
          source: 'scoop',
        });
      }
    }
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

  // One entry per WSL distribution when `wsl -l -q` answers, plus the default
  // launcher. `System32\bash.exe` runs bash inside the default distro, so its
  // Windows paths must be translated (see `wslCommand`); the per-distro entries
  // go through `wsl -d <name> -e bash` and need the same translation.
  const distros = wslDistros();
  if (distros.length === 0) {
    // Launch via `wsl.exe`, NOT `System32\bash.exe`: the legacy bash.exe
    // launcher hardcodes /bin/bash, which does not exist on usrmerge distros
    // (Ubuntu 24.04+ where /bin is a symlink) and fails with execvpe(/bin/bash).
    add(path.join(winRoot, 'System32', 'wsl.exe'), {
      id: 'wsl',
      label: 'WSL bash',
      kind: 'bash',
      compatible: true,
      source: 'well-known',
      note: 'runs inside WSL: Windows paths are translated to /mnt/<drive>/...',
    });
  } else {
    for (const distro of distros) {
      add(path.join(winRoot, 'System32', 'wsl.exe'), {
        id: 'wsl',
        distro: distro.name,
        label:
          distro.bash === false
            ? `WSL · ${distro.name}（无 bash）`
            : distro.running
              ? `WSL · ${distro.name}`
              : `WSL · ${distro.name}（未运行）`,
        kind: 'bash',
        // A distro without bash cannot run anything, so it is listed but not
        // selectable; an unprobed distro stays selectable.
        compatible: distro.bash !== false,
        source: 'wsl',
        note: `runs inside WSL distro \"${distro.name}\": Windows paths are translated to /mnt/<drive>/...`,
      });
    }
  }
  add(path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'), {
    id: 'pwsh',
    label: 'PowerShell 7',
    kind: 'powershell',
    dialect: 'powershell',
    compatible: true,
    source: 'well-known',
  });
  add(path.join(programFiles, 'PowerShell', '7-preview', 'pwsh.exe'), {
    id: 'pwsh-preview',
    label: 'PowerShell 7 Preview',
    kind: 'powershell',
    dialect: 'powershell',
    compatible: true,
    source: 'well-known',
  });
  add(path.join(winRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), {
    id: 'powershell',
    label: 'Windows PowerShell 5.1',
    kind: 'powershell',
    dialect: 'powershell',
    compatible: true,
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
      // A Microsoft Store app-execution alias is a reparse point that the FS
      // API reports as EACCES, so `existsSync` says no while `spawn` works.
      // For the alias directories, treat a directory entry as present.
      const aliasDir = /[\\/]windowsapps$/i.test(dir);
      if (!fs.existsSync(candidate) && !aliasDir) continue;
      if (aliasDir && !fs.existsSync(candidate)) {
        let listed = false;
        try {
          listed = fs.readdirSync(dir, { withFileTypes: true }).some((item) => item.name.toLowerCase() === exe.toLowerCase());
        } catch {
          listed = false;
        }
        if (!listed) continue;
      }
      if (exe === 'bash.exe') {
        // `%SystemRoot%\System32\bash.exe` and the Store alias
        // `...\WindowsApps\bash.exe` are NOT a bash install — they are the
        // legacy WSL launchers that hardcode `/bin/bash`, which does not exist
        // on usrmerge distros (Ubuntu 24.04+), so they are broken. The real WSL
        // entry is offered separately via `wsl.exe -d <distro>` (see
        // `knownShells`), so listing these here only adds a dead, mislabelled
        // "bash" row. Skip them.
        if (/[\\/](system32|windowsapps)[\\/]bash\.exe$/i.test(candidate)) continue;
        const id = /git/i.test(dir)
          ? 'git-bash'
          : /niubash|winuxsh/i.test(dir)
            ? 'niubash'
            : /msys/i.test(dir)
              ? 'msys2'
              : /cygwin/i.test(dir)
                ? 'cygwin'
                : 'bash';
        entries.push({
          path: candidate,
          id,
          label: `bash · ${base}`,
          kind: 'bash',
          compatible: true,
          source: 'path',
          note: /\\windows\\system32/i.test(dir) ? 'runs inside WSL: Windows paths are translated to /mnt/<drive>/...' : undefined,
        });
      } else if (exe === 'nu.exe') {
        entries.push({ path: candidate, id: 'nushell', label: 'Nushell', kind: 'nu', compatible: false, source: 'path' });
      } else {
        // PowerShell is the second shell dialect this plugin can drive (see
        // `powershellCommand`), not a bash shell, so it has its own group.
        const alias = /windowsapps/i.test(dir);
        entries.push({
          path: candidate,
          id: alias ? 'pwsh-store' : 'pwsh',
          label: alias ? 'PowerShell 7 (Microsoft Store alias)' : `PowerShell 7 (PATH) · ${base}`,
          kind: 'powershell',
          dialect: 'powershell',
          compatible: true,
          source: 'path',
        });
      }
    }
  }
  return entries;
}

let discovery = { at: 0, shells: [] };

/** Live embedded-Niubash options, set by `apply` from the row config. */
let embeddedOptions = { enabled: isWin, autoInstall: true, baseUrl: '', releasesApi: '' };

/** Last embedded update-check result, so the panel can show it without a call. */
let embeddedUpdateState = { status: 'unknown', at: 0 };

/**
 * The embedded Niubash as a picker entry, or undefined when disabled / the
 * platform has no build. A missing install still yields an entry (so the picker
 * can offer to fetch it) when autoInstall is on; otherwise it is omitted.
 * @returns {Record<string, unknown> | undefined} a shell entry.
 */
function embeddedShellEntry() {
  if (embeddedOptions.enabled === false) return undefined;
  const desc = embeddedAssetFor();
  if (desc === undefined) return undefined;
  const exe = resolveEmbeddedExe();
  const installed = exe !== undefined;
  if (!installed && embeddedOptions.autoInstall === false) return undefined;
  const ver = activeVersion() ?? EMBEDDED_VERSION;
  return {
    path: installed ? exe : path.join(embeddedRoot(), `<not-installed-${process.platform}-${process.arch}>`),
    id: 'embedded-niu',
    label: installed ? `内置 Niubash ${ver}` : `内置 Niubash（未安装，点「重新扫描」下载）`,
    kind: 'bash',
    dialect: 'niu',
    embedded: true,
    installed,
    version: installed ? ver : '',
    compatible: true,
    source: 'embedded',
    note: installed ? '自带' : '待下载',
  };
}

/**
 * Detect every local shell, de-duplicated by real path.
 * @param {boolean} refresh - ignore the short-lived cache.
 * @returns {Array<Record<string, unknown>>} the detected shells.
 */
async function discoverShells(refresh = false) {
  if (!refresh && Date.now() - discovery.at < 15000) return discovery.shells;
  if (refresh) {
    wslCache = { at: 0, distros: [] };
    registryCache = { at: 0, locations: [], promise: null };
  }
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
    } catch (error) {
      // Store app aliases answer EACCES instead of resolving; keep the path
      // `spawn` would use rather than dropping a shell the user can run.
      const alias = /[\\/]windowsapps[\\/][^\\/]+\.exe$/i.test(entry.path);
      if (!alias || (error?.code !== 'EACCES' && error?.code !== 'EPERM')) continue;
      real = entry.path;
    }
    // A per-distro WSL entry shares `System32\bash.exe` with every other
    // distro, so the de-duplication key has to include the distro name. The
    // `current` entry and the versioned entry resolve to the same real path.
    const key = entry.distro === undefined ? real.toLowerCase() : `${real.toLowerCase()}#${String(entry.distro).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    shells.push({
      path: real,
      id: entry.id,
      ...entry.distro === undefined ? {} : { distro: entry.distro },
      ...entry.dialect === undefined ? {} : { dialect: entry.dialect },
      label: entry.label,
      kind: entry.kind,
      compatible: entry.compatible === true,
      source: entry.source ?? '',
      ...entry.note === undefined ? {} : { note: entry.note },
      version: '',
    });
  }
  // The embedded Niubash is a plugin-provided shell (no registry/PATH file when
  // it is the not-yet-downloaded placeholder), so it is spliced in directly
  // rather than discovered. It is a bash dialect, so it sorts into tier 1.
  const embedded = embeddedShellEntry();
  if (embedded !== undefined && !shells.some((shell) => shell.id === 'embedded-niu')) {
    shells.push({ ...embedded, version: '' });
  }
  // Order: native bash on Windows first, then WSL distributions, then the rest;
  // within a tier, raw installs before linked/duplicated ones, then by label.
  // The first compatible entry is what `auto` picks, so this order decides the
  // default — a native bash (Git Bash, Niubash) beats a WSL launcher.
  const tier = (shell) => (shell.id === 'embedded-niu' ? 0 : isPowerShell(shell) ? 3 : isWslLauncher(shell) ? 2 : 1);
  // `usr\bin` is the real bash; `bin` is the shim Git for Windows puts first on
  // PATH. Prefer the real one when both resolve, so `auto` picks the same binary.
  const shim = (shell) => (/[\\/]bin[\\/]bash\.exe$/i.test(shell.path) && !/[\\/]usr[\\/]bin[\\/]/i.test(shell.path) ? 1 : 0);
  shells.sort((a, b) =>
    Number(b.compatible) - Number(a.compatible)
    || tier(a) - tier(b)
    || shim(a) - shim(b)
    || a.label.localeCompare(b.label, undefined, { numeric: true }));
  // One row per *install*, not per file. A single installation ships two
  // `bash.exe` files: `<root>\usr\bin\bash.exe` (the real one) and
  // `<root>\bin\bash.exe` (a launcher shim, or a plain copy as Niubash does).
  // Listing both is noise — they are the same shell — so the list is keyed by
  // installation root plus distro, and the sort above already puts `usr\bin`
  // first, which makes it the row that survives.
  const installKey = (shell) => {
    // Collapse the two bash files of one installation:
    // `<root>\usr\bin\bash.exe` and `<root>\bin\bash.exe` -> `<root>`.
    // Anything else (PowerShell, cmd, nushell, the WSL launcher) keeps its own
    // file identity, because those neighbours are different programs that
    // happen to live in one directory.
    let dir = path.dirname(shell.path.toLowerCase());
    const isBash = /[\\/]bash\.exe$/.test(shell.path.toLowerCase());
    if (isBash) {
      if (path.basename(dir) === 'bin') {
        const parent = path.dirname(dir);
        dir = path.basename(parent) === 'usr' ? path.dirname(parent) : parent;
      }
    }
    const identity = isBash ? dir : shell.path.toLowerCase();
    return `${identity}#${String(shell.distro ?? '').toLowerCase()}`;
  };
  const unique = [];
  const seenKey = new Set();
  for (const shell of shells) {
    // The embedded Niubash is plugin-provided and must NEVER be merged with a
    // locally-installed Niubash (different binary, different version). It is
    // kept verbatim by the dedupe below and only its own entry survives.
    if (shell.id === 'embedded-niu') { unique.push(shell); continue; }
    // Non-bash rows keep their own identity so e.g. `winuxsh.exe` next to the
    // bash entries of the same install is not swallowed.
    const key = shell.compatible ? installKey(shell) : shell.path.toLowerCase();
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    unique.push(shell);
  }
  shells.length = 0;
  shells.push(...unique);

  // `WindowsApps\bash.exe` (Store alias) and `System32\bash.exe` are both just
  // the legacy WSL launcher, the same thing the named `wsl.exe -d <distro>`
  // entry drives — and both hardcode `/bin/bash`, which breaks on usrmerge
  // distros. When a real WSL entry exists, drop these dead launcher rows so the
  // list shows the working `wsl.exe` entry instead of two broken "bash" rows.
  const isWslBashLauncher = (shell) => /[\\/](?:windowsapps|windows[\\/]system32)[\\/]bash\.exe$/i.test(String(shell.path ?? ''));
  if (shells.some((shell) => shell.source === 'well-known' && shell.id === 'wsl')) {
    const filtered = shells.filter((shell) => !isWslBashLauncher(shell));
    shells.length = 0;
    shells.push(...filtered);
  }
  // Append manually-added shell paths (from the Settings "add path" field) so
  // they show up in the picker as normal, selectable options. A path already
  // detected (same real path) is skipped to avoid a duplicate row.
  const knownPaths = new Set(shells.map((shell) => String(shell.path).toLowerCase()));
  for (const rawPath of readCustomPaths()) {
    let real = rawPath;
    try { real = fs.realpathSync.native(rawPath); } catch { /* keep literal */ }
    if (knownPaths.has(String(real).toLowerCase())) continue;
    const entry = classifyManualShell(real);
    if (entry === undefined) continue; // path vanished / no longer a shell
    entry.manual = true;
    shells.push(entry);
    knownPaths.add(String(real).toLowerCase());
  }
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
  const cacheKey = `${shell.path}#${shell.distro ?? ''}`;
  const cached = versions.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.at < 600000) return cached.version;
  let version = '';
  try {
    if (isWslLauncher(shell)) {
      // Probe the bash version INSIDE the distro. Never run `wsl.exe --version`:
      // on a localized Windows that prints UTF-16LE ("WSL 内核版本: ...") which,
      // decoded as utf8, turns into mojibake like "W\u0000S\u0000L\u0000…".
      // `wsl -d <distro> bash -c 'printf %s "$BASH_VERSION"'` returns a clean
      // ASCII version string that matches the other bash rows. Try the plain
      // form first, then `-e bash` (some configurations need the exec flag).
      const target = shell.distro ? ['-d', shell.distro] : [];
      const probeArgv = [
        [...target, 'bash', '-c', 'printf %s "$BASH_VERSION"'],
        [...target, '-e', 'bash', '-c', 'printf %s "$BASH_VERSION"'],
        [...target, '--', 'bash', '-c', 'printf %s "$BASH_VERSION"'],
      ];
      for (const argv of probeArgv) {
        try {
          const output = execFileSync('wsl.exe', argv, {
            encoding: 'buffer',
            windowsHide: true,
            timeout: 6000,
            maxBuffer: 64 * 1024,
          });
          const text = output.includes(0) ? output.toString('utf16le') : output.toString('utf8');
          const matched = /([0-9]+\.[0-9]+(?:\.[0-9]+)?)/.exec(text)?.[1];
          if (matched) { version = matched; break; }
        } catch {
          // try the next argv form
        }
      }
    } else if (shell.kind === 'bash') {
      const output = execFileSync(shell.path, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1200,
        maxBuffer: 64 * 1024,
      });
      version = /version\s+([0-9][^\s(]*)/i.exec(output)?.[1] ?? (output.split(/\r?\n/)[0] ?? '').trim();
    } else if (isPowerShell(shell)) {
      const output = execFileSync(
        shell.path,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
        { encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024 },
      );
      version = output.trim().split(/\r?\n/).pop() ?? '';
    }
  } catch {
    version = '';
  }
  versions.set(cacheKey, { at: Date.now(), version });
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
  const keyOf = (shell) => `${shell.path}#${shell.distro ?? ''}`;
  const pending = shells.filter((shell) => shell.compatible && !versions.has(keyOf(shell)));
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
    const cached = versions.get(keyOf(shell));
    return { ...shell, version: cached?.version ?? '' };
  });
}

/** Does this path name one of the detected shells? */
function findByPath(shells, candidate, distro) {
  if (typeof candidate !== 'string' || candidate.length === 0) return undefined;
  const sameDistro = (shell) => String(shell.distro ?? '') === String(distro ?? '');
  let real;
  try {
    real = fs.realpathSync.native(candidate);
  } catch {
    // Store app-execution aliases cannot be resolved (EACCES); match them by
    // their own path, which is what spawn uses.
    const literal = shells.find((shell) => shell.path.toLowerCase() === candidate.toLowerCase() && sameDistro(shell));
    if (literal !== undefined) return literal;
    // Fall through: a manual path that realpath cannot resolve — accept it only
    // if the file is actually present (a path that does not exist is an error).
    if (fs.existsSync(candidate)) real = candidate;
    else return undefined;
  }
  const hit = shells.find((shell) => shell.path.toLowerCase() === real.toLowerCase() && sameDistro(shell));
  if (hit !== undefined) return hit;
  // Manual path not among discovered shells: validate it is a real file and
  // classify its dialect (bash-family vs PowerShell) so a non-shell or a
  // non-bash binary is not silently accepted.
  return classifyManualShell(real);
}

/**
 * Classify a manually-entered shell path.
 *
 * A manual path bypasses auto-detection, so it must be validated: the file must
 * exist, and it must be a runnable shell. The dialect is inferred from the
 * executable name and a cheap `--version` probe, so a `cmd.exe` or a random
 * binary is rejected rather than treated as bash. Returns a synthetic shell
 * entry (source `custom`) or `undefined` when the path is not usable.
 * @param {string} realPath - an existing absolute path.
 * @returns {Record<string, unknown> | undefined} a shell entry, or undefined.
 */
function classifyManualShell(realPath) {
  const base = path.basename(realPath).toLowerCase();
  const isPs = /^(pwsh|powershell)(\.exe)?$/.test(base);
  const looksBash = /(bash|sh|niu)(\.exe)?$/.test(base);
  // Hard-reject known non-shells even if a probe happens to "succeed".
  if (/^(cmd|notepad|bash\.exe\.bak)(\.exe)?$/.test(base)) return undefined;
  // Probe a version to confirm it really runs (guards against a bogus binary).
  let version = '';
  let probedVersion = false;
  try {
    if (isPs) {
      const out = execFileSync(realPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
        encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024,
      });
      version = (out.trim().split(/\r?\n/).pop() ?? '').trim();
      probedVersion = /\d+\.\d+/.test(version);
    } else {
      const out = execFileSync(realPath, ['--version'], {
        encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024,
      });
      const m = /version\s+([0-9][^\s(]*)/i.exec(out)?.[1] ?? /(\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1];
      if (m !== undefined) { version = m; probedVersion = true; }
      else version = (out.split(/\r?\n/)[0] ?? '').trim();
    }
  } catch {
    // If the name does not look like a shell AND the probe failed, refuse it.
    if (!isPs && !looksBash) return undefined;
  }
  if (isPs) {
    return { path: realPath, id: 'custom-pwsh', label: base, kind: 'powershell', dialect: 'powershell', compatible: true, source: 'custom', version };
  }
  // bash-family: accept a bash-ish NAME, or a binary whose --version had a
  // real version number. A random binary that neither looks like bash nor
  // reports a version is refused.
  if (!looksBash && !probedVersion) return undefined;
  return { path: realPath, id: 'custom', label: base, kind: 'bash', compatible: true, source: 'custom', version };
}

/**
 * Decide which shell the next command runs in: the Settings choice, then the
 * row's `shellPath`, then `shell`, then the first bash-compatible shell.
 * @param {Record<string, { get: () => unknown }>} config - the executor config.
 * @param {Array<Record<string, unknown>>} shells - detected shells.
 * @returns {{ shell: Record<string, unknown> | undefined, source: string, warning?: string }} the decision.
 */
/**
 * The first shell that is both compatible and actually usable right now: a
 * not-yet-installed embedded Niubash is compatible in principle but cannot run,
 * so it must never be an automatic default — only an explicit selection.
 * @param {Array<Record<string, unknown>>} shells - detected shells.
 * @returns {Record<string, unknown> | undefined} the first usable shell.
 */
function firstUsable(shells) {
  return shells.find((shell) => shell.compatible && !(shell.id === 'embedded-niu' && shell.installed === false));
}

function resolveShell(config, shells) {
  const selected = readSelection();
  const configuredPath = String(valueOf(config.shellPath, '') ?? '');
  const configuredId = String(valueOf(config.shell, DEFAULT_SHELL) ?? DEFAULT_SHELL);
  if (selected !== null) {
    const hit = findByPath(shells, selected.path, selected.distro);
    if (hit !== undefined) return { shell: hit, source: 'selection' };
    return {
      shell: firstUsable(shells),
      source: 'fallback',
      warning: `保存的 shell 已不存在：${selected.path}`,
    };
  }
  if (configuredPath.length > 0) {
    const hit = findByPath(shells, configuredPath);
    if (hit !== undefined) return { shell: hit, source: 'config' };
    return {
      shell: firstUsable(shells),
      source: 'fallback',
      warning: `配置的 shellPath 不存在：${configuredPath}`,
    };
  }
  if (configuredId.length > 0 && configuredId !== DEFAULT_SHELL) {
    const hit = shells.find((shell) => shell.id === configuredId && shell.compatible);
    if (hit !== undefined) return { shell: hit, source: 'config' };
  }
  return { shell: firstUsable(shells), source: 'auto' };
}

/**
 * Is this shell the WSL launcher (`%SystemRoot%\\System32\\bash.exe`)?
 *
 * That binary does not run bash on Windows: it starts bash inside the default
 * WSL distro, where `C:\\` does not exist. Everything Windows passes it must be
 * rewritten first.
 * @param {Record<string, unknown>} shell - the resolved shell.
 * @returns {boolean} true when the command has to be translated for WSL.
 */
function isWslLauncher(shell) {
  if (shell?.id === 'wsl') return true;
  const resolved = String(shell?.path ?? '').replace(/\\/g, '/').toLowerCase();
  return /\/windows\/system32\/bash\.exe$/.test(resolved) || /\/windows\/system32\/wsl\.exe$/.test(resolved);
}

/**
 * Translate a Windows path to its WSL form: `C:\\a\\b` becomes `/mnt/c/a/b`.
 * Already-POSIX paths, UNC paths and anything unparsable pass through unchanged.
 * @param {string} value - a Windows path.
 * @returns {string} the path usable inside WSL.
 */
function toWslPath(value) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (match === null) return value;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

/**
 * Build the argv that runs one command through WSL.
 *
 * Two translations are required, because the child process is inside the
 * distro: the command itself (absolute Windows paths written in the command
 * must become `/mnt/<drive>/...`), and the working directory, which Windows
 * resolves but Linux cannot. `-l` gives a login shell so the distro's PATH and
 * aliases are present, matching what a terminal in WSL would see.
 * @param {string} shellPath - the WSL launcher path.
 * @param {string} command - the bash command source.
 * @param {string} workdir - the host working directory.
 * @param {string} [distro] - a specific distribution (`wsl -d`), or the default.
 * @returns {string[]} argv for the launcher.
 */
function wslCommand(shellPath, command, workdir, distro) {
  const translated = command.replace(
    /(^|[^\w:])([A-Za-z]):[\\/]([^\s'"`;|&<>()]*)/g,
    (_match, prefix, drive, rest) => `${prefix}/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`,
  );
  const cd = `cd ${JSON.stringify(toWslPath(workdir))} 2>/dev/null || cd ~`;
  const target = typeof distro === 'string' && distro.length > 0 ? ['-d', distro] : [];
  // Run the distro's bash explicitly as a login shell: `bash -lc <cmd>`.
  // Do NOT pass `-l` to the WSL launcher itself — `wsl.exe -l` means "list
  // distributions" and rejects `-c` with E_INVALIDARG. The `-l/-c` flags belong
  // to bash inside the distro, so they go after `bash`.
  return [shellPath, ...target, 'bash', '-lc', `${cd} && ${translated}`];
}

/**
 * Is this shell a PowerShell dialect rather than bash?
 * @param {Record<string, unknown>} shell - the resolved shell.
 * @returns {boolean} whether the command has to be sent as PowerShell source.
 */
function isPowerShell(shell) {
  return shell?.dialect === 'powershell' || shell?.kind === 'powershell';
}

/**
 * Is this the embedded Niubash launcher? It runs bash, but its argv is the
 * encoded-command handoff `[niu, '--ec', base64]` instead of `-c`, which the
 * project documents as the agent-safe way to pass a command through layers.
 * @param {Record<string, unknown>} shell - the resolved shell.
 * @returns {boolean} whether to use the `--ec` form.
 */
function isNiu(shell) {
  return shell?.dialect === 'niu' || shell?.id === 'embedded-niu';
}

/**
 * The argv for one command under the embedded Niubash: UTF-8 source, base64,
 * passed as `--ec`. This has no quoting layer, so a command can contain any
 * shell metacharacter or quote and arrive verbatim.
 * @param {string} exePath - the niu launcher.
 * @param {string} command - the bash command source.
 * @returns {string[]} argv.
 */
function niuCommand(exePath, command) {
  return [exePath, '--ec', Buffer.from(command, 'utf8').toString('base64')];
}

/**
 * Bootstrap that reads UTF-8 source from stdin and runs it in a script block.
 *
 * The source never appears on the command line: a quoting mistake becomes a
 * syntax error instead of executing part of the command, and non-ASCII text
 * survives intact. `-EncodedCommand` is not used because it would need UTF-16.
 */
const POWERSHELL_STDIN_BOOTSTRAP =
  "$__dsh_source = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String([Console]::In.ReadToEnd())); " +
  "& ([ScriptBlock]::Create($__dsh_source))";

/**
 * Prologue that makes PowerShell's output and native-command encoding UTF-8.
 *
 * Without it, output from a non-ASCII path or a native program is decoded as
 * the OEM code page and arrives as mojibake. `UTF8Encoding($false)` keeps a BOM
 * off any stdin a native child would receive.
 */
const POWERSHELL_UTF8_PREFACE =
  "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
  "if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }";

/**
 * Build the argv and stdin for one PowerShell command.
 *
 * Mirrors what `@4fu/pi-pwsh` does (see its `spawn.ts`): UTF-8 source over
 * stdin, a base64 bootstrap, and the `-NoLogo -NoProfile -NonInteractive`
 * flags that keep a managed shell out of interactive/profile behaviour.
 * @param {Record<string, unknown>} shell - the resolved PowerShell.
 * @param {string} command - the PowerShell source.
 * @param {boolean} [loadProfile] - keep the user's profile active.
 * @returns {{ argv: string[], stdin?: string }} the invocation.
 */
function powershellCommand(shell, command, loadProfile = false) {
  const flags = ['-NoLogo', loadProfile ? null : '-NoProfile', '-NonInteractive', '-Command', POWERSHELL_STDIN_BOOTSTRAP]
    .filter((flag) => flag !== null);
  const source = `${POWERSHELL_UTF8_PREFACE}\n${command}`;
  return {
    argv: [shell.path, ...flags],
    stdin: Buffer.from(source, 'utf8').toString('base64'),
  };
}

/**
 * Resolve the selected shell to a detached-safe argv for one command.
 *
 * The foreground executor sends a PowerShell command over stdin; a detached
 * process has no stdin pipe here, so the base64 UTF-8 source is folded into the
 * `-Command` argument itself via the same bootstrap. Bash and WSL already carry
 * the command in argv. This is the background counterpart of the executor's
 * `argvFor`, kept standalone so `bg_start` needs no live executor.
 * @param {Record<string, unknown>} config - the row config.
 * @param {string} command - the command source.
 * @param {string} workdir - the resolved working directory.
 * @returns {Promise<{argv: string[], cwd: string, shellLabel: string}>} the detached invocation.
 */
async function resolveShellArgv(config, command, workdir) {
  const decision = resolveShell(config, await discoverShells());
  const shell = decision.shell;
  if (shell === undefined) {
    throw new Error('没有可用的 shell；请在 设置 → Shell 选择器 中选择，或安装 Niubash / Git Bash / MSYS2');
  }
  if (shell.compatible === false) {
    throw new Error(`${shell.label} 不是可用的 shell（既不是 bash 方言，也不是 PowerShell）`);
  }
  const cwd = workdir ?? process.cwd();
  if (isPowerShell(shell)) {
    const source = `${POWERSHELL_UTF8_PREFACE}\n${command}`;
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    const bootstrap = `$__dsh_src = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')); & ([ScriptBlock]::Create($__dsh_src))`;
    const loadProfile = Boolean(valueOf(config?.loadProfile, false));
    const flags = ['-NoLogo', loadProfile ? null : '-NoProfile', '-NonInteractive', '-Command', bootstrap].filter(
      (flag) => flag !== null,
    );
    return { argv: [shell.path, ...flags], cwd, shellLabel: shell.label, selfRedirect: true, dialect: 'powershell' };
  }
  if (isWslLauncher(shell)) {
    return { argv: wslCommand(shell.path, command, cwd, shell.distro), cwd, shellLabel: shell.label, selfRedirect: true, dialect: 'wsl', wslDistro: shell.distro, wslLauncher: shell.path };
  }
  if (isNiu(shell)) {
    const exe = shell.installed === false ? undefined : resolveEmbeddedExe();
    if (exe === undefined) {
      throw new Error('内置 Niubash 尚未安装；请在 设置 → Shell 选择器 点「安装内置 bash」或「重新扫描」下载');
    }
    // Bundled Niu reliably writes to an inherited detached fd — no self-redirect.
    return { argv: niuCommand(exe, command), cwd, shellLabel: shell.label, selfRedirect: false, dialect: 'niu' };
  }
  // Plain bash-family (Git Bash / MSYS2 / Cygwin). These need self-redirect
  // (they don't write to an inherited detached fd), and a detached Git Bash
  // needs its own coreutils dirs on PATH or `sleep`/`ls`/`date` go missing.
  return {
    argv: [shell.path, '-c', command],
    cwd,
    shellLabel: shell.label,
    selfRedirect: true,
    dialect: 'bash',
    extraPath: bashExtraPath(shell.path),
  };
}

/**
 * The bin directories a Windows bash needs on PATH when launched detached (its
 * `usr/bin` holds the coreutils, `mingw64/bin` the winpty/helpers). Derived from
 * `<root>/usr/bin/bash.exe` → [`<root>/usr/bin`, `<root>/mingw64/bin`]. Returns
 * undefined for a path that does not look like a Git/MSYS tree.
 * @param {string} bashPath - the bash.exe path.
 * @returns {string[] | undefined} extra PATH directories.
 */
function bashExtraPath(bashPath) {
  const normalized = String(bashPath ?? '');
  const match = /^(.*)[\\/]usr[\\/]bin[\\/]bash\.exe$/i.exec(normalized);
  if (match === null) return undefined;
  const binDir = path.dirname(normalized);
  const root = path.dirname(path.dirname(binDir)); // <root>
  return [binDir, path.join(root, 'mingw64', 'bin')];
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
  const { SandboxBashExecutor, SandboxUnavailableError, classifyRunnerFailure, isRunnerSpawnFailure, sandboxDenialMarker } =
    await shipped();
  /**
   * Did the sandbox provider reject this run as a policy denial?
   * @param {{ exitCode?: number|null, stderr: { text: string } }} result - the settled result.
   * @param {readonly string[]} [signatures] - provider-provided denial markers.
   * @returns {boolean} whether the run was denied.
   */
  const classifyDenial = (result, signatures) => {
    const text = String(result?.stderr?.text ?? '');
    if (text.includes(sandboxDenialMarker)) return true;
    if (Array.isArray(signatures)) {
      return signatures.some((signature) => signature.length > 0 && text.includes(signature));
    }
    return false;
  };
  ShellSwitchExecutor = class extends SandboxBashExecutor {
    static Config = Config;
    static inject = ['subprocess', 'sandbox', 'sandboxPolicy'];

    /**
     * @param {import('@deepseek-ai/cordis').Context} ctx - the isolated host context.
     * @param {object} config - the executor config.
     */
    constructor(ctx, config) {
      super(ctx, config);
      // The base class keeps this private; the local confined path writes the
      // same per-process facts, so a name derived from the instance is used and
      // only touched when the base already created it.
      this.processFacts ??= new Map();
    }

    /** The shell every command runs through, resolved per call. */
    async current() {
      const decision = resolveShell(this.config, await discoverShells());
      if (decision.shell === undefined) {
        throw new Error('dsh-shell-switch: 没有可用的 bash shell；请在 设置 → Shell 选择器 中选择，或安装 Niubash / Git Bash / MSYS2');
      }
      if (decision.shell.compatible === false) {
        throw new Error(`dsh-shell-switch: ${decision.shell.label} 不是可用的 shell（既不是 bash 方言，也不是 PowerShell）`);
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
    async confine(command, policy, signal, workdir) {
      const { shell } = await this.current();
      return this.ctx.sandbox.confine(this.argvFor(shell, command, policy, workdir), policy, signal);
    }

    /**
     * The inner argv for one command. Native bash runs `-c` as-is; the WSL
     * launcher gets the command and the working directory translated, because
     * the child process lives inside the distro.
     * @param {Record<string, unknown>} shell - the resolved shell.
     * @param {string} command - the bash command source.
     * @param {{ workspaceRoot?: string }} policy - resolved policy, for its root.
     * @param {string} [workdir] - the resolved command working directory.
     * @returns {string[]} argv handed to the sandbox provider or the subprocess.
     */
    argvFor(shell, command, policy, workdir) {
      if (isPowerShell(shell)) return powershellCommand(shell, command, Boolean(this.config?.loadProfile?.get?.())).argv;
      if (isWslLauncher(shell)) {
        return wslCommand(shell.path, command, workdir ?? policy?.workspaceRoot ?? process.cwd(), shell.distro);
      }
      if (isNiu(shell)) {
        // The executor only mounts the embedded shell once it is installed, so
        // the launcher path resolves here; fall back to shell.path otherwise.
        const exe = resolveEmbeddedExe() ?? shell.path;
        return niuCommand(exe, command);
      }
      return [shell.path, '-c', command];
    }

    /**
     * The spec fields a PowerShell command needs: the base64 source for stdin.
     * @param {object} spec - the resolved spec carrying the command.
     * @returns {{ stdin: string }} the stdin payload.
     */
    powershellSpec(spec) {
      return { stdin: Buffer.from(`${POWERSHELL_UTF8_PREFACE}\n${spec.command}`, 'utf8').toString('base64') };
    }

    /**
     * Run one resolved spec. Full-access runs bypass confinement and therefore
     * need their own argv; confined runs go through `confine` above.
     * @param {object} spec - the resolved execution spec.
     * @returns {Promise<object>} the execution handle.
     */
    async execute(spec) {
      const policy = spec.sandboxPolicy;
      // A PowerShell command travels on stdin (base64 UTF-8 source), so the
      // executed spec carries that payload; bash and WSL keep the command in
      // argv and leave stdin alone.
      const { shell: probe } = await this.current();
      const runSpec = isPowerShell(probe)
        ? { ...spec, ...this.powershellSpec(spec) }
        : spec;
      if (policy?.mode === 'danger-full-access') {
        const { shell } = await this.current();
        const execution = await this.executeArgv(runSpec, this.argvFor(shell, spec.command, policy, spec.workdir));
        return SandboxBashExecutor.decorateResult(execution, (result) => ({
          ...result,
          sandbox: { mode: 'danger-full-access', denied: false },
        }));
      }
      // Drive the confined path here instead of in the base class: the base
      // calls its own `confine(command, policy, signal)` with no working
      // directory, and the WSL launcher needs that directory translated. The
      // rest of the flow mirrors the shipped SandboxBashExecutor.execute.
      const { mode } = policy;
      let confined;
      const execution = await this.executeArgv(
        runSpec,
        async (signal) => {
          const prepared = await this.confine(spec.command, { ...policy, mode }, signal, spec.workdir);
          signal.throwIfAborted();
          confined = prepared;
          return prepared.argv;
        },
        (process) => {
          const facts = confined;
          if (facts === undefined) return;
          this.processFacts.set(process, {
            mode,
            enforcement: facts.enforcement,
            denialSignatures: facts.denialSignatures,
            runnerFailureRules: facts.runnerFailureRules,
            runnerProgram: facts.argv[0],
            workdir: spec.workdir,
          });
        },
      );
      return SandboxBashExecutor.decorateResult(
        execution,
        (result) => {
          if (confined === undefined) return { ...result, sandbox: { mode, denied: false } };
          const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, confined.runnerFailureRules);
          if (runnerFailure !== undefined) throw new SandboxUnavailableError(mode, runnerFailure.detail);
          return {
            ...result,
            sandbox: {
              mode,
              denied: classifyDenial(result, confined.denialSignatures),
              enforcement: confined.enforcement,
            },
          };
        },
        (error) => {
          if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
          if (confined !== undefined && isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
            throw new SandboxUnavailableError(mode, String(error));
          }
          throw error;
        },
      );
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
            ...decision.shell.distro === undefined ? {} : { distro: decision.shell.distro },
            label: decision.shell.label,
            kind: decision.shell.kind,
            version: decision.shell.version ?? '',
            compatible: decision.shell.compatible,
            exists: fs.existsSync(decision.shell.path),
          },
    source: decision.source,
    warning: decision.warning ?? null,
    customPaths: readCustomPaths(),
    terminal: {
      controller: terminalControllerIntegrated,
      follow: readStore().followTerminal !== false,
      selectedPath: decision.shell === undefined ? null : terminalPathForShell(decision.shell),
    },
    sandbox: policy ?? null,
    settingsFile: selectionFile(),
    defaults: { shell: String(valueOf(config.shell, DEFAULT_SHELL) ?? DEFAULT_SHELL) },
    embedded: {
      enabled: embeddedOptions.enabled !== false,
      supported: embeddedAssetFor() !== undefined,
      installed: embeddedInstalled(),
      version: activeVersion() ?? EMBEDDED_VERSION,
      versions: installedVersions(),
      lastCheck: embeddedUpdateState,
      platform: process.platform,
      arch: process.arch,
    },
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
        if (req.method === 'GET' && tail === '/embedded') {
          const desc = embeddedAssetFor();
          return json(res, 200, {
            ok: true,
            supported: desc !== undefined,
            enabled: embeddedOptions.enabled !== false,
            installed: embeddedInstalled(),
            version: activeVersion() ?? EMBEDDED_VERSION,
            versions: installedVersions(),
            asset: desc?.asset ?? null,
            platform: process.platform,
            arch: process.arch,
            root: embeddedRoot(),
            exe: resolveEmbeddedExe() ?? null,
            lastCheck: embeddedUpdateState,
          });
        }
        if (req.method === 'POST' && tail === '/embedded/install') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          const result = await installEmbedded({ baseUrl: embeddedOptions.baseUrl || undefined, debug: (...p) => debug('embedded', ...p) });
          if (result.ok) { discovery = { at: 0, shells: [] }; embeddedUpdateState = { status: 'unknown', at: Date.now() }; }
          return json(res, result.ok ? 200 : 500, result);
        }
        if (req.method === 'POST' && tail === '/embedded/check') {
          // Live check against GitHub Releases; read-only (never downloads).
          const result = await checkUpdate({ apiBase: embeddedOptions.releasesApi || undefined });
          embeddedUpdateState = { ...result, at: Date.now() };
          return json(res, 200, { ok: result.status !== 'unknown', ...embeddedUpdateState });
        }
        if (req.method === 'POST' && tail === '/embedded/update') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body = {};
          try { body = await readJson(req); } catch { body = {}; }
          // Resolve the target tag: explicit body.tag, else re-check for latest.
          let target = typeof body?.tag === 'string' ? body.tag : undefined;
          if (target === undefined) {
            const checked = await checkUpdate({ apiBase: embeddedOptions.releasesApi || undefined });
            if (checked.status !== 'update-available' || typeof checked.latest !== 'string') {
              return json(res, 400, { ok: false, error: checked.status === 'up-to-date' ? 'already up to date' : (checked.error ?? 'no newer version found') });
            }
            target = checked.latest;
          }
          const result = await updateEmbedded(target, {
            baseUrl: embeddedOptions.baseUrl || undefined,
            keep: 1,
            debug: (...p) => debug('embedded', ...p),
          });
          if (result.ok) {
            discovery = { at: 0, shells: [] };
            embeddedUpdateState = { status: 'up-to-date', current: result.version, latest: result.version, at: Date.now() };
          }
          return json(res, result.ok ? 200 : 500, result);
        }
        if (req.method === 'POST' && tail === '/embedded/rollback') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body = {};
          try { body = await readJson(req); } catch { body = {}; }
          const result = rollbackEmbedded(typeof body?.tag === 'string' ? body.tag : undefined);
          if (result.ok) { discovery = { at: 0, shells: [] }; embeddedUpdateState = { status: 'unknown', current: result.version, at: Date.now() }; }
          return json(res, result.ok ? 200 : 400, result);
        }
        if (req.method === 'POST' && tail === '/embedded/remove') {
          const result = removeEmbedded();
          discovery = { at: 0, shells: [] };
          embeddedUpdateState = { status: 'unknown', at: Date.now() };
          return json(res, 200, result);
        }
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
            refilterTools();
            return json(res, 200, await statePayload(ctx, config, false));
          }
          const shells = await discoverShells(true);
          const customPath = typeof body?.path === 'string' ? body.path.trim() : '';
          const hit = findByPath(shells, customPath, body?.distro);
          if (hit === undefined) {
            const exists = customPath.length > 0 && fs.existsSync(customPath);
            return json(res, 400, {
              ok: false,
              error: exists
                ? `该文件不是可用的 shell（不是 bash 方言，也不是 PowerShell）：${customPath}`
                : `未找到该 shell（路径不存在）：${customPath}`,
            });
          }
          if (hit.compatible !== true) {
            return json(res, 400, { ok: false, error: `${hit.label} 不是 bash 方言，无法执行 bash 命令` });
          }
          writeSelection(hit.path, hit.distro);
          refilterTools();
          return json(res, 200, await statePayload(ctx, config, false));
        }
        // Add or remove a manually-entered shell path from the picker. Adding
        // validates the path (exists + is a shell) but does NOT select it — the
        // user then chooses it in the dropdown and saves.
        if (req.method === 'POST' && tail === '/custom/add') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body;
          try {
            body = await readJson(req);
          } catch {
            return json(res, 400, { ok: false, error: 'invalid JSON body' });
          }
          const rawPath = typeof body?.path === 'string' ? body.path.trim() : '';
          if (rawPath.length === 0) return json(res, 400, { ok: false, error: '路径为空' });
          let real = rawPath;
          try { real = fs.realpathSync.native(rawPath); } catch { /* keep literal */ }
          if (!fs.existsSync(real)) {
            return json(res, 400, { ok: false, error: `路径不存在：${rawPath}` });
          }
          const entry = classifyManualShell(real);
          if (entry === undefined) {
            return json(res, 400, { ok: false, error: `该文件不是可用的 shell（不是 bash 方言，也不是 PowerShell）：${rawPath}` });
          }
          addCustomPath(real);
          discovery = { at: 0, shells: [] }; // force re-discovery so it appears
          return json(res, 200, await statePayload(ctx, config, true));
        }
        if (req.method === 'POST' && tail === '/custom/remove') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body;
          try {
            body = await readJson(req);
          } catch {
            return json(res, 400, { ok: false, error: 'invalid JSON body' });
          }
          const rawPath = typeof body?.path === 'string' ? body.path.trim() : '';
          if (rawPath.length === 0) return json(res, 400, { ok: false, error: '路径为空' });
          removeCustomPath(rawPath);
          discovery = { at: 0, shells: [] };
          return json(res, 200, await statePayload(ctx, config, true));
        }
        if (req.method === 'POST' && tail === '/terminal/follow') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body;
          try {
            body = await readJson(req);
          } catch {
            return json(res, 400, { ok: false, error: 'invalid JSON body' });
          }
          if (typeof body?.follow !== 'boolean') {
            return json(res, 400, { ok: false, error: 'follow must be a boolean' });
          }
          writeStore({ followTerminal: body.follow });
          return json(res, 200, await statePayload(ctx, config, false));
        }
        if (backgroundSessions === null) {
          return json(res, 404, { ok: false, error: 'background sessions are disabled' });
        }
        if (req.method === 'GET' && tail === '/jobs') {
          const active = url.searchParams.get('session') ?? '';
          const all = url.searchParams.get('all') === '1';
          const auto = { enabled: backgroundSessions.autoCleanup, keep: backgroundSessions.autoCleanupKeep };
          if (all) return json(res, 200, { ok: true, jobs: backgroundSessions.list(), autoCleanup: auto });
          return json(res, 200, { ok: true, ...backgroundSessions.grouped(active), autoCleanup: auto });
        }
        const logMatch = /^\/jobs\/([^/]+)\/log$/.exec(tail);
        if (req.method === 'GET' && logMatch !== null) {
          const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
          const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10) || undefined;
          const result = backgroundSessions.read(decodeURIComponent(logMatch[1]), offset, limit);
          if (!result.ok) return json(res, 404, result);
          return json(res, 200, { ok: true, ...result });
        }
        const killMatch = /^\/jobs\/([^/]+)\/kill$/.exec(tail);
        if (req.method === 'POST' && killMatch !== null) {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body = {};
          try {
            body = await readJson(req);
          } catch {
            body = {};
          }
          const result = backgroundSessions.kill(decodeURIComponent(killMatch[1]), body?.reason);
          if (!result.ok) return json(res, 404, result);
          return json(res, 200, result);
        }
        // Delete one STOPPED job (log included). Live jobs are refused.
        const removeMatch = /^\/jobs\/([^/]+)\/remove$/.exec(tail);
        if (req.method === 'POST' && removeMatch !== null) {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          const result = backgroundSessions.remove(decodeURIComponent(removeMatch[1]));
          if (!result.ok) return json(res, 400, result);
          return json(res, 200, result);
        }
        // Delete every STOPPED job (optionally scoped to one session).
        if (req.method === 'POST' && tail === '/jobs/cleanup') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body = {};
          try {
            body = await readJson(req);
          } catch {
            body = {};
          }
          const sessionId = typeof body?.session === 'string' && body.session.length > 0 ? body.session : undefined;
          const removed = backgroundSessions.removeStopped(sessionId);
          return json(res, 200, { ok: true, removed });
        }
        // Update the auto-cleanup policy at runtime.
        if (req.method === 'POST' && tail === '/jobs/auto-cleanup') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
            return json(res, 415, { ok: false, error: 'content-type must be application/json' });
          }
          let body = {};
          try {
            body = await readJson(req);
          } catch {
            body = {};
          }
          const applied = backgroundSessions.setAutoCleanup({ enabled: body?.enabled, keep: body?.keep });
          writeStore({ autoCleanup: applied.enabled, autoCleanupKeep: applied.keep });
          return json(res, 200, { ok: true, ...applied });
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
const diagnostics = { tool: 'idle', attached: 0, restricted: 0, pending: 0, error: null, pwshError: null };
const attached = new WeakMap();
/** Every Agent currently mounted, so a selection change can re-filter tools. */
const liveAgents = new Set();
/** Agent → disposer of the `pwsh` deny filter this plugin installed. */
const pwshFilters = new WeakMap();

/**
 * Make exactly one shell tool visible for one Agent.
 *
 * Both tools are mounted on the Agent's scope: `bash` (this plugin's executor,
 * which runs whatever shell is selected) and the official `pwsh`. Depending on
 * the selection one of them is hidden again:
 *
 * - a bash-family shell (Git Bash, Niubash, MSYS2, WSL, ...): hide `pwsh`, so
 *   `bash` is the only shell tool and commands are bash;
 * - a PowerShell selection: hide `bash`, so the official `pwsh` tool is the
 *   only shell tool and commands are PowerShell, with its own params, sandbox
 *   facts and prompt guidance.
 *
 * `tools.restrict()` can only name tools that already exist in the scope, so
 * the filter is (re)applied after the tools mount; an Agent whose filter could
 * not be installed yet is retried rather than left with both tools visible.
 * @param {object} agent - the Agent whose catalog is adjusted.
 * @param {boolean} [retry] - schedule a retry when the named tool is missing.
 */
function applyPwshPolicy(agent, retry = true, scope = undefined) {
  if (!isWin) return;
  if (agent === null || agent === undefined || agent.ctx === undefined) return;
  // `restrict()` only masks *global* tools; scope-local registrations stay
  // visible, and this plugin mounts both tools inside the Agent's own shell
  // scope. So the deny filter belongs on the Agent scope, one level above that
  // scope, where both tools are seen as visible globals.
  const target = agent.ctx;
  const existing = pwshFilters.get(agent);
  if (existing !== undefined) {
    try {
      existing();
    } catch {
      // already released
    }
    pwshFilters.delete(agent);
    diagnostics.restricted = Math.max(0, diagnostics.restricted - 1);
  }
  const powerShellSelected = wantPowerShellTool();
  const hidden = powerShellSelected ? 'bash' : 'pwsh';
  try {
    const dispose = target.tools.restrict({ deny: [hidden] });
    pwshFilters.set(agent, dispose);
    diagnostics.restricted += 1;
    diagnostics.pwshError = null;
    diagnostics.pending = 0;
    debug('tool-filter', `deny=${hidden}`, agent.id ?? 'unknown');
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/unknown global tool/i.test(message)) {
      // The tools are still mounting; retry shortly rather than leave the
      // Agent with two shell tools.
      diagnostics.pending = (diagnostics.pending ?? 0) + 1;
      debug('tool-filter-pending', `deny=${hidden}`, agent.id ?? 'unknown');
      if (retry) {
        const timer = setTimeout(() => applyPwshPolicy(agent, false, scope), 1500);
        timer.unref?.();
      }
      return;
    }
    diagnostics.pwshError = message;
    debug('tool-filter-failed', message.slice(0, 300));
  }
}

/**
 * Should the official `pwsh` tool be the visible one?
 *
 * Decided from the resolved shell: a PowerShell choice is identified by the
 * entry it resolves to (its dialect). Before the first discovery the list is
 * empty, so the stored path is inspected instead — it names
 * `pwsh.exe`/`powershell.exe` exactly when the user picked a PowerShell.
 * @returns {boolean} true when PowerShell is selected.
 */
function wantPowerShellTool() {
  try {
    const chosen = readSelection();
    // The stored choice is authoritative and always available: a PowerShell
    // pick names a `pwsh.exe`/`powershell.exe` path, a bash pick does not.
    if (chosen !== null) {
      const stored = discovery.shells.find(
        (shell) => shell.path.toLowerCase() === String(chosen.path).toLowerCase(),
      );
      if (stored !== undefined) return isPowerShell(stored);
      return /[/\\](pwsh|powershell)\.exe$/i.test(String(chosen.path ?? ''));
    }
    if (discovery.shells.length === 0) return false;
    const selected = resolveShell(executorConfig({}), discovery.shells);
    return isPowerShell(selected.shell ?? {});
  } catch {
    return false;
  }
}

/** Filter tools from the Agent's inner shell scope, where they were mounted. */
function applyToolsFilter(agent, scope) {
  applyPwshPolicy(agent, true, scope);
}

/** Re-apply the tool filter to every mounted Agent after a selection change. */
function refilterTools() {
  for (const agent of liveAgents) applyPwshPolicy(agent);
}

/** Remove one Agent's tool deny filter, if this plugin installed it. */
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
      inject: ['subprocess', 'sandbox', 'sandboxPolicy', 'tools', 'workingDirectory'],
      async apply(inner) {
        // Deferred here so creating an Agent costs nothing until it really needs
        // a shell tool; every call is memoized after the first Agent.
        //
        // Both tools are mounted: `bash` is powered by this plugin's executor
        // (any shell the user selects), and `pwsh` is the official PowerShell
        // tool. Which one the model sees is decided by a scope filter below, so
        // switching the selection in Settings takes effect without a remount.
        const [Executor, modules] = await Promise.all([shellSwitchExecutor(), shipped()]);
        new Executor(inner, executorConfig(config));
        // One tool per dialect, and only the one this selection needs: `bash`
        // runs a bash-family shell, the official `pwsh` tool is used for a
        // PowerShell selection. Mounting the unused one and hiding it would
        // need a deny filter, which cannot mask scope-local tools.
        const wantPwsh = wantPowerShellTool();
        // `run_in_background` is disabled: background work is provided by this
        // plugin's own detached `bg_*` tools (see below), which neither need nor
        // touch the DSH job registry. That keeps one coherent background story.
        const tools = wantPwsh
          ? [[modules.toolPwsh, 'pwsh', undefined]]
          : [[modules.toolBash, 'bash', { enableRunInBackground: false }]];
        const mounted = [];
        for (const [tool, label, toolConfig] of tools) {
          const toolFiber = inner.plugin(tool, toolConfig);
          mounted.push(Promise.resolve(toolFiber).then(
            () => {
              diagnostics.tool = 'active';
              debug('tool-active', label, agent.id ?? 'unknown');
            },
            (error) => {
              diagnostics.tool = 'failed';
              diagnostics.error = `[${label}] ${String(error?.stack ?? error)}`;
              debug('tool-failed', label, diagnostics.error);
            },
          ));
        }
        // Mount the background tools beside whichever shell tool this selection
        // uses: they work for bash, WSL and PowerShell alike (the resolver picks
        // the dialect), and run detached processes that outlive the call.
        if (backgroundSessions !== null && backgroundConfig(config).enabled) {
          const kit = await toolKit();
          const bgDefs = buildBackgroundTools({
            sessions: backgroundSessions,
            resolve: ({ cwd, command }) => resolveShellArgv(config, command, cwd),
            // Default the working directory to the Agent's session workspace,
            // exactly as the `bash` tool does, so a relative command behaves
            // the same in the foreground and the background.
            sessionCwd: (agent, signal) => inner.workingDirectory.ensure(agent, signal),
            defineTool: kit.defineTool,
            ToolArgsError: kit.ToolArgsError,
          });
          for (const def of bgDefs) {
            const reg = inner.tools.register(def);
            mounted.push(Promise.resolve(reg).then(
              () => debug('bg-tool-active', def.name, agent.id ?? 'unknown'),
              (error) => debug('bg-tool-failed', def.name, String(error?.stack ?? error)),
            ));
          }
        }
        // Only now can a filter name both tools, so the visible one is chosen
        // once the mounts settle rather than at Agent creation. The mount
        // itself is awaited by the fiber, so the filter runs just after this
        // apply returns.
        await Promise.all(mounted);
      },
    });
    attached.set(agent, fiber);
    liveAgents.add(agent);
    diagnostics.attached += 1;
    // A bash-family selection must also hide the *preset's* own `pwsh` tool;
    // a PowerShell selection keeps it and mounts its own copy only if the
    // preset does not provide one (see the mount above).
    if (!wantPowerShellTool()) applyPwshPolicy(agent);
  } catch (error) {
    diagnostics.tool = 'threw';
    diagnostics.error = String(error?.stack ?? error);
    debug('attach-threw', diagnostics.error);
  }
}

/** Drop one Agent's scope, executor, and tool. */
function detachAgent(agent) {
  releasePwshPolicy(agent);
  liveAgents.delete(agent);
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
  // Capture the embedded-Niubash options and, on a platform that ships one,
  // start a one-shot background install so the first visit finds it ready.
  // (Windows is enabled by default; Linux/macOS default off — they have bash.)
  {
    const raw = valueOf(config?.embedded, undefined);
    const inner = raw !== null && typeof raw === 'object' ? raw : {};
    embeddedOptions = {
      enabled: valueOf(inner.enabled, isWin) !== false,
      autoInstall: valueOf(inner.autoInstall, true) !== false,
      baseUrl: String(valueOf(inner.baseUrl, '') ?? ''),
      releasesApi: String(valueOf(inner.releasesApi, '') ?? ''),
      checkOnStartup: valueOf(inner.checkOnStartup, true) !== false,
    };
    const anyInstalled = embeddedInstalled();
    if (embeddedOptions.enabled && embeddedOptions.autoInstall && !anyInstalled && embeddedAssetFor() !== undefined) {
      const timer = setTimeout(() => {
        void installEmbedded({ baseUrl: embeddedOptions.baseUrl || undefined, debug: (...p) => debug('embedded', ...p) })
          .then((r) => {
            if (r.ok) { discovery = { at: 0, shells: [] }; debug('embedded-installed', r.path ?? ''); }
            else if (!r.skipped) debug('embedded-install-failed', r.error ?? '');
          })
          .catch(() => {});
      }, 2500);
      timer.unref?.();
    }
    // Online update check at startup: PROMPT ONLY. It records the result (so the
    // Settings panel shows "update available") but never downloads or switches
    // anything — the user must click Update. Runs after the install above so a
    // fresh install is checked once, and is deliberately delayed + non-blocking.
    if (embeddedOptions.enabled && embeddedOptions.checkOnStartup && embeddedAssetFor() !== undefined) {
      const checkTimer = setTimeout(() => {
        void checkUpdate({ apiBase: embeddedOptions.releasesApi || undefined })
          .then((r) => {
            embeddedUpdateState = { ...r, at: Date.now() };
            debug('embedded-check', r.status, r.current ?? '', r.latest ?? '');
          })
          .catch(() => {});
      }, anyInstalled ? 4000 : 12000);
      checkTimer.unref?.();
    }
  }
  // Create the shared background manager once, before any Agent attaches so
  // their `bg_*` tools have a live sessions store to register against. It is
  // disposed (sweep timer only; jobs keep running) with this row's fiber.
  ctx.effect(() => {
    const bg = backgroundConfig(config);
    if (!bg.enabled) return () => {};
    backgroundSessions = new BackgroundSessions({
      maxLogBytes: bg.maxLogBytes,
      maxJobs: bg.maxJobs,
      autoCleanup: bg.autoCleanup,
      autoCleanupKeep: bg.autoCleanupKeep,
      debug: (...parts) => debug('bg', ...parts),
    });
    return () => {
      try {
        backgroundSessions?.dispose();
      } catch {
        // ignore
      }
      backgroundSessions = null;
    };
  }, 'dsh-shell-switch: background sessions');
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
  // Optional better-sidebar / official-terminal integration. The controller is
  // decorated in memory only: no other plugin's files or Config are changed.
  ctx.inject(['terminalController'], (serviceCtx) => {
    serviceCtx.effect(() => {
      const controller = serviceCtx.terminalController ?? serviceCtx.get?.('terminalController');
      if (typeof controller?.shells !== 'function' || typeof controller?.create !== 'function') return () => {};
      const restore = installTerminalIntegration(controller, {
        discover: () => discoverShells(false),
        current: async () => resolveShell(config, await discoverShells(false)).shell,
        following: () => readStore().followTerminal !== false,
      });
      terminalControllerIntegrated = true;
      debug('terminal-controller-integrated');
      return () => {
        terminalControllerIntegrated = false;
        try { restore(); } catch { /* best effort during teardown */ }
      };
    }, 'dsh-shell-switch: terminal controller integration');
  });
  // Warm the registry scan and the version cache at mount so the first visit to
  // the Settings page is answered from cache instead of waiting for them.
  ctx.effect(() => {
    let cancelled = false;
    uninstallLocations();
    const timer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          // Distro presence first: it decides which WSL entries exist and
          // whether each can run bash at all.
          const distros = wslDistros();
          for (const distro of distros) probeDistroBash(distro);
          if (cancelled) return;
          const shells = await discoverShells(true);
          for (const shell of shells) {
            if (shell.compatible) probeVersion(shell);
          }
          if (cancelled) return;
          // Drop the cached list so the page's next read reflects the probes.
          discovery = { at: 0, shells: [] };
        } catch {
          // best effort
        }
      })();
    }, 1500);
    timer.unref?.();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, 'dsh-shell-switch: shell cache warm-up');
  debug('row-apply');
}
