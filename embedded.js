/**
 * Embedded Niubash: an optional, self-contained bash the plugin can ship so a
 * machine with no bash (Windows) gets one out of the box.
 *
 * Niubash (https://github.com/unixwin/niubash, MIT) is a native Rust rewrite of
 * GNU Bash 5.3. On Windows a release is `niu.exe` plus a `winuxcmd/` command
 * tree; on Linux/macOS it is a single portable `niu` binary that uses the
 * system's own tools. We fetch the official release archive for the current
 * platform, extract it once under the DSH home, and expose the `niu` entry as a
 * shell the picker can choose — argv is `[niu, '--ec', base64(cmd)]`, the
 * official encoded-command handoff that avoids multi-layer quoting.
 *
 * Windows: worth shipping (no system bash otherwise).
 * Linux/macOS: a system bash already exists, so this is opt-in only.
 *
 * @module dsh-shell-switch/embedded
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Release tag this build pins as the cold-start fallback. It is NO LONGER the
 * only version the plugin can install: the active version is whatever the
 * `current` pointer / installed version dirs say, and it can be upgraded to any
 * newer upstream tag at runtime via `checkUpdate`/`updateEmbedded`. This
 * constant only seeds the very first download when the network needs a
 * pre-known asset name, and is the version shown if nothing is installed yet.
 */
export const EMBEDDED_VERSION = '1.5.1';

/** Default download host (the project's GitHub releases). */
export const DEFAULT_BASE_URL = 'https://github.com/unixwin/niubash/releases/download';

/** GitHub API for the latest release (used by the update check). */
export const DEFAULT_RELEASES_API = 'https://api.github.com/repos/unixwin/niubash/releases';

/**
 * The release asset name for the current platform/arch, or undefined when this
 * platform has no embedded build mapped.
 * @param {string} [platform] - process.platform.
 * @param {string} [arch] - process.arch.
 * @returns {{ asset: string, archive: 'tgz' | 'zip', exeRel: string } | undefined} the asset descriptor.
 */
export function assetFor(platform = process.platform, arch = process.arch, tag = EMBEDDED_VERSION) {
  const v = String(tag).replace(/^v/i, '');
  // exeRel: path of the niu launcher inside the extracted archive root.
  if (platform === 'win32') {
    if (arch === 'x64') return { asset: `niubash-v${v}-win-x64.tar.gz`, archive: 'tgz', exeRel: 'niu.exe' };
    if (arch === 'arm64') return { asset: `niubash-v${v}-win-arm64.tar.gz`, archive: 'tgz', exeRel: 'niu.exe' };
    return undefined;
  }
  if (platform === 'linux') {
    if (arch === 'x64') return { asset: `niubash-v${v}-linux-x86_64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
    if (arch === 'arm64') return { asset: `niubash-v${v}-linux-aarch64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
    return undefined;
  }
  if (platform === 'darwin') {
    // macOS builds are portable single `niu` binaries; use them if present.
    if (arch === 'arm64') return { asset: `niubash-v${v}-macos-aarch64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
    if (arch === 'x64') return { asset: `niubash-v${v}-macos-x86_64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
    return undefined;
  }
  return undefined;
}

/** The embedded install root under the DSH home. */
export function embeddedRoot() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'embedded-niubash');
}

/** Where the extracted version lives (one dir per pinned version). */
function versionDir(tag = EMBEDDED_VERSION) {
  return path.join(embeddedRoot(), `v${String(tag).replace(/^v/i, '')}`);
}

/** Path of the `current` pointer file that names the active version tag. */
function currentPointer() {
  return path.join(embeddedRoot(), 'current');
}

/** Read the active version tag from the `current` pointer, or undefined. */
function readCurrentTag() {
  try {
    const tag = fs.readFileSync(currentPointer(), 'utf8').trim();
    return tag.length > 0 ? tag.replace(/^v/i, '') : undefined;
  } catch {
    return undefined;
  }
}

/** Write the active version tag to the `current` pointer. */
function writeCurrentTag(tag) {
  ensureDir(embeddedRoot());
  fs.writeFileSync(currentPointer(), String(tag).replace(/^v/i, ''), 'utf8');
}

/**
 * List the versions actually extracted under the install root (each `vX.Y.Z`
 * dir that holds a launcher), newest first. Used by the update/rollback UI and
 * by the resolver to pick a fallback when the pointer is missing.
 * @returns {string[]} installed version tags without the leading `v`.
 */
export function installedVersions() {
  const root = embeddedRoot();
  let names;
  try {
    names = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const tags = [];
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const match = /^v(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/i.exec(entry.name);
    if (match === null) continue;
    const dir = path.join(root, entry.name);
    if (findLauncherDir(dir, assetFor(process.platform, process.arch, match[1])?.exeRel ?? 'niu.exe') !== undefined) {
      tags.push(match[1]);
    }
  }
  return tags.sort(compareVersions).reverse();
}

/**
 * Compare two dotted version strings (`major.minor.patch[-pre]`). Numeric, so
 * `1.10.0 > 1.9.0`. A missing segment counts as 0. A prerelease (`-x`) sorts
 * BELOW the same release. Returns <0, 0, or >0.
 * @param {string} a - left version.
 * @param {string} b - right version.
 * @returns {number} comparison result.
 */
export function compareVersions(a, b) {
  const parse = (raw) => {
    const [core, pre = ''] = String(raw).replace(/^v/i, '').split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums, pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa.nums[i] ?? 0;
    const db = pb.nums[i] ?? 0;
    if (da !== db) return da - db;
  }
  // Equal cores: a release (no pre) is greater than a prerelease.
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1;
  if (pb.pre === '') return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** The `niu` launcher path under the version dir, or undefined for this platform. */
export function embeddedExePath() {
  return resolveEmbeddedExe();
}

/**
 * Is the embedded bash already installed and runnable for this platform?
 * @returns {boolean} true when the launcher file exists.
 */
export function embeddedInstalled() {
  const exe = embeddedExePath();
  return exe !== undefined && fs.existsSync(exe);
}

/**
 * Find the extracted archive root: the version dir may contain a single
 * top-level folder (e.g. `niubash-v1.5.1-win-x64/`) instead of the files
 * directly. Return the folder that actually holds the launcher.
 * @param {string} dir - the version dir to inspect.
 * @param {string} exeRel - launcher name.
 * @returns {string | undefined} the dir holding the launcher.
 */
function findLauncherDir(dir, exeRel) {
  const direct = path.join(dir, exeRel);
  if (fs.existsSync(direct)) return dir;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name, exeRel);
    if (fs.existsSync(candidate)) return path.join(dir, entry.name);
  }
  return undefined;
}

/** Ensure a directory exists. */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Default number of download attempts before giving up. GitHub release assets
 * are frequently reset mid-transfer on restricted networks (ECONNRESET); a
 * handful of retries with resume makes the install reliable there.
 */
const DOWNLOAD_ATTEMPTS = 5;
/** Per-attempt inactivity timeout: a stalled stream fails fast and retries. */
const DOWNLOAD_STALL_MS = 30000;

/**
 * One streaming fetch attempt, appending to `dest` from `startByte`. Streams
 * the body to disk (never buffers the whole asset in memory) and aborts a
 * stalled read so the caller can retry. Honors HTTP 206 for resume.
 * @param {string} url - source.
 * @param {string} dest - destination file (opened in append mode).
 * @param {number} startByte - resume offset.
 * @param {AbortSignal} [signal] - external cancellation.
 * @returns {Promise<{ done: boolean, received: number, total: number | null }>} attempt outcome.
 */
async function downloadOnce(url, dest, startByte, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let stalled = false;
  let stallTimer;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { stalled = true; controller.abort(); }, DOWNLOAD_STALL_MS);
  };
  try {
    const headers = startByte > 0 ? { Range: `bytes=${startByte}-` } : {};
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status} for ${url}`);
    const totalHeader = response.headers.get('content-length');
    const total = totalHeader === null ? null : Number(totalHeader) + (response.status === 206 ? startByte : 0);
    const reader = response.body.getReader();
    const out = fs.openSync(dest, startByte > 0 ? 'a' : 'w');
    let received = startByte;
    try {
      armStall();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (stalled) throw new Error('download stalled');
        fs.writeSync(out, value);
        received += value.byteLength;
        armStall();
      }
    } finally {
      clearTimeout(stallTimer);
      fs.closeSync(out);
    }
    if (stalled) throw new Error('download stalled');
    return { done: true, received, total };
  } finally {
    clearTimeout(stallTimer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Download one URL to a file with resume-on-reset retries. Uses the global
 * fetch so no extra dependency is needed. Each attempt streams to disk and,
 * on a mid-transfer failure, resumes from the bytes already written via a
 * Range request, so a flaky link still completes instead of restarting.
 * @param {string} url - the source.
 * @param {string} dest - the destination file.
 * @param {AbortSignal} [signal] - cancellation.
 * @param {(line: string) => void} [debug] - progress logger.
 * @returns {Promise<void>} resolves when the file is written.
 */
async function download(url, dest, signal, debug = () => {}) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error('aborted');
    let startByte = 0;
    try { startByte = fs.existsSync(dest) ? fs.statSync(dest).size : 0; } catch { startByte = 0; }
    try {
      const result = await downloadOnce(url, dest, startByte, signal);
      const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      if (result.total !== null && size < result.total) {
        throw new Error(`incomplete: ${size}/${result.total} bytes`);
      }
      return;
    } catch (error) {
      lastError = error;
      const msg = String(error?.message ?? error);
      debug(`embedded: download attempt ${attempt}/${DOWNLOAD_ATTEMPTS} failed (${msg}); retrying with resume`);
      // Backoff before the next attempt (200ms, 400ms, ... capped at 2s).
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 200 * 2 ** (attempt - 1))));
    }
  }
  throw new Error(`download failed after ${DOWNLOAD_ATTEMPTS} attempts: ${String(lastError?.message ?? lastError)}`);
}

/**
 * Extract a .tar.gz using the system `tar` (bsdtar on Windows 10+, tar on
 * Linux/macOS): no dependency, and bsdtar restores hardlinks the way the
 * official archive expects.
 * @param {string} archive - the .tar.gz path.
 * @param {string} destDir - where to extract.
 */
function extractTarGz(archive, destDir) {
  execFileSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'pipe' });
}

/**
 * Install the embedded bash for the current platform if it is not present yet.
 * Downloads the pinned release asset and extracts it under the DSH home. Safe
 * to call repeatedly: an already-installed launcher short-circuits.
 * @param {object} [options] - install options.
 * @param {string} [options.baseUrl] - release host (override for a mirror).
 * @param {(line: string) => void} [options.debug] - progress logger.
 * @param {AbortSignal} [options.signal] - cancellation.
 * @returns {Promise<{ ok: boolean, path?: string, error?: string, skipped?: boolean }>} the result.
 */
export async function installEmbedded(options = {}) {
  const tag = String(options.tag ?? EMBEDDED_VERSION).replace(/^v/i, '');
  const desc = assetFor(process.platform, process.arch, tag);
  if (desc === undefined) {
    return { ok: false, skipped: true, error: `no embedded niubash build for ${process.platform}/${process.arch}` };
  }
  if (options.tag === undefined && embeddedInstalled()) {
    return { ok: true, path: embeddedExePath() };
  }
  const debug = options.debug ?? (() => {});
  const root = embeddedRoot();
  const vdir = versionDir(tag);
  ensureDir(vdir);
  const archivePath = path.join(root, desc.asset);
  const baseUrl = String(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    debug(`embedded: downloading ${desc.asset}`);
    await download(`${baseUrl}/v${tag}/${desc.asset}`, archivePath, options.signal, debug);
    debug('embedded: extracting');
    extractTarGz(archivePath, vdir);
    const launcherDir = findLauncherDir(vdir, desc.exeRel);
    if (launcherDir === undefined) {
      throw new Error('archive did not contain the niu launcher');
    }
    // Normalize: if the launcher sits in a nested folder, hoist the entry to
    // the version dir so embeddedExePath() resolves. Simplest: record a marker
    // and let embeddedExePath search. Here we resolve by returning the found
    // path and writing it to a small pointer file.
    const exePath = path.join(launcherDir, desc.exeRel);
    if (!process.platform.startsWith('win')) {
      try { fs.chmodSync(exePath, 0o755); } catch { /* ignore */ }
    }
    if (path.dirname(exePath) !== vdir) {
      fs.writeFileSync(path.join(vdir, '.launcher-dir'), launcherDir, 'utf8');
    }
    try { fs.unlinkSync(archivePath); } catch { /* ignore */ }
    writeCurrentTag(tag);
    debug('embedded: installed at ' + exePath);
    return { ok: true, path: exePath, version: tag };
  } catch (error) {
    try { fs.unlinkSync(archivePath); } catch { /* ignore */ }
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * Remove the extracted embedded install (keeps nothing). Used by a settings
 * "uninstall" action.
 * @returns {{ ok: boolean }} the result.
 */
export function removeEmbedded() {
  try {
    fs.rmSync(embeddedRoot(), { recursive: true, force: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * The launcher path when installed, honoring the hoisted-folder marker. This is
 * the authoritative resolver used instead of embeddedExePath() so a nested
 * archive layout still works.
 * @returns {string | undefined} the runnable niu path.
 */
export function resolveEmbeddedExe() {
  const desc = assetFor();
  if (desc === undefined) return undefined;
  const exeRel = desc.exeRel;

  /** Resolve the launcher inside one version dir (direct / marker / nested). */
  const resolveIn = (tag) => {
    const vdir = versionDir(tag);
    const direct = path.join(vdir, exeRel);
    if (fs.existsSync(direct)) return direct;
    try {
      const marker = fs.readFileSync(path.join(vdir, '.launcher-dir'), 'utf8').trim();
      const p = path.join(marker, exeRel);
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
    const found = findLauncherDir(vdir, exeRel);
    return found === undefined ? undefined : path.join(found, exeRel);
  };

  // 1) The active version named by the `current` pointer wins.
  const current = readCurrentTag();
  if (current !== undefined) {
    const hit = resolveIn(current);
    if (hit !== undefined) return hit;
  }
  // 2) Fall back to the newest installed version (covers a missing/stale
  //    pointer and single-version installs written before the pointer existed).
  for (const tag of installedVersions()) {
    const hit = resolveIn(tag);
    if (hit !== undefined) return hit;
  }
  // 3) Last resort: the build's pinned version dir (legacy layout).
  return resolveIn(EMBEDDED_VERSION);
}

/**
 * The version tag actually active right now (from the pointer, else the newest
 * installed version, else the pinned default), or undefined if not installed.
 * @returns {string | undefined} active version tag without a leading `v`.
 */
export function activeVersion() {
  if (!embeddedInstalled()) return undefined;
  return readCurrentTag() ?? installedVersions()[0] ?? EMBEDDED_VERSION;
}

/**
 * Probe the runnable `niu` for its own reported version (best effort). Runs
 * `niu --version` and pulls the first `x.y.z` out; returns undefined on any
 * failure so callers can fall back to the directory tag. Tries the encoded
 * command handshake first (the safe path) then a plain `--version`.
 * @param {string} exe - the niu launcher path.
 * @returns {string | undefined} the version the binary reports.
 */
export function probeBinaryVersion(exe) {
  const extract = (text) => {
    const match = /(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/.exec(String(text ?? ''));
    return match === null ? undefined : match[1];
  };
  const attempts = [
    [exe, '--version'],
    [exe, '--ec', Buffer.from('echo NIU_VERSION_MARK""').toString('base64')],
  ];
  for (const argv of attempts) {
    try {
      const out = execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 8000, windowsHide: true });
      const v = extract(out);
      if (v !== undefined) return v;
    } catch { /* try next */ }
  }
  return undefined;
}

/**
 * Query GitHub Releases for the latest published tag. Read-only; never
 * downloads. Designed to fail soft: a network/rate-limit error resolves to an
 * `unknown` status instead of throwing, so a startup check never blocks.
 * @param {object} [options] - options.
 * @param {string} [options.apiBase] - override the releases API base URL.
 * @param {AbortSignal} [options.signal] - cancellation.
 * @param {number} [options.timeoutMs] - request timeout (default 6000).
 * @returns {Promise<{ status: 'update-available'|'up-to-date'|'unknown'|'unsupported', current?: string, latest?: string, error?: string }>} the check result.
 */
export async function checkUpdate(options = {}) {
  if (assetFor() === undefined) {
    return { status: 'unsupported', error: `no embedded niubash build for ${process.platform}/${process.arch}` };
  }
  const current = activeVersion();
  const apiBase = String(options.apiBase ?? DEFAULT_RELEASES_API).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs ?? 6000)));
  const onAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', onAbort);
  let latest;
  try {
    const response = await fetch(`${apiBase}/latest`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-shell-switch' },
    });
    if (!response.ok) {
      return { status: 'unknown', current, error: `GitHub API HTTP ${response.status}` };
    }
    const body = await response.json();
    const tag = typeof body?.tag_name === 'string' ? body.tag_name : '';
    latest = tag.replace(/^v/i, '');
    if (latest.length === 0) {
      return { status: 'unknown', current, error: 'no tag_name in GitHub response' };
    }
  } catch (error) {
    return { status: 'unknown', current, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.('abort', onAbort);
  }
  // Before first install there is no `current`; offer the latest as installable.
  if (current === undefined) {
    return { status: 'update-available', latest };
  }
  const cmp = compareVersions(latest, current);
  if (cmp > 0) return { status: 'update-available', current, latest };
  return { status: 'up-to-date', current, latest };
}

/**
 * Install a specific upstream tag into its own version dir, verify the binary
 * runs, then switch the `current` pointer to it. The previous active version is
 * kept for rollback (the newest previous one only — see `pruneOldVersions`).
 * Atomic in effect: the pointer only moves after the new binary is verified, so
 * a failed upgrade leaves the working version untouched.
 * @param {string} tag - target version tag (with or without leading `v`).
 * @param {object} [options] - options (baseUrl, debug, signal, keep).
 * @returns {Promise<{ ok: boolean, version?: string, previous?: string, error?: string }>} the result.
 */
export async function updateEmbedded(tag, options = {}) {
  const target = String(tag).replace(/^v/i, '');
  const desc = assetFor(process.platform, process.arch, target);
  if (desc === undefined) {
    return { ok: false, error: `no embedded niubash build for ${process.platform}/${process.arch}` };
  }
  const previous = activeVersion();
  // Guard against an accidental downgrade: a build with a LOWER hardcoded
  // EMBEDDED_VERSION (or any stale caller) must never replace a newer install
  // the user already upgraded to. Refuse unless the caller explicitly opts in.
  if (previous !== undefined && options.allowDowngrade !== true) {
    const cmp = compareVersions(target, previous);
    if (cmp < 0) {
      return { ok: false, error: `refused to downgrade ${previous} -> ${target} (pass allowDowngrade to force)`, downgrade: true, previous, target };
    }
    if (cmp === 0) {
      // Already on this version: nothing to do, keep the current install.
      return { ok: true, version: previous, previous, unchanged: true };
    }
  }
  const install = await installEmbedded({ ...options, tag: target });
  if (!install.ok) return { ok: false, error: install.error };
  // Verify the freshly extracted binary actually runs before trusting it.
  const exe = resolveInVersionDir(target, desc.exeRel);
  const probed = exe === undefined ? undefined : probeBinaryVersion(exe);
  if (probed === undefined && exe === undefined) {
    return { ok: false, error: 'new version extracted but the launcher is missing' };
  }
  writeCurrentTag(target);
  // Keep only the current + the immediate previous version for rollback.
  pruneOldVersions(target, previous, Number(options.keep ?? 1));
  return { ok: true, version: target, previous };
}

/**
 * Resolve the launcher path inside one version dir (no pointer/fallback logic).
 * @param {string} tag - version tag.
 * @param {string} exeRel - launcher name.
 * @returns {string | undefined} the launcher path.
 */
function resolveInVersionDir(tag, exeRel) {
  const vdir = versionDir(tag);
  const direct = path.join(vdir, exeRel);
  if (fs.existsSync(direct)) return direct;
  try {
    const marker = fs.readFileSync(path.join(vdir, '.launcher-dir'), 'utf8').trim();
    const p = path.join(marker, exeRel);
    if (fs.existsSync(p)) return p;
  } catch { /* ignore */ }
  const found = findLauncherDir(vdir, exeRel);
  return found === undefined ? undefined : path.join(found, exeRel);
}

/**
 * Delete old installed versions, keeping the active one and up to `keep`
 * previous versions (for rollback). Removes leftover download archives too.
 * @param {string} activeTag - the version to never delete.
 * @param {string} [previousTag] - the version to prefer keeping.
 * @param {number} [keep] - how many non-active versions to retain (default 1).
 */
function pruneOldVersions(activeTag, previousTag, keep = 1) {
  const active = String(activeTag).replace(/^v/i, '');
  const prev = previousTag === undefined ? undefined : String(previousTag).replace(/^v/i, '');
  const others = installedVersions().filter((v) => v !== active);
  // Prefer keeping `previousTag`, then newer leftovers, up to `keep`.
  const ordered = prev !== undefined && others.includes(prev)
    ? [prev, ...others.filter((v) => v !== prev)]
    : others;
  const keepSet = new Set(ordered.slice(0, Math.max(0, keep)));
  for (const v of others) {
    if (keepSet.has(v)) continue;
    try { fs.rmSync(versionDir(v), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  // Clean stray archives (*.tar.gz) left in the root.
  try {
    for (const entry of fs.readdirSync(embeddedRoot())) {
      if (/\.tar\.gz$/i.test(entry)) {
        try { fs.unlinkSync(path.join(embeddedRoot(), entry)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

/**
 * Roll back to a previously installed version by moving the `current` pointer.
 * @param {string} [tag] - target version; defaults to the newest installed
 *   version that is not the active one.
 * @returns {{ ok: boolean, version?: string, from?: string, error?: string }} the result.
 */
export function rollbackEmbedded(tag) {
  const active = activeVersion();
  const versions = installedVersions();
  if (versions.length === 0) return { ok: false, error: 'no installed versions to roll back to' };
  const target = tag === undefined
    ? versions.find((v) => v !== active)
    : String(tag).replace(/^v/i, '');
  if (target === undefined || !versions.includes(target)) {
    return { ok: false, error: `version ${target ?? '(none)'} is not installed` };
  }
  writeCurrentTag(target);
  return { ok: true, version: target, from: active };
}
