/**
 * Plugin Butler — browser half.
 *
 * A settings page that renders the live plugin inventory served by ./index.js
 * and flips rows through the same-origin JSON routes. Plain JS + React: no
 * build step, no Harness client package imports, only theme tokens for colour.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-butler',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback
    const useRef = React.useRef

    const NS = 'dsh-plugin-butler'
    const API = '/dsh-butler/api'
    const POLL_MS = 4000

    const ZH = {
      nav: '插件管家',
      subtitle: '所有插件的总开关：精简启动、按需启用，下次启动自动收起。',
      modeLabel: '启动策略',
      modeObserve: '手动',
      modeObserveDesc: '只提供清单和开关，不自动改动任何插件。',
      modeLean: '精简启动',
      modeLeanDesc: '启动只载核心插件；本次打开的插件，下次启动自动收起。',
      modeAll: '全部载入',
      modeAllDesc: '每次启动都拉起全部插件。功能最全，启动最慢。',
      actLean: '立即精简',
      actAll: '全部启用',
      actRefresh: '刷新',
      busy: '处理中…',
      on: '已启用',
      off: '已停用',
      pin: '常驻，不自动停用',
      pinned: '常驻',
      pinShort: '常驻',
      core: '核心',
      selfBadge: '管家自身',
      selfLocked: '管家自身，请到插件市场里切换',
      expand: '展开包内模块',
      collapse: '收起包内模块',
      rowDetached: '未挂载',
      leased: '本次',
      phasePending: '待加载',
      phaseLoading: '加载中',
      phaseUnloading: '停止中',
      phaseFailed: '加载失败',
      roManaged: '需在插件市场管理',
      roUnaddress: '无法定位',
      statTotal: '插件',
      statEnabled: '已启用',
      statManaged: '可管理',
      statBundles: '插件包',
      statPinned: '常驻',
      errorTitle: '出错了',
      restartHint: '有改动需要重启 DSH 才能完全生效。',
      restart: '重启 DSH',
      changed: '已处理',
      failedCount: '失败',
      restartCount: '待重启',
      warnCount: '警告',
      nothingChanged: '没有需要变更的插件。',
      empty: '没有匹配的插件。',
      emptyBundles: '没有匹配的插件包。',
      stateFile: '状态文件',
      bootId: '本次启动',
      listTitle: '插件清单',
      listHint: '搜索会同时过滤下方插件包。',
      coreHint: '核心插件由 DSH 自身管理，这里不会自动停用它们。',
      bundlesTitle: '插件包',
      bundlesHint: '按包启用或停用，会同时作用于包内所有模块。',
      avInstall: '未安装',
      avMissing: '已缺失',
      official: '官方',
      rowsUnit: '个模块',
      bundleErr: '安装异常',
      planLabel: '下次启动',
      planObserve: '手动模式：启动时不会自动改动任何插件。',
      planClean: '无需变更：当前策略下所有可管理插件都已就位。',
      planDisable: '收起',
      planEnable: '拉起',
      search: '搜索插件…',
      loading: '读取插件清单…',
    }

    const EN = {
      nav: 'Plugin Butler',
      subtitle: 'One switchboard for every plugin: lean startup, enable on demand, folded away next launch.',
      modeLabel: 'Startup policy',
      modeObserve: 'Manual',
      modeObserveDesc: 'Inventory and switches only. Nothing changes on its own.',
      modeLean: 'Lean',
      modeLeanDesc: 'Boot the core only. Anything opened in this session folds away next launch.',
      modeAll: 'Load all',
      modeAllDesc: 'Pull in every plugin on each launch. Fullest feature set, slowest boot.',
      actLean: 'Trim now',
      actAll: 'Enable all',
      actRefresh: 'Refresh',
      busy: 'Working…',
      on: 'Enabled',
      off: 'Disabled',
      pin: 'Pin: never auto-disabled',
      pinned: 'Pinned',
      pinShort: 'Pin',
      core: 'Core',
      selfBadge: 'Butler itself',
      selfLocked: 'Butler itself: switch it from the plugin manager',
      expand: 'Show the modules in this bundle',
      collapse: 'Hide the modules in this bundle',
      rowDetached: 'not mounted',
      leased: 'This session',
      phasePending: 'Pending',
      phaseLoading: 'Loading',
      phaseUnloading: 'Stopping',
      phaseFailed: 'Load failed',
      roManaged: 'Manage in the plugin market',
      roUnaddress: 'Unaddressable',
      statTotal: 'Plugins',
      statEnabled: 'Enabled',
      statManaged: 'Managed',
      statBundles: 'Bundles',
      statPinned: 'Pinned',
      errorTitle: 'Something went wrong',
      restartHint: 'Some changes need a DSH restart to take full effect.',
      restart: 'Restart DSH',
      changed: 'Updated',
      failedCount: 'failed',
      restartCount: 'restart',
      warnCount: 'warnings',
      nothingChanged: 'Nothing needed changing.',
      empty: 'No matching plugins.',
      emptyBundles: 'No matching bundles.',
      stateFile: 'State file',
      bootId: 'This launch',
      listTitle: 'Inventory',
      listHint: 'Search also filters the bundles below.',
      coreHint: 'Core plugins belong to DSH itself and are never auto-disabled here.',
      bundlesTitle: 'Bundles',
      bundlesHint: 'Switching a bundle enables or disables every module inside it.',
      avInstall: 'Not installed',
      avMissing: 'Missing',
      official: 'Official',
      rowsUnit: 'modules',
      bundleErr: 'Install error',
      planLabel: 'Next launch',
      planObserve: 'Manual mode: nothing changes on launch.',
      planClean: 'Nothing to change: every manageable plugin is already in place.',
      planDisable: 'fold away',
      planEnable: 'pull in',
      search: 'Search plugins…',
      loading: 'Reading the inventory…',
    }

    const T = {
      base: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border1: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      brand: 'var(--dsw-alias-brand-primary)',
      text: 'var(--dsw-alias-label-primary)',
      sub: 'var(--dsw-alias-label-secondary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
    }

    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

    /** Fiber phases worth a badge. `active` is the quiet default. */
    const PHASE = {
      pending: ['phasePending', T.sub],
      loading: ['phaseLoading', T.brand],
      unloading: ['phaseUnloading', T.warn],
      failed: ['phaseFailed', T.err],
    }

    const READ_ONLY = {
      'management-required': ['roManaged', T.sub],
      unaddressable: ['roUnaddress', T.warn],
    }

    function errorText(error) {
      return String((error && error.message) || error || 'unknown error')
    }

    async function readJson(path, init) {
      const response = await fetch(API + path, Object.assign({ credentials: 'same-origin' }, init))
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`)
      }
      return payload
    }

    function loadState() {
      return readJson('/state', { method: 'GET', headers: { accept: 'application/json' } })
    }

    function loadRevision() {
      return readJson('/revision', { method: 'GET', headers: { accept: 'application/json' } })
    }

    function postJson(path, body) {
      return readJson(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body || {}),
      })
    }

    function metaTitle(meta) {
      if (!meta) return ''
      const title = meta.title
      if (typeof title === 'string') return title
      if (title && typeof title === 'object') return title.zh || title['zh-CN'] || title.en || ''
      return ''
    }

    function summarize(changes, t) {
      const list = Array.isArray(changes) ? changes : []
      if (!list.length) return t('nothingChanged')
      const failed = list.filter((change) => change.application === 'failed' || change.error).length
      const restart = list.filter((change) => change.application === 'restart-required').length
      const warnings = list.reduce(
        (total, change) => total + (Array.isArray(change.warnings) ? change.warnings.length : 0),
        0,
      )
      let text = `${t('changed')} ${list.length}`
      if (failed) text += ` · ${t('failedCount')} ${failed}`
      if (restart) text += ` · ${t('restartCount')} ${restart}`
      if (warnings) text += ` · ${t('warnCount')} ${warnings}`
      return text
    }

    function badge(text, color) {
      return h(
        'span',
        {
          style: {
            fontSize: 10.5,
            lineHeight: '16px',
            padding: '0 6px',
            borderRadius: 6,
            border: `1px solid ${color}`,
            color,
            whiteSpace: 'nowrap',
          },
        },
        text,
      )
    }

    function toggleDot(on) {
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            width: 34,
            height: 19,
            borderRadius: 999,
            position: 'relative',
            background: on ? T.brand : T.border2,
            transition: 'background .15s ease',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: on ? 17 : 2,
            width: 15,
            height: 15,
            borderRadius: '50%',
            background: T.base,
            transition: 'left .15s ease',
          },
        }),
      )
    }

    function buttonStyle(primary, busy) {
      return {
        padding: '6px 12px',
        borderRadius: 8,
        border: `1px solid ${primary ? T.brand : T.border2}`,
        background: primary ? T.layer2 : T.layer1,
        color: primary ? T.brand : T.text,
        fontSize: 12.5,
        fontWeight: 500,
        font: 'inherit',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }
    }

    function sectionTitle(text, hint) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 12.5, fontWeight: 600, color: T.text } }, text),
        hint ? h('span', { style: { fontSize: 11, color: T.sub } }, hint) : null,
      )
    }

    function listShell(children, maxHeight) {
      return h(
        'div',
        {
          style: {
            border: `1px solid ${T.border1}`,
            borderRadius: 12,
            overflow: 'hidden',
            maxHeight,
            overflowY: 'auto',
            background: T.base,
          },
        },
        children,
      )
    }

    function ButlerPanel(props) {
      const t = props.t
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [query, setQuery] = useState('')
      const [needRestart, setNeedRestart] = useState(false)
      const [openBundle, setOpenBundle] = useState('')
      const alive = useRef(true)
      const revisionRef = useRef(-1)

      useEffect(
        () => () => {
          alive.current = false
        },
        [],
      )

      const adopt = useCallback((next) => {
        if (!alive.current || !next) return
        setSnap(next)
        if (typeof next.revision === 'number') revisionRef.current = next.revision
      }, [])

      const refresh = useCallback(async () => {
        try {
          const next = await loadState()
          adopt(next)
          if (alive.current) setError('')
        } catch (failure) {
          if (alive.current) setError(errorText(failure))
        }
      }, [adopt])

      // Cheap liveness check: the revision only moves when the profile
      // composition changes, so this keeps the page in sync with installs made
      // from the market without re-reading the whole inventory every tick.
      useEffect(() => {
        let stopped = false
        const tick = async () => {
          if (stopped) return
          try {
            const head = await loadRevision()
            if (stopped) return
            if (typeof head.revision === 'number' && head.revision === revisionRef.current) return
            await refresh()
          } catch {
            /* A host that predates /revision would keep this panel stale, so
               fall back to reading the full snapshot; refresh() reports its own
               failures and the next tick retries either way. */
            if (!stopped) await refresh()
          }
        }

        refresh()
        const timer = setInterval(tick, POLL_MS)
        const onFocus = () => {
          tick()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onFocus)
        return () => {
          stopped = true
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onFocus)
        }
      }, [refresh])

      const run = useCallback(
        async (tag, path, body) => {
          setBusy(tag)
          setError('')
          setNotice('')
          try {
            const result = await postJson(path, body)
            if (!alive.current) return
            if (result.snapshot) adopt(result.snapshot)
            setNotice(summarize(result.changes, t))
            if ((result.changes || []).some((change) => change.application === 'restart-required')) {
              setNeedRestart(true)
            }
          } catch (failure) {
            if (alive.current) setError(errorText(failure))
          } finally {
            if (alive.current) setBusy('')
          }
        },
        [adopt, t],
      )

      const shell = typeof window !== 'undefined' ? window.__dshHostShell : null
      const restartShell = shell && typeof shell.restart === 'function' ? shell.restart : null

      const entries = snap && Array.isArray(snap.entries) ? snap.entries : []
      const bundleList = snap && Array.isArray(snap.bundles) ? snap.bundles : []
      const entryIndex = new Map(entries.map((entry) => [entry.entryId, entry]))
      const needle = query.trim().toLowerCase()
      const matches = (value) => String(value || '').toLowerCase().includes(needle)
      const shown = needle ? entries.filter((entry) => matches(entry.moduleName) || matches(entry.title)) : entries
      const shownBundles = needle ? bundleList.filter((bundle) => matches(bundle.name)) : bundleList
      // Outside of a search, only bundles that are actually part of this
      // profile belong in the list: the inventory also carries every bundle
      // that merely *could* be installed, which would drown the useful rows.
      const visibleBundles = needle
        ? shownBundles
        : shownBundles.filter(
            (bundle) =>
              bundle.installed || bundle.enabled || bundle.availability === 'profile' || Boolean(bundle.error),
          )
      const managed = shown.filter((entry) => !entry.core)
      const core = shown.filter((entry) => entry.core)
      const counts = (snap && snap.counts) || {}
      const plan = snap && snap.plan ? snap.plan : null
      const planFolds = plan && Array.isArray(plan.disable) ? plan.disable.length : 0
      const planPulls = plan && Array.isArray(plan.enable) ? plan.enable.length : 0

      const planText = !plan
        ? ''
        : !plan.active
          ? t('planObserve')
          : planFolds + planPulls === 0
            ? t('planClean')
            : [
                planFolds ? `${t('planDisable')} ${planFolds}` : '',
                planPulls ? `${t('planEnable')} ${planPulls}` : '',
              ]
                .filter(Boolean)
                .join(' · ')

      const modeCards = [
        ['observe', t('modeObserve'), t('modeObserveDesc')],
        ['lean', t('modeLean'), t('modeLeanDesc')],
        ['all', t('modeAll'), t('modeAllDesc')],
      ].map(([key, title, desc]) => {
        const active = snap && snap.mode === key
        return h(
          'button',
          {
            key,
            type: 'button',
            disabled: Boolean(busy) || !snap,
            onClick: () => run(`mode:${key}`, '/mode', { mode: key }),
            style: {
              flex: '1 1 0',
              minWidth: 0,
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${active ? T.brand : T.border1}`,
              background: active ? T.layer2 : T.layer1,
              color: T.text,
              font: 'inherit',
              cursor: busy ? 'default' : 'pointer',
            },
          },
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, title),
          h('span', { style: { fontSize: 11.5, lineHeight: 1.5, color: T.sub } }, desc),
        )
      })

      const rowOf = (entry) => {
        const tag = `set:${entry.entryId}`
        const phase = entry.fiberPhase ? PHASE[entry.fiberPhase] : null
        const readOnly = !entry.core && entry.readOnlyReason ? READ_ONLY[entry.readOnlyReason] : null
        return h(
          'div',
          {
            key: entry.entryId,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderTop: `1px solid ${T.border1}`,
            },
          },
          h(
            'div',
            { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
            h(
              'div',
              {
                title: entry.description || entry.title || entry.moduleName,
                style: {
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: T.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              entry.title || entry.moduleName,
            ),
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: T.sub,
                  fontFamily: MONO,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              entry.moduleName,
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
            entry.self ? badge(t('selfBadge'), T.brand) : entry.core ? badge(t('core'), T.warn) : null,
            readOnly ? badge(t(readOnly[0]), readOnly[1]) : null,
            phase ? badge(t(phase[0]), phase[1]) : null,
            entry.leased ? badge(t('leased'), T.ok) : null,
            entry.writable && !entry.core
              ? h(
                  'button',
                  {
                    type: 'button',
                    title: entry.pinned ? t('pin') : t('pinShort'),
                    disabled: Boolean(busy),
                    onClick: () => run(`pin:${entry.entryId}`, '/pin', { entryId: entry.entryId, pinned: !entry.pinned }),
                    style: {
                      border: `1px solid ${entry.pinned ? T.brand : 'transparent'}`,
                      background: 'transparent',
                      color: entry.pinned ? T.brand : T.sub,
                      borderRadius: 6,
                      padding: '2px 6px',
                      fontSize: 11,
                      font: 'inherit',
                      cursor: busy ? 'default' : 'pointer',
                    },
                  },
                  entry.pinned ? t('pinned') : t('pinShort'),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': Boolean(entry.enabled),
                title:
                  entry.writable && !entry.core && !entry.self
                    ? entry.enabled
                      ? t('off')
                      : t('on')
                    : entry.self
                      ? t('selfLocked')
                      : entry.readOnlyReason
                        ? READ_ONLY[entry.readOnlyReason]
                          ? t(READ_ONLY[entry.readOnlyReason][0])
                          : entry.readOnlyReason
                        : t('coreHint'),
                disabled: Boolean(busy) || !entry.writable || entry.core,
                // No handler at all when the row cannot be switched: a
              // disabled button that still carries onClick is a lie to
              // keyboard users and to anything that inspects the DOM.
              onClick:
                entry.writable && !entry.core && !busy
                  ? () => run(tag, '/set', { entryId: entry.entryId, enabled: !entry.enabled })
                  : undefined,
                style: {
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  lineHeight: 0,
                  opacity: entry.writable && !entry.core ? 1 : 0.45,
                  cursor: entry.writable && !entry.core && !busy ? 'pointer' : 'not-allowed',
                },
              },
              toggleDot(Boolean(entry.enabled)),
            ),
          ),
        )
      }

      const bundleRow = (bundle) => {
        const tag = `bundle:${bundle.name}`
        const availability = bundle.availability === 'installation' || bundle.availability === 'missing' ? bundle.availability : null
        const rows = Array.isArray(bundle.rows) ? bundle.rows : []
        const open = openBundle === bundle.name && rows.length > 0
        const entryById = entryIndex
        const modules = open
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '4px 12px 9px 30px',
                  borderTop: `1px dashed ${T.border1}`,
                },
              },
              rows.map((row) => {
                const entry = row.entryId ? entryById.get(row.entryId) : null
                const phase = entry && entry.fiberPhase ? PHASE[entry.fiberPhase] : null
                return h(
                  'div',
                  {
                    key: row.rowId || row.moduleName,
                    style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, fontSize: 11.5 },
                  },
                  h(
                    'span',
                    {
                      style: {
                        color: T.text,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 220,
                      },
                    },
                    metaTitle(row.meta) || row.moduleName,
                  ),
                  h(
                    'span',
                    {
                      style: {
                        fontFamily: MONO,
                        fontSize: 10.5,
                        color: T.sub,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      },
                    },
                    row.moduleName,
                  ),
                  entry
                    ? badge(entry.enabled ? t('on') : t('off'), entry.enabled ? T.ok : T.sub)
                    : badge(t('rowDetached'), T.warn),
                  phase ? badge(t(phase[0]), phase[1]) : null,
                )
              }),
            )
          : null
        const toggleRow = rows.length
          ? h(
              'button',
              {
                type: 'button',
                'aria-expanded': open,
                'aria-label': t(open ? 'collapse' : 'expand'),
                title: t(open ? 'collapse' : 'expand'),
                onClick: () => setOpenBundle(open ? '' : bundle.name),
                style: {
                  border: `1px solid ${T.border1}`,
                  background: 'transparent',
                  color: T.sub,
                  font: 'inherit',
                  fontSize: 10,
                  lineHeight: '14px',
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  padding: 0,
                  flexShrink: 0,
                  cursor: 'pointer',
                },
              },
              open ? '▾' : '▸',
            )
          : null
        return h(
          'div',
          { key: bundle.name, style: { borderTop: `1px solid ${T.border1}` } },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
              },
            },
            toggleRow,
          h(
            'div',
            { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
            h(
              'div',
              {
                title: bundle.description || bundle.name,
                style: {
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                  minWidth: 0,
                  fontSize: 12.5,
                  color: T.text,
                },
              },
              h(
                'span',
                {
                  style: {
                    fontFamily: MONO,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                bundle.name,
              ),
              bundle.version
                ? h(
                    'span',
                    { style: { fontSize: 11, color: T.sub, fontFamily: MONO, whiteSpace: 'nowrap' } },
                    bundle.version,
                  )
                : null,
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
              h(
                'span',
                { style: { fontSize: 11, color: T.sub } },
                `${bundle.rowCount || 0} ${t('rowsUnit')}`,
              ),
              !bundle.installed && !availability ? badge(t('avInstall'), T.sub) : null,
              availability ? badge(t(availability === 'missing' ? 'avMissing' : 'avInstall'), availability === 'missing' ? T.err : T.sub) : null,
              bundle.readOnlyReason
                ? badge(
                    READ_ONLY[bundle.readOnlyReason] ? t(READ_ONLY[bundle.readOnlyReason][0]) : bundle.readOnlyReason,
                    T.sub,
                  )
                : null,
              bundle.self ? badge(t('selfBadge'), T.brand) : null,
              bundle.official ? badge(t('official'), T.brand) : null,
              bundle.error ? badge(t('bundleErr'), T.err) : null,
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': Boolean(bundle.enabled),
              title:
                bundle.writable && !bundle.self
                  ? bundle.enabled
                    ? t('off')
                    : t('on')
                  : bundle.self
                    ? t('selfLocked')
                    : bundle.readOnlyReason
                      ? READ_ONLY[bundle.readOnlyReason]
                        ? t(READ_ONLY[bundle.readOnlyReason][0])
                        : bundle.readOnlyReason
                      : bundle.error
                        ? t('bundleErr')
                        : availability === 'missing'
                          ? t('avMissing')
                          : t('roManaged'),
              disabled: Boolean(busy) || !bundle.writable || Boolean(bundle.self),
              onClick:
                bundle.writable && !bundle.self && !busy
                  ? () => run(tag, '/bundle', { name: bundle.name, enabled: !bundle.enabled })
                  : undefined,
              style: {
                border: 'none',
                background: 'transparent',
                padding: 0,
                lineHeight: 0,
                flexShrink: 0,
                opacity: bundle.writable && !bundle.self ? 1 : 0.45,
                cursor: bundle.writable && !bundle.self && !busy ? 'pointer' : 'not-allowed',
              },
            },
            toggleDot(Boolean(bundle.enabled)),
          ),
          ),
          modules,
        )
      }

      const chips = [
        [t('statTotal'), counts.total],
        [t('statEnabled'), counts.enabled],
        [t('statManaged'), counts.managed],
        [t('statBundles'), counts.bundles],
        [t('statPinned'), counts.pinned],
      ].map(([label, value]) =>
        h(
          'span',
          {
            key: label,
            style: {
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 5,
              padding: '3px 9px',
              borderRadius: 8,
              background: T.layer1,
              border: `1px solid ${T.border1}`,
            },
          },
          h('span', { style: { fontSize: 11, color: T.sub } }, label),
          h('span', { style: { fontSize: 12.5, fontWeight: 600, color: T.text } }, String(value == null ? 0 : value)),
        ),
      )

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14, color: T.text, padding: '2px 0 8px' } },

        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { fontSize: 14, fontWeight: 600 } }, t('nav')),
          h('div', { style: { fontSize: 11.5, lineHeight: 1.6, color: T.sub } }, t('subtitle')),
        ),

        snap
          ? h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
              chips,
              h(
                'span',
                { style: { fontSize: 11, color: T.sub, marginLeft: 'auto' } },
                `${t('bootId')} ${snap.bootId}`,
              ),
            )
          : null,

        sectionTitle(t('modeLabel'), plan ? `${t('planLabel')}：${planText}` : null),
        h('div', { style: { display: 'flex', gap: 8 } }, modeCards),

        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          h(
            'button',
            {
              type: 'button',
              disabled: Boolean(busy) || !snap,
              onClick: () => run('sweep:lean', '/sweep', { mode: 'lean' }),
              style: buttonStyle(false, Boolean(busy)),
            },
            busy === 'sweep:lean' ? t('busy') : t('actLean'),
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: Boolean(busy) || !snap,
              onClick: () => run('sweep:all', '/sweep', { mode: 'all' }),
              style: buttonStyle(false, Boolean(busy)),
            },
            busy === 'sweep:all' ? t('busy') : t('actAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: Boolean(busy),
              onClick: refresh,
              style: buttonStyle(false, Boolean(busy)),
            },
            t('actRefresh'),
          ),
          h('input', {
            type: 'search',
            value: query,
            placeholder: t('search'),
            onChange: (event) => setQuery(event.target.value),
            style: {
              flex: '1 1 140px',
              minWidth: 120,
              padding: '5px 9px',
              borderRadius: 8,
              border: `1px solid ${T.border2}`,
              background: T.layer1,
              color: T.text,
              font: 'inherit',
              fontSize: 12,
            },
          }),
        ),

        error
          ? h(
              'div',
              {
                style: {
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${T.err}`,
                  color: T.err,
                  wordBreak: 'break-word',
                },
              },
              `${t('errorTitle')}：${error}`,
            )
          : null,

        notice
          ? h(
              'div',
              {
                style: {
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${T.ok}`,
                  color: T.ok,
                },
              },
              notice,
            )
          : null,

        needRestart
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${T.warn}`,
                  color: T.warn,
                },
              },
              t('restartHint'),
              restartShell
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => restartShell(),
                      style: Object.assign(buttonStyle(true, false), { marginLeft: 'auto' }),
                    },
                    t('restart'),
                  )
                : null,
            )
          : null,

        sectionTitle(t('listTitle'), t('coreHint')),
        listShell(
          snap
            ? shown.length
              ? [...managed, ...core].map(rowOf)
              : h('div', { style: { padding: '14px 12px', fontSize: 11.5, color: T.sub } }, t('empty'))
            : h('div', { style: { padding: '14px 12px', fontSize: 11.5, color: T.sub } }, t('loading')),
          420,
        ),

        sectionTitle(t('bundlesTitle'), t('bundlesHint')),
        listShell(
          snap
            ? visibleBundles.length
              ? visibleBundles.map(bundleRow)
              : h('div', { style: { padding: '14px 12px', fontSize: 11.5, color: T.sub } }, t('emptyBundles'))
            : h('div', { style: { padding: '14px 12px', fontSize: 11.5, color: T.sub } }, t('loading')),
          320,
        ),

        snap && snap.statePath
          ? h(
              'div',
              { style: { fontSize: 10.5, color: T.sub, wordBreak: 'break-all', fontFamily: MONO } },
              `${t('stateFile')}: ${snap.statePath}`,
            )
          : null,
      )
    }

    function bindTranslate(ctx) {
      const fallback = (key) => (ZH[key] === undefined ? key : ZH[key])
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function' && typeof ctx.locale.bind === 'function') {
          ctx.locale.register(NS, 'zh', ZH)
          ctx.locale.register(NS, 'en', EN)
          const bound = ctx.locale.bind(NS)
          if (typeof bound === 'function') {
            return (key) => {
              const value = bound(key)
              return typeof value === 'string' && value !== key ? value : fallback(key)
            }
          }
        }
      } catch {
        /* dictionaries are optional decoration */
      }
      return fallback
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = bindTranslate(ctx)
        const element = (ownerProps) =>
          h(ButlerPanel, Object.assign({}, ownerProps, { t, key: 'plugin-butler' }))

        if (!ctx.slots || typeof ctx.slots.register !== 'function') return

        if (typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('settings.section', () => {
            const off = ctx.slots.register(
              { name: 'settings.section', id: 'plugin-butler', order: 45, label: () => t('nav'), locale: NS },
              element,
            )
            return () => {
              try {
                if (typeof off === 'function') off()
              } catch {
                /* already gone */
              }
            }
          })
          return
        }

        const off = ctx.slots.register(
          { name: 'settings.section', id: 'plugin-butler', order: 45, label: () => t('nav'), locale: NS },
          element,
        )
        ctx.effect(
          () => () => {
            try {
              if (typeof off === 'function') off()
            } catch {
              /* already gone */
            }
          },
          'plugin-butler: settings section',
        )
      },
    }
  },
})