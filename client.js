window.__ModuleLoader__.load({
  id: 'dsh-shell-switch',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'settings.shell-switch';

    /** English copy for the Shell selector page. */
    const en = {
      nav: 'Shell',
      title: 'Shell selector',
      description: 'Choose which local shell the bash tool runs commands in. The change applies to the next command — no restart needed.',
      shell: 'Shell executable',
      compatible: 'Bash-compatible',
      powershell: 'PowerShell series',
      other: 'Detected, not bash-compatible',
      detected: 'Detected shells',
      effective: 'In effect now',
      selected: 'Saved choice',
      defaults: 'Falls back to',
      none: 'No shell selected yet',
      version: 'version',
      path: 'path',
      sandbox: 'Sandbox',
      sandboxHint: 'Commands still run under the session file policy; the sandbox is not changed by this page.',
      refresh: 'Rescan',
      save: 'Save',
      saving: 'Saving…',
      reset: 'Use default',
      saved: 'Saved. The next bash command uses this shell.',
      resetDone: 'Reset to the deployment default.',
      loading: 'Detecting local shells…',
      empty: 'No shell detected on this machine.',
      incompatible: 'not bash-compatible',
      saveFailed: 'The change was not accepted',
      loadFailed: 'Could not read the shell list',
      settingsFile: 'Saved in',
      pwshHiddenNote: 'While this plugin is active, on Windows the shipped pwsh tool is hidden from every Agent; disable or remove the plugin to bring it back.',
      note: 'Note',
      // Background jobs tab (better-sidebar).
      bgNav: 'Background jobs',
      bgDescription: 'Detached background processes started with bg_start — they keep running after the tool call and the harness restart.',
      bgThis: 'This conversation',
      bgAll: 'All conversations',
      bgRefresh: 'Refresh',
      bgRunning: 'running',
      bgExited: 'exited',
      bgKilled: 'killed',
      bgFailed: 'failed',
      bgOrphan: 'detached',
      bgStopping: 'stopping',
      bgEmpty: 'No background jobs yet.',
      bgEmptySession: 'No background jobs in this conversation.',
      bgKill: 'Stop',
      bgKilling: 'Stopping…',
      bgOpenLog: 'Log',
      bgCloseLog: 'Hide log',
      bgLoadingLog: 'Loading…',
      bgOtherSessions: 'Other conversations',
      bgNoOwner: 'No owner',
      bgJump: 'Go to',
      bgOtherHint: 'Other conversations have',
      bgViewAll: 'view all',
      bgLoadFailed: 'Could not read the job list',
      bgKillFailed: 'Stop request failed',
      bgStarted: 'started',
    };

    /** Simplified Chinese copy for the Shell selector page. */
    const zh = {
      nav: 'Shell',
      title: 'Shell 选择器',
      description: '选择 bash 工具实际调用的本机 shell。保存后下一条命令即生效，不需要重启。',
      shell: 'Shell 可执行文件',
      compatible: '可用于 bash',
      powershell: 'PowerShell系列',
      other: '已检测到，但不是 bash 方言',
      detected: '检测到的 shell',
      effective: '当前生效',
      selected: '已保存的选择',
      defaults: '回退配置',
      none: '尚未选择 shell',
      version: '版本',
      path: '路径',
      sandbox: '沙箱',
      sandboxHint: '命令仍受会话文件策略约束；本页不会改动沙箱设置。',
      refresh: '重新扫描',
      save: '保存',
      saving: '保存中…',
      reset: '恢复默认',
      saved: '已保存，下一条 bash 命令将使用该 shell。',
      resetDone: '已恢复为部署默认值。',
      loading: '正在检测本机 shell…',
      empty: '本机未检测到任何 shell。',
      incompatible: '不兼容 bash',
      saveFailed: '修改未被接受',
      loadFailed: '读取 shell 列表失败',
      settingsFile: '保存位置',
      pwshHiddenNote: '本插件启用期间，如果是 Windows 环境，官方 pwsh 工具对所有 Agent 隐藏；停用或卸载本插件即可恢复。',
      note: '说明',
      // 后台任务 tab（better-sidebar）。
      bgNav: '后台任务',
      bgDescription: '由 bg_start 启动的分离后台进程，工具调用结束后仍继续运行（重启 harness 也不受影响）。',
      bgThis: '本会话',
      bgAll: '全部会话',
      bgRefresh: '刷新',
      bgRunning: '运行中',
      bgExited: '已结束',
      bgKilled: '已停止',
      bgFailed: '失败',
      bgOrphan: '已脱管',
      bgStopping: '停止中',
      bgEmpty: '暂无后台任务。',
      bgEmptySession: '本会话暂无后台任务。',
      bgKill: '停止',
      bgKilling: '停止中…',
      bgOpenLog: '日志',
      bgCloseLog: '收起日志',
      bgLoadingLog: '加载中…',
      bgOtherSessions: '其它会话',
      bgNoOwner: '无归属',
      bgJump: '前往',
      bgOtherHint: '其它会话还有',
      bgViewAll: '查看全部',
      bgLoadFailed: '读取任务列表失败',
      bgKillFailed: '停止请求失败',
      bgStarted: '启动于',
    };

    /**
     * The `<option>` value for one shell. Several WSL distributions share one
     * launcher path, so the distro name is part of the identity.
     * @param {{ path?: string, distro?: string }} shell - a detected shell.
     * @returns {string} the encoded option value.
     */
    function optionValue(shell) {
      const base = String(shell?.path ?? '');
      return typeof shell?.distro === 'string' && shell.distro.length > 0 ? `${base}#${shell.distro}` : base;
    }

    /**
     * Split an `<option>` value back into the request body fields.
     * @param {string} value - an encoded option value.
     * @returns {{ path: string, distro?: string }} the selection payload.
     */
    function decodeOption(value) {
      const index = String(value).indexOf('#');
      if (index < 0) return { path: value };
      return { path: value.slice(0, index), distro: value.slice(index + 1) };
    }

    /** Resolve the API prefix against the page's base so sub-path deployments work. */
    function apiBase() {
      const fallback = '/api/dsh-shell-switch';
      if (typeof document === 'undefined') return fallback;
      try {
        const base = document.baseURI;
        const dir = new URL('.', base).pathname;
        return `${dir.replace(/\/$/, '')}/api/dsh-shell-switch`;
      } catch {
        return fallback;
      }
    }

    /** One JSON call against this plugin's host surface. */
    async function request(tail, init) {
      const response = await fetch(`${apiBase()}${tail}`, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${response.status}`);
      return data;
    }

    const styles = {
      page: { display: 'grid', gap: '18px', maxWidth: '760px' },
      title: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      description: { margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      field: { display: 'grid', gap: '8px' },
      label: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      select: {
        width: '100%',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      button: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        cursor: 'pointer',
      },
      primary: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: '1px solid transparent',
        background: 'var(--dsw-alias-brand-primary)',
        color: '#fff',
        fontSize: '13px',
        cursor: 'pointer',
      },
      card: {
        display: 'grid',
        gap: '8px',
        padding: '12px 14px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      line: { display: 'grid', gridTemplateColumns: '96px 1fr', gap: '8px', fontSize: '12px', lineHeight: 1.6 },
      labelCell: { color: 'var(--dsw-alias-label-secondary)' },
      valueCell: { color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      message: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
      error: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' },
      hint: { fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' },
    };

    /** One label/value row inside the "in effect" card. */
    function InfoRow(props) {
      return h('div', { style: styles.line },
        h('span', { style: styles.labelCell }, props.label),
        h('span', { style: styles.valueCell }, props.value ?? '—'));
    }

    /** The Shell selector page registered into the Settings panel. */
    function ShellSection(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const [state, setState] = React.useState(null);
      const [draft, setDraft] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);
      const [error, setError] = React.useState(null);

      const load = React.useCallback(async (force, settle) => {
        setBusy(true);
        setError(null);
        try {
          const tail = settle === true ? '/state?refresh=1&settle=1' : force === true ? '/state?refresh=1' : '/state';
          const next = await request(tail);
          setState(next);
          setDraft(next.selected?.path ?? next.effective?.path ?? '');
        } catch (failure) {
          setError(`${t('loadFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      }, [t]);

      React.useEffect(() => { load(false); }, [load]);

      // Versions are probed in the background by the host, so the first response
      // carries none. Re-read once shortly after the list appears instead of
      // making the user hit "Rescan" for them.
      React.useEffect(() => {
        const timer = setTimeout(() => { load(false); }, 1200);
        return () => clearTimeout(timer);
      }, [load]);

      const save = async () => {
        if (draft === '') return;
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const next = await request('/select', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(decodeOption(draft)),
          });
          setState(next);
          setDraft(next.selected?.path ?? next.effective?.path ?? draft);
          setMessage(t('saved'));
        } catch (failure) {
          setError(`${t('saveFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      };

      const reset = async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const next = await request('/select', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'reset' }),
          });
          setState(next);
          setDraft(next.effective?.path ?? '');
          setMessage(t('resetDone'));
        } catch (failure) {
          setError(`${t('saveFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      };

      if (state === null) {
        return h('div', { style: styles.page }, h('p', { style: styles.description }, busy || error === null ? t('loading') : error));
      }

      const shells = Array.isArray(state.shells) ? state.shells : [];
      const isPs = (shell) => shell.dialect === 'powershell' || shell.kind === 'powershell';
      const compatible = shells.filter((shell) => shell.compatible === true && !isPs(shell));
      const powershell = shells.filter((shell) => shell.compatible === true && isPs(shell));
      const others = shells.filter((shell) => shell.compatible !== true);
      const currentValue = optionValue(state.selected ?? {});
      const dirty = draft !== currentValue;

      const groups = [];
      if (compatible.length > 0) groups.push(h('optgroup', { key: 'compatible', label: t('compatible') },
        compatible.map((shell) => h('option', { key: shell.path, value: optionValue(shell) },
          `${shell.label}${shell.version ? ` · ${shell.version}` : ''}${shell.note ? ` — ${shell.note}` : ''}`))));
      if (powershell.length > 0) groups.push(h('optgroup', { key: 'powershell', label: t('powershell') },
        powershell.map((shell) => h('option', { key: shell.path, value: optionValue(shell) },
          `${shell.label}${shell.version ? ` · ${shell.version}` : ''}`))));
      if (others.length > 0) groups.push(h('optgroup', { key: 'others', label: t('other') },
        others.map((shell) => h('option', { key: shell.path, value: optionValue(shell), disabled: true },
          `${shell.label}（${t('incompatible')}）`))));

      const selectedShell = shells.find((shell) => optionValue(shell) === currentValue) ?? null;

      return h('div', { style: styles.page },
        h('h2', { style: styles.title }, t('title')),
        h('p', { style: styles.description }, t('description')),
        h('div', { style: styles.field },
          h('label', { style: styles.label, htmlFor: 'shell-switch-select' }, t('shell')),
          h('select', {
            id: 'shell-switch-select',
            style: styles.select,
            value: draft === '' ? currentValue : draft,
            disabled: busy,
            onChange: (event) => setDraft(event.target.value),
          }, groups.length > 0 ? groups : h('option', { value: '' }, t('empty')))),
        h('div', { style: styles.row },
          h('button', { type: 'button', style: styles.primary, disabled: busy || !dirty, onClick: save }, busy ? t('saving') : t('save')),
          h('button', { type: 'button', style: styles.button, disabled: busy, onClick: reset }, t('reset')),
          h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => load(false, true) }, t('refresh'))),
        message !== null ? h('p', { style: styles.message }, message) : null,
        error !== null ? h('p', { style: styles.error }, error) : null,
        state.effective !== null
          ? h('div', { style: styles.card },
            h('strong', { style: styles.label }, t('effective')),
            h(InfoRow, { label: t('shell'), value: state.effective.label }),
            h(InfoRow, { label: t('path'), value: h('span', { style: styles.mono }, state.effective.path) }),
            state.effective.version ? h(InfoRow, { label: t('version'), value: state.effective.version }) : null,
            h(InfoRow, { label: t('selected'), value: state.selected?.path ?? t('none') }),
            h(InfoRow, { label: t('defaults'), value: state.defaults?.shell ?? 'auto' }),
            state.sandbox ? h(InfoRow, { label: t('sandbox'), value: state.sandbox.mode }) : null,
            selectedShell?.note ? h(InfoRow, { label: t('note'), value: selectedShell.note }) : null,
            h('p', { style: styles.hint }, t('sandboxHint')))
          : h('p', { style: styles.error }, t('empty')),
        state.warning ? h('p', { style: styles.error }, state.warning) : null,
        state.pwsh?.hidden === true ? h('p', { style: styles.hint }, t('pwshHiddenNote')) : null,
        h('p', { style: styles.hint }, `${t('settingsFile')}：${state.settingsFile}`));
    }

    // --- Background jobs panel (rendered inside dsh-better-sidebar) --------

    /** Extra styles for the jobs panel. */
    const jobStyles = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: '12px', color: 'var(--dsw-alias-label-primary)' },
      toolbar: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' },
      seg: { display: 'inline-flex', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '7px', overflow: 'hidden' },
      segBtn: (active) => ({ padding: '3px 10px', fontSize: '12px', cursor: 'pointer', border: 'none', background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent', color: active ? '#fff' : 'var(--dsw-alias-label-secondary)' }),
      spacer: { flex: '1 1 auto' },
      minibtn: { padding: '3px 9px', fontSize: '12px', cursor: 'pointer', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' },
      jumpbtn: { padding: '2px 7px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline', whiteSpace: 'nowrap' },
      scroller: { flex: '1 1 auto', overflow: 'auto', minHeight: 0 },
      groupHead: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px 4px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', userSelect: 'none' },
      groupCount: { opacity: 0.7 },
      row: { display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 10px', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      dot: (status) => ({ width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto', background: status === 'running' ? 'var(--dsw-alias-state-success-primary)' : status === 'failed' ? 'var(--dsw-alias-state-error-primary)' : status === 'orphan' ? '#e0a800' : 'var(--dsw-alias-label-secondary)' }),
      label: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      statusText: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' },
      log: { margin: 0, padding: '8px 10px', background: 'var(--dsw-alias-bg-layer-2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '240px', overflow: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      meta: { padding: '2px 10px 8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' },
      empty: { padding: '18px 12px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)' },
      err: { padding: '8px 10px', color: 'var(--dsw-alias-state-error-primary)' },
    };

    /** Human-friendly elapsed "3m 12s". */
    function elapsed(from, to) {
      const ms = Math.max(0, (to ?? Date.now()) - (from ?? to ?? Date.now()));
      const s = Math.floor(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m ${s % 60}s`;
      const hrs = Math.floor(m / 60);
      return `${hrs}h ${m % 60}m`;
    }

    /** Short id for a session: drop the `session-` prefix, keep 8 hex chars. */
    function shortSession(id) {
      if (typeof id !== 'string' || id.length === 0) return '';
      const core = id.startsWith('session-') ? id.slice('session-'.length) : id;
      return core.length > 8 ? core.slice(0, 8) : core;
    }

    /** Last path segment of a directory (both / and \ separators). */
    function baseName(p) {
      if (typeof p !== 'string' || p.length === 0) return '';
      const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
      return parts[parts.length - 1] || p;
    }

    /**
     * A human label for an owner session: its working-directory basename when
     * known (a project name reads far better than a uuid), plus a short id so
     * two sessions in the same directory stay distinguishable.
     * @param {{ sessionId?: string, sessionCwd?: string, cwd?: string }} job - any job from that session.
     * @returns {string} the display label.
     */
    function sessionLabel(job) {
      const id = shortSession(job?.sessionId);
      const dir = baseName(job?.sessionCwd || job?.cwd || '');
      if (dir && id) return `${dir} · ${id}`;
      if (dir) return dir;
      if (id) return id;
      return '';
    }

    /**
     * The Background-jobs page. Two views (this conversation / all), a per-
     * session tree, a streaming log per job, and a per-row stop button.
     *
     * Polls the host `/jobs` surface while visible and there is anything
     * running; a manual refresh is always available.
     */
    function JobsPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const scope = props.scope ?? {};
      const visible = props.visible !== false;
      const sessionId = String(scope.sessionId ?? '');
      // betterSidebar passes a jump-to-conversation callback for tabs; use it to
      // offer "go to the originating conversation" on each job / group.
      const jumpTo = typeof props.onSubagentJump === 'function' ? props.onSubagentJump : null;
      const [view, setView] = React.useState('session'); // 'session' | 'all'
      const [data, setData] = React.useState(null); // { active, groups, total } or { jobs }
      const [error, setError] = React.useState(null);
      const [expanded, setExpanded] = React.useState(() => new Set());
      const [openLog, setOpenLog] = React.useState(null); // jobId
      const [logText, setLogText] = React.useState({});
      const [logOffset, setLogOffset] = React.useState({});
      const [busy, setBusy] = React.useState({});
      const collapsed = React.useRef(new Set());

      const load = React.useCallback(async () => {
        try {
          const query = view === 'all' ? '/jobs?all=1' : `/jobs?session=${encodeURIComponent(sessionId)}`;
          const next = await request(query);
          setData(next);
          setError(null);
        } catch (failure) {
          setError(`${t('bgLoadFailed')}：${failure.message}`);
        }
      }, [view, sessionId, t]);

      // Initial + view-change load.
      React.useEffect(() => { void load(); }, [load]);

      // Poll while visible and something is alive.
      React.useEffect(() => {
        if (!visible) return undefined;
        const anyLive = () => {
          if (data === null) return true;
          const all = data.jobs ?? [...(data.active ?? []), ...((data.groups ?? []).flatMap((g) => g.jobs))];
          return all.some((job) => job.status === 'running' || job.status === 'stopping' || job.status === 'orphan');
        };
        if (!anyLive()) return undefined;
        const timer = setInterval(() => { void load(); }, 4000);
        return () => clearInterval(timer);
      }, [visible, data, load]);

      // Poll the open job's log.
      React.useEffect(() => {
        if (openLog === null || !visible) return undefined;
        let cancelled = false;
        const tick = async () => {
          try {
            const offset = logOffset[openLog] ?? 0;
            const read = await request(`/jobs/${encodeURIComponent(openLog)}/log?offset=${offset}`);
            if (cancelled) return;
            if (typeof read.text === 'string' && read.text.length > 0) {
              setLogText((prev) => ({ ...prev, [openLog]: (prev[openLog] ?? '') + read.text }));
            }
            setLogOffset((prev) => ({ ...prev, [openLog]: typeof read.offset === 'number' ? read.offset : offset }));
          } catch {
            // A missing log file (just started) is not an error worth surfacing.
          }
        };
        void tick();
        const timer = setInterval(() => { void tick(); }, 1500);
        return () => { cancelled = true; clearInterval(timer); };
      }, [openLog, visible, logOffset]);

      const kill = async (jobId) => {
        setBusy((prev) => ({ ...prev, [jobId]: true }));
        try {
          await request(`/jobs/${encodeURIComponent(jobId)}/kill`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'stopped from sidebar' }),
          });
          await load();
        } catch (failure) {
          setError(`${t('bgKillFailed')}：${failure.message}`);
        } finally {
          setBusy((prev) => ({ ...prev, [jobId]: false }));
        }
      };

      const toggleGroup = (key) => {
        const set = collapsed.current;
        if (set.has(key)) set.delete(key); else set.add(key);
        setExpanded(new Set(set));
      };

      const toggleLog = (jobId) => {
        setOpenLog((prev) => (prev === jobId ? null : jobId));
      };

      const statusLabel = (status) => {
        switch (status) {
          case 'running': return t('bgRunning');
          case 'stopping': return t('bgStopping');
          case 'killed': return t('bgKilled');
          case 'failed': return t('bgFailed');
          case 'orphan': return t('bgOrphan');
          default: return t('bgExited');
        }
      };

      const renderJob = (job, showOwner) => {
        const isOpen = openLog === job.id;
        const live = job.status === 'running' || job.status === 'stopping' || job.status === 'orphan';
        const owner = sessionLabel(job);
        const canJump = jumpTo !== null && job.sessionId && job.sessionId !== sessionId;
        return h('div', { key: job.id },
          h('div', { style: jobStyles.row },
            h('span', { style: jobStyles.dot(job.status), title: statusLabel(job.status) }),
            h('span', { style: jobStyles.label, title: job.command ?? job.label }, job.label),
            showOwner === true && owner
              ? h('span', { style: jobStyles.statusText, title: `session ${job.sessionId}` }, owner)
              : null,
            h('span', { style: jobStyles.statusText }, `${statusLabel(job.status)} · ${elapsed(job.startedAt, job.endedAt)}`),
            canJump ? h('button', { type: 'button', style: jobStyles.jumpbtn, title: t('bgJump'), onClick: () => { try { jumpTo(job.sessionId); } catch {} } }, t('bgJump')) : null,
            h('button', { type: 'button', style: jobStyles.minibtn, onClick: () => toggleLog(job.id) }, isOpen ? t('bgCloseLog') : t('bgOpenLog')),
            live
              ? h('button', { type: 'button', style: jobStyles.minibtn, disabled: busy[job.id] === true, onClick: () => kill(job.id) }, busy[job.id] ? t('bgKilling') : t('bgKill'))
              : null),
          isOpen
            ? h('div', null,
              h('pre', { style: jobStyles.log }, (logText[job.id] ?? '') || t('bgLoadingLog')),
              h('div', { style: jobStyles.meta }, `${job.shellLabel ? `${job.shellLabel} · ` : ''}${job.cwd}`))
            : null);
      };

      /**
       * One collapsible group. `ownerId` (when set and not this conversation)
       * turns the header into a jump target too; `current` marks the reader's
       * own conversation so its group is never collapsed.
       */
      const renderGroup = (key, title, jobs, opts) => {
        if (!Array.isArray(jobs) || jobs.length === 0) return null;
        const options = opts ?? {};
        const collapsible = options.collapsible === true;
        const current = options.current === true;
        const isCollapsed = collapsible && collapsed.current.has(key);
        const canJump = jumpTo !== null && options.ownerId && options.ownerId !== sessionId;
        return h('div', { key },
          h('div', { style: jobStyles.groupHead, onClick: collapsible ? () => toggleGroup(key) : undefined },
            collapsible ? h('span', null, isCollapsed ? '▸' : '▾') : null,
            h('span', { style: current ? { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } : null }, title),
            h('span', { style: jobStyles.groupCount }, ` (${jobs.length})`),
            canJump
              ? h('button', { type: 'button', style: jobStyles.jumpbtn, title: t('bgJump'), onClick: (e) => { e.stopPropagation(); try { jumpTo(options.ownerId); } catch {} } }, t('bgJump'))
              : null),
          isCollapsed ? null : jobs.map((job) => renderJob(job, options.showOwner === true)));
      };

      /** Group a flat job list by owner session, this conversation first. */
      const groupByOwner = (jobs) => {
        const byOwner = new Map();
        for (const job of jobs) {
          const key = job.sessionId || '';
          if (!byOwner.has(key)) byOwner.set(key, []);
          byOwner.get(key).push(job);
        }
        return byOwner;
      };

      const total = data === null ? 0 : (data.jobs ? data.jobs.length : (data.total ?? 0));
      const body = [];
      if (data !== null) {
        if (view === 'all' && Array.isArray(data.jobs)) {
          const byOwner = groupByOwner(data.jobs);
          const mine = byOwner.get(sessionId) ?? [];
          byOwner.delete(sessionId);
          if (mine.length > 0) body.push(renderGroup('this', t('bgThis'), mine, { current: true }));
          let index = 0;
          for (const [owner, jobs] of byOwner) {
            index += 1;
            const title = owner ? sessionLabel(jobs[0]) || shortSession(owner) : t('bgNoOwner');
            body.push(renderGroup(`g${index}`, title, jobs, { collapsible: true, ownerId: owner }));
          }
          if (total === 0) body.push(h('div', { key: 'empty', style: jobStyles.empty }, t('bgEmpty')));
        } else if (view === 'session') {
          // This-conversation view shows ONLY this conversation's jobs. Other
          // conversations live in the 全部 view — earlier they leaked in here,
          // which read as "本会话 shows other sessions' jobs".
          const active = Array.isArray(data.active) ? data.active : [];
          if (active.length === 0) {
            body.push(h('div', { key: 'empty', style: jobStyles.empty }, t('bgEmptySession')));
          } else {
            body.push(renderGroup('this', t('bgThis'), active, { current: true }));
          }
          // Tell the reader when other conversations have jobs they can see in 全部.
          const otherCount = (Array.isArray(data.groups) ? data.groups : [])
            .reduce((sum, g) => sum + ((g.jobs ?? []).length), 0);
          if (otherCount > 0) {
            body.push(h('div', {
              key: 'other-hint',
              style: { padding: '8px 10px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
              onClick: () => setView('all'),
            }, `${t('bgOtherHint')} ${otherCount} · ${t('bgViewAll')} →`));
          }
        }
      }

      return h('div', { style: jobStyles.root },
        h('div', { style: jobStyles.toolbar },
          h('div', { style: jobStyles.seg },
            h('button', { type: 'button', style: jobStyles.segBtn(view === 'session'), onClick: () => setView('session') }, t('bgThis')),
            h('button', { type: 'button', style: jobStyles.segBtn(view === 'all'), onClick: () => setView('all') }, t('bgAll'))),
          h('span', { style: jobStyles.spacer }),
          h('span', { style: jobStyles.statusText }, `${total}`),
          h('button', { type: 'button', style: jobStyles.minibtn, onClick: () => load() }, t('bgRefresh'))),
        error !== null ? h('div', { style: jobStyles.err }, error) : null,
        h('div', { style: jobStyles.scroller }, body));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-shell-switch: locale');
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'shell-switch',
          order: 12,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({ t }),
        }, ShellSection));
        // Register the background-jobs page into dsh-better-sidebar. That
        // plugin is OPTIONAL, so `betterSidebar` is not declared in this
        // plugin's module-level `inject` (a missing service would block the
        // whole client from loading). Instead `ctx.inject([...], cb)` runs the
        // callback exactly when the service becomes available and never when it
        // is absent — the correct optional-dependency form. A plain
        // `ctx.get('betterSidebar')` inside `ctx.effect` raced the service and
        // ran before it existed, so the tab silently never registered.
        ctx.inject(['betterSidebar'], (serviceCtx) => {
          serviceCtx.effect(() => {
            const service = serviceCtx.betterSidebar ?? (typeof serviceCtx.get === 'function' ? serviceCtx.get('betterSidebar') : undefined);
            if (service === undefined || typeof service.registerTab !== 'function') return () => {};
            const dispose = service.registerTab({
              id: 'dsh-shell-switch:jobs',
              title: () => t('bgNav'),
              description: () => t('bgDescription'),
              icon: () => h('span', { style: { fontSize: '15px' } }, '▤'),
              order: 62,
              single: true,
              component: (props) => h(JobsPanel, { ...props, t }),
            });
            return () => {
              if (typeof dispose === 'function') dispose();
            };
          }, 'dsh-shell-switch: better-sidebar jobs tab');
        });
      },
    };
  },
});
