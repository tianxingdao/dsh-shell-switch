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
      bgFollowOn: 'Following',
      bgFollowOff: 'Follow',
      bgFollowHint: 'Auto-scroll to the newest output',
      bgSearchPh: 'Search log…',
      bgCopy: 'Copy',
      bgCopied: 'Copied',
      bgDownload: 'Download',
      bgFullscreen: 'Fullscreen',
      bgExitFull: 'Exit',
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
      bgFollowOn: '跟随最新',
      bgFollowOff: '跟随',
      bgFollowHint: '自动滚动到最新输出',
      bgSearchPh: '搜索日志…',
      bgCopy: '复制',
      bgCopied: '已复制',
      bgDownload: '下载',
      bgFullscreen: '全屏',
      bgExitFull: '退出',
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
      // --- terminal log: a fixed dark palette independent of the light/dark
      // theme, so it always reads as a real console. Colors are hard-coded on
      // purpose (a terminal is dark); no theme tokens leak in.
      term: { margin: 0, background: '#0d1117', color: '#c9d1d9', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '11.5px', lineHeight: 1.55, borderRadius: '8px', border: '1px solid #21262d', overflow: 'auto', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' },
      termChrome: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', background: '#161b22', borderBottom: '1px solid #21262d', borderTopLeftRadius: '8px', borderTopRightRadius: '8px' },
      termDot: (c) => ({ width: '9px', height: '9px', borderRadius: '50%', background: c }),
      termTitle: { flex: '1 1 auto', fontSize: '11px', color: '#8b949e', marginLeft: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      termBody: { padding: '8px 0', display: 'block' },
      termLine: { display: 'flex', alignItems: 'flex-start', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '0 10px 0 0' },
      gutter: { flex: '0 0 auto', width: '40px', textAlign: 'right', paddingRight: '10px', paddingLeft: '8px', color: '#484f58', userSelect: 'none', WebkitUserSelect: 'none' },
      lineText: { flex: '1 1 auto', minWidth: 0 },
      lineErrBg: { background: 'rgba(248,81,73,0.14)' },
      lineWarnBg: { background: 'rgba(187,128,9,0.14)' },
      tokTime: { color: '#7d8590' },
      tokErr: { color: '#ff7b72', fontWeight: 600 },
      tokWarn: { color: '#d29922', fontWeight: 600 },
      tokInfo: { color: '#58a6ff' },
      tokDebug: { color: '#8b949e' },
      tokStr: { color: '#a5d6ff' },
      tokNum: { color: '#79c0ff' },
      tokUrl: { color: '#56d4dd', textDecoration: 'underline' },
      tokPath: { color: '#d2a8ff' },
      tokStack: { color: '#8b949e' },
      logBar: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderTop: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', flexWrap: 'wrap' },
      logSearch: { flex: '1 1 120px', minWidth: '80px', padding: '3px 7px', fontSize: '11px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' },
      followOn: { padding: '3px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', border: '1px solid transparent', background: 'var(--dsw-alias-brand-primary)', color: '#fff' },
      followOff: { padding: '3px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)' },
      mark: { background: 'rgba(255,210,0,0.55)', color: '#0d1117', borderRadius: '2px' },
      modalMask: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
      modalBox: { display: 'flex', flexDirection: 'column', width: '90vw', maxWidth: '1100px', height: '85vh', background: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2))', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1)' },
      modalHead: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
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
     * Streaming log viewer for one job.
     *
     * Renders the accumulated text with a toolbar offering: follow-latest
     * (auto-scroll), a search box that highlights matches, error/warn line
     * tinting, copy, download, clear-the-view, and a fullscreen modal. It keeps
     * its own UI state so the parent stays simple.
     * @param {object} props - { job, text, t, onClose }.
     */
    function LogView(props) {
      const t = props.t;
      const text = props.text ?? '';
      const [follow, setFollow] = React.useState(true);
      const [search, setSearch] = React.useState('');
      const [full, setFull] = React.useState(false);
      const [copied, setCopied] = React.useState(false);
      const boxRef = React.useRef(null);
      const modalBoxRef = React.useRef(null);

      // Auto-scroll to the newest line while follow is on.
      React.useEffect(() => {
        if (!follow) return;
        for (const el of [boxRef.current, modalBoxRef.current]) {
          if (el) el.scrollTop = el.scrollHeight;
        }
      }, [text, follow, full]);

      const onScroll = (event) => {
        const el = event.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        setFollow(atBottom);
      };

      /**
       * Colorize one plain line into tokens: a leading timestamp, then the
       * level keyword, URLs, quoted strings, paths, stack frames, and numbers.
       * Only used when NO search is active (search keeps plain text so the
       * match highlight stays legible).
       */
      const ansiColor = (code) => {
        // Standard + bright foreground SGR codes → readable-on-dark colors.
        switch (code) {
          case 30: case 90: return '#8b949e'; // black/gray
          case 31: case 91: return '#ff7b72'; // red
          case 32: case 92: return '#7ee787'; // green
          case 33: case 93: return '#e3b341'; // yellow
          case 34: case 94: return '#79c0ff'; // blue
          case 35: case 95: return '#d2a8ff'; // magenta
          case 36: case 96: return '#56d4dd'; // cyan
          case 37: case 97: return '#c9d1d9'; // white
          default: return undefined;
        }
      };

      /**
       * Parse ANSI SGR color escapes (java/Spring logs are full of them) into
       * colored spans, so a colorized log renders as its intended colors rather
       * than a wall of `[34mINFO[0;39m`. Non-SGR sequences (cursor moves, etc.)
       * are stripped.
       * @param {string} line - one raw log line, possibly with escapes.
       * @returns {Array} react nodes.
       */
      const parseAnsi = (line) => {
        const nodes = [];
        const re = /\x1b\[([0-9;]*)m|\x1b\[[0-9;]*[A-Za-z]/g;
        let last = 0;
        let color;
        let key = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          if (m.index > last) {
            const seg = line.slice(last, m.index);
            nodes.push(color ? h('span', { key: `a${key++}`, style: { color } }, seg) : seg);
          }
          if (m[1] !== undefined) {
            for (const part of m[1].split(';')) {
              const code = part === '' ? 0 : Number(part);
              if (code === 0 || code === 39) color = undefined;
              else if (ansiColor(code) !== undefined) color = ansiColor(code);
              // bold(1)/dim(2)/underline(4) etc. are ignored; color is enough.
            }
          }
          last = re.lastIndex;
        }
        if (last < line.length) {
          const seg = line.slice(last);
          nodes.push(color ? h('span', { key: `a${key++}`, style: { color } }, seg) : seg);
        }
        return nodes.length > 0 ? nodes : [line];
      };

      /** True when the raw text carries ANSI SGR escapes. */
      const hasAnsi = /\x1b\[[0-9;]*m/.test(text);

      const tokenize = (line) => {
        const nodes = [];
        let rest = line;
        let key = 0;
        // Leading timestamp: 2026-11-18T..., [12:34:56], 12:34:56.789
        const tsMatch = /^(\[?\d{2,4}[-/:.]\d{2}[-/:.]\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?\]?)\s?/.exec(rest);
        if (tsMatch) {
          nodes.push(h('span', { key: `t${key++}`, style: jobStyles.tokTime }, tsMatch[1]));
          rest = rest.slice(tsMatch[0].length);
        }
        // Split the remainder on a combined token regex, keeping separators.
        const re = /(\b(?:ERROR|FATAL|SEVERE|Exception|Traceback|PANIC)\b|\b(?:WARN|WARNING|DEPRECATED)\b|\b(?:INFO|DEBUG|TRACE|NOTICE)\b|https?:\/\/[^\s"')]+|"[^"]*"|'[^']*'|\bat\s+[\w$.<>]+\([^)]*\)|[A-Za-z]:\\[^\s"']+|\/(?:[\w.-]+\/)+[\w.-]+|\b\d+(?:\.\d+)?\b)/g;
        let last = 0;
        let m;
        while ((m = re.exec(rest)) !== null) {
          if (m.index > last) nodes.push(rest.slice(last, m.index));
          const tok = m[0];
          let style;
          if (/^(ERROR|FATAL|SEVERE|Exception|Traceback|PANIC)$/.test(tok)) style = jobStyles.tokErr;
          else if (/^(WARN|WARNING|DEPRECATED)$/i.test(tok)) style = jobStyles.tokWarn;
          else if (/^(INFO|DEBUG|TRACE|NOTICE)$/.test(tok)) style = /^(DEBUG|TRACE)$/.test(tok) ? jobStyles.tokDebug : jobStyles.tokInfo;
          else if (/^https?:\/\//.test(tok)) style = jobStyles.tokUrl;
          else if (/^["']/.test(tok)) style = jobStyles.tokStr;
          else if (/^at\s/.test(tok)) style = jobStyles.tokStack;
          else if (/^[A-Za-z]:\\/.test(tok) || /^\//.test(tok)) style = jobStyles.tokPath;
          else style = jobStyles.tokNum;
          nodes.push(h('span', { key: `k${key++}`, style }, tok));
          last = m.index + tok.length;
        }
        if (last < rest.length) nodes.push(rest.slice(last));
        return nodes;
      };

      /** Split into terminal lines with a gutter and token coloring. */
      const renderLines = () => {
        if (text.length === 0) {
          return [h('div', { key: 'empty', style: { color: '#8b949e', padding: '4px 10px' } }, t('bgLoadingLog'))];
        }
        const lines = text.split('\n');
        const q = search.trim();
        const lc = q.toLowerCase();
        const errRe = /\b(error|exception|failed|fatal|traceback|panic|severe)\b/i;
        const warnRe = /\b(warn|warning|deprecated)\b/i;
        const out = [];
        for (let i = 0; i < lines.length; i += 1) {
          const rawLine = lines[i];
          // For matching/tinting, work on the ANSI-stripped text.
          const line = hasAnsi ? rawLine.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') : rawLine;
          let content;
          if (q.length > 0 && lc.length > 0) {
            // Search mode: plain text with <mark> on matches.
            const lcLine = line.toLowerCase();
            if (lcLine.includes(lc)) {
              content = [];
              let from = 0;
              let at = lcLine.indexOf(lc, from);
              let key = 0;
              while (at >= 0) {
                if (at > from) content.push(line.slice(from, at));
                content.push(h('mark', { key: `m${key++}`, style: jobStyles.mark }, line.slice(at, at + q.length)));
                from = at + q.length;
                at = lcLine.indexOf(lc, from);
              }
              if (from < line.length) content.push(line.slice(from));
            } else {
              content = line === '' ? '\u00a0' : line;
            }
          } else if (hasAnsi) {
            // A colorized log renders in its own ANSI colors.
            content = line === '' ? '\u00a0' : parseAnsi(rawLine);
          } else {
            content = line === '' ? '\u00a0' : tokenize(line);
          }
          const bgStyle = q.length === 0
            ? errRe.test(line) ? jobStyles.lineErrBg : warnRe.test(line) ? jobStyles.lineWarnBg : null
            : null;
          out.push(h('div', { key: `l${i}`, style: { ...jobStyles.termLine, ...(bgStyle ?? {}) }, 'data-line': i + 1 },
            h('span', { style: jobStyles.gutter }, String(i + 1)),
            h('span', { style: jobStyles.lineText }, content)));
        }
        return out;
      };

      const download = () => {
        try {
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${props.job?.label ? props.job.label.replace(/[^\w.-]+/g, '_').slice(0, 40) : 'job'}.log`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch { /* ignore */ }
      };

      const copy = async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore */ }
      };

      const toolbar = (big) => h('div', { style: jobStyles.logBar },
        h('button', { type: 'button', style: follow ? jobStyles.followOn : jobStyles.followOff, onClick: () => setFollow((v) => !v), title: t('bgFollowHint') },
          follow ? `⬇ ${t('bgFollowOn')}` : `⬇ ${t('bgFollowOff')}`),
        h('input', {
          style: jobStyles.logSearch,
          placeholder: t('bgSearchPh'),
          value: search,
          onChange: (e) => setSearch(e.target.value),
        }),
        h('button', { type: 'button', style: jobStyles.minibtn, onClick: copy }, copied ? t('bgCopied') : t('bgCopy')),
        h('button', { type: 'button', style: jobStyles.minibtn, onClick: download }, t('bgDownload')),
        h('button', { type: 'button', style: jobStyles.minibtn, onClick: () => setFull((v) => !v) }, big ? t('bgExitFull') : t('bgFullscreen')));

      /** The terminal surface: chrome bar + scrollable body. */
      const terminal = (bodyRef, bodyStyle, title) => h('div', { style: jobStyles.term },
        h('div', { style: jobStyles.termChrome },
          h('span', { style: jobStyles.termDot('#ff5f56') }),
          h('span', { style: jobStyles.termDot('#ffbd2e') }),
          h('span', { style: jobStyles.termDot('#27c93f') }),
          h('span', { style: jobStyles.termTitle }, title ?? '')),
        h('div', { ref: bodyRef, style: { ...jobStyles.termBody, ...bodyStyle }, onScroll }, renderLines()));

      return h('div', null,
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          toolbar(false),
          terminal(boxRef, { maxHeight: '260px', overflow: 'auto' }, props.job?.label ?? '')),
        full
          ? h('div', { style: jobStyles.modalMask, onClick: (e) => { if (e.target === e.currentTarget) setFull(false); } },
            h('div', { style: jobStyles.modalBox },
              h('div', { style: jobStyles.modalHead },
                h('strong', { style: { flex: '1 1 auto', fontSize: '13px' } }, props.job?.label ?? 'log'),
                h('button', { type: 'button', style: jobStyles.minibtn, onClick: () => setFull(false) }, '✕')),
              toolbar(true),
              terminal(modalBoxRef, { flex: '1 1 auto', overflow: 'auto', borderRadius: '0 0 8px 8px' }, props.job?.label ?? '')))
          : null);
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
      const ctx = props.ctx;
      const visible = props.visible !== false;
      const sessionId = String(scope.sessionId ?? '');
      // betterSidebar passes a jump-to-conversation callback for tabs; use it to
      // offer "go to the originating conversation" on each job / group.
      // "Go to conversation" opens the owning conversation in the MAIN view.
      // Do NOT use onSubagentJump: that callback opens a *subagent* tab
      // (service.openTab({ type: 'subagent' })), i.e. the Tasks page — not the
      // conversation. The correct path (per betterSidebar's own builtin) is the
      // workspace face's `openSession`, which owns main-view selection.
      const jumpTo = (targetSessionId) => {
        if (!targetSessionId || targetSessionId === sessionId) return;
        try {
          const workspace = ctx && typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
          if (workspace && typeof workspace.openSession === 'function') {
            workspace.openSession(targetSessionId);
            return;
          }
          const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
          if (sessions && typeof sessions.open === 'function') {
            sessions.open(targetSessionId);
            return;
          }
        } catch (err) {
          try { console.error('[dsh-shell-switch] open conversation failed:', err); } catch {}
        }
      };
      const [view, setView] = React.useState('session'); // 'session' | 'all'
      const [data, setData] = React.useState(null); // { active, groups, total } or { jobs }
      const [error, setError] = React.useState(null);
      const [expanded, setExpanded] = React.useState(() => new Set());
      const [openLog, setOpenLog] = React.useState(null); // jobId
      const [logText, setLogText] = React.useState({});
      const [logFollow, setLogFollow] = React.useState(true); // auto-scroll to newest
      const [logFull, setLogFull] = React.useState(false); // fullscreen modal
      const [busy, setBusy] = React.useState({});
      const collapsed = React.useRef(new Set());
      // Per-job read offsets live in a ref, not state: advancing the offset must
      // not re-run the polling effect (which state would, causing tight refetch
      // loops). The effect reads/writes this ref only.
      const logOffsetRef = React.useRef({});

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

      // Poll the open job's log. Offset is kept in a ref so advancing it does
      // not restart this effect; the effect depends only on which job is open.
      React.useEffect(() => {
        if (openLog === null || !visible) return undefined;
        const jobId = openLog;
        let cancelled = false;
        const tick = async () => {
          try {
            const offset = logOffsetRef.current[jobId] ?? 0;
            const read = await request(`/jobs/${encodeURIComponent(jobId)}/log?offset=${offset}`);
            if (cancelled) return;
            if (typeof read.text === 'string' && read.text.length > 0) {
              setLogText((prev) => ({ ...prev, [jobId]: (prev[jobId] ?? '') + read.text }));
            }
            logOffsetRef.current[jobId] = typeof read.offset === 'number' ? read.offset : offset;
          } catch {
            // A missing log file (just started) is not an error worth surfacing.
          }
        };
        void tick();
        const timer = setInterval(() => { void tick(); }, 1500);
        return () => { cancelled = true; clearInterval(timer); };
      }, [openLog, visible]);

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
        const canJump = Boolean(job.sessionId) && job.sessionId !== sessionId;
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
              h('div', { style: jobStyles.meta }, `${job.shellLabel ? `${job.shellLabel} · ` : ''}${job.cwd}`),
              h(LogView, {
                job,
                t,
                text: logText[job.id] ?? '',
              }))
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
        const canJump = Boolean(options.ownerId) && options.ownerId !== sessionId;
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
