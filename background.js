/**
 * Persistent background sessions for dsh-shell-switch.
 *
 * DSH's own `ctx.subprocess` is a *managed* process group: the service tears a
 * spawned process down when its own fiber disposes, and a tool call waits on
 * the handle rather than outliving it. That is exactly why DSH ships a separate
 * job registry — but this plugin deliberately does NOT depend on
 * `@deepseek-ai/dsh-tool-jobs`. Instead it owns a small detached-process manager
 * of its own:
 *
 *  - `spawn(..., { detached: true })` + `unref()` so the child survives the tool
 *    call (and the harness) that started it;
 *  - output is redirected to a per-job log file, which is the single source of
 *    truth a later read streams from with an offset;
 *  - a JSON index in `$DSH_HOME/shell-switch-jobs/index.json` records each job's
 *    owner session, argv, pid and liveness so the sidebar panel can group them
 *    per conversation, and so a restart can reconcile orphans.
 *
 * The manager is intentionally sandbox-agnostic: a detached long-running server
 * has no meaning inside a read-only confinement. Callers start a job only after
 * resolving the shell (via the executor's own `argvFor`), so bash / WSL /
 * PowerShell all work; the panel and tools surface this explicitly.
 *
 * @module dsh-shell-switch/background
 */

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Default per-job log cap; older output is dropped from the head on rotation. */
const DEFAULT_MAX_LOG_BYTES = 8 * 1024 * 1024;
/** Default cap on retained (non-running) jobs, oldest pruned first. */
const DEFAULT_MAX_JOBS = 50;
/** Auto-cleanup keeps this many newest STOPPED jobs; older ones are deleted. */
const DEFAULT_AUTO_CLEANUP_KEEP = 50;
/**
 * A job that exited successfully within this window is a one-shot command that
 * should have been a foreground `bash` call; the panel hides those by default so
 * the list stays a view of real long-running services. Failures are never
 * hidden: a server that dies after two seconds is exactly what the user needs
 * to see.
 */
const QUICK_SUCCESS_MS = 15_000;
/** How often the liveness sweep re-checks a running job's pid. */
const SWEEP_MS = 4000;

/** The jobs directory under the per-user DSH home. */
function jobsDir() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'shell-switch-jobs');
}

/** The index file backing the manager. */
function indexFile() {
  return path.join(jobsDir(), 'index.json');
}

/** Short, human-scannable id (`bg-<8 hex>`). */
function mintId() {
  return `bg-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Is `pid` alive right now? `kill(pid, 0)` only probes; on Windows an
 * `EPERM` still means the process exists (just not ours to signal), so both
 * `null` and `EPERM` count as alive.
 * @param {number} pid - the process id to probe.
 * @returns {boolean} true when the process is still running.
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Translate a Windows path to its WSL mount form (`C:\a` → `/mnt/c/a`). A
 * non-drive path is returned unchanged.
 * @param {string} value - a Windows path.
 * @returns {string} the WSL path.
 */
function toWslPath(value) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(String(value));
  if (match === null) return String(value);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

/** Cached default WSL distribution name (resolved via `wsl -l -v`). */
let cachedWslDistro;
/**
 * Resolve a usable WSL distribution name for launching a background job.
 *
 * A background WSL command MUST run as `<wsl.exe> -d <distro> bash <file>`;
 * without `-d`, `wsl bash file` falls into a `/bin/sh` with no `bash` (exit
 * 127). We list distributions and pick the first non-utility one (skipping the
 * `docker-desktop` VM), preferring a `Default`/running one when known.
 * @param {string} [launcher] - the wsl.exe path.
 * @returns {string | undefined} a distro name, or undefined if none found.
 */
function defaultWslDistro(launcher) {
  if (cachedWslDistro !== undefined) return cachedWslDistro;
  const exe = typeof launcher === 'string' && launcher.length > 0 ? launcher : 'wsl.exe';
  try {
    const raw = execFileSync(exe, ['-l', '-q'], {
      encoding: 'buffer', windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024,
    });
    const text = raw.includes(0) ? raw.toString('utf16le') : raw.toString('utf8');
    const names = text.split(/\r?\n/).map((s) => s.replace(/\u0000/g, '').trim()).filter(Boolean)
      .filter((n) => !/^docker-desktop/i.test(n));
    cachedWslDistro = names[0];
  } catch {
    cachedWslDistro = undefined;
    return undefined;
  }
  return cachedWslDistro;
}

/**
 * Build an argv whose command source redirects its own stdout/stderr to the
 * log file, for shells that do not write to an inherited, detached file handle
 * (WSL, PowerShell, some Git Bash builds). The command source is always the
 * last argv element; we rewrite only that.
 * @param {string[]} argv - the original argv from the shell resolver.
 * @param {string} logPath - absolute log-file path (Windows form).
 * @param {string} [dialect] - 'bash' | 'wsl' | 'powershell' | undefined.
 * @returns {string[]} a new argv with self-redirection appended.
 */
function buildSelfRedirectArgv(argv, logPath, dialect) {
  const out = [...argv];
  const cmd = out[out.length - 1] ?? '';
  if (dialect === 'powershell') {
    // PowerShell: redirect all streams to the file, ASCII/UTF8 append.
    // `*>` sends every stream; wrap the whole original source in a scriptblock
    // so the redirect applies to the script's output.
    out[out.length - 1] = `& { ${cmd} } *> ${psQuote(logPath)}`;
  } else if (dialect === 'wsl') {
    // Path lives on the Windows side; the distro sees it under /mnt/<drive>.
    const wslLog = toWslPath(logPath);
    out[out.length - 1] = `{ ${cmd} ; } > ${bashQuote(wslLog)} 2>&1`;
  } else {
    // bash-family on Windows (Git Bash, MSYS2, Niu): write to the Windows path.
    // Git Bash understands Windows paths when quoted; use the posix form to be safe.
    const posix = String(logPath).replace(/\\/g, '/');
    out[out.length - 1] = `{ ${cmd} ; } > ${bashQuote(posix)} 2>&1`;
  }
  return out;
}

/** Single-quote a path for a POSIX shell. */
function bashQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Single-quote a path for PowerShell (escape internal single quotes). */
function psQuote(value) {
  return `'${String(value).replace(/'/g, `''`)}'`;
}

/**
 * Build the argv for a file-based WSL background job.
 *
 * Passing a long command as a `-lc "<cmd>"` argument to `wsl.exe` mangles shell
 * metacharacters (`$i`, `$(...)`, `$((...))` get eaten by wsl.exe's own arg
 * handling), which silently breaks loops/vars. So instead we write the command
 * to a `.sh` file (with the `cd` prelude baked in) and run `wsl -d <distro>
 * bash <file>`, which preserves everything verbatim. The script redirects its
 * own output to the log.
 * @param {object} opts - options.
 * @param {string} opts.launcher - wsl.exe path.
 * @param {string} [opts.distro] - distribution name (optional).
 * @param {string} opts.command - the raw bash command.
 * @param {string} opts.cwd - the Windows working directory.
 * @param {string} opts.logPath - the Windows log path.
 * @param {string} opts.scriptPath - where to write the .sh (Windows path).
 * @returns {string[]} argv for wsl.exe.
 */
function wslFileArgv(opts) {
  // `wsl.exe` REQUIRES `-d <distro>` here: without it, `wsl bash script.sh`
  // runs under a `/bin/sh` that has no `bash` (exit 127 "/bin/sh: bash: not
  // found"), and `-e bash` also fails on a default distro whose bash path
  // differs. So resolve a distro if the caller did not supply one.
  let distro = opts.distro;
  if (!(typeof distro === 'string' && distro.length > 0)) {
    distro = defaultWslDistro(opts.launcher);
  }
  // Translate the script body ...
  const translated = String(opts.command).replace(
    /(^|[^\w:])([A-Za-z]):[\\/]([^\s'"`;|&<>()]*)/g,
    (_m, prefix, drive, rest) => `${prefix}/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`,
  );
  const cd = `cd ${bashQuote(toWslPath(opts.cwd))} 2>/dev/null || cd ~`;
  const logWsl = toWslPath(opts.logPath);
  const body = `#!/usr/bin/env bash\n${cd}\n{\n${translated}\n} > ${bashQuote(logWsl)} 2>&1\n`;
  fs.writeFileSync(opts.scriptPath, body, 'utf8');
  const scriptWsl = toWslPath(opts.scriptPath);
  const target = typeof distro === 'string' && distro.length > 0 ? ['-d', distro] : [];
  return [opts.launcher, ...target, 'bash', scriptWsl];
}

/**
 * Split a PowerShell argv into its executable and the static flags before
 * `-Command`. The `-Command <bootstrap>` pair is dropped because the detached
 * launcher runs the raw command from a `.ps1` file instead.
 * @param {string[]} argv - `[exe, ...flags, '-Command', bootstrap]`.
 * @returns {{ psExe: string, psFlags: string[] }} the executable and flags.
 */
function splitPowerShellArgv(argv) {
  const psExe = argv[0];
  const cmdIndex = argv.indexOf('-Command');
  const psFlags = cmdIndex === -1 ? argv.slice(1) : argv.slice(1, cmdIndex);
  return { psExe, psFlags };
}

/**
 * Launch a PowerShell command as a genuinely detached process that actually
 * runs and writes its output to `logPath`.
 *
 * On Windows `spawn(pwsh, ..., {detached:true})` exits immediately without
 * running the command (no console host), including the Store alias `pwsh.exe`.
 * `cmd /c start "" /b <launcher.cmd>` detaches into an independent process that
 * keeps a console context. We write the raw command to a `.ps1`, and a `.cmd`
 * launcher that runs it with `> log 2>&1`, then start that launcher detached.
 * @param {object} opts - launch options.
 * @param {string} opts.exe - the PowerShell executable.
 * @param {string[]} opts.flags - static flags (`-NoLogo`, `-NoProfile`, …).
 * @param {string} opts.command - the raw PowerShell command source.
 * @param {string} opts.logPath - log file path.
 * @param {string} opts.cwd - working directory.
 * @param {object} opts.env - environment.
 * @returns {import('node:child_process').ChildProcess} the launcher process.
 */
function launchPowerShellDetached(opts) {
  const id = path.basename(opts.logPath).replace(/\.log$/, '');
  const dir = path.dirname(opts.logPath);
  const ps1 = path.join(dir, `${id}.ps1`);
  const bat = path.join(dir, `${id}.cmd`);
  const pidFile = path.join(dir, `${id}.pid`);
  // Force UTF-8 output so CJK / unicode lines round-trip into the log cleanly,
  // and record the real PowerShell PID (the launcher cmd's PID dies instantly,
  // so the job must track this one instead).
  const prelude = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8;';
  const pidLine = `$PID | Out-File -FilePath ${psQuote(pidFile)} -Encoding ascii -Force`;
  fs.writeFileSync(ps1, `${prelude}\n${pidLine}\n${opts.command}\n`, 'utf8');
  const flags = (opts.flags ?? []).join(' ');
  // Batch: run pwsh -File <ps1>, redirecting both streams to the log. `chcp 65001`
  // so the console code page matches UTF-8.
  const lines = [
    '@echo off',
    'chcp 65001 >nul 2>&1',
    `"${opts.exe}" ${flags} -ExecutionPolicy Bypass -File "${ps1}" > "${opts.logPath}" 2>&1`,
  ];
  fs.writeFileSync(bat, lines.join('\r\n') + '\r\n', 'utf8');
  // `start "" /b <bat>` detaches the batch into its own independent process.
  const launcher = spawn('cmd.exe', ['/c', 'start', '', '/b', bat], {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  // The real PowerShell process is a grandchild; resolve its PID from the pid
  // file shortly after launch and hand it back via a callback.
  return { launcher, pidFile, resolvePid: opts.resolvePid };
}

/** Read one log file's tail from `offset`, capped at `limit` bytes. */
function readLogAt(file, offset, limit) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { text: '', offset: 0, size: 0, eof: true };
  }
  const size = stat.size;
  const start = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, size));
  const want = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 64 * 1024, 256 * 1024));
  const end = Math.min(size, start + want);
  if (end <= start) return { text: '', offset: start, size, eof: start >= size };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return { text: buf.toString('utf8'), offset: end, size, eof: end >= size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The detached-process manager.
 *
 * One instance is created per plugin row `apply` and shared across every Agent,
 * so all conversations see the same job list (which is what the panel's
 * "global" view needs). It is deliberately NOT scoped to an Agent.
 */
export class BackgroundSessions {
  /**
   * @param {object} options - manager budgets.
   * @param {number} [options.maxLogBytes] - per-job log cap.
   * @param {number} [options.maxJobs] - retained-job cap.
   * @param {(line: string) => void} [options.debug] - optional logger.
   */
  constructor(options = {}) {
    this.maxLogBytes = Number.isFinite(options.maxLogBytes) ? options.maxLogBytes : DEFAULT_MAX_LOG_BYTES;
    this.maxJobs = Number.isFinite(options.maxJobs) ? options.maxJobs : DEFAULT_MAX_JOBS;
    // Auto-cleanup of STOPPED jobs is GLOBAL: across every session combined,
    // keep only the newest `autoCleanupKeep` settled jobs and delete the rest
    // (log file included). Default: enabled, keep 50.
    this.autoCleanup = options.autoCleanup !== false;
    this.autoCleanupKeep = Number.isFinite(options.autoCleanupKeep) ? options.autoCleanupKeep : DEFAULT_AUTO_CLEANUP_KEEP;
    this.debug = options.debug ?? (() => {});
    /** @type {Map<string, object>} jobId → record */
    this.jobs = new Map();
    this.sweep = undefined;
    this.load();
  }

  /** Ensure the jobs directory exists. */
  ensureDir() {
    try {
      fs.mkdirSync(jobsDir(), { recursive: true });
    } catch (error) {
      this.debug(`jobs dir failed: ${String(error)}`);
    }
  }

  /**
   * Load the persisted index and reconcile liveness. A pid still alive but
   * recorded as running with no manager watching it (a restart) is marked
   * `orphan`; a dead one flips to its last-known exit.
   */
  load() {
    this.ensureDir();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
    } catch {
      return;
    }
    const list = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    for (const raw of list) {
      if (raw === null || typeof raw !== 'object' || typeof raw.id !== 'string') continue;
      const record = { ...raw };
      if (record.status === 'running' || record.status === 'stopping') {
        if (pidAlive(record.pid)) {
          // Alive but this manager did not start it in this process: it is an
          // orphan we still own the bookkeeping for, and can kill.
          record.status = 'orphan';
        } else {
          record.status = 'exited';
          record.exitCode = record.exitCode ?? null;
          record.endedAt = record.endedAt ?? Date.now();
        }
      }
      this.jobs.set(record.id, record);
    }
    this.syncLogSizes();
    this.prune();
  }

  /** Refresh each job's logged byte count from disk (best effort). */
  syncLogSizes() {
    for (const record of this.jobs.values()) {
      try {
        record.bytes = fs.statSync(record.logPath).size;
      } catch {
        record.bytes = record.bytes ?? 0;
      }
    }
  }

  /** Persist the index atomically (write temp, then rename). */
  save() {
    this.ensureDir();
    const file = indexFile();
    const tmp = `${file}.tmp`;
    const payload = { version: 1, jobs: [...this.jobs.values()] };
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (error) {
      this.debug(`save failed: ${String(error)}`);
    }
  }

  /** Drop the oldest settled jobs past `maxJobs`; running jobs are never pruned. */
  prune() {
    const settled = [...this.jobs.values()]
      .filter((job) => job.status !== 'running' && job.status !== 'stopping')
      .sort((a, b) => (a.endedAt ?? a.startedAt ?? 0) - (b.endedAt ?? b.startedAt ?? 0));
    while (this.jobs.size > this.maxJobs && settled.length > 0) {
      const victim = settled.shift();
      try {
        fs.unlinkSync(victim.logPath);
      } catch {
        // already gone
      }
      this.jobs.delete(victim.id);
    }
  }

  /**
   * Run auto-cleanup: keep only the newest `autoCleanupKeep` STOPPED jobs and
   * delete the rest (log files included). Never touches a live job. No-op when
   * auto-cleanup is off.
   * @returns {number} how many jobs were deleted.
   */
  applyAutoCleanup() {
    if (!this.autoCleanup) return 0;
    const stopped = [...this.jobs.values()]
      .filter((job) => job.status !== 'running' && job.status !== 'stopping' && job.status !== 'orphan')
      .sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0));
    let removed = 0;
    for (const victim of stopped.slice(this.autoCleanupKeep)) {
      try {
        fs.unlinkSync(victim.logPath);
      } catch {
        // already gone
      }
      this.jobs.delete(victim.id);
      removed += 1;
    }
    if (removed > 0) this.save();
    return removed;
  }

  /**
   * Delete every STOPPED job owned by an optional session (or every session
   * when omitted), log files included. Live jobs are left alone.
   * @param {string} [sessionId] - restrict to one owner; omit for all.
   * @returns {number} how many jobs were deleted.
   */
  removeStopped(sessionId) {
    let removed = 0;
    for (const [id, job] of [...this.jobs.entries()]) {
      if (job.status === 'running' || job.status === 'stopping' || job.status === 'orphan') continue;
      if (sessionId !== undefined && job.sessionId !== sessionId) continue;
      try {
        fs.unlinkSync(job.logPath);
      } catch {
        // already gone
      }
      this.jobs.delete(id);
      removed += 1;
    }
    if (removed > 0) this.save();
    return removed;
  }

  /**
   * Update the auto-cleanup settings at runtime (from a settings POST) and run
   * one pass immediately so the change is visible without waiting for a sweep.
   * @param {{enabled?: boolean, keep?: number}} next - partial settings.
   * @returns {{enabled: boolean, keep: number, removed: number}} the applied state.
   */
  setAutoCleanup(next) {
    if (next && typeof next.enabled === 'boolean') this.autoCleanup = next.enabled;
    if (next && Number.isFinite(next.keep)) this.autoCleanupKeep = Math.max(0, Math.floor(next.keep));
    const removed = this.applyAutoCleanup();
    return { enabled: this.autoCleanup, keep: this.autoCleanupKeep, removed };
  }

  /**
   * Start one detached job.
   * @param {object} input - the start request.
   * @param {string[]} input.argv - program and arguments (never shell-interpreted).
   * @param {string} input.command - the original command text, for display.
   * @param {string} input.cwd - working directory.
   * @param {string} [input.label] - one-line model-facing label.
   * @param {string} [input.shellLabel] - which shell ran it.
   * @param {string} [input.sessionId] - the owning conversation id.
   * @param {string} [input.sessionCwd] - the owning conversation's cwd.
   * @returns {object} the public job snapshot.
   */
  start(input) {
    this.ensureDir();
    const id = mintId();
    const logPath = path.join(jobsDir(), `${id}.log`);
    // Decide how the child's stdout/stderr reach the log file.
    //
    // Only the bundled Niubash reliably writes to an inherited file handle when
    // spawned detached and windowless. Git Bash (Scoop) loses its coreutils
    // PATH, and WSL/PowerShell simply do not write to a redirected inherited
    // handle without a console — their output never lands in the log. So for
    // those shells we let the SHELL open the log itself via `> log 2>&1`
    // (self-redirection), and hand it a throwaway stdout. `selfRedirect` is set
    // by the caller from the resolved shell dialect.
    const selfRedirect = input.selfRedirect === true;
    let spawnArgv = input.argv;
    let spawnEnv = { ...process.env };
    // Extra PATH dirs (e.g. Git Bash's usr/bin + mingw64/bin) so a detached
    // Git Bash still finds its own coreutils (`sleep`, `ls`, `date`, …).
    if (Array.isArray(input.extraPath) && input.extraPath.length > 0) {
      const current = spawnEnv.PATH ?? spawnEnv.Path ?? '';
      spawnEnv.PATH = `${input.extraPath.join(path.delimiter)}${current ? path.delimiter + current : ''}`;
      spawnEnv.Path = spawnEnv.PATH;
    }

    // PowerShell does not run its `-Command` when spawned `detached` and
    // windowless from Node on Windows (it exits 0 without producing output, and
    // the App-Execution-Alias `pwsh.exe` is even worse). The reliable detach is
    // `cmd /c start "" /b <launcher>`: `start` creates an independent process
    // that keeps a console context. We drop the raw PowerShell source into a
    // .ps1 and a .cmd launcher that runs it with `> log 2>&1`, then launch via
    // `start /b` and detach THAT.
    const isPowerShellDialect = input.shellDialect === 'powershell' || input.dialect === 'powershell';
    // Detect a WSL launch from the argv itself (self-sufficient, independent of
    // what the resolver passed): argv[0] is wsl.exe / System32\bash.exe. Pull
    // the distro from a `-d <name>` pair if present.
    const wslLauncherArg = String(input.argv?.[0] ?? '');
    const normLower = wslLauncherArg.replace(/\//g, '\\').toLowerCase();
    // Only the WSL launchers count: System32\wsl.exe or System32\bash.exe. A
    // normal Git Bash/ MSYS `...\usr\bin\bash.exe` must NOT be treated as WSL.
    const looksWsl = /\\windows\\system32\\(?:wsl|bash)\.exe$/.test(normLower)
      || input.shellDialect === 'wsl' || input.dialect === 'wsl';
    let wslDistroArg = input.wslDistro;
    if (wslDistroArg === undefined) {
      const di = input.argv.indexOf('-d');
      if (di !== -1 && di + 1 < input.argv.length) wslDistroArg = input.argv[di + 1];
    }
    const isWslDialect = looksWsl && typeof wslLauncherArg === 'string';
    let child;
    let psLaunch;
    const out = isPowerShellDialect || isWslDialect || selfRedirect ? undefined : fs.openSync(logPath, 'a');
    try {
      if (isPowerShellDialect) {
        const { psExe, psFlags } = splitPowerShellArgv(input.argv);
        psLaunch = launchPowerShellDetached({ exe: psExe, flags: psFlags, command: input.command, logPath, cwd: input.cwd, env: spawnEnv });
        child = psLaunch.launcher;
      } else if (isWslDialect) {
        // File-based WSL: wsl.exe mangles `$`/metacharacters in a `-lc` arg, so
        // run a written .sh instead; it redirects its own output to the log.
        const scriptPath = path.join(path.dirname(logPath), `${id}.sh`);
        const wslArgv = wslFileArgv({ launcher: wslLauncherArg, distro: wslDistroArg, command: input.command, cwd: input.cwd, logPath, scriptPath });
        child = spawn(wslArgv[0], wslArgv.slice(1), {
          cwd: input.cwd,
          env: spawnEnv,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } else {
        if (selfRedirect) {
          // Replace the final (command) argument with one that redirects its own
          // output to the log file. argv shapes: bash `[exe,-c,cmd]` — the
          // command source is the last element.
          spawnArgv = buildSelfRedirectArgv(input.argv, logPath, input.shellDialect);
        }
        // windowsHide keeps a console from flashing; detached puts the child in
        // its own process group so closing the parent (or the harness) leaves it
        // running; stdio[1]/[2] share the log fd so stdout and stderr interleave
        // in one stream, exactly what a terminal user expects.
        child = spawn(spawnArgv[0], spawnArgv.slice(1), {
          cwd: input.cwd,
          env: spawnEnv,
          detached: true,
          windowsHide: true,
          stdio: selfRedirect ? ['ignore', 'ignore', 'ignore'] : ['ignore', out, out],
        });
      }
    } finally {
      // The child holds its own duplicate of the fd; the parent's copy must be
      // closed or the log stays locked on Windows.
      if (out !== undefined) {
        try {
          fs.closeSync(out);
        } catch {
          // ignore
        }
      }
    }
    const record = {
      id,
      kind: 'bg',
      label: String(input.label ?? input.command ?? '').slice(0, 200) || id,
      command: input.command,
      shellLabel: input.shellLabel ?? '',
      cwd: input.cwd,
      sessionId: input.sessionId ?? '',
      sessionCwd: input.sessionCwd ?? input.cwd,
      argv: input.argv,
      pid: child.pid,
      logPath,
      startedAt: Date.now(),
      endedAt: undefined,
      exitCode: undefined,
      signal: undefined,
      status: child.pid === undefined ? 'failed' : 'running',
      bytes: 0,
      error: undefined,
      pidPending: isPowerShellDialect === true,
    };
    this.jobs.set(id, record);
    this.save();
    // PowerShell: the launcher cmd's PID dies immediately; the real pwsh is a
    // grandchild. Poll the pid file it writes and adopt that PID so the
    // liveness sweep and kill target the right process.
    if (isPowerShellDialect && psLaunch) {
      const adopt = (attempt) => {
        let real;
        try { real = Number.parseInt(fs.readFileSync(psLaunch.pidFile, 'utf8').trim(), 10); } catch { real = NaN; }
        if (Number.isInteger(real) && real > 0) {
          const job = this.jobs.get(id);
          if (job !== undefined && job.pid !== real) {
            job.pid = real;
            job.pidPending = false;
            this.save();
          } else if (job !== undefined) {
            job.pidPending = false;
          }
          return;
        }
        if (attempt < 40 /* ~10s */) setTimeout(() => adopt(attempt + 1), 250).unref?.();
        // If the log already has bytes, the job ran even if we couldn't read a PID.
      };
      setTimeout(() => adopt(0), 200).unref?.();
    }
    child.on('error', (error) => {
      const job = this.jobs.get(id);
      if (job === undefined) return;
      job.status = 'failed';
      job.error = String(error?.message ?? error);
      job.endedAt = Date.now();
      this.save();
    });
    // For PowerShell the launcher cmd exits almost immediately with 0 — that is
    // NOT the job ending (the real pwsh keeps running). So we never mark a
    // PowerShell job `exited` from the launcher's exit; the liveness sweep
    // (which checks the adopted pid) owns its terminal state.
    if (!isPowerShellDialect) {
      child.on('exit', (code, signal) => {
        const job = this.jobs.get(id);
        if (job === undefined) return;
        // Preserve a kill: whether the status is still `stopping` or was already
        // flipped to `killed` synchronously by kill(), the terminal reason is the
        // same. Only a job that ran to completion becomes `exited`.
        if (job.status === 'stopping' || job.status === 'killed') {
          job.status = 'killed';
        } else {
          job.status = 'exited';
        }
        job.exitCode = code;
        job.signal = signal;
        job.endedAt = job.endedAt ?? Date.now();
        this.save();
      });
    }
    // The child is unreferenced so the harness can exit without waiting for it.
    child.unref();
    this.ensureSweep();
    return this.public(record);
  }

  /** Lazily start the liveness sweep, which also refreshes log sizes. */
  ensureSweep() {
    if (this.sweep !== undefined) return;
    this.sweep = setInterval(() => {
      let changed = false;
      let running = 0;
      for (const job of this.jobs.values()) {
        if (job.status === 'running') {
          running += 1;
          try {
            job.bytes = fs.statSync(job.logPath).size;
          } catch {
            // ignore
          }
          // A PowerShell job's starting `pid` is the launcher cmd (dead at once)
          // until the real pwsh pid is adopted from the pid file. Don't reap it
          // during that brief window; give adoption ~15s.
          if (job.pidPending === true && Date.now() - job.startedAt < 15000) {
            continue;
          }
          if (job.pidPending === true) {
            // Adoption never succeeded; fall back to "did it produce output?"
            job.pidPending = false;
            if (job.bytes > 0) { continue; }
          }
          if (!pidAlive(job.pid)) {
            job.status = 'exited';
            job.endedAt = job.endedAt ?? Date.now();
            changed = true;
          }
        } else if (job.status === 'orphan' && !pidAlive(job.pid)) {
          job.status = 'exited';
          job.endedAt = job.endedAt ?? Date.now();
          changed = true;
        }
      }
      if (changed) this.save();
      // Reap stopped jobs per the auto-cleanup policy while we are already here.
      this.applyAutoCleanup();
      if (running === 0 && ![...this.jobs.values()].some((job) => job.status === 'orphan')) {
        // Nothing to watch; let the interval idle out. It restarts on the next
        // `start`/`kill`.
        clearInterval(this.sweep);
        this.sweep = undefined;
      }
    }, SWEEP_MS);
    this.sweep.unref?.();
  }

  /** The public view of one record (no argv/env, no fs paths beyond the log). */
  public(record) {
    // A job whose process is still alive IS "running" from the user's point of
    // view. The internal `orphan` marker only means "this manager did not spawn
    // it in this process" (it survived a restart); it is not a distinct
    // user-facing state, so surface it as `running` and keep the distinction in
    // `adopted` for anything that cares.
    const adopted = record.status === 'orphan';
    const status = adopted ? 'running' : record.status;
    const durationMs = record.endedAt === undefined
      ? Math.max(0, Date.now() - (record.startedAt ?? Date.now()))
      : Math.max(0, record.endedAt - (record.startedAt ?? record.endedAt));
    return {
      id: record.id,
      kind: record.kind,
      label: record.label,
      command: record.command,
      shellLabel: record.shellLabel,
      cwd: record.cwd,
      sessionId: record.sessionId,
      sessionCwd: record.sessionCwd,
      pid: record.pid,
      status,
      adopted,
      durationMs,
      // A one-shot command that already succeeded: hidden by default in the
      // panel (a quick FAILURE stays visible — that is a real signal).
      quickSuccess: status === 'exited' && (record.exitCode ?? 0) === 0 && durationMs <= QUICK_SUCCESS_MS,
      exitCode: record.exitCode ?? null,
      signal: record.signal ?? null,
      startedAt: record.startedAt,
      endedAt: record.endedAt ?? null,
      bytes: record.bytes ?? 0,
      logPath: record.logPath,
      error: record.error ?? null,
    };
  }

  /** One job's public snapshot, or undefined. */
  get(id) {
    const record = this.jobs.get(id);
    return record === undefined ? undefined : this.public(record);
  }

  /**
   * Every job, newest first, optionally filtered by owner session.
   * @param {string} [sessionId] - only this owner's jobs.
   * @returns {object[]} public snapshots.
   */
  list(sessionId) {
    const all = [...this.jobs.values()]
      .filter((job) => sessionId === undefined || job.sessionId === sessionId)
      .map((job) => this.public(job));
    all.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return all;
  }

  /**
   * The grouped view the panel renders: `[本会话]` first, then the other
   * conversations, then a bucket for orphans (no owner).
   * @param {string} activeSessionId - the conversation currently open.
   * @returns {{active: object[], groups: Array<{sessionId: string, cwd: string, jobs: object[]}>, total: number}} grouped jobs.
   */
  grouped(activeSessionId) {
    const bySession = new Map();
    for (const job of this.list()) {
      const key = job.sessionId || '';
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key).push(job);
    }
    const active = bySession.get(activeSessionId) ?? [];
    bySession.delete(activeSessionId);
    const groups = [...bySession.entries()]
      .filter(([, jobs]) => jobs.length > 0)
      .map(([sessionId, jobs]) => ({
        sessionId,
        cwd: jobs[0]?.sessionCwd ?? jobs[0]?.cwd ?? '',
        jobs,
      }))
      .sort((a, b) => (b.jobs[0]?.startedAt ?? 0) - (a.jobs[0]?.startedAt ?? 0));
    return { active, groups, total: this.jobs.size };
  }

  /**
   * Read a job's log from an offset.
   * @param {string} id - the job id.
   * @param {number} offset - byte offset to start from.
   * @param {number} [limit] - max bytes this read.
   * @returns {{ok: boolean, error?: string, status?: string, text?: string, offset?: number, size?: number, eof?: boolean}} read result.
   */
  read(id, offset, limit) {
    const record = this.jobs.get(id);
    if (record === undefined) return { ok: false, error: `no such job: ${id}` };
    const read = readLogAt(record.logPath, offset, limit);
    const running = record.status === 'running' || record.status === 'stopping' || record.status === 'orphan';
    return {
      ok: true,
      status: record.status,
      ...read,
      // "eof" means no more output is expected: the read caught the file end
      // AND the process is no longer producing.
      eof: read.eof && !running,
    };
  }

  /**
   * Kill a job. Windows needs `taskkill /T /F` to reach the whole tree a
   * detached shell spawned; POSIX signals the process group.
   * @param {string} id - the job id.
   * @param {string} [reason] - recorded reason.
   * @returns {{ok: boolean, error?: string, job?: object, alreadyFinished?: boolean}} kill result.
   */
  kill(id, reason) {
    const record = this.jobs.get(id);
    if (record === undefined) return { ok: false, error: `no such job: ${id}` };
    if (!['running', 'stopping', 'orphan'].includes(record.status)) {
      return { ok: true, alreadyFinished: true, job: this.public(record) };
    }
    record.status = 'stopping';
    record.killReason = reason ?? '';
    this.save();
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(record.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        try {
          process.kill(-record.pid, 'SIGTERM');
        } catch {
          process.kill(record.pid, 'SIGTERM');
        }
      }
    } catch (error) {
      // A process that already exited makes taskkill fail; treat that as done.
      this.debug(`kill ${id} failed: ${String(error)}`);
    }
    // The exit handler flips the status; if it already fired, reflect it now.
    const after = this.jobs.get(id);
    if (after !== undefined && after.status === 'stopping' && !pidAlive(after.pid)) {
      after.status = 'killed';
      after.endedAt = after.endedAt ?? Date.now();
      this.save();
    }
    return { ok: true, job: this.public(this.jobs.get(id)) };
  }

  /** Remove a settled job entirely (log file too). */
  remove(id) {
    const record = this.jobs.get(id);
    if (record === undefined) return { ok: false, error: `no such job: ${id}` };
    if (record.status === 'running' || record.status === 'stopping' || record.status === 'orphan') {
      return { ok: false, error: 'job is still live; kill it first' };
    }
    try {
      fs.unlinkSync(record.logPath);
    } catch {
      // ignore
    }
    this.jobs.delete(id);
    this.save();
    return { ok: true };
  }

  /** Stop the sweep timer (plugin teardown). Jobs themselves keep running. */
  dispose() {
    if (this.sweep !== undefined) {
      clearInterval(this.sweep);
      this.sweep = undefined;
    }
  }
}

/** Module default caps, exported for the row config. */
export { DEFAULT_MAX_LOG_BYTES, DEFAULT_MAX_JOBS, DEFAULT_AUTO_CLEANUP_KEEP };
