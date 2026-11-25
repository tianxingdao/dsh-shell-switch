/**
 * Model-facing background-session tools for dsh-shell-switch.
 *
 * Four tools over a {@link BackgroundSessions} manager, mounted on each Agent's
 * private scope beside `bash`:
 *
 *  - `bg_start`  spawn a detached process under the selected shell → a job id;
 *  - `bg_output` stream a job's log incrementally (optionally wait for more);
 *  - `bg_list`   list jobs (this conversation or all);
 *  - `bg_kill`   terminate a job and its whole process tree.
 *
 * These deliberately do NOT depend on `@deepseek-ai/dsh-tool-jobs`. They are a
 * self-contained alternative: a job here is a real detached OS process whose
 * output lives in a log file, so it survives the tool call and the harness.
 *
 * @module dsh-shell-switch/background-tools
 */

/**
 * Build the four tools.
 * @param {object} deps - injected collaborators.
 * @param {import('./background.js').BackgroundSessions} deps.sessions - the job manager.
 * @param {(input: {cwd?: string, agent?: object}) => Promise<{argv: string[], cwd: string, shellLabel: string}>} deps.resolve - resolve the selected shell to an argv.
 * @param {(name: string) => object} deps.defineTool - the DSH `defineTool`.
 * @param {(violations: string[]) => Error} deps.ToolArgsError - the DSH args error constructor.
 * @returns {object[]} the four tool definitions.
 */
export function buildBackgroundTools(deps) {
  const { sessions, resolve, defineTool, ToolArgsError } = deps;
  const sessionCwd = typeof deps.sessionCwd === 'function' ? deps.sessionCwd : undefined;

  /** The owner session id of a call, when known. */
  const ownerOf = (exec) => (exec?.agent === undefined ? '' : String(exec.agent.id ?? ''));

  const bgStart = defineTool({
    name: 'bg_start',
    description:
      'Start a long-running command as a detached background process and return its job id immediately. '
      + 'The process keeps running after this tool call ends (and after the harness restarts) — use it for dev servers, watchers, and daemons. '
      + 'The command runs through the shell currently selected in Settings (bash-family, WSL, or PowerShell syntax accordingly). '
      + 'NOTE: the process is detached and is NOT confined by the session sandbox; it runs with your user privileges. '
      + 'Read its output with bg_output, stop it with bg_kill.',
    parameters: {
      command: { type: 'string', required: true, description: 'The command to run in the background, in the selected shell dialect.' },
      label: { type: 'string', description: 'Optional short label shown in the job list; defaults to the command.' },
      workdir: { type: 'string', description: 'Working directory. Defaults to the session workspace; a relative path resolves against it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          jobId: { type: 'string' },
          status: { type: 'string' },
          pid: { type: 'number' },
          cwd: { type: 'string' },
          shellLabel: { type: 'string' },
          logPath: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{
          type: 'text',
          text: value.ok
            ? `started background job ${value.jobId} (pid ${value.pid ?? '?'}, ${value.shellLabel ?? 'shell'}) in ${value.cwd}`
            : `bg_start failed: ${value.error ?? 'unknown error'}`,
        }];
      },
    },
    async execute(args, exec) {
      const command = typeof args?.command === 'string' ? args.command.trim() : '';
      if (command.length === 0) throw new ToolArgsError(['command must be a non-empty string']);
      const workdirArg = typeof args?.workdir === 'string' && args.workdir.length > 0 ? args.workdir : undefined;
      let resolved;
      try {
        // Resolve the working directory: an explicit `workdir` wins; otherwise
        // the session workspace (like the `bash` tool), falling back to the
        // process cwd when no Agent/workingDirectory service is available.
        let cwd = workdirArg;
        if (cwd === undefined && typeof sessionCwd === 'function' && exec?.agent !== undefined) {
          try {
            cwd = await sessionCwd(exec.agent, exec?.signal);
          } catch {
            cwd = undefined;
          }
        }
        resolved = await resolve({ cwd, command, agent: exec?.agent });
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
      if (resolved === undefined || Array.isArray(resolved.argv) === false || resolved.argv.length === 0) {
        return { ok: false, error: 'no shell resolved' };
      }
      const argv = [...resolved.argv];
      // The selected shell's argv carries the command as its final argument —
      // bash: [shell, '-c', command]; WSL: [bash.exe, '-d', distro, '-c', ...];
      // PowerShell: [powershell, '-Command', ...]. That is exactly the argv a
      // foreground call would run, so reuse it verbatim and detach instead.
      const publicJob = sessions.start({
        argv,
        command,
        cwd: resolved.cwd,
        label: args?.label,
        shellLabel: resolved.shellLabel,
        sessionId: ownerOf(exec),
        sessionCwd: resolved.cwd,
        // How the child's output reaches the log file: Niu writes to an
        // inherited fd; WSL/PowerShell/Git Bash must redirect themselves, and a
        // detached Git Bash needs its coreutils dirs on PATH.
        selfRedirect: resolved.selfRedirect === true,
        dialect: resolved.dialect,
        shellDialect: resolved.dialect,
        extraPath: resolved.extraPath,
        wslDistro: resolved.wslDistro,
        wslLauncher: resolved.wslLauncher,
      });
      return {
        ok: true,
        jobId: publicJob.id,
        status: publicJob.status,
        pid: publicJob.pid,
        cwd: publicJob.cwd,
        shellLabel: publicJob.shellLabel,
        logPath: publicJob.logPath,
      };
    },
  });

  const bgOutput = defineTool({
    name: 'bg_output',
    description:
      'Read a background job\'s output incrementally. Each call returns output since the previous read (pass the returned offset back to continue). '
      + 'With follow:true it waits up to timeout_ms for new output or the process to finish, then returns — it does not block indefinitely. '
      + 'Ends with a status line.',
    parameters: {
      job_id: { type: 'string', required: true, description: 'The job id returned by bg_start.' },
      offset: { type: 'number', description: 'Byte offset to read from; omit to start at 0, or pass a previous read\'s offset to continue.' },
      follow: { type: 'boolean', description: 'Wait for new output or process exit instead of returning immediately.' },
      timeout_ms: { type: 'number', description: 'With follow:true, how long to wait (default 20000, capped at 60000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          status: { type: 'string' },
          text: { type: 'string' },
          offset: { type: 'number' },
          size: { type: 'number' },
          eof: { type: 'boolean' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        if (!value.ok) return [{ type: 'text', text: `bg_output failed: ${value.error ?? 'unknown error'}` }];
        const body = value.text ?? '';
        const status = value.status ?? 'unknown';
        const tail = value.eof
          ? `[status: ${status}${value.exitCode === null || value.exitCode === undefined ? '' : `, exit code: ${value.exitCode}`}]`
          : `[status: ${status}, more output may follow; offset ${value.offset ?? 0}]`;
        return [{ type: 'text', text: body.length > 0 ? `${body}\n${tail}` : tail }];
      },
    },
    async execute(args) {
      const id = typeof args?.job_id === 'string' ? args.job_id : '';
      if (id.length === 0) throw new ToolArgsError(['job_id must be a non-empty string']);
      const snap = sessions.get(id);
      if (snap === undefined) return { ok: false, error: `no such job: ${id}` };
      const offset = Number.isFinite(args?.offset) ? args.offset : 0;
      const follow = args?.follow === true;
      const timeoutMs = Math.max(0, Math.min(Number.isFinite(args?.timeout_ms) ? args.timeout_ms : 20000, 60000));
      let read = sessions.read(id, offset, 128 * 1024);
      if (follow && read.ok && (read.text ?? '').length === 0 && read.eof !== true) {
        // Poll until new bytes appear, the job settles, or the timeout passes.
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await new Promise((resolveSleep) => setTimeout(resolveSleep, Math.min(800, Math.max(100, deadline - Date.now()))));
          read = sessions.read(id, offset, 128 * 1024);
          if ((read.text ?? '').length > 0 || read.eof === true) break;
        }
      }
      const final = sessions.get(id);
      return {
        ok: read.ok,
        status: read.status ?? final?.status,
        text: read.text ?? '',
        offset: read.offset ?? offset,
        size: read.size ?? 0,
        eof: read.eof === true,
        exitCode: final?.exitCode ?? null,
        ...read.ok ? {} : { error: read.error },
      };
    },
  });

  const bgList = defineTool({
    name: 'bg_list',
    description:
      'List background jobs started with bg_start: their ids, labels, status (running/exited/killed/failed), and owning conversation. '
      + 'By default lists every job across all conversations; pass this_conversation:true to list only this conversation\'s.',
    parameters: {
      this_conversation: { type: 'boolean', description: 'Only list jobs started from this conversation.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          jobs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                jobId: { type: 'string', required: true },
                label: { type: 'string', required: true },
                status: { type: 'string', required: true },
                pid: { type: 'number' },
                sessionId: { type: 'string' },
                startedAt: { type: 'number' },
              },
            },
          },
        },
      },
      render(_args, value) {
        if (!value.ok || value.jobs.length === 0) return [{ type: 'text', text: 'no background jobs' }];
        const lines = value.jobs.map(
          (job) => `${job.jobId} [${job.status}] ${job.label}${job.sessionId ? ` — session ${job.sessionId}` : ''}`,
        );
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      const onlyThis = args?.this_conversation === true;
      const owner = ownerOf(exec);
      const jobs = sessions.list(onlyThis ? owner : undefined).map((job) => ({
        jobId: job.id,
        label: job.label,
        status: job.status,
        pid: job.pid,
        sessionId: job.sessionId,
        startedAt: job.startedAt,
      }));
      return { ok: true, jobs };
    },
  });

  const bgKill = defineTool({
    name: 'bg_kill',
    description:
      'Stop a background job started with bg_start and its whole process tree. Returns once the cancellation is requested; '
      + 'a job that already finished reports already_finished.',
    parameters: {
      job_id: { type: 'string', required: true, description: 'The job id to stop.' },
      reason: { type: 'string', description: 'Optional reason, recorded with the job.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          alreadyFinished: { type: 'boolean' },
          status: { type: 'string' },
          jobId: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        if (!value.ok) return [{ type: 'text', text: `bg_kill failed: ${value.error ?? 'unknown error'}` }];
        return [{
          type: 'text',
          text: value.alreadyFinished
            ? `job ${value.jobId} already finished (${value.status})`
            : `stop requested for job ${value.jobId} (status ${value.status ?? 'stopping'})`,
        }];
      },
    },
    async execute(args) {
      const id = typeof args?.job_id === 'string' ? args.job_id : '';
      if (id.length === 0) throw new ToolArgsError(['job_id must be a non-empty string']);
      const result = sessions.kill(id, args?.reason);
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        alreadyFinished: result.alreadyFinished === true,
        status: result.job?.status,
        jobId: id,
      };
    },
  });

  return [bgStart, bgOutput, bgList, bgKill];
}

/** The tool names, so the mount can log and the panel can recognize them. */
export const BACKGROUND_TOOL_NAMES = ['bg_start', 'bg_output', 'bg_list', 'bg_kill'];
