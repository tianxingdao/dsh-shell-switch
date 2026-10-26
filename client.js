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
    };

    /** Simplified Chinese copy for the Shell selector page. */
    const zh = {
      nav: 'Shell',
      title: 'Shell 选择器',
      description: '选择 bash 工具实际调用的本机 shell。保存后下一条命令即生效，不需要重启。',
      shell: 'Shell 可执行文件',
      compatible: '可用于 bash',
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
    };

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

      const load = React.useCallback(async (force) => {
        setBusy(true);
        setError(null);
        try {
          const next = await request(force === true ? '/state?refresh=1' : '/state');
          setState(next);
          setDraft(next.selected?.path ?? next.effective?.path ?? '');
        } catch (failure) {
          setError(`${t('loadFailed')}：${failure.message}`);
        } finally {
          setBusy(false);
        }
      }, [t]);

      React.useEffect(() => { load(false); }, [load]);

      const save = async () => {
        if (draft === '') return;
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const next = await request('/select', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: draft }),
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
      const compatible = shells.filter((shell) => shell.compatible === true);
      const others = shells.filter((shell) => shell.compatible !== true);
      const dirty = draft !== (state.selected?.path ?? '');
      const currentValue = state.selected?.path ?? '';

      const groups = [];
      if (compatible.length > 0) groups.push(h('optgroup', { key: 'compatible', label: t('compatible') },
        compatible.map((shell) => h('option', { key: shell.path, value: shell.path },
          `${shell.label}${shell.version ? ` · ${shell.version}` : ''}`))));
      if (others.length > 0) groups.push(h('optgroup', { key: 'others', label: t('other') },
        others.map((shell) => h('option', { key: shell.path, value: shell.path, disabled: true },
          `${shell.label}（${t('incompatible')}）`))));

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
          h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => load(true) }, t('refresh'))),
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
            h('p', { style: styles.hint }, t('sandboxHint')))
          : h('p', { style: styles.error }, t('empty')),
        state.warning ? h('p', { style: styles.error }, state.warning) : null,
        state.pwsh?.hidden === true ? h('p', { style: styles.hint }, t('pwshHiddenNote')) : null,
        h('p', { style: styles.hint }, `${t('settingsFile')}：${state.settingsFile}`));
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
      },
    };
  },
});
