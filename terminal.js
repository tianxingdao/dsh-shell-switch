/**
 * Optional integration with `@deepseek-ai/dsh-api-terminal-controller`.
 *
 * The controller owns the real PTY. This module only decorates two public
 * methods: `shells()` supplies the shell-switch discovery list to the terminal
 * dropdown, and `create()` defaults a new terminal to the shell-switch choice
 * when following is enabled. Explicit dropdown choices always win.
 */

/** Synthetic menu identity for one WSL distro (all distros share wsl.exe). */
export const WSL_TERMINAL_PREFIX = 'dsh-shell-switch:wsl:';

/** The stable path/id shown to the terminal menu for one discovered shell. */
export function terminalPathForShell(shell) {
  if (shell?.id === 'wsl' || shell?.source === 'wsl') {
    return `${WSL_TERMINAL_PREFIX}${encodeURIComponent(shell.distro ?? '')}`;
  }
  return shell?.path;
}

/** Arguments needed for an interactive terminal, unlike one-shot bash -c. */
function terminalArgs(shell) {
  if (shell.id === 'wsl' || shell.source === 'wsl') {
    return shell.distro ? ['-d', shell.distro, 'bash'] : ['bash'];
  }
  if (shell.kind === 'powershell' || shell.dialect === 'powershell') return ['-NoLogo'];
  if (shell.kind === 'cmd' || shell.kind === 'interactive' || shell.kind === 'nu') return [];
  return ['-i'];
}

/** Public TerminalShell shape consumed by the official client. */
function publicShell(shell, pathOverride) {
  return {
    path: pathOverride ?? terminalPathForShell(shell),
    name: shell.label || shell.path,
    args: terminalArgs(shell),
  };
}

/** Convert the discovery list, keeping WSL distros as distinct menu entries. */
export function terminalShellList(shells) {
  const result = [];
  const seen = new Set();
  for (const shell of shells ?? []) {
    if (!shell || typeof shell.path !== 'string' || shell.path.length === 0 || shell.installed === false) continue;
    const mapped = publicShell(shell);
    const key = process.platform === 'win32' ? mapped.path.toLowerCase() : mapped.path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(mapped);
  }
  return result;
}

/**
 * Decorate one live controller. Returns a restore function; no host files or
 * plugin Config are modified.
 *
 * @param {object} controller - TerminalController service instance.
 * @param {object} options - discovery/follow callbacks.
 * @param {() => Promise<Array>} options.discover - shell-switch discovery.
 * @param {() => Promise<object|undefined>} options.current - effective shell.
 * @param {() => boolean} options.following - whether new terminals follow.
 */
export function installTerminalIntegration(controller, { discover, current, following }) {
  const originalShells = controller.shells;
  const originalCreate = controller.create;
  const hadOwnShells = Object.hasOwn(controller, 'shells');
  const hadOwnCreate = Object.hasOwn(controller, 'create');
  const wslOverrides = new Map(); // agent.id -> raw WSL shell for one create
  const createQueues = new Map(); // serialize same-agent WSL launches

  async function shells(agent, signal) {
    try {
      const list = terminalShellList(await discover());
      const override = wslOverrides.get(agent?.id);
      // The controller's userLaunch finds by the real wsl.exe path. During a
      // synthetic WSL-distro create, put that distro's real-path entry first so
      // its `-d <distro> bash` arguments are the ones selected.
      if (override !== undefined) return [publicShell(override, override.path), ...list];
      return list;
    } catch (error) {
      // Preserve the stock terminal if optional discovery fails.
      return originalShells.call(this, agent, signal);
    }
  }

  async function createWithWslOverride(agent, request, selected, signal) {
    const previous = createQueues.get(agent.id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      wslOverrides.set(agent.id, selected);
      try {
        return await originalCreate.call(this, agent, { ...request, shellPath: selected.path }, signal);
      } finally {
        wslOverrides.delete(agent.id);
      }
    });
    const queued = run.catch(() => {});
    createQueues.set(agent.id, queued);
    try {
      return await run;
    } finally {
      if (createQueues.get(agent.id) === queued) createQueues.delete(agent.id);
    }
  }

  async function create(agent, request, signal) {
    let next = request;
    if (following() && next.shellPath === undefined) {
      const selected = await current();
      if (selected?.path) next = { ...next, shellPath: terminalPathForShell(selected) };
    }
    if (typeof next.shellPath === 'string' && next.shellPath.startsWith(WSL_TERMINAL_PREFIX)) {
      const discovered = await discover();
      const selected = discovered.find((shell) => terminalPathForShell(shell) === next.shellPath);
      if (selected === undefined) throw new Error('Selected WSL distribution is not available');
      return createWithWslOverride.call(this, agent, next, selected, signal);
    }
    // An explicit shellPath from the terminal dropdown is never rewritten.
    return originalCreate.call(this, agent, next, signal);
  }

  controller.shells = shells;
  controller.create = create;

  return () => {
    if (controller.shells === shells) {
      if (hadOwnShells) controller.shells = originalShells;
      else delete controller.shells;
    }
    if (controller.create === create) {
      if (hadOwnCreate) controller.create = originalCreate;
      else delete controller.create;
    }
    wslOverrides.clear();
    createQueues.clear();
  };
}
