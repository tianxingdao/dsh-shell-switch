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

/** Release tag this build pins. Bump when re-vendoring. */
export const EMBEDDED_VERSION = '1.5.1';

/** Default download host (the project's GitHub releases). */
export const DEFAULT_BASE_URL = 'https://github.com/unixwin/niubash/releases/download';

/**
 * The release asset name for the current platform/arch, or undefined when this
 * platform has no embedded build mapped.
 * @param {string} [platform] - process.platform.
 * @param {string} [arch] - process.arch.
 * @returns {{ asset: string, archive: 'tgz' | 'zip', exeRel: string } | undefined} the asset descriptor.
 */
export function assetFor(platform = process.platform, arch = process.arch) {
  // exeRel: path of the niu launcher inside the extracted archive root.
  if (platform === 'win32') {
    if (arch === 'x64') return { asset: `niubash-v${EMBEDDED_VERSION}-win-x64.tar.gz`, archive: 'tgz', exeRel: 'niu.exe' };
    if (arch === 'arm64') return { asset: `niubash-v${EMBEDDED_VERSION}-win-arm64.tar.gz`, archive: 'tgz', exeRel: 'niu.exe' };
    return undefined;
  }
  if (platform === 'linux') {
    if (arch === 'x64') return { asset: `niubash-v${EMBEDDED_VERSION}-linux-x86_64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
    if (arch === 'arm64') return { asset: `niubash-v${EMBEDDED_VERSION}-linux-aarch64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
    return undefined;
  }
  if (platform === 'darwin') {
    // macOS builds are portable single `niu` binaries; use them if present.
    if (arch === 'arm64') return { asset: `niubash-v${EMBEDDED_VERSION}-macos-aarch64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
    if (arch === 'x64') return { asset: `niubash-v${EMBEDDED_VERSION}-macos-x86_64.tar.gz`, archive: 'tgz', exeRel: 'niu' };
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
function versionDir() {
  return path.join(embeddedRoot(), `v${EMBEDDED_VERSION}`);
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
 * Download one URL to a file (redirect-following). Uses the global fetch so no
 * extra dependency is needed.
 * @param {string} url - the source.
 * @param {string} dest - the destination file.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<void>} resolves when the file is written.
 */
async function download(url, dest, signal) {
  const response = await fetch(url, { signal, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuffer));
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
  const desc = assetFor();
  if (desc === undefined) {
    return { ok: false, skipped: true, error: `no embedded niubash build for ${process.platform}/${process.arch}` };
  }
  if (embeddedInstalled()) {
    return { ok: true, path: embeddedExePath() };
  }
  const debug = options.debug ?? (() => {});
  const root = embeddedRoot();
  const vdir = versionDir();
  ensureDir(vdir);
  const archivePath = path.join(root, desc.asset);
  const baseUrl = String(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    debug(`embedded: downloading ${desc.asset}`);
    await download(`${baseUrl}/v${EMBEDDED_VERSION}/${desc.asset}`, archivePath, options.signal);
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
    debug('embedded: installed at ' + exePath);
    return { ok: true, path: exePath };
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
  const vdir = versionDir();
  const direct = path.join(vdir, desc.exeRel);
  if (fs.existsSync(direct)) return direct;
  try {
    const marker = fs.readFileSync(path.join(vdir, '.launcher-dir'), 'utf8').trim();
    const p = path.join(marker, desc.exeRel);
    if (fs.existsSync(p)) return p;
  } catch { /* ignore */ }
  const found = findLauncherDir(vdir, desc.exeRel);
  return found === undefined ? undefined : path.join(found, desc.exeRel);
}
