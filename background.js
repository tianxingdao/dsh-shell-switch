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
const DEFAULT_AUTO_CLEANUP_KEEP = 20;
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
    // Auto-cleanup of STOPPED jobs: when on, keep only the newest
    // `autoCleanupKeep` settled jobs and delete the rest (log file included).
    this.autoCleanup = options.autoCleanup === true;
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
    const out = fs.openSync(logPath, 'a');
    let child;
    try {
      // windowsHide keeps a console from flashing; detached puts the child in
      // its own process group so closing the parent (or the harness) leaves it
      // running; stdio[1]/[2] share the log fd so stdout and stderr interleave
      // in one stream, exactly what a terminal user expects.
      child = spawn(input.argv[0], input.argv.slice(1), {
        cwd: input.cwd,
        env: { ...process.env },
        detached: true,
        windowsHide: true,
        stdio: ['ignore', out, out],
      });
    } finally {
      // The child holds its own duplicate of the fd; the parent's copy must be
      // closed or the log stays locked on Windows.
      try {
        fs.closeSync(out);
      } catch {
        // ignore
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
    };
    child.on('error', (error) => {
      const job = this.jobs.get(id);
      if (job === undefined) return;
      job.status = 'failed';
      job.error = String(error?.message ?? error);
      job.endedAt = Date.now();
      this.save();
    });
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
    // The child is unreferenced so the harness can exit without waiting for it.
    child.unref();
    this.jobs.set(id, record);
    this.save();
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
      status: record.status,
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
