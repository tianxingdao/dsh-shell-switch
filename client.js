window.__ModuleLoader__.load({
  id: 'dsh-shell-switch',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'settings.shell-switch';

    // Optional integration presence is reactive: better-sidebar may load after
    // this settings page is already mounted.
    let betterSidebarPresent = false;
    const presenceListeners = new Set();
    let terminalService;
    const setBetterSidebarPresent = (value) => {
      betterSidebarPresent = value;
      for (const listener of presenceListeners) listener();
    };
    function useBetterSidebarPresent() {
      const [present, setPresent] = React.useState(betterSidebarPresent);
      React.useEffect(() => {
        const listener = () => setPresent(betterSidebarPresent);
        presenceListeners.add(listener);
        return () => presenceListeners.delete(listener);
      }, []);
      return present;
    }
    /** Keep the terminal client's remembered default aligned when following. */
    function syncTerminalPreference(state) {
      const path = state?.terminal?.selectedPath;
      if (state?.terminal?.follow === true && typeof path === 'string' && path.length > 0) {
        try { terminalService?.selectShell?.(path); } catch { /* optional integration */ }
      }
    }

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
      terminalFollow: 'New sidebar terminals follow this shell selection',
      terminalFollowHint: 'The terminal dropdown also lists every shell detected here. Following applies to newly opened terminals; close and reopen an existing terminal to change its shell. An explicit choice in the terminal dropdown still wins.',
      terminalFollowSaved: 'Terminal following preference saved.',
      terminalFollowFailed: 'Could not save the terminal preference',
      manualLabel: 'Or enter a shell path manually',
      manualPlaceholder: 'e.g. D:\\tools\\git\\bin\\bash.exe',
      manualUse: 'Add this path',
      manualHint: 'Use this when auto-detection misses your shell. The path is validated (must exist and be a bash-family shell or PowerShell) and added to the dropdown above — pick it there and Save.',
      manualGroup: 'Manually added',
      manualTag: 'manual',
      manualRemove: 'Remove',
      added: 'Added to the list. Pick it in the dropdown above, then Save.',
      removed: 'Removed.',
      addFailed: 'Could not add the path',
      loading: 'Detecting local shells…',
      empty: 'No shell detected on this machine.',
      incompatible: 'not bash-compatible',
      saveFailed: 'The change was not accepted',
      loadFailed: 'Could not read the shell list',
      settingsFile: 'Saved in',
      pwshHiddenNote: 'While this plugin is active, on Windows the shipped pwsh tool is hidden from every Agent; disable or remove the plugin to bring it back.',
      note: 'Note',
      embGroup: 'Built-in bash (bundled)',
      embTitle: 'Built-in Niubash (bash)',
      embStateInstalled: 'Installed',
      embStateMissing: 'Not installed',
      embExplain: 'A self-contained bash shipped by this plugin — no separate Niubash/Git Bash install needed. On Windows it is the ready-to-go option; on Linux/macOS your system bash already works, so this is optional.',
      embInstall: 'Download built-in bash',
      embRemove: 'Remove built-in bash',
      embWorking: 'Working…',
      embInstalled: 'Built-in bash installed',
      embRemoved: 'Built-in bash removed',
      embFailed: 'Built-in bash action failed',
      embNotInstalled: 'not installed',
      embCheck: 'Check for updates',
      embChecking: 'Checking…',
      embUpToDate: 'Up to date',
      embAvailable: 'Update available',
      embUpdate: 'Update',
      embUpdating: 'Updating…',
      embRollback: 'Roll back',
      embRollingBack: 'Rolling back…',
      embUnknown: 'Check failed (retry)',
      embLatest: 'latest',
      embCurrent: 'current',
      embUpdated: 'Built-in bash updated',
      embRolledBack: 'Rolled back',
      embVersion: 'Version',
      embVersions: 'Installed versions',
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
      bgAdopted: 'adopted after restart',
      bgJobId: 'job id',
      bgStopping: 'stopping',
      bgEmpty: 'No background jobs yet.',
      bgEmptySession: 'No background jobs in this conversation.',
      bgKill: 'Stop',
      bgKilling: 'Stopping…',
      bgOpenLog: 'Log',
      bgCloseLog: 'Hide log',
      bgLoadingLog: 'Loading…',
      bgLogEmpty: 'No output.',
      bgOtherSessions: 'Other conversations',
      bgNoOwner: 'No owner',
      bgJump: 'Open conversation',
      bgOtherHint: 'Other conversations have',
      bgViewAll: 'view all',
      bgRunningGroup: 'Running',
      bgStoppedGroup: 'Stopped',
      bgCleanup: 'Clear',
      bgCleanupStopped: 'Clear stopped',
      bgCleanupHint: 'Delete finished jobs and their logs (running jobs are kept)',
      bgCleanupFailed: 'Cleanup failed',
      bgAutoCleanup: 'Auto-clean stopped (global)',
      bgAutoKeep: 'keep newest across all conversations',
      bgAutoHint: 'Across ALL conversations combined, keep only the newest N stopped jobs; older ones and their logs are deleted automatically. Running jobs are never touched',
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
      cardCommand: 'Command',
      cardOutput: 'Output',
      cardRunning: 'Running',
      cardExit: 'exit',
      cardInspect: 'Inspect',
      cardNoOutput: '(no output)',
      bgHideQuick: 'Hide quick one-shot jobs',
      bgQuickHidden: 'quick one-shot job(s) hidden',
      bgQuickShow: 'Show',
      bgQuickOnly: 'Only quick one-shot commands here. Long-running services (java, node, go, python, web) appear once they start.',
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
      terminalFollow: '新建侧边终端跟随这里的 Shell 选择',
      terminalFollowHint: '终端下拉框也会列出这里检测到的 Shell。跟随只对新建的终端生效；已有终端需关闭后重开。你在终端下拉里单独选择的 Shell 仍优先。',
      terminalFollowSaved: '终端跟随设置已保存。',
      terminalFollowFailed: '终端跟随设置保存失败',
      manualLabel: '或手动输入 shell 路径',
      manualPlaceholder: '例如 D:\\tools\\git\\bin\\bash.exe',
      manualUse: '添加此路径',
      manualHint: '自动检测漏掉你的 shell 时用这个。路径会被校验（必须存在、是 bash 方言或 PowerShell），并添加到上方下拉框——在上方选中它再点保存。',
      manualGroup: '手动添加',
      manualTag: '手动',
      manualRemove: '移除',
      added: '已添加到列表，请在上方下拉框选中它再点保存。',
      removed: '已移除。',
      addFailed: '添加路径失败',
      loading: '正在检测本机 shell…',
      empty: '本机未检测到任何 shell。',
      incompatible: '不兼容 bash',
      saveFailed: '修改未被接受',
      loadFailed: '读取 shell 列表失败',
      settingsFile: '保存位置',
      pwshHiddenNote: '本插件启用期间，如果是 Windows 环境，官方 pwsh 工具对所有 Agent 隐藏；停用或卸载本插件即可恢复。',
      note: '说明',
      embGroup: '内置 bash（插件自带）',
      embTitle: '内置 Niubash（bash）',
      embStateInstalled: '已安装',
      embStateMissing: '未安装',
      embExplain: '本插件自带的 bash，无需另装 Niubash / Git Bash。Windows 上开箱即用；Linux/macOS 系统已有 bash，此项为可选项。',
      embInstall: '下载内置 bash',
      embRemove: '移除内置 bash',
      embWorking: '处理中…',
      embInstalled: '内置 bash 已安装',
      embRemoved: '内置 bash 已移除',
      embFailed: '内置 bash 操作失败',
      embNotInstalled: '未安装',
      embCheck: '检查更新',
      embChecking: '检查中…',
      embUpToDate: '已是最新',
      embAvailable: '有新版本',
      embUpdate: '更新',
      embUpdating: '更新中…',
      embRollback: '回退',
      embRollingBack: '回退中…',
      embUnknown: '检查失败（可重试）',
      embLatest: '最新',
      embCurrent: '当前',
      embUpdated: '内置 bash 已更新',
      embRolledBack: '已回退',
      embVersion: '版本',
      embVersions: '已安装版本',
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
      bgAdopted: '重启后接续',
      bgJobId: '任务 id',
      bgStopping: '停止中',
      bgEmpty: '暂无后台任务。',
      bgEmptySession: '本会话暂无后台任务。',
      bgKill: '停止',
      bgKilling: '停止中…',
      bgOpenLog: '日志',
      bgCloseLog: '收起日志',
      bgLoadingLog: '加载中…',
      bgLogEmpty: '暂无输出（该命令没有产生日志）。',
      bgOtherSessions: '其它会话',
      bgNoOwner: '无归属',
      bgJump: '前往会话',
      bgOtherHint: '其它会话还有',
      bgViewAll: '查看全部',
      bgRunningGroup: '运行中',
      bgStoppedGroup: '已停止',
      bgCleanup: '清理',
      bgCleanupStopped: '清理已停止',
      bgCleanupHint: '删除已结束的任务及其日志（运行中的任务会保留）',
      bgCleanupFailed: '清理失败',
      bgAutoCleanup: '自动清理已停止（全局）',
      bgAutoKeep: '所有会话合计保留最近',
      bgAutoHint: '对所有会话合计只保留最新 N 个已停止任务；更早的任务及其日志自动删除，运行中的任务不受影响',
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
      cardCommand: '命令',
      cardOutput: '输出',
      cardRunning: '运行中',
      cardExit: '退出码',
      cardInspect: '检查调用',
      cardNoOutput: '（无输出）',
      bgHideQuick: '隐藏快速结束的一次性命令',
      bgQuickHidden: '条快速结束的任务已隐藏',
      bgQuickShow: '显示',
      bgQuickOnly: '当前只有快速结束的一次性命令。java / node / go / python / web 这类长时服务启动后会出现在这里。',
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
      input: {
        flex: '1 1 260px',
        minWidth: '200px',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      manualList: { display: 'grid', gap: '4px', marginTop: '2px' },
      manualItem: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      miniRemove: {
        padding: '2px 8px',
        fontSize: '11px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      },
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
      toggle: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
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
      const [embBusy, setEmbBusy] = React.useState(false);
      const [embMsg, setEmbMsg] = React.useState(null);
      const [embCheck, setEmbCheck] = React.useState(null);
      const [embOp, setEmbOp] = React.useState(null);
      const [manualPath, setManualPath] = React.useState('');
      const betterSidebar = useBetterSidebarPresent();

      /** Install or remove the embedded Niubash, then refresh the shell list. */
      const embeddedAction = async (action) => {
        setEmbBusy(true);
        setError(null);
        setEmbMsg(null);
        try {
          const res = await request(`/embedded/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (action === 'install') {
            setEmbMsg(res.ok ? `${t('embInstalled')}${res.path ? `：${res.path}` : ''}` : `${t('embFailed')}：${res.error ?? ''}`);
          } else {
            setEmbMsg(t('embRemoved'));
          }
          await load(true);
        } catch (failure) {
          setEmbMsg(`${t('embFailed')}：${failure.message}`);
        } finally {
          setEmbBusy(false);
        }
      };

      /** Check GitHub for a newer embedded Niubash (read-only; never downloads). */
      const checkEmbUpdate = async () => {
        setEmbCheck('busy');
        setEmbMsg(null);
        try {
          const res = await request('/embedded/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          setEmbCheck(res);
          if (res.status === 'unknown') setEmbMsg(`${t('embUnknown')}${res.error ? `：${res.error}` : ''}`);
        } catch (failure) {
          setEmbCheck({ status: 'unknown', error: failure.message });
          setEmbMsg(`${t('embUnknown')}：${failure.message}`);
        }
      };

      /** Download + switch to the latest embedded Niubash (manual click only). */
      const updateEmb = async () => {
        setEmbOp('update');
        setEmbMsg(null);
        try {
          const res = await request('/embedded/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (res.ok) {
            setEmbMsg(`${t('embUpdated')}：v${res.version}${res.previous ? `（${t('embCurrent')} ${res.previous}）` : ''}`);
            setEmbCheck({ status: 'up-to-date', current: res.version, latest: res.version });
            await load(true);
          } else {
            setEmbMsg(`${t('embFailed')}：${res.error ?? ''}`);
          }
        } catch (failure) {
          setEmbMsg(`${t('embFailed')}：${failure.message}`);
        } finally {
          setEmbOp(null);
        }
      };

      /** Roll back to the previously installed embedded Niubash version. */
      const rollbackEmb = async () => {
        setEmbOp('rollback');
        setEmbMsg(null);
        try {
          const res = await request('/embedded/rollback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (res.ok) {
            setEmbMsg(`${t('embRolledBack')}：v${res.version}`);
            setEmbCheck({ status: 'unknown', current: res.version });
            await load(true);
          } else {
            setEmbMsg(`${t('embFailed')}：${res.error ?? ''}`);
          }
        } catch (failure) {
          setEmbMsg(`${t('embFailed')}：${failure.message}`);
        } finally {
          setEmbOp(null);
        }
      };

      const load = React.useCallback(async (force, settle) => {
        setBusy(true);
        setError(null);
        try {
          const tail = settle === true ? '/state?refresh=1&settle=1' : force === true ? '/state?refresh=1' : '/state';
          const next = await request(tail);
          setState(next);
          syncTerminalPreference(next);
          setDraft(next.selected?.path ?? next.effective?.path ?? '');
          // Surface a startup update-check result without requiring a click.
          const lc = next?.embedded?.lastCheck;
          if (lc && typeof lc === 'object' && typeof lc.status === 'string') {
            setEmbCheck((prev) => (prev === 'busy' ? prev : lc));
          }
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
          syncTerminalPreference(next);
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
          syncTerminalPreference(next);
          setDraft(next.effective?.path ?? '');
          setMessage(t('resetDone'));
        } catch (failure) {
          setError(`${t('saveFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      };

      const toggleTerminalFollow = async (follow) => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const next = await request('/terminal/follow', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ follow }),
          });
          setState(next);
          syncTerminalPreference(next);
          setMessage(t('terminalFollowSaved'));
        } catch (failure) {
          setError(`${t('terminalFollowFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      };

      const addManual = async () => {
        const value = manualPath.trim();
        if (value === '') return;
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          // Add the path to the picker (does not switch to it); the user then
          // selects it in the dropdown and saves.
          const next = await request('/custom/add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: value }),
          });
          setState(next);
          setManualPath('');
          setMessage(t('added'));
        } catch (failure) {
          setError(`${t('addFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      };

      const removeManual = async (value) => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const next = await request('/custom/remove', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: value }),
          });
          setState(next);
          setMessage(t('removed'));
        } catch (failure) {
          setError(`${t('addFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      };

      if (state === null) {
        return h('div', { style: styles.page }, h('p', { style: styles.description }, busy || error === null ? t('loading') : error));
      }

      const shells = Array.isArray(state.shells) ? state.shells : [];
      const isPs = (shell) => shell.dialect === 'powershell' || shell.kind === 'powershell';
      const isEmbedded = (shell) => shell.id === 'embedded-niu' || shell.source === 'embedded';
      const isManual = (shell) => shell.manual === true;
      const embedded = shells.find(isEmbedded) ?? null;
      // A locally-installed Niubash stays a normal bash-family shell and lives
      // in the generic "can runs bash" group — only the plugin's OWN embedded
      // bash gets a separate group. Manually-added paths get their own group.
      const manual = shells.filter((shell) => isManual(shell) && shell.compatible === true);
      const compatible = shells.filter((shell) => shell.compatible === true && !isPs(shell) && !isEmbedded(shell) && !isManual(shell));
      const powershell = shells.filter((shell) => shell.compatible === true && isPs(shell) && !isManual(shell));
      const others = shells.filter((shell) => shell.compatible !== true);
      const currentValue = optionValue(state.selected ?? {});
      const dirty = draft !== currentValue;

      const groups = [];
      // The embedded Niubash gets its own group at the top — it is the
      // plugin-provided, self-contained bash, never merged with a local Niubash.
      if (embedded !== null) {
        groups.push(h('optgroup', { key: 'embedded', label: t('embGroup') },
          h('option', { key: embedded.path, value: optionValue(embedded), disabled: embedded.installed === false },
            `${embedded.label}${embedded.version ? ` · ${embedded.version}` : ''}${embedded.installed === false ? `（${t('embNotInstalled')}）` : ''}`)));
      }
      // Manually-added paths first (right under embedded) so the user sees the
      // path they just added.
      if (manual.length > 0) groups.push(h('optgroup', { key: 'manual', label: t('manualGroup') },
        manual.map((shell) => h('option', { key: shell.path, value: optionValue(shell) },
          `${shell.label}${shell.version ? ` · ${shell.version}` : ''}（${t('manualTag')}）`))));
      if (compatible.length > 0) groups.push(h('optgroup', { key: 'compatible', label: t('compatible') },
        compatible.map((shell) => h('option', { key: shell.path, value: optionValue(shell) },
          // Keep the option label terse: `label · version`. The longer
          // explanatory note is shown in the detail row below the picker, not
          // inline — an inline note here made rows wrap with a trailing wall of
          // text (and, before the probe fix, mojibake).
          `${shell.label}${shell.version ? ` · ${shell.version}` : ''}`))));
      if (powershell.length > 0) groups.push(h('optgroup', { key: 'powershell', label: t('powershell') },
        powershell.map((shell) => h('option', { key: shell.path, value: optionValue(shell) },
          `${shell.label}${shell.version ? ` · ${shell.version}` : ''}`))));
      if (others.length > 0) groups.push(h('optgroup', { key: 'others', label: t('other') },
        others.map((shell) => h('option', { key: shell.path, value: optionValue(shell), disabled: true },
          `${shell.label}（${t('incompatible')}）`))));

      const selectedShell = shells.find((shell) => optionValue(shell) === currentValue) ?? null;
      const embInfo = state.embedded ?? null;

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
        betterSidebar
          ? h('div', { style: styles.field },
            h('label', { style: styles.toggle },
              h('input', {
                type: 'checkbox',
                checked: state.terminal?.follow !== false,
                disabled: busy,
                onChange: (event) => toggleTerminalFollow(event.target.checked),
              }),
              h('span', null, t('terminalFollow'))),
            h('p', { style: styles.hint }, t('terminalFollowHint')))
          : null,
        // Manual path: when auto-detection misses a shell (custom build, odd
        // install location), let the user type the executable path. Adding puts
        // it into the dropdown above; you then pick it there and Save.
        h('div', { style: styles.field },
          h('label', { style: styles.label, htmlFor: 'shell-switch-manual' }, t('manualLabel')),
          h('div', { style: styles.row },
            h('input', {
              id: 'shell-switch-manual',
              type: 'text',
              style: styles.input,
              placeholder: t('manualPlaceholder'),
              value: manualPath,
              disabled: busy,
              spellCheck: false,
              onChange: (event) => setManualPath(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') addManual(); },
            }),
            h('button', { type: 'button', style: styles.primary, disabled: busy || manualPath.trim() === '', onClick: addManual }, t('manualUse'))),
          h('p', { style: styles.hint }, t('manualHint')),
          // Let the user drop a manually-added path again.
          manual.length > 0
            ? h('div', { style: styles.manualList },
                manual.map((shell) => h('div', { key: shell.path, style: styles.manualItem },
                  h('span', { style: styles.mono, title: shell.path }, shell.path),
                  h('button', {
                    type: 'button',
                    style: styles.miniRemove,
                    disabled: busy,
                    title: t('manualRemove'),
                    onClick: () => removeManual(shell.path),
                  }, t('manualRemove')))))
            : null),
        message !== null ? h('p', { style: styles.message }, message) : null,
        error !== null ? h('p', { style: styles.error }, error) : null,
        // Embedded Niubash status + install/remove/update/rollback.
        embInfo !== null && embInfo.supported === true
          ? h('div', { style: styles.card },
            h('strong', { style: styles.label }, t('embTitle')),
            h('p', { style: styles.hint },
              embInfo.installed === true
                ? `${t('embStateInstalled')} · v${embInfo.version}`
                : `${t('embStateMissing')} · v${embInfo.version}`),
            h('p', { style: styles.hint }, t('embExplain')),
            h('div', { style: styles.row },
              embInfo.installed === true
                ? h('button', { type: 'button', style: styles.button, disabled: embBusy, onClick: () => embeddedAction('remove') }, embBusy ? t('embWorking') : t('embRemove'))
                : h('button', { type: 'button', style: styles.primary, disabled: embBusy, onClick: () => embeddedAction('install') }, embBusy ? t('embWorking') : t('embInstall')),
              // Update controls only make sense once installed.
              embInfo.installed === true
                ? h('button', {
                    type: 'button',
                    style: styles.button,
                    disabled: embCheck === 'busy' || embOp !== null,
                    onClick: checkEmbUpdate,
                  }, embCheck === 'busy' ? t('embChecking') : t('embCheck'))
                : null,
              // Show Update when a newer version is known; show Roll back when an
              // older version is retained.
              embInfo.installed === true && embCheck !== null && embCheck !== 'busy' && embCheck.status === 'update-available'
                ? h('button', { type: 'button', style: styles.primary, disabled: embOp !== null, onClick: updateEmb },
                    embOp === 'update' ? t('embUpdating') : `${t('embUpdate')} → v${embCheck.latest}`)
                : null,
              embInfo.installed === true && Array.isArray(embInfo.versions) && embInfo.versions.length > 1
                ? h('button', { type: 'button', style: styles.button, disabled: embOp !== null, onClick: rollbackEmb },
                    embOp === 'rollback' ? t('embRollingBack') : t('embRollback'))
                : null),
            // Update status line.
            embCheck !== null && embCheck !== 'busy'
              ? h('p', {
                  style: embCheck.status === 'update-available' ? styles.message : styles.hint,
                },
                embCheck.status === 'update-available'
                  ? `${t('embAvailable')}：v${embCheck.current ?? '?'} → v${embCheck.latest}`
                  : embCheck.status === 'up-to-date'
                    ? `${t('embUpToDate')} · ${t('embCurrent')} v${embCheck.current ?? embInfo.version}`
                    : `${t('embUnknown')}${embCheck.error ? `：${embCheck.error}` : ''}`)
              : null,
            // Installed versions list (for transparency / rollback targets).
            embInfo.installed === true && Array.isArray(embInfo.versions) && embInfo.versions.length > 0
              ? h('p', { style: styles.hint }, `${t('embVersions')}：${embInfo.versions.join(', ')}`)
              : null,
            embMsg !== null ? h('p', { style: styles.message }, embMsg) : null)
          : null,
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
    /** Parse the actual shell identity recorded by the Host executor. */
    function executionFacts(text) {
      const source = String(text ?? '');
      return {
        label: /^\[shell: ([^\]]+)\]$/m.exec(source)?.[1],
        path: /^\[shell-path: ([^\]]*)\]$/m.exec(source)?.[1],
      };
    }

    /** The execution markers belong in the badge, not in the output body. */
    function stripExecutionFacts(text) {
      return String(text ?? '').split('\n')
        .filter((line) => !/^\[shell: [^\]]+\]$/.test(line) && !/^\[shell-path: [^\]]*\]$/.test(line))
        .join('\n');
    }

    /** Parse the stock final exit/signal marker without changing its contract. */
    function executionExit(text, settled, isError) {
      const signal = /(?:^|\n)\[killed by signal: ([^\]\n]+)\]\s*$/.exec(text);
      if (signal !== null) return { output: text.slice(0, signal.index), signal: signal[1], exitCode: undefined };
      const exit = /(?:^|\n)\[exit code: (\d+)\]\s*$/.exec(text);
      if (exit !== null) return { output: text.slice(0, exit.index), signal: undefined, exitCode: Number(exit[1]) };
      return { output: text, signal: undefined, exitCode: settled && !isError ? 0 : undefined };
    }

    function cardDisplayCwd(workdir, sessionCwd) {
      const base = workdir || sessionCwd || '';
      if (!workdir || !sessionCwd || /^(?:[A-Za-z]:|[/\\])/.test(workdir)) return base;
      return `${sessionCwd.replace(/[/\\]+$/, '')}${sessionCwd.includes('\\') ? '\\' : '/'}${workdir}`;
    }

    const toolCardStyles = {
      root: { padding: '3px 0', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '20px' },
      row: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, cursor: 'pointer', userSelect: 'none' },
      chevron: { width: '12px', flex: 'none', color: 'var(--dsw-alias-label-secondary)', fontFamily: 'monospace' },
      tool: { flex: 'none', color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
      summary: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: { flex: 'none', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 7px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-1)', fontSize: '11px', lineHeight: '18px' },
      exit: { flex: 'none', fontFamily: 'ui-monospace, monospace', fontSize: '11px', lineHeight: '18px' },
      body: { margin: '5px 0 7px 19px', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)' },
      meta: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' },
      sectionLabel: { padding: '6px 10px 0', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px' },
      pre: { margin: 0, padding: '7px 10px 9px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: '18px' },
      output: { borderTop: '1px solid var(--dsw-alias-border-l1)', maxHeight: '360px', overflow: 'auto' },
      actions: { display: 'flex', gap: '6px', padding: '6px 10px', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      action: { padding: '2px 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '11px' },
    };

    /**
     * Shell tool row with the actual execution identity, cwd and exit status.
     * The stock card remains responsible for every other tool; this keyed view
     * is registered only for bash/pwsh.
     */
    function ShellToolCard(props) {
      const t = props.t;
      const block = props.block ?? {};
      const settled = props.phase === 'result';
      const call = block.call ?? block;
      let args = call.args && typeof call.args === 'object' ? call.args : null;
      if (args === null && typeof call.argsRaw === 'string') {
        try {
          const parsed = JSON.parse(call.argsRaw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
        } catch { /* preparing args may be incomplete */ }
      }
      const command = typeof args?.command === 'string' ? args.command : '';
      const description = typeof args?.description === 'string' ? args.description : '';
      const raw = (block.content ?? []).map((part) => part.type === 'text' ? part.text : '').filter(Boolean).join('\n');
      const facts = executionFacts(raw);
      const isError = block.isError === true || block.error !== undefined;
      const tail = executionExit(stripExecutionFacts(raw), settled, isError);
      const cwd = cardDisplayCwd(args?.workdir, props.cwd);
      const disclosure = props.useDisclosure();
      const [fallbackOpen, setFallbackOpen] = React.useState(false);
      const expanded = disclosure?.expanded ?? fallbackOpen;
      const toggle = disclosure?.toggle ?? (() => setFallbackOpen((value) => !value));
      const [copied, setCopied] = React.useState('');
      const copy = async (key, text, event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(key);
        } catch { /* clipboard may be unavailable */ }
      };
      const expandable = command !== '' || raw !== '';
      const open = expanded && expandable;
      const failed = isError || tail.signal !== undefined || (tail.exitCode !== undefined && tail.exitCode !== 0);
      const exitLabel = tail.signal !== undefined ? tail.signal : tail.exitCode !== undefined ? `${t('cardExit')} ${tail.exitCode}` : '';
      const shellBadge = facts.label
        ? h('span', { key: 'shell', style: toolCardStyles.badge, title: facts.path || facts.label }, facts.label)
        : null;
      const actionButton = (key, label, text) => h('button', {
        key, type: 'button', style: toolCardStyles.action,
        onClick: (event) => copy(key, text, event),
      }, copied === key ? t('bgCopied') : label);

      return h('div', { style: toolCardStyles.root },
        h('div', {
          style: toolCardStyles.row,
          role: expandable ? 'button' : undefined,
          tabIndex: expandable ? 0 : undefined,
          'aria-expanded': expandable ? open : undefined,
          onClick: expandable ? toggle : undefined,
          onKeyDown: expandable ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
          } : undefined,
        },
          h('span', { style: toolCardStyles.chevron }, expandable ? (open ? '▾' : '▸') : '›'),
          h('span', { style: toolCardStyles.tool }, props.toolName),
          shellBadge,
          h('span', { style: { ...toolCardStyles.summary, ...(failed ? { color: 'var(--dsw-alias-state-error-primary)' } : {}) } },
            description || (!settled ? t('cardRunning') : command)),
          exitLabel ? h('span', { style: { ...toolCardStyles.exit, color: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' } }, exitLabel) : null),
        open
          ? h('div', { style: toolCardStyles.body },
            h('div', { style: toolCardStyles.meta },
              shellBadge,
              cwd ? h('span', { style: toolCardStyles.mono, title: cwd }, cwd) : null,
              facts.path ? h('span', { style: toolCardStyles.mono, title: facts.path }, facts.path) : null),
            command ? h('div', null,
              h('div', { style: toolCardStyles.sectionLabel }, t('cardCommand')),
              h('pre', { style: toolCardStyles.pre }, command)) : null,
            settled ? h('div', { style: toolCardStyles.output },
              h('div', { style: toolCardStyles.sectionLabel }, t('cardOutput')),
              h('pre', { style: { ...toolCardStyles.pre, ...(isError ? { color: 'var(--dsw-alias-state-error-primary)' } : {}) } },
                tail.output.trim() === '' ? t('cardNoOutput') : tail.output.replace(/\n+$/, ''))) : null,
            h('div', { style: toolCardStyles.actions },
              command ? actionButton('command', `${t('bgCopy')} ${t('cardCommand')}`, command) : null,
              settled ? actionButton('output', `${t('bgCopy')} ${t('cardOutput')}`, tail.output) : null,
              typeof props.inspect === 'function' ? h('button', {
                type: 'button', style: toolCardStyles.action,
                onClick: (event) => { event.stopPropagation(); props.inspect(); },
              }, t('cardInspect')) : null))
          : null);
    }

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
      dot: (status) => ({ width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto', background: status === 'running' ? 'var(--dsw-alias-state-success-primary)' : status === 'failed' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' }),
      label: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      statusText: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' },
      idTag: { fontSize: '10.5px', color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', flex: '0 0 auto', opacity: 0.75 },
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
      subHead: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px 3px 20px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      subHeadLabel: { fontWeight: 600, letterSpacing: '0.02em' },
      autoRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 10px', borderTop: '1px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' },
      autoLabel: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
      autoNum: { width: '48px', padding: '2px 5px', fontSize: '11px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' },
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
      const loading = props.loading === true;
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
          return [h('div', { key: 'empty', style: { color: '#8b949e', padding: '4px 10px' } }, loading ? t('bgLoadingLog') : t('bgLogEmpty'))];
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
      const [logLoaded, setLogLoaded] = React.useState({}); // successful read, even when empty
      const [logFollow, setLogFollow] = React.useState(true); // auto-scroll to newest
      const [logFull, setLogFull] = React.useState(false); // fullscreen modal
      const [busy, setBusy] = React.useState({});
      const [autoCleanup, setAutoCleanup] = React.useState({ enabled: false, keep: 20 });
      // Quick one-shot commands (finished successfully within seconds) are noise
      // for this panel: it exists to watch long-running services. Hidden by
      // default, and the choice sticks across sessions.
      const [showQuick, setShowQuick] = React.useState(() => {
        try { return window.localStorage.getItem('dsh-shell-switch:showQuick') === '1'; } catch { return false; }
      });
      const toggleShowQuick = () => setShowQuick((value) => {
        const next = !value;
        try { window.localStorage.setItem('dsh-shell-switch:showQuick', next ? '1' : '0'); } catch { /* private mode */ }
        return next;
      });
      /** Split a job list into what the panel shows and what it hides. */
      const splitQuick = (jobs) => {
        if (!Array.isArray(jobs)) return { visible: [], hidden: 0 };
        if (showQuick) return { visible: jobs, hidden: 0 };
        const visible = jobs.filter((job) => job.quickSuccess !== true);
        return { visible, hidden: jobs.length - visible.length };
      };
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
          if (next && next.autoCleanup) setAutoCleanup(next.autoCleanup);
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
            // A successful empty read is a completed load, not perpetual
            // "Loading…": stopped commands often legitimately produce no log.
            setLogLoaded((prev) => ({ ...prev, [jobId]: true }));
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

      const removeJob = async (jobId) => {
        setBusy((prev) => ({ ...prev, [jobId]: true }));
        try {
          await request(`/jobs/${encodeURIComponent(jobId)}/remove`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          // Forget this job's cached log so a same-named future job starts clean.
          setOpenLog((cur) => (cur === jobId ? null : cur));
          setLogText((prev) => { const copy = { ...prev }; delete copy[jobId]; return copy; });
          setLogLoaded((prev) => { const copy = { ...prev }; delete copy[jobId]; return copy; });
          delete logOffsetRef.current[jobId];
          await load();
        } catch (failure) {
          setError(`${t('bgCleanupFailed')}：${failure.message}`);
        } finally {
          setBusy((prev) => ({ ...prev, [jobId]: false }));
        }
      };

      /** Delete every stopped job in this conversation (or all in 全部 view). */
      const cleanupStopped = async (sessionIdArg) => {
        try {
          await request('/jobs/cleanup', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(typeof sessionIdArg === 'string' && sessionIdArg.length > 0 ? { session: sessionIdArg } : {}),
          });
          setOpenLog(null);
          await load();
        } catch (failure) {
          setError(`${t('bgCleanupFailed')}：${failure.message}`);
        }
      };

      const updateAutoCleanup = async (next) => {
        const merged = { enabled: next.enabled !== undefined ? next.enabled : autoCleanup.enabled, keep: next.keep !== undefined ? next.keep : autoCleanup.keep };
        setAutoCleanup(merged);
        try {
          const applied = await request('/jobs/auto-cleanup', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(merged),
          });
          setAutoCleanup({ enabled: applied.enabled, keep: applied.keep });
          await load();
        } catch (failure) {
          setError(`${t('bgCleanupFailed')}：${failure.message}`);
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
          default: return t('bgExited');
        }
      };

      const renderJob = (job, showOwner) => {
        const isOpen = openLog === job.id;
        const live = job.status === 'running' || job.status === 'stopping' || job.status === 'orphan';
        const owner = sessionLabel(job);
        const canJump = Boolean(job.sessionId) && job.sessionId !== sessionId;
        // A short id + pid so two same-named jobs (e.g. a dead record and the
        // live one) are distinguishable at a glance.
        const shortId = String(job.id ?? '').replace(/^bg-/, '');
        return h('div', { key: job.id },
          h('div', { style: jobStyles.row },
            h('span', { style: jobStyles.dot(job.status), title: statusLabel(job.status) }),
            h('span', { style: jobStyles.label, title: job.command ?? job.label }, job.label),
            h('span', { style: jobStyles.idTag, title: `${t('bgJobId')} ${job.id} · pid ${job.pid ?? '?'}` }, `#${shortId}${job.pid ? ` · ${job.pid}` : ''}`),
            showOwner === true && owner
              ? h('span', { style: jobStyles.statusText, title: `session ${job.sessionId}` }, owner)
              : null,
            h('span', { style: jobStyles.statusText }, `${statusLabel(job.status)}${job.adopted ? ` · ${t('bgAdopted')}` : ''} · ${elapsed(job.startedAt, job.endedAt)}`),
            canJump ? h('button', { type: 'button', style: jobStyles.jumpbtn, title: t('bgJump'), onClick: () => { try { jumpTo(job.sessionId); } catch {} } }, t('bgJump')) : null,
            h('button', { type: 'button', style: jobStyles.minibtn, onClick: () => toggleLog(job.id) }, isOpen ? t('bgCloseLog') : t('bgOpenLog')),
            live
              ? h('button', { type: 'button', style: jobStyles.minibtn, disabled: busy[job.id] === true, onClick: () => kill(job.id) }, busy[job.id] ? t('bgKilling') : t('bgKill'))
              : h('button', { type: 'button', style: jobStyles.minibtn, disabled: busy[job.id] === true, title: t('bgCleanupHint'), onClick: () => removeJob(job.id) }, t('bgCleanup'))),
          isOpen
            ? h('div', null,
              h('div', { style: jobStyles.meta }, `${job.shellLabel ? `${job.shellLabel} · ` : ''}${job.cwd}`),
              h(LogView, {
                job,
                t,
                text: logText[job.id] ?? '',
                loading: logLoaded[job.id] !== true,
              }))
            : null);
      };

      /** Is a job live (running/stopping/orphan)? */
      const isLive = (job) => job.status === 'running' || job.status === 'stopping' || job.status === 'orphan';

      /**
       * One conversation group. Inside it jobs split into a RUNNING section and
       * a STOPPED section, each with its own sub-header. The stopped header
       * carries a "clean up" action; live jobs are never cleaned. `ownerId`
       * (another conversation) makes the header a jump target too.
       */
      const renderGroup = (key, title, jobs, opts) => {
        if (!Array.isArray(jobs) || jobs.length === 0) return null;
        const options = opts ?? {};
        const collapsible = options.collapsible === true;
        const current = options.current === true;
        const isCollapsed = collapsible && collapsed.current.has(key);
        const canJump = Boolean(options.ownerId) && options.ownerId !== sessionId;
        const live = jobs.filter(isLive);
        const stopped = jobs.filter((job) => !isLive(job));

        const subHead = (subKey, label, count, withCleanup) => h('div', { style: jobStyles.subHead, key: subKey },
          h('span', { style: jobStyles.subHeadLabel }, label),
          h('span', { style: jobStyles.groupCount }, ` (${count})`),
          withCleanup && count > 0
            ? h('button', {
              type: 'button',
              style: jobStyles.jumpbtn,
              title: t('bgCleanupHint'),
              onClick: (e) => { e.stopPropagation(); cleanupStopped(options.cleanupSession); },
            }, t('bgCleanupStopped'))
            : null);

        return h('div', { key },
          h('div', { style: jobStyles.groupHead, onClick: collapsible ? () => toggleGroup(key) : undefined },
            collapsible ? h('span', null, isCollapsed ? '▸' : '▾') : null,
            h('span', { style: current ? { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } : null }, title),
            h('span', { style: jobStyles.groupCount }, ` (${jobs.length})`),
            canJump
              ? h('button', { type: 'button', style: jobStyles.jumpbtn, title: t('bgJump'), onClick: (e) => { e.stopPropagation(); try { jumpTo(options.ownerId); } catch {} } }, t('bgJump'))
              : null),
          isCollapsed ? null : h('div', null,
            live.length > 0 ? subHead(`${key}-run`, t('bgRunningGroup'), live.length, false) : null,
            live.length > 0 ? live.map((job) => renderJob(job, options.showOwner === true)) : null,
            stopped.length > 0 ? subHead(`${key}-stop`, t('bgStoppedGroup'), stopped.length, true) : null,
            stopped.length > 0 ? stopped.map((job) => renderJob(job, options.showOwner === true)) : null));
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
      let hiddenQuick = 0;
      let visibleTotal = 0;
      if (data !== null) {
        if (view === 'all' && Array.isArray(data.jobs)) {
          const split = splitQuick(data.jobs);
          hiddenQuick = split.hidden;
          const visible = split.visible;
          visibleTotal = visible.length;
          const byOwner = groupByOwner(visible);
          const mine = byOwner.get(sessionId) ?? [];
          byOwner.delete(sessionId);
          if (mine.length > 0) body.push(renderGroup('this', t('bgThis'), mine, { current: true, cleanupSession: sessionId }));
          let index = 0;
          for (const [owner, jobs] of byOwner) {
            index += 1;
            const title = owner ? sessionLabel(jobs[0]) || shortSession(owner) : t('bgNoOwner');
            body.push(renderGroup(`g${index}`, title, jobs, { collapsible: true, ownerId: owner, cleanupSession: owner }));
          }
          if (visible.length === 0) {
            body.push(h('div', { key: 'empty', style: jobStyles.empty }, hiddenQuick > 0 ? t('bgQuickOnly') : t('bgEmpty')));
          }
        } else if (view === 'session') {
          // This-conversation view shows ONLY this conversation's jobs. Other
          // conversations live in the 全部 view — earlier they leaked in here,
          // which read as "本会话 shows other sessions' jobs".
          const split = splitQuick(Array.isArray(data.active) ? data.active : []);
          const active = split.visible;
          hiddenQuick = split.hidden;
          visibleTotal = active.length;
          if (active.length === 0) {
            body.push(h('div', { key: 'empty', style: jobStyles.empty }, hiddenQuick > 0 ? t('bgQuickOnly') : t('bgEmptySession')));
          } else {
            body.push(renderGroup('this', t('bgThis'), active, { current: true, cleanupSession: sessionId }));
          }
          // Tell the reader when other conversations have jobs they can see in 全部.
          const otherCount = splitQuick((Array.isArray(data.groups) ? data.groups : [])
            .flatMap((g) => g.jobs ?? [])).visible.length;
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
          h('span', { style: jobStyles.statusText }, data === null ? `${total}` : `${visibleTotal}`),
          view === 'session'
            ? h('button', { type: 'button', style: jobStyles.minibtn, title: t('bgCleanupHint'), onClick: () => cleanupStopped(sessionId) }, t('bgCleanupStopped'))
            : h('button', { type: 'button', style: jobStyles.minibtn, title: t('bgCleanupHint'), onClick: () => cleanupStopped() }, t('bgCleanupStopped')),
          h('button', { type: 'button', style: jobStyles.minibtn, onClick: () => load() }, t('bgRefresh'))),
        // Auto-cleanup controls: a toggle plus the "keep N newest stopped" count.
        h('div', { style: jobStyles.autoRow },
          h('label', { style: jobStyles.autoLabel, title: t('bgAutoHint') },
            h('input', { type: 'checkbox', checked: autoCleanup.enabled === true, onChange: (e) => updateAutoCleanup({ enabled: e.target.checked }) }),
            h('span', null, t('bgAutoCleanup'))),
          autoCleanup.enabled
            ? h('span', { style: jobStyles.autoLabel },
              h('span', null, t('bgAutoKeep')),
              h('input', {
                type: 'number', min: 0, max: 999, value: autoCleanup.keep,
                style: jobStyles.autoNum,
                onChange: (e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) updateAutoCleanup({ keep: Math.max(0, n) });
                },
              }))
            : null),
        error !== null ? h('div', { style: jobStyles.err }, error) : null,
        // Quick-command filter: this panel is for watching long-running
        // services, so one-shot commands that already succeeded are folded away.
        h('div', { style: jobStyles.autoRow },
          h('label', { style: jobStyles.autoLabel, title: t('bgQuickOnly') },
            h('input', { type: 'checkbox', checked: showQuick, onChange: toggleShowQuick }),
            h('span', null, t('bgHideQuick'))),
          hiddenQuick > 0
            ? h('span', { style: jobStyles.autoLabel },
              h('span', null, `${hiddenQuick} ${t('bgQuickHidden')}`),
              h('button', { type: 'button', style: jobStyles.minibtn, onClick: () => toggleShowQuick() }, t('bgQuickShow')))
            : null),
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
        // Replace only the shell tool rows. Other tools keep the host's own
        // cards. Priority -1 intentionally shadows the shipped bash/pwsh view.
        for (const toolKey of ['bash', 'pwsh']) {
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
            { name: 'tool.call.toolview', key: toolKey, priority: -1 },
            (slotProps) => h(ShellToolCard, { ...slotProps, t }),
          ));
        }
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
            setBetterSidebarPresent(true);
            return () => setBetterSidebarPresent(false);
          }, 'dsh-shell-switch: better-sidebar presence');
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
        // The terminal client remembers a preferred shell in localStorage. Keep
        // that preference aligned while following is enabled, including when
        // the user never opens this Settings page before opening a terminal.
        ctx.inject(['webTerminals'], (serviceCtx) => {
          serviceCtx.effect(() => {
            const service = serviceCtx.webTerminals ?? serviceCtx.get?.('webTerminals');
            terminalService = service;
            let active = true;
            void request('/state').then((next) => {
              if (active) syncTerminalPreference(next);
            }).catch(() => {});
            return () => {
              active = false;
              if (terminalService === service) terminalService = undefined;
            };
          }, 'dsh-shell-switch: terminal preference sync');
        });
      },
    };
  },
});
