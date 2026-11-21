// dsh-daily-workspace —— 浏览器半身。
//
// 由 client 模块系统按 package.json 的 `dsh.client` 声明装载：本文件向
// window.__ModuleLoader__ 登记包名与一个 lazy-CJS factory，factory 返回
// { apply, inject }，被 Cordis 当插件对象收养。
//
// 界面落点：sidebar.session.action 是唯一包住「新会话」行内容的 HOC。
// 我们在 HOC 里把「最近」区 portal 到 .regionArea（WorkspaceBrowser 之前），
// 不改官方组件，也不整体替换工作区浏览区。
window.__ModuleLoader__.load({
  id: 'dsh-daily-workspace',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDOM = require('react-dom')

    if (!React || typeof React.createElement !== 'function' || !ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      console.warn('[daily-workspace] React/ReactDOM 不可用，最近区跳过')
      exports.inject = ['slots']
      exports.apply = () => {}
      return module.exports
    }

    const { useEffect, useState, useSyncExternalStore } = React
    const h = React.createElement
    const { createPortal } = ReactDOM

    /** Route prefix owned by the host half. */
    const API = '/dsh-daily-workspace'
    /** Locale namespace owned by this plugin. */
    const NS = 'dailyWorkspace'
    /** Last known pointer, so the first click after a reload still honors it. */
    const CACHE_KEY = 'dsh-daily-workspace.default'

    const zh = {
      'recent.title': '最近',
      'recent.unset': '未设置',
      'recent.default': '默认工作区',
      'recent.change': '更改',
      'recent.viewAll': '查看全部 {count} 个对话',
      'recent.empty': '还没有对话',
      'recent.error': '无法读取默认工作区',
      'setup.title': '还没有默认工作区',
      'setup.body': '选择电脑上的任意文件夹，新对话会自动落在那里，不用每次手动切换。',
      'setup.action': '选择文件夹',
      'picker.title': '选择默认工作区',
      'picker.body': '新对话将默认在这个工作区创建。',
      'picker.folder': '选择文件夹…',
      'picker.picking': '正在选择…',
      'picker.folderHint': '可选择电脑上的任意文件夹，选中后会自动添加为工作区。',
      'picker.existing': '或从已有工作区中选择',
      'picker.current': '当前',
      'picker.empty': '还没有工作区。可以直接选择电脑上的文件夹。',
      'picker.error': '选择失败：{message}',
      'picker.cancel': '取消',
      'all.title': '全部对话',
      'all.empty': '还没有对话。',
      'session.untitled': '未命名',
      'time.now': '刚刚',
      'time.minute': '{n}分钟前',
      'time.hour': '{n}小时前',
      'time.day': '{n}天前',
    }

    const en = {
      'recent.title': 'Recent',
      'recent.unset': 'Not set',
      'recent.default': 'Default workspace',
      'recent.change': 'Change',
      'recent.viewAll': 'View all {count} conversations',
      'recent.empty': 'No conversations yet',
      'recent.error': 'Could not read the default workspace',
      'setup.title': 'No default workspace yet',
      'setup.body': 'Choose any folder on your computer; new conversations will start there automatically.',
      'setup.action': 'Choose a folder',
      'picker.title': 'Choose a default workspace',
      'picker.body': 'New conversations will start in this workspace by default.',
      'picker.folder': 'Choose a folder…',
      'picker.picking': 'Choosing…',
      'picker.folderHint': 'Pick any folder on this computer; it will be added as a workspace.',
      'picker.existing': 'Or pick an existing workspace',
      'picker.current': 'Current',
      'picker.empty': 'No workspaces yet. You can choose any folder on this computer.',
      'picker.error': 'Could not choose: {message}',
      'picker.cancel': 'Cancel',
      'all.title': 'All conversations',
      'all.empty': 'No conversations yet.',
      'session.untitled': 'Untitled',
      'time.now': 'Just now',
      'time.minute': '{n} min ago',
      'time.hour': '{n} hr ago',
      'time.day': '{n} d ago',
    }

    // ── 状态：默认工作区指针 ───────────────────────────────────────────────
    const store = {
      value: { ready: false, defaultWorkspaceId: null, error: null },
      listeners: new Set(),
      get() {
        return store.value
      },
      set(patch) {
        store.value = { ...store.value, ...patch }
        for (const listener of store.listeners) listener()
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      },
    }

    try {
      const cached = window.localStorage.getItem(CACHE_KEY)
      if (cached) store.value.defaultWorkspaceId = cached
    } catch {
      // Private mode or blocked storage: the server remains the source of truth.
    }

    function remember(id) {
      try {
        if (id) window.localStorage.setItem(CACHE_KEY, id)
        else window.localStorage.removeItem(CACHE_KEY)
      } catch {
        // Ignore storage failures.
      }
    }

    async function loadState() {
      try {
        const response = await fetch(`${API}/state`, { headers: { accept: 'application/json' } })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        const id = typeof data.defaultWorkspaceId === 'string' ? data.defaultWorkspaceId : null
        remember(id)
        store.set({ ready: true, defaultWorkspaceId: id, error: null })
      } catch (error) {
        store.set({ ready: true, error: (error && error.message) || String(error) })
      }
    }

    async function saveState(id) {
      remember(id)
      store.set({ defaultWorkspaceId: id, error: null })
      try {
        const response = await fetch(`${API}/state`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ workspaceId: id }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        store.set({ ready: true, defaultWorkspaceId: id, error: null })
      } catch (error) {
        store.set({ error: (error && error.message) || String(error) })
        // Re-read the authoritative value; an optimistic write must not stick.
        void loadState()
      }
    }

    // ── 样式 ───────────────────────────────────────────────────────────────
    const CSS = `
.dsh-dw-mount{flex:none}
.dsh-dw-section{padding:2px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}
.dsh-dw-head{display:flex;align-items:center;justify-content:space-between;padding:6px 10px 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-dw-muted{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-default{display:flex;align-items:center;gap:6px;padding:1px 10px 6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,inherit);min-width:0}
.dsh-dw-star{color:#e0a800;font-size:11px;line-height:1}
.dsh-dw-default-label{flex:none;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-default-name{color:var(--dsw-alias-label-secondary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.dsh-dw-change{border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:11.5px;cursor:pointer;padding:2px 2px;white-space:nowrap}
.dsh-dw-change:hover{text-decoration:underline}
.dsh-dw-list{display:flex;flex-direction:column;padding:0 4px}
.dsh-dw-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:30px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.dsh-dw-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10))}
.dsh-dw-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-2px}
.dsh-dw-row[aria-current="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.14))}
.dsh-dw-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-dw-time{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-more{display:block;width:100%;padding:5px 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,inherit);font:inherit;font-size:11.5px;text-align:left;cursor:pointer}
.dsh-dw-more:hover{color:var(--dsw-alias-label-secondary,inherit);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10))}
.dsh-dw-card{margin:5px 10px 4px;padding:10px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.30));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}
.dsh-dw-card-title{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.dsh-dw-card-body{margin:4px 0 8px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-primary{width:100%;height:30px;border:0;border-radius:8px;background:var(--dsw-alias-button-primary-fill,#1f2329);color:var(--dsw-alias-label-on-color,#fff);font:inherit;font-size:12px;cursor:pointer}
.dsh-dw-primary:hover{opacity:.9}
.dsh-dw-folder{width:100%;height:32px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.30));border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;cursor:pointer}
.dsh-dw-folder:hover{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.12))}
.dsh-dw-folder:disabled{opacity:.55;cursor:default}
.dsh-dw-hint{margin:6px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-sep{display:flex;align-items:center;gap:8px;margin:12px 0 6px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-sep::after{content:"";flex:1;height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.16))}
.dsh-dw-pickerr{margin:8px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#d9534f)}
.dsh-dw-error{padding:0 10px 4px;font-size:11px;color:var(--dsw-alias-state-error-primary,#d9534f)}
.dsh-dw-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.34)}
.dsh-dw-dialog{width:min(380px,100%);max-height:min(560px,82vh);display:flex;flex-direction:column;padding:16px;border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,inherit);box-shadow:0 18px 60px rgba(0,0,0,.30)}
.dsh-dw-dialog h2{margin:0;font-size:14px;font-weight:600}
.dsh-dw-dialog p{margin:6px 0 10px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-dialog-list{display:flex;flex-direction:column;gap:2px;overflow:auto;min-height:0;padding:2px 0}
.dsh-dw-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.dsh-dw-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10))}
.dsh-dw-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-dw-item-meta{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-dw-foot{display:flex;justify-content:flex-end;padding-top:10px}
.dsh-dw-cancel{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.30));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
`

    function installStyles(ctx) {
      const style = document.createElement('style')
      style.id = 'dsh-daily-workspace-styles'
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() })
    }

    // ── 展示辅助 ───────────────────────────────────────────────────────────
    function relativeTime(updatedAt, t) {
      const diff = Math.max(0, Date.now() - updatedAt)
      if (diff < 60_000) return t('time.now')
      if (diff < 3_600_000) return t('time.minute', { n: String(Math.floor(diff / 60_000)) })
      if (diff < 86_400_000) return t('time.hour', { n: String(Math.floor(diff / 3_600_000)) })
      return t('time.day', { n: String(Math.floor(diff / 86_400_000)) })
    }

    function sessionTitle(session, t) {
      return session.displayTitle || session.title || t('session.untitled')
    }

    function workspaceTitle(workspace, t) {
      const title = workspace && workspace.title
      if (!title || title === 'default-workspace') return t('recent.default')
      return title
    }

    /** Windows paths compare case-insensitively and tolerate slash direction. */
    function normalizePath(path) {
      return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    // ── 对话框 ─────────────────────────────────────────────────────────────
    function Dialog({ title, children, onClose }) {
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [onClose])
      return createPortal(
        h('div', {
          className: 'dsh-dw-overlay',
          onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
        }, h('div', { className: 'dsh-dw-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('h2', null, title),
          children)),
        document.body,
      )
    }

    // ── 最近区 ─────────────────────────────────────────────────────────────
    function RecentLayer(props) {
      const { wide, children, t, useSessions, useWorkspaces, openSession, pickDirectory, createWorkspace } = props
      const state = useSyncExternalStore(store.subscribe, store.get, store.get)
      const workspaces = useWorkspaces((snapshot) => snapshot.items)
      const archivedIds = useWorkspaces((snapshot) => snapshot.archivedSessionIds)
      const sessions = useSessions((snapshot) => snapshot)

      const [mount, setMount] = useState(null)
      const [pickerOpen, setPickerOpen] = useState(false)
      const [allOpen, setAllOpen] = useState(false)
      const [picking, setPicking] = useState(false)
      const [pickError, setPickError] = useState(null)

      // Mount once next to the WorkspaceBrowser, immediately before its root.
      useEffect(() => {
        if (!wide) return undefined
        let node = null
        let disposed = false

        const attach = () => {
          if (disposed) return false
          const header = document.querySelector('[data-sidebar-workspace-header]')
          const root = header && header.parentElement
          const region = root && root.parentElement
          if (!region || !root) return false
          if (!node) {
            node = document.createElement('div')
            node.className = 'dsh-dw-mount'
            node.dataset.dshDailyWorkspace = ''
          }
          // Keep the section directly before the WorkspaceBrowser root even
          // when React replaces or reorders the browser's own DOM.
          if (node.parentElement !== region || node.nextElementSibling !== root) region.insertBefore(node, root)
          setMount(node)
          return true
        }

        if (!attach()) {
          const observer = new MutationObserver(() => {
            if (attach()) observer.disconnect()
          })
          observer.observe(document.body, { childList: true, subtree: true })
          return () => {
            disposed = true
            observer.disconnect()
            if (node) node.remove()
            setMount(null)
          }
        }

        const keep = new MutationObserver(() => {
          if (node) attach()
        })
        keep.observe(document.body, { childList: true, subtree: true })
        return () => {
          disposed = true
          keep.disconnect()
          if (node) node.remove()
          setMount(null)
        }
      }, [wide])

      // Load the authoritative pointer on first render and whenever the
      // default workspace disappears from the registry.
      useEffect(() => {
        void loadState()
      }, [])

      useEffect(() => {
        if (!state.ready || state.defaultWorkspaceId === null) return
        if (workspaces.some((workspace) => workspace.workspaceId === state.defaultWorkspaceId)) return
        void saveState(null)
      }, [state.ready, state.defaultWorkspaceId, workspaces])

      // Keep the default workspace out of the lower grouped list: it already
      // owns the Recent section. The group section carries an inline indent
      // custom property, which gives a stable anchor without depending on
      // CSS-module class hashes.
      useEffect(() => {
        if (!wide || !state.defaultWorkspaceId) return undefined
        const rowKey = `workspace:${state.defaultWorkspaceId}`
        const hidden = new Set()
        const apply = () => {
          for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
            if (row.getAttribute('data-row-key') !== rowKey) continue
            const section = row.closest('[style*="--dsh-workspace-indent"]')
            if (!section || section.style.display === 'none') continue
            // Nested workspace-tree mode: never hide child workspaces along
            // with their default parent.
            if (section.querySelectorAll('[data-row-key^="workspace:"]').length > 1) continue
            section.style.display = 'none'
            section.dataset.dshDwHiddenGroup = ''
            hidden.add(section)
          }
        }
        apply()
        const observer = new MutationObserver(apply)
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'data-row-key'],
        })
        return () => {
          observer.disconnect()
          for (const section of hidden) {
            if (section.dataset.dshDwHiddenGroup === undefined) continue
            delete section.dataset.dshDwHiddenGroup
            section.style.display = ''
          }
        }
      }, [wide, state.defaultWorkspaceId])

      if (!wide) return children

      const defaultWorkspace = state.defaultWorkspaceId === null
        ? undefined
        : workspaces.find((workspace) => workspace.workspaceId === state.defaultWorkspaceId)
      const archived = new Set(archivedIds || [])
      const allSessions = (sessions.ids || [])
        .map((id) => sessions.byId[id])
        .filter((session) => session && !session.blank && session.origin !== 'subagent' && !archived.has(session.id))
        .sort((left, right) => right.updatedAt - left.updatedAt)

      const choose = (workspaceId) => {
        setPickerOpen(false)
        setPickError(null)
        void saveState(workspaceId)
      }

      // The Host-native directory picker only accepts folders, and it reaches
      // the whole disk. Picking a folder registers it as a Workspace on demand,
      // so the user is not limited to workspaces already in the sidebar.
      const chooseFolder = async () => {
        if (picking) return
        setPicking(true)
        setPickError(null)
        try {
          const path = await pickDirectory()
          if (!path) return
          const key = normalizePath(path)
          let workspace = workspaces.find((item) => normalizePath(item.path) === key)
          if (!workspace) workspace = await createWorkspace(path)
          if (!workspace || !workspace.workspaceId) throw new Error('workspace not created')
          choose(workspace.workspaceId)
        } catch (error) {
          setPickError((error && error.message) || String(error))
        } finally {
          setPicking(false)
        }
      }

      const section = h('div', { className: 'dsh-dw-section' },
        h('div', { className: 'dsh-dw-head' },
          h('span', null, t('recent.title')),
          !state.ready ? null : (defaultWorkspace ? null : h('span', { className: 'dsh-dw-muted' }, t('recent.unset')))),
        defaultWorkspace
          ? h('div', { className: 'dsh-dw-default' },
            h('span', { className: 'dsh-dw-star', 'aria-hidden': 'true' }, '★'),
            h('span', { className: 'dsh-dw-default-label' }, t('recent.default')),
            defaultWorkspace.title === 'default-workspace'
              ? null
              : h('span', { className: 'dsh-dw-default-name', title: defaultWorkspace.path }, defaultWorkspace.title),
            h('button', { type: 'button', className: 'dsh-dw-change', onClick: () => { setPickerOpen(true) } }, t('recent.change')))
          : state.ready
            ? h('div', { className: 'dsh-dw-card' },
              h('div', { className: 'dsh-dw-card-title' }, h('span', { 'aria-hidden': 'true' }, '☆'), t('setup.title')),
              h('div', { className: 'dsh-dw-card-body' }, t('setup.body')),
              h('button', {
                type: 'button',
                className: 'dsh-dw-primary',
                disabled: picking,
                onClick: () => { void chooseFolder() },
              }, picking ? t('picker.picking') : t('setup.action')))
            : null,
        pickError ? h('div', { className: 'dsh-dw-pickerr', style: { padding: '0 10px' } }, t('picker.error', { message: pickError })) : null,
        state.error ? h('div', { className: 'dsh-dw-error' }, t('recent.error')) : null,
        h('div', { className: 'dsh-dw-list' },
          allSessions.length === 0
            ? h('div', { className: 'dsh-dw-muted', style: { padding: '4px 6px' } }, t('recent.empty'))
            : allSessions.slice(0, 5).map((session) => h('button', {
              key: session.id,
              type: 'button',
              className: 'dsh-dw-row',
              onClick: () => { if (typeof openSession === 'function') openSession(session.id) },
              title: sessionTitle(session, t),
            },
            h('span', { className: 'dsh-dw-name' }, sessionTitle(session, t)),
            h('span', { className: 'dsh-dw-time' }, relativeTime(session.updatedAt, t))))),
        allSessions.length > 5
          ? h('button', { type: 'button', className: 'dsh-dw-more', onClick: () => { setAllOpen(true) } },
            t('recent.viewAll', { count: String(allSessions.length) }) + ' ›')
          : null,
      )

      const picker = pickerOpen
        ? h(Dialog, { title: t('picker.title'), onClose: () => { setPickerOpen(false); setPickError(null) } },
          h('p', null, t('picker.body')),
          h('button', {
            type: 'button',
            className: 'dsh-dw-folder',
            disabled: picking,
            onClick: () => { void chooseFolder() },
          }, picking ? t('picker.picking') : t('picker.folder')),
          h('div', { className: 'dsh-dw-hint' }, t('picker.folderHint')),
          pickError ? h('div', { className: 'dsh-dw-pickerr' }, t('picker.error', { message: pickError })) : null,
          workspaces.length > 0
            ? h('div', { className: 'dsh-dw-sep' }, t('picker.existing'))
            : null,
          h('div', { className: 'dsh-dw-dialog-list' },
            workspaces.length === 0
              ? h('div', { className: 'dsh-dw-muted', style: { padding: '6px' } }, t('picker.empty'))
              : workspaces.map((workspace) => h('button', {
                key: workspace.workspaceId,
                type: 'button',
                className: 'dsh-dw-item',
                onClick: () => { choose(workspace.workspaceId) },
              },
              h('span', { className: 'dsh-dw-item-name' }, workspaceTitle(workspace, t)),
              workspace.workspaceId === state.defaultWorkspaceId
                ? h('span', { className: 'dsh-dw-item-meta' }, t('picker.current'))
                : null))),
          h('div', { className: 'dsh-dw-foot' },
            h('button', { type: 'button', className: 'dsh-dw-cancel', onClick: () => { setPickerOpen(false); setPickError(null) } }, t('picker.cancel'))))
        : null

      const allSessionsDialog = allOpen
        ? h(Dialog, { title: t('all.title'), onClose: () => { setAllOpen(false) } },
          h('div', { className: 'dsh-dw-dialog-list' },
            allSessions.length === 0
              ? h('div', { className: 'dsh-dw-muted', style: { padding: '6px' } }, t('all.empty'))
              : allSessions.map((session) => h('button', {
                key: session.id,
                type: 'button',
                className: 'dsh-dw-item',
                onClick: () => { setAllOpen(false); if (typeof openSession === 'function') openSession(session.id) },
              },
              h('span', { className: 'dsh-dw-item-name' }, sessionTitle(session, t)),
              h('span', { className: 'dsh-dw-item-meta' }, relativeTime(session.updatedAt, t))))),
          h('div', { className: 'dsh-dw-foot' },
            h('button', { type: 'button', className: 'dsh-dw-cancel', onClick: () => { setAllOpen(false) } }, t('picker.cancel'))))
        : null

      return h(React.Fragment, null,
        children,
        mount ? createPortal(h(React.Fragment, null, section, picker, allSessionsDialog), mount) : null)
    }

    // ── 注册 ───────────────────────────────────────────────────────────────
    const inject = ['slots', 'locale', 'uiWorkspace', 'workspaces']

    const apply = (ctx) => {
      installStyles(ctx)

      const uiWorkspace = ctx.uiWorkspace || ctx.get('uiWorkspace')
      const workspacesService = ctx.workspaces || ctx.get('workspaces')

      // Synchronous preload: a click before the first fetch still honors the
      // cached pointer, and the fetch corrects it shortly after.
      void loadState()

      // No-argument New Session: default workspace first, otherwise the
      // built-in current/recent fallback stays untouched. Explicitly chosen
      // workspaces (including the picker and "+" rows) always pass an id and
      // are never rewritten.
      if (uiWorkspace && typeof uiWorkspace.startSession === 'function' && workspacesService && workspacesService.list) {
        const original = uiWorkspace.startSession
        const patched = function (workspaceId, options) {
          if (workspaceId === undefined || workspaceId === null) {
            const preferred = store.value.defaultWorkspaceId
            if (preferred) {
              const items = workspacesService.list.getSnapshot().items
              if (items.some((workspace) => workspace.workspaceId === preferred)) {
                return original.call(uiWorkspace, preferred, options)
              }
            }
          }
          return original.call(uiWorkspace, workspaceId, options)
        }
        try {
          uiWorkspace.startSession = patched
          if (uiWorkspace.startSession !== patched) {
            console.warn('[daily-workspace] startSession is not writable; default workspace will not apply to the top New Session button')
          } else {
            ctx.effect(() => () => {
              if (uiWorkspace.startSession === patched) uiWorkspace.startSession = original
            })
          }
        } catch (error) {
          console.warn('[daily-workspace] failed to wrap startSession:', (error && error.message) || error)
        }
      } else {
        console.warn('[daily-workspace] uiWorkspace/workspaces service unavailable; default workspace fallback disabled')
      }

      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'daily-workspace: dictionaries')
      } catch (error) {
        console.warn('[daily-workspace] locale registration failed:', (error && error.message) || error)
      }

      try {
        ctx.slots.inject('sidebar.session.action', () => {
          try {
            ctx.slots.register({
              name: 'sidebar.session.action',
              id: 'daily-workspace',
              order: 60,
              locale: NS,
              inject: () => ({
                openSession: (sessionId) => { uiWorkspace.openSession(sessionId) },
                pickDirectory: () => uiWorkspace.pickDirectory(),
                createWorkspace: (path) => workspacesService.create({ path }),
              }),
            }, RecentLayer)
          } catch (error) {
            console.warn('[daily-workspace] recent section registration failed:', (error && error.message) || error)
          }
        })
      } catch (error) {
        console.warn('[daily-workspace] sidebar.session.action unavailable:', (error && error.message) || error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
