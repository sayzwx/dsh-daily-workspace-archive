/**
 * dsh-monitor — 浏览器端（Client half）
 *
 * 注册两个位置：
 *   - `sidebar.panellist`：左侧面板列表里的「监控台」入口（order -10，排在「插件」上面）
 *   - `main`：点击入口后显示的主面板页面（key = monitor）
 *
 * 数据全部来自宿主半边 /dsh-monitor/* 路由。这里不 require 任何 Harness
 * 客户端包，只用模块表里的 react，样式也只用 --dsw-alias-* 主题变量。
 */
window.__ModuleLoader__.load({
  id: 'dsh-monitor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    if (!React || typeof React.createElement !== 'function') {
      console.warn('[dsh-monitor] React 不可用，监控台跳过挂载')
      exports.inject = ['slots']
      exports.apply = () => {}
      return module.exports
    }

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const API = '/dsh-monitor'
    const NS = 'dshMonitor'
    const PANEL_KEY = 'monitor'
    const RANGE_KEY = 'dsh-monitor.range'
    const VIEW_KEY = 'dsh-monitor.view'
    const DAY = 86400000

    /* ------------------------------------------------------------------ */
    /* 文案：跟随 DSH 当前语言（zh / en），由 locale 服务判定             */
    /* ------------------------------------------------------------------ */

    const CSS = `
.dm-root { height: 100%; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dm-root * { box-sizing: border-box; }
.dm-inner { max-width: 1180px; margin: 0 auto; padding: 22px 24px 72px; display: flex; flex-direction: column; gap: 16px; }
.dm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dm-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0; }
.dm-sub { margin: 6px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.dm-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dm-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12.5px; line-height: 1.4; cursor: pointer; white-space: nowrap; }
.dm-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.dm-btn:disabled { opacity: .55; cursor: default; }
.dm-btn[data-primary="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dm-seg { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 9px; }
.dm-seg button { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 7px; padding: 5px 11px; font: inherit; font-size: 12.5px; cursor: pointer; }
.dm-seg button[data-on="true"] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2) inset; }
.dm-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 10px; }
.dm-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; padding: 12px 14px; min-width: 0; }
.dm-card-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-card-value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; }
.dm-card-note { margin-top: 5px; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dm-tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 0; }
.dm-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13.5px; padding: 9px 12px 10px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.dm-tab[data-on="true"] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight: 600; }
.dm-pill { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; line-height: 1.7; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base); white-space: nowrap; }
.dm-pill[data-tone="brand"] { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dm-pill[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.dm-table { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.dm-table-scroll { overflow-x: auto; }
.dm-grid-head, .dm-grid-row { display: grid; gap: 10px; align-items: center; min-width: 720px; padding: 9px 14px; }
.dm-grid-head { font-size: 11px; color: var(--dsw-alias-label-secondary); border-bottom: 1px solid var(--dsw-alias-border-l1); text-transform: uppercase; letter-spacing: .04em; }
.dm-grid-row { border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 12.5px; font-variant-numeric: tabular-nums; cursor: pointer; }
.dm-grid-row:last-child { border-bottom: 0; }
.dm-grid-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dm-grid-row[data-static="true"] { cursor: default; }
.dm-grid-row[data-static="true"]:hover { background: transparent; }
.dm-c-model { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dm-model-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-provider { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dm-num { text-align: right; white-space: nowrap; }
.dm-right { text-align: right; }
.dm-muted { color: var(--dsw-alias-label-secondary); }
.dm-hit { display: flex; align-items: center; gap: 7px; }
.dm-hit-track { flex: 1; height: 5px; border-radius: 999px; background: var(--dsw-alias-border-l2); overflow: hidden; min-width: 34px; }
.dm-hit-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-success-primary); }
.dm-hit-fill[data-low="true"] { background: var(--dsw-alias-state-warn-primary); }
.dm-section { display: flex; flex-direction: column; gap: 10px; }
.dm-section-title { font-size: 13px; font-weight: 600; margin: 0; display: flex; align-items: baseline; gap: 8px; }
.dm-card-block { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 14px; }
.dm-detail-head { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.dm-detail-title { font-size: 16px; font-weight: 600; margin: 0; word-break: break-all; }
.dm-price { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.7; }
.dm-bars { display: flex; align-items: flex-end; gap: 3px; height: 132px; padding: 10px 2px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dm-bar { flex: 1; min-width: 2px; border-radius: 3px 3px 0 0; background: var(--dsw-alias-brand-primary); opacity: .72; position: relative; }
.dm-bar:hover { opacity: 1; }
.dm-bar[data-zero="true"] { background: var(--dsw-alias-border-l2); opacity: 1; min-height: 2px; }
.dm-axis { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }
.dm-empty { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; padding: 36px 24px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.8; }
.dm-empty strong { display: block; color: var(--dsw-alias-label-primary); font-size: 14px; margin-bottom: 6px; }
.dm-error { border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); border-radius: 10px; padding: 10px 12px; font-size: 12.5px; }
.dm-project { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.dm-project-head { display: flex; align-items: center; gap: 10px; padding: 11px 14px; flex-wrap: wrap; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dm-project-name { font-size: 13.5px; font-weight: 600; margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-project-meta { display: flex; gap: 12px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); flex-wrap: wrap; }
.dm-project-body { padding: 4px 0; }
.dm-task { border-top: 1px solid var(--dsw-alias-border-l1); }
.dm-task:first-child { border-top: 0; }
.dm-task-row { display: flex; align-items: center; gap: 10px; padding: 9px 14px; cursor: pointer; min-width: 0; }
.dm-task-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dm-task-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dm-task-title { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-task-sub { font-size: 10.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-task-nums { display: flex; gap: 14px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex-wrap: wrap; justify-content: flex-end; }
.dm-task-nums b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dm-task-models { padding: 2px 14px 10px 14px; }
.dm-mini-grid { display: grid; grid-template-columns: minmax(160px, 1.6fr) 70px 90px 110px 90px; gap: 8px; font-size: 11.5px; padding: 5px 8px; border-radius: 7px; align-items: center; }
.dm-mini-grid[data-head="true"] { color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.dm-mini-grid:nth-child(2n+1):not([data-head="true"]) { background: var(--dsw-alias-bg-base); }
.dm-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.42); display: flex; align-items: flex-start; justify-content: center; padding: 7vh 16px 16px; overflow: auto; }
.dm-modal { width: min(760px, 100%); background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.28); padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.dm-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dm-modal-title { margin: 0; font-size: 15px; font-weight: 600; }
.dm-modal-note { font-size: 11.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); margin: 0; }
.dm-price-list { display: flex; flex-direction: column; gap: 8px; max-height: 52vh; overflow: auto; padding-right: 2px; }
.dm-price-row { display: grid; grid-template-columns: minmax(150px, 1.5fr) repeat(4, minmax(58px, .7fr)) 56px; gap: 7px; align-items: center; }
.dm-price-row input { width: 100%; min-width: 0; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 4px 6px; font: inherit; font-size: 12px; }
.dm-price-name { font-size: 11.5px; min-width: 0; }
.dm-price-name b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.dm-price-name span { color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.dm-link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.dm-link:hover { text-decoration: underline; }
.dm-search { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12.5px; min-width: 190px; }
.dm-row-wrap { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dm-spacer { flex: 1; }
.dm-chevron { color: var(--dsw-alias-label-secondary); font-size: 11px; width: 14px; text-align: center; flex: none; }
.dm-charts { display: grid; grid-template-columns: minmax(240px, .9fr) minmax(340px, 1.4fr); gap: 10px; align-items: stretch; }
.dm-chart-card { display: flex; flex-direction: column; gap: 12px; }
.dm-chart-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
.dm-chart-title { font-size: 13px; font-weight: 600; }
.dm-chart-scroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 2px; }
.dm-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 8px; }
.dm-chart-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); max-width: 190px; }
.dm-donut { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.dm-donut-chart { position: relative; flex: 0 0 auto; }
.dm-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center; pointer-events: none; padding: 0 18px; }
.dm-donut-value { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dm-donut-label { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dm-legend { display: flex; flex-direction: column; gap: 6px; flex: 1 1 170px; min-width: 0; }
.dm-legend-row { display: flex; align-items: center; gap: 7px; font-size: 11.5px; min-width: 0; }
.dm-dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; display: inline-block; }
.dm-legend-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.dm-legend-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.dm-legend-pct { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); min-width: 42px; text-align: right; }
.dm-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.dm-metric { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); padding: 8px 10px; min-width: 0; }
.dm-metric-label { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 3px; }
.dm-metric-value { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; word-break: break-all; }
@media (max-width: 860px) { .dm-charts { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .dm-inner { padding: 14px 12px 56px; }
  .dm-card-value { font-size: 17px; }
}
`

    /** 注入样式，插件卸载时移除 */
    function installStyles(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-monitor', '')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove())
    }

    /* ------------------------------------------------------------------ */
    /* 格式化                                                             */
    /* ------------------------------------------------------------------ */

    const pad2 = (value) => String(value).padStart(2, '0')

    const fmtInt = (value) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      return Math.round(value).toLocaleString('zh-CN')
    }

    const fmtTokens = (value) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
      if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
      if (value >= 1e4) return `${(value / 1e3).toFixed(1)}k`
      return Math.round(value).toLocaleString('zh-CN')
    }

    const fmtCost = (value) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      if (value === 0) return '¥0'
      if (value < 0.01) return `¥${value.toFixed(4)}`
      if (value < 1) return `¥${value.toFixed(3)}`
      return `¥${value.toFixed(2)}`
    }

    const fmtPct = (value) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      return `${(value * 100).toFixed(1)}%`
    }

    const fmtClock = (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      const date = new Date(ms)
      return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    const fmtDay = (day) => (typeof day === 'string' ? day.slice(5) : '')

    const startOfDay = (ms) => {
      const date = new Date(ms)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    const rangeFrom = (rangeKey, now) => {
      switch (rangeKey) {
        case 'today': return startOfDay(now)
        case '7': return startOfDay(now - 6 * DAY)
        case '30': return startOfDay(now - 29 * DAY)
        default: return 0
      }
    }

    /** 图表配色：深浅色主题下都能看清 */
    const PALETTE = ['var(--dsw-alias-brand-primary)', '#28c76f', '#ff9f43', '#ea5455', '#7367f0', '#00cfe8']

    const metricValue = (row, metric) => {
      if (!row) return 0
      if (metric === 'calls') return row.calls || 0
      if (metric === 'cost') return row.cost || 0
      return row.tokens || 0
    }

    const fmtMetric = (value, metric) => (
      metric === 'cost' ? fmtCost(value) : metric === 'calls' ? fmtInt(value) : fmtTokens(value)
    )

    /* ------------------------------------------------------------------ */
    /* 小组件                                                             */
    /* ------------------------------------------------------------------ */

    function Pill({ tone, children }) {
      return h('span', { className: 'dm-pill', 'data-tone': tone || '' }, children)
    }

    function Hit({ rate }) {
      const pct = rate === null || rate === undefined ? 0 : Math.max(0, Math.min(1, rate))
      return h('div', { className: 'dm-hit', title: fmtPct(rate) },
        h('div', { className: 'dm-hit-track' },
          h('div', {
            className: 'dm-hit-fill',
            'data-low': pct < 0.3 ? 'true' : 'false',
            style: { width: `${(pct * 100).toFixed(1)}%` },
          })),
        h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', minWidth: '38px' } }, fmtPct(rate)))
    }

    function Collapse({ open, children }) {
      if (!open) return null
      return h('div', null, children)
    }

    function DailyBars({ days, metric, locale }) {
      const rows = Array.isArray(days) ? days : []
      const values = rows.map((row) => {
        if (metric === 'calls') return row.calls
        if (metric === 'cost') return row.cost || 0
        return row.tokens
      })
      const max = Math.max(1, ...values)
      return h('div', null,
        h('div', { className: 'dm-bars', role: 'img', 'aria-label': locale === 'en' ? 'Daily usage' : '每日用量' },
          rows.map((row, index) => {
            const value = values[index]
            const pct = Math.max(1, Math.round((value / max) * 100))
            const label = metric === 'cost' ? fmtCost(row.cost) : metric === 'calls' ? fmtInt(row.calls) : fmtTokens(row.tokens)
            return h('div', {
              key: row.day,
              className: 'dm-bar',
              'data-zero': value > 0 ? 'false' : 'true',
              style: { height: `${value > 0 ? pct : 3}%` },
              title: `${row.day} · ${label}`,
            })
          })),
        h('div', { className: 'dm-axis' },
          h('span', null, rows.length > 0 ? rows[0].day : ''),
          h('span', null, rows.length > 1 ? rows[rows.length - 1].day : '')))
    }

    /** 环形分布图（甜甜圈）：按占比展示各模型 / 各 token 类型 */
    function Donut({ slices, metric, size = 164, thickness = 18, center, t }) {
      const rows = (Array.isArray(slices) ? slices : []).filter((slice) => slice.value > 0)
      const total = rows.reduce((sum, slice) => sum + slice.value, 0)
      const radius = (size - thickness) / 2 - 1
      const circumference = 2 * Math.PI * radius
      let offset = 0
      return h('div', { className: 'dm-donut' },
        h('div', { className: 'dm-donut-chart', style: { width: `${size}px`, height: `${size}px` } },
          h('svg', {
            viewBox: `0 0 ${size} ${size}`,
            width: size,
            height: size,
            role: 'img',
            'aria-label': center ? String(center.label) : '',
          },
            h('circle', {
              cx: size / 2, cy: size / 2, r: radius,
              fill: 'none',
              stroke: 'var(--dsw-alias-border-l2)',
              strokeWidth: thickness,
            }),
            rows.map((slice, index) => {
              const length = total > 0 ? (slice.value / total) * circumference : 0
              const gap = Math.min(1.4, length * 0.2)
              const dash = `${Math.max(0, length - gap)} ${circumference - Math.max(0, length - gap)}`
              const rotation = (offset / Math.max(circumference, 1)) * 360 - 90
              offset += length
              return h('circle', {
                key: slice.key || slice.label || index,
                cx: size / 2,
                cy: size / 2,
                r: radius,
                fill: 'none',
                stroke: slice.color || PALETTE[index % PALETTE.length],
                strokeWidth: thickness,
                strokeDasharray: dash,
                strokeLinecap: 'butt',
                transform: `rotate(${rotation} ${size / 2} ${size / 2})`,
              })
            })),
          center
            ? h('div', { className: 'dm-donut-center' },
              h('span', { className: 'dm-donut-value' }, center.value),
              h('span', { className: 'dm-donut-label' }, center.label))
            : null),
        h('div', { className: 'dm-legend' },
          rows.length === 0
            ? h('span', { className: 'dm-muted', style: { fontSize: '11.5px' } }, t('chart.empty'))
            : rows.map((slice, index) => {
              const pct = total > 0 ? (slice.value / total) * 100 : 0
              return h('div', { className: 'dm-legend-row', key: slice.key || slice.label || index },
                h('span', {
                  className: 'dm-dot',
                  style: { background: slice.color || PALETTE[index % PALETTE.length] },
                }),
                h('span', { className: 'dm-legend-label', title: slice.label }, slice.label),
                h('span', { className: 'dm-legend-value' }, fmtMetric(slice.value, metric)),
                h('span', { className: 'dm-legend-pct' }, `${pct.toFixed(1)}%`))
            })))
    }

    /** 多序列折线对比图：每个序列一条线，按天对齐 */
    function TrendChart({ series, days, metric, t, height = 156 }) {
      const rows = Array.isArray(days) ? days : []
      const lines = (Array.isArray(series) ? series : []).filter((line) => line.points && line.points.length > 0)
      const width = Math.max(300, rows.length * 24)
      const padL = 40
      const padR = 10
      const padT = 12
      const padB = 20
      const innerW = Math.max(1, width - padL - padR)
      const innerH = Math.max(1, height - padT - padB)
      const max = Math.max(1, ...lines.flatMap((line) => line.points.map((point) => metricValue(point, metric))))
      const xAt = (index) => padL + (rows.length <= 1 ? innerW / 2 : (index * innerW) / (rows.length - 1))
      const yAt = (value) => padT + (1 - value / max) * innerH
      const ticks = [1, 0.5, 0]
      const labelIndexes = rows.length <= 1 ? [0] : [0, Math.floor((rows.length - 1) / 2), rows.length - 1]
      return h('div', null,
        h('div', { className: 'dm-chart-legend' },
          lines.map((line, index) => h('span', { className: 'dm-chart-legend-item', key: line.key || index },
            h('span', { className: 'dm-dot', style: { background: line.color || PALETTE[index % PALETTE.length] } }),
            h('span', { className: 'dm-legend-label', title: line.label }, line.label)))),
        rows.length === 0 || lines.length === 0
          ? h('div', { className: 'dm-empty', style: { border: 0, padding: '24px 12px' } }, t('chart.empty'))
          : h('div', { className: 'dm-chart-scroll' },
            h('svg', {
              viewBox: `0 0 ${width} ${height}`,
              width,
              height,
              role: 'img',
              'aria-label': t('chart.trend'),
              style: { display: 'block' },
            },
              ticks.map((tick) => {
                const value = max * tick
                const y = yAt(value)
                return h('g', { key: `tick-${tick}` },
                  h('line', {
                    x1: padL, x2: width - padR, y1: y, y2: y,
                    stroke: 'var(--dsw-alias-border-l1)',
                    strokeWidth: '1',
                    strokeDasharray: tick === 0 ? '0' : '3 3',
                  }),
                  h('text', {
                    x: padL - 6, y: y + 3.5, textAnchor: 'end',
                    fontSize: '9.5', fill: 'var(--dsw-alias-label-secondary)',
                  }, fmtMetric(value, metric)))
              }),
              labelIndexes.map((index) => h('text', {
                key: `day-${index}`,
                x: xAt(index),
                y: height - 6,
                textAnchor: index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle',
                fontSize: '9.5',
                fill: 'var(--dsw-alias-label-secondary)',
              }, fmtDay(rows[index]))),
              lines.map((line, index) => {
                const color = line.color || PALETTE[index % PALETTE.length]
                const points = line.points.map((point, pointIndex) => `${xAt(pointIndex)},${yAt(metricValue(point, metric))}`)
                return h('g', { key: line.key || index },
                  rows.length > 1
                    ? h('polyline', {
                      points: points.join(' '),
                      fill: 'none',
                      stroke: color,
                      strokeWidth: '1.8',
                      strokeLinejoin: 'round',
                      strokeLinecap: 'round',
                      opacity: '0.9',
                    })
                    : null,
                  line.points.map((point, pointIndex) => h('circle', {
                    key: `${line.key || index}-${pointIndex}`,
                    cx: xAt(pointIndex),
                    cy: yAt(metricValue(point, metric)),
                    r: rows.length > 60 ? 1.4 : 2.1,
                    fill: color,
                  }, h('title', null, `${fmtDay(rows[pointIndex])} · ${fmtMetric(metricValue(point, metric), metric)}`))))
              }))))
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'dm-empty' },
            h('strong', null, '监控台渲染失败'),
            h('div', null, String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)))
        }
        return this.props.children
      }
    }

    /* ------------------------------------------------------------------ */
    /* 定价对话框                                                         */
    /* ------------------------------------------------------------------ */

    const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite']

    function PricingDialog({ models, config, t, onClose, onSaved }) {
      const [draft, setDraft] = useState({})
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')

      useEffect(() => {
        const next = {}
        const overrides = (config && config.pricing) || {}
        for (const model of models) {
          const existing = overrides[model.key] || {}
          const row = {}
          for (const field of PRICE_FIELDS) {
            row[field] = typeof existing[field] === 'number' ? String(existing[field]) : ''
          }
          next[model.key] = row
        }
        setDraft(next)
      }, [models, config])

      const setField = (key, field, value) => {
        setDraft((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: value } }))
      }

      const placeholder = (model, field) => {
        if (model.price && model.priceSource === 'custom') return String(model.price[field])
        return ''
      }

      const save = async () => {
        setSaving(true)
        setError('')
        try {
          const pricing = {}
          for (const [key, row] of Object.entries(draft)) {
            const price = {}
            let complete = true
            for (const field of PRICE_FIELDS) {
              const text = String(row[field] ?? '').trim()
              if (text === '') {
                complete = false
                break
              }
              const value = Number(text)
              if (!Number.isFinite(value) || value < 0) throw new Error(t('price.invalid'))
              price[field] = value
            }
            if (complete) pricing[key] = price
          }
          const response = await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pricing }),
          })
          const body = await response.json()
          if (!body || body.ok !== true) throw new Error(body && body.error ? body.error : 'save failed')
          onSaved()
          onClose()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setSaving(false)
        }
      }

      return h('div', {
        className: 'dm-overlay',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onClose()
        },
      }, h('div', { className: 'dm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('price.title') },
        h('div', { className: 'dm-modal-head' },
          h('h2', { className: 'dm-modal-title' }, t('price.title')),
          h('button', { className: 'dm-btn', onClick: onClose, 'aria-label': t('common.close') }, t('common.close'))),
        h('p', { className: 'dm-modal-note' }, t('price.note')),
        error ? h('div', { className: 'dm-error' }, error) : null,
        h('div', { className: 'dm-price-list' },
          models.length === 0
            ? h('div', { className: 'dm-muted', style: { fontSize: '12px' } }, t('price.empty'))
            : models.map((model) => h('div', { className: 'dm-price-row', key: model.key },
              h('div', { className: 'dm-price-name' },
                h('b', { title: model.model }, model.model),
                h('span', null, `${model.providerLabel} · ${model.priceSource === 'custom' ? t('price.custom') : model.priceSource === 'official' ? t('price.official') : t('price.none')}`)),
              PRICE_FIELDS.map((field) => h('input', {
                key: field,
                type: 'number',
                min: '0',
                step: '0.01',
                inputMode: 'decimal',
                value: (draft[model.key] || {})[field] ?? '',
                placeholder: placeholder(model, field),
                'aria-label': `${model.model} ${field}`,
                onChange: (event) => setField(model.key, field, event.target.value),
              })),
              h('button', {
                className: 'dm-btn',
                style: { padding: '4px 8px' },
                onClick: () => {
                  const empty = {}
                  for (const field of PRICE_FIELDS) empty[field] = ''
                  setDraft((prev) => ({ ...prev, [model.key]: empty }))
                },
              }, t('price.reset')))),
        h('div', { className: 'dm-modal-head' },
          h('span', { className: 'dm-price' }, t('price.fields')),
          h('div', { className: 'dm-actions' },
            h('button', { className: 'dm-btn', onClick: onClose }, t('common.cancel')),
            h('button', { className: 'dm-btn', 'data-primary': 'true', disabled: saving, onClick: save }, saving ? t('common.saving') : t('common.save')))))))
    }

    /* ------------------------------------------------------------------ */
    /* 主面板                                                             */
    /* ------------------------------------------------------------------ */

    function MonitorPanel({ locale }) {
      const snapshot = useSyncExternalStore(
        (fn) => locale.subscribe(fn),
        () => locale.getSnapshot(),
        () => locale.getSnapshot(),
      )
      const isEn = /^en/i.test(String((snapshot && snapshot.active) || 'zh'))
      const t = useCallback((key, vars) => {
        const table = isEn ? EN : ZH
        let text = table[key] || ZH[key] || key
        if (vars) {
          for (const [name, value] of Object.entries(vars)) {
            text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value))
          }
        }
        return text
      }, [isEn])

      const [rangeKey, setRangeKey] = useState(() => {
        try {
          return localStorage.getItem(RANGE_KEY) || '7'
        } catch {
          return '7'
        }
      })
      const [view, setView] = useState(() => {
        try {
          return localStorage.getItem(VIEW_KEY) || 'models'
        } catch {
          return 'models'
        }
      })
      const [data, setData] = useState(null)
      const [config, setConfig] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [selectedModel, setSelectedModel] = useState(null)
      const [metric, setMetric] = useState('tokens')
      const [chartMetric, setChartMetric] = useState('tokens')
      const [search, setSearch] = useState('')
      const [openTasks, setOpenTasks] = useState({})
      const [openProjects, setOpenProjects] = useState({})
      const [pricingOpen, setPricingOpen] = useState(false)
      const requestRef = useRef(0)

      useEffect(() => {
        try {
          localStorage.setItem(RANGE_KEY, rangeKey)
        } catch {
          // 隐私模式忽略
        }
      }, [rangeKey])

      useEffect(() => {
        try {
          localStorage.setItem(VIEW_KEY, view)
        } catch {
          // 隐私模式忽略
        }
      }, [view])

      const loadConfig = useCallback(async () => {
        try {
          const response = await fetch(`${API}/config`, { cache: 'no-store' })
          const body = await response.json()
          if (body && body.ok === true) setConfig(body)
        } catch {
          // 配置读不到不影响用量展示
        }
      }, [])

      const load = useCallback(async () => {
        const ticket = requestRef.current + 1
        requestRef.current = ticket
        setLoading(true)
        try {
          const now = Date.now()
          const from = rangeFrom(rangeKey, now)
          const response = await fetch(`${API}/data?from=${from}&to=${now}&_=${now}`, { cache: 'no-store' })
          const body = await response.json()
          if (ticket !== requestRef.current) return
          if (!body || body.ok !== true) throw new Error(body && body.error ? body.error : 'bad response')
          setData(body)
          setError('')
        } catch (err) {
          if (ticket !== requestRef.current) return
          setError(String(err && err.message ? err.message : err))
        } finally {
          if (ticket === requestRef.current) setLoading(false)
        }
      }, [rangeKey])

      useEffect(() => {
        load()
      }, [load])

      useEffect(() => {
        loadConfig()
      }, [loadConfig])

      useEffect(() => {
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          load()
        }, 15000)
        return () => clearInterval(timer)
      }, [load])

      const models = (data && data.models) || []
      const tasks = (data && data.tasks) || []
      const totals = (data && data.totals) || null

      useEffect(() => {
        if (selectedModel && !models.some((model) => model.key === selectedModel)) setSelectedModel(null)
      }, [models, selectedModel])

      const currentModel = selectedModel ? models.find((model) => model.key === selectedModel) : null

      const daySeries = useMemo(() => {
        if (!data) return []
        const now = Date.now()
        const from = rangeFrom(rangeKey, now)
        const start = startOfDay(from > 0 ? from : (data.days && data.days.length > 0 ? Date.parse(`${data.days[0].day}T00:00:00`) : startOfDay(now)))
        const source = currentModel ? currentModel.days : (data.days || [])
        const byDay = new Map(source.map((row) => [row.day, row]))
        const rows = []
        let cursor = start
        const maxDays = 190
        while (cursor <= now && rows.length < maxDays) {
          const date = new Date(cursor)
          const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
          const found = byDay.get(key)
          rows.push(found || { day: key, calls: 0, tokens: 0, cost: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
          cursor += DAY
        }
        return rows
      }, [data, currentModel, rangeKey])

      const modelsWithPrice = useMemo(() => models, [models])

      const filteredTasks = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return tasks
        return tasks.filter((task) => (
          String(task.title || '').toLowerCase().includes(query)
          || String(task.project || '').toLowerCase().includes(query)
          || String(task.cwd || '').toLowerCase().includes(query)
        ))
      }, [tasks, search])

      const grouped = useMemo(() => {
        const map = new Map()
        for (const task of filteredTasks) {
          const key = task.project || '(未知项目)'
          if (!map.has(key)) map.set(key, [])
          map.get(key).push(task)
        }
        return [...map.entries()]
          .map(([project, rows]) => ({
            project,
            cwd: rows[0].cwd || '',
            tasks: rows,
            calls: rows.reduce((sum, task) => sum + task.calls, 0),
            tokens: rows.reduce((sum, task) => sum + task.tokens, 0),
            cost: rows.some((task) => task.cost !== null) ? rows.reduce((sum, task) => sum + (task.cost || 0), 0) : null,
            unpriced: rows.reduce((sum, task) => sum + task.unpricedCalls, 0),
            models: mergeProjectModels(rows),
          }))
          .sort((left, right) => right.calls - left.calls)
      }, [filteredTasks])

      const taskById = useMemo(() => {
        const map = new Map()
        for (const task of tasks) map.set(task.id, task)
        return map
      }, [tasks])

      const chartModels = useMemo(() => (
        [...models].sort((left, right) => metricValue(right, chartMetric) - metricValue(left, chartMetric))
      ), [models, chartMetric])

      const shareSlices = useMemo(() => {
        const ranked = chartModels.filter((model) => metricValue(model, chartMetric) > 0)
        const slices = ranked.slice(0, 4).map((model, index) => ({
          key: model.key,
          label: `${model.model} · ${model.providerLabel}`,
          value: metricValue(model, chartMetric),
          color: PALETTE[index % PALETTE.length],
        }))
        const rest = ranked.slice(4).reduce((sum, model) => sum + metricValue(model, chartMetric), 0)
        if (rest > 0) slices.push({ key: '__other', label: t('chart.other'), value: rest, color: 'var(--dsw-alias-border-l2)' })
        return slices
      }, [chartModels, chartMetric, t])

      const trendSeries = useMemo(() => (
        chartModels
          .filter((model) => metricValue(model, chartMetric) > 0)
          .slice(0, 4)
          .map((model, index) => {
            const byDay = new Map((model.days || []).map((row) => [row.day, row]))
            return {
              key: model.key,
              label: `${model.model} · ${model.providerLabel}`,
              color: PALETTE[index % PALETTE.length],
              points: daySeries.map((row) => byDay.get(row.day) || { day: row.day, calls: 0, tokens: 0, cost: null }),
            }
          })
      ), [chartModels, chartMetric, daySeries])

      const rangeOptions = [
        ['today', t('range.today')],
        ['7', t('range.7')],
        ['30', t('range.30')],
        ['all', t('range.all')],
      ]

      const header = h('div', { className: 'dm-head' },
        h('div', { style: { minWidth: 0 } },
          h('h1', { className: 'dm-title' }, t('panel.title')),
          h('p', { className: 'dm-sub' }, t('panel.subtitle'))),
        h('div', { className: 'dm-actions' },
          h('div', { className: 'dm-seg', role: 'group', 'aria-label': t('range.label') },
            rangeOptions.map(([key, label]) => h('button', {
              key,
              type: 'button',
              'data-on': rangeKey === key ? 'true' : 'false',
              onClick: () => setRangeKey(key),
            }, label))),
          h('button', { className: 'dm-btn', onClick: () => load(), disabled: loading }, loading ? t('common.loading') : t('common.refresh')),
          h('button', { className: 'dm-btn', onClick: () => setPricingOpen(true) }, t('price.button'))))

      const cards = totals && h('div', { className: 'dm-cards' },
        h('div', { className: 'dm-card' },
          h('div', { className: 'dm-card-label' }, t('stat.calls')),
          h('div', { className: 'dm-card-value' }, fmtInt(totals.calls)),
          h('div', { className: 'dm-card-note' }, t('stat.calls.note', { models: fmtInt(totals.models), tasks: fmtInt(totals.tasks) }))),
        h('div', { className: 'dm-card' },
          h('div', { className: 'dm-card-label' }, t('stat.tokens')),
          h('div', { className: 'dm-card-value' }, fmtTokens(totals.tokens)),
          h('div', { className: 'dm-card-note' }, t('stat.tokens.note', { input: fmtTokens(totals.input), output: fmtTokens(totals.output) }))),
        h('div', { className: 'dm-card' },
          h('div', { className: 'dm-card-label' }, t('stat.hit')),
          h('div', { className: 'dm-card-value' }, fmtPct(totals.hitRate)),
          h('div', { className: 'dm-card-note' }, t('stat.hit.note', { read: fmtTokens(totals.cacheRead), write: fmtTokens(totals.cacheWrite) }))),
        h('div', { className: 'dm-card' },
          h('div', { className: 'dm-card-label' }, t('stat.cost')),
          h('div', { className: 'dm-card-value' }, fmtCost(totals.cost)),
          h('div', { className: 'dm-card-note' }, totals.unpricedCalls > 0
            ? t('stat.cost.unpriced', { n: fmtInt(totals.unpricedCalls) })
            : t('stat.cost.note'))),
        h('div', { className: 'dm-card' },
          h('div', { className: 'dm-card-label' }, t('stat.projects')),
          h('div', { className: 'dm-card-value' }, fmtInt(totals.projects)),
          h('div', { className: 'dm-card-note' }, t('stat.projects.note', { tasks: fmtInt(totals.tasks) }))))

      const chartMetricLabels = [
        ['tokens', t('metric.tokens')],
        ['calls', t('metric.calls')],
        ['cost', t('metric.cost')],
      ]

      const overview = totals && totals.calls > 0 && !currentModel && h('div', { className: 'dm-charts' },
        h('div', { className: 'dm-card-block dm-chart-card' },
          h('div', { className: 'dm-chart-head' },
            h('span', { className: 'dm-chart-title' }, t('chart.share')),
            h('div', { className: 'dm-seg', role: 'group', 'aria-label': t('chart.share') },
              chartMetricLabels.map(([key, label]) => h('button', {
                key,
                type: 'button',
                'data-on': chartMetric === key ? 'true' : 'false',
                onClick: () => setChartMetric(key),
              }, label)))),
          h(Donut, {
            slices: shareSlices,
            metric: chartMetric,
            size: 156,
            center: {
              value: fmtMetric(
                chartMetric === 'cost' ? totals.cost : chartMetric === 'calls' ? totals.calls : totals.tokens,
                chartMetric,
              ),
              label: t('chart.total'),
            },
            t,
          })),
        h('div', { className: 'dm-card-block dm-chart-card' },
          h('div', { className: 'dm-chart-head' },
            h('span', { className: 'dm-chart-title' }, t('chart.trend')),
            h('span', { className: 'dm-muted', style: { fontSize: '11px' } }, t('chart.trend.note'))),
          h(TrendChart, { series: trendSeries, days: daySeries, metric: chartMetric, t })))

      const tabs = h('div', { className: 'dm-tabs', role: 'tablist' },
        h('button', {
          className: 'dm-tab', role: 'tab', type: 'button',
          'data-on': view === 'models' ? 'true' : 'false',
          onClick: () => setView('models'),
        }, t('tab.models', { n: fmtInt(models.length) })),
        h('button', {
          className: 'dm-tab', role: 'tab', type: 'button',
          'data-on': view === 'tasks' ? 'true' : 'false',
          onClick: () => setView('tasks'),
        }, t('tab.tasks', { n: fmtInt(tasks.length) })))

      const empty = h('div', { className: 'dm-empty' },
        h('strong', null, t('empty.title')),
        h('div', null, t('empty.body')),
        h('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          h('button', { className: 'dm-btn', onClick: () => load() }, t('common.refresh')),
          h('button', {
            className: 'dm-btn',
            onClick: async () => {
              try {
                await fetch(`${API}/rescan`, { method: 'POST' })
              } catch {
                // 忽略；下一次轮询会刷新
              }
              setTimeout(() => load(), 1200)
            },
          }, t('empty.rescan'))))

      let body
      if (error) {
        body = h('div', { className: 'dm-error' }, t('error.load', { message: error }))
      } else if (!data) {
        body = h('div', { className: 'dm-empty' }, t('common.loading'))
      } else if (totals && totals.calls === 0) {
        body = empty
      } else if (view === 'models') {
        body = currentModel
          ? h(ModelDetail, {
            model: currentModel,
            t,
            isEn,
            metric,
            setMetric,
            series: daySeries,
            taskById,
            onBack: () => setSelectedModel(null),
            onOpenTask: (taskId) => {
              setView('tasks')
              setOpenTasks((prev) => ({ ...prev, [taskId]: true }))
            },
          })
          : h(ModelList, {
            models,
            t,
            onSelect: (key) => setSelectedModel(key),
          })
      } else {
        body = h(TaskView, {
          t,
          groups: grouped,
          search,
          setSearch,
          openTasks,
          setOpenTasks,
          openProjects,
          setOpenProjects,
          onOpenModel: (key) => {
            setSelectedModel(key)
            setView('models')
          },
          unpriced: totals ? totals.unpricedCalls : 0,
        })
      }

      return h('div', { className: 'dm-root' },
        h('div', { className: 'dm-inner' },
          header,
          cards,
          overview,
          tabs,
          body,
          data ? h('div', { className: 'dm-muted', style: { fontSize: '11px', lineHeight: 1.7 } },
            t('footer.note', {
              records: fmtInt(data.scan ? data.scan.records : 0),
              sessions: fmtInt(data.scan ? data.scan.sessions : 0),
              when: fmtClock(data.generatedAt),
            }),
            data.scanning ? ` · ${t('footer.scanning')}` : '',
            h('br'),
            h('a', { className: 'dm-link', href: (config && config.usageUrl) || 'https://platform.deepseek.com/usage', target: '_blank', rel: 'noreferrer' }, t('footer.official')),
            ' · ',
            h('a', { className: 'dm-link', href: (config && config.officialPricingUrl) || 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', target: '_blank', rel: 'noreferrer' }, t('footer.pricing'))) : null),
        pricingOpen ? h(PricingDialog, {
          models: modelsWithPrice,
          config,
          t,
          onClose: () => setPricingOpen(false),
          onSaved: () => {
            loadConfig()
            load()
          },
        }) : null)
    }

    /** 项目内模型汇总（同名模型按 provider::model 分开） */
    function mergeProjectModels(rows) {
      const map = new Map()
      for (const task of rows) {
        for (const model of task.models || []) {
          let entry = map.get(model.key)
          if (!entry) {
            entry = {
              key: model.key, provider: model.provider, providerLabel: model.providerLabel,
              model: model.model, calls: 0, tokens: 0, cost: 0, priced: 0, unpriced: 0,
              input: 0, cacheRead: 0, cacheWrite: 0,
            }
            map.set(model.key, entry)
          }
          entry.calls += model.calls
          entry.tokens += model.tokens
          entry.input += model.input
          entry.cacheRead += model.cacheRead
          entry.cacheWrite += model.cacheWrite
          if (model.cost !== null) {
            entry.cost += model.cost
            entry.priced += model.pricedCalls
          } else {
            entry.unpriced += model.unpricedCalls
          }
        }
      }
      return [...map.values()]
        .map((entry) => ({
          ...entry,
          cost: entry.priced > 0 ? entry.cost : null,
          hitRate: entry.input + entry.cacheRead + entry.cacheWrite > 0
            ? entry.cacheRead / (entry.input + entry.cacheRead + entry.cacheWrite)
            : null,
        }))
        .sort((left, right) => right.tokens - left.tokens)
    }

    function ModelList({ models, t, onSelect }) {
      return h('div', { className: 'dm-table' },
        h('div', { className: 'dm-table-scroll' },
          h('div', {
            className: 'dm-grid-head',
            style: { gridTemplateColumns: 'minmax(220px, 1.6fr) 74px 96px 132px 96px' },
          },
            h('span', null, t('col.model')),
            h('span', { className: 'dm-right' }, t('col.calls')),
            h('span', { className: 'dm-right' }, t('col.tokens')),
            h('span', null, t('col.hit')),
            h('span', { className: 'dm-right' }, t('col.cost'))),
          models.map((model) => h('div', {
            key: model.key,
            className: 'dm-grid-row',
            style: { gridTemplateColumns: 'minmax(220px, 1.6fr) 74px 96px 132px 96px' },
            role: 'button',
            tabIndex: 0,
            onClick: () => onSelect(model.key),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(model.key)
              }
            },
          },
            h('div', { className: 'dm-c-model' },
              h('div', { className: 'dm-stack', style: { minWidth: 0 } },
                h('span', { className: 'dm-model-name', title: model.model }, model.model),
                h('span', { className: 'dm-provider' }, model.providerLabel)),
              model.priceSource === 'none'
                ? h(Pill, { tone: 'warn' }, t('badge.unpriced'))
                : model.priceSource === 'custom'
                  ? h(Pill, null, t('badge.custom'))
                  : h(Pill, { tone: 'brand' }, t('badge.official'))),
            h('span', { className: 'dm-num' }, fmtInt(model.calls)),
            h('span', { className: 'dm-num' }, fmtTokens(model.tokens)),
            h(Hit, { rate: model.hitRate }),
            h('span', { className: 'dm-num' }, fmtCost(model.cost))))),
        models.length === 0 ? h('div', { className: 'dm-empty', style: { border: 0 } }, t('empty.range')) : null)
    }

    function priceLine(model, t) {
      const price = model.price
      if (!price) return t('price.unpriced')
      if (model.priceSource === 'official' && price.peak && price.offPeak) {
        return t('price.officialUnit', {
          inP: price.peak.input, inO: price.offPeak.input,
          outP: price.peak.output, outO: price.offPeak.output,
        })
      }
      return t('price.unit', {
        input: price.input, output: price.output, cacheRead: price.cacheRead, cacheWrite: price.cacheWrite,
      })
    }

    function ModelDetail({ model, t, isEn, metric, setMetric, series, taskById, onBack, onOpenTask }) {
      const metrics = [['tokens', t('metric.tokens')], ['calls', t('metric.calls')], ['cost', t('metric.cost')]]
      return h('div', { className: 'dm-section' },
        h('div', { className: 'dm-row-wrap' },
          h('button', { className: 'dm-btn', onClick: onBack }, t('common.back')),
          h('div', { style: { minWidth: 0 } },
            h('h2', { className: 'dm-detail-title' }, model.model),
            h('div', { className: 'dm-price' },
              `${model.providerLabel} · ${model.provider}`,
              ` · ${priceLine(model, t)}`))),
        h('div', { className: 'dm-cards' },
          h('div', { className: 'dm-card' },
            h('div', { className: 'dm-card-label' }, t('col.calls')),
            h('div', { className: 'dm-card-value' }, fmtInt(model.calls))),
          h('div', { className: 'dm-card' },
            h('div', { className: 'dm-card-label' }, t('col.tokens')),
            h('div', { className: 'dm-card-value' }, fmtTokens(model.tokens)),
            h('div', { className: 'dm-card-note' }, t('detail.tokens.note', {
              input: fmtTokens(model.input), output: fmtTokens(model.output),
              read: fmtTokens(model.cacheRead), write: fmtTokens(model.cacheWrite),
            }))),
          h('div', { className: 'dm-card' },
            h('div', { className: 'dm-card-label' }, t('col.hit')),
            h('div', { className: 'dm-card-value' }, fmtPct(model.hitRate)),
            h('div', { className: 'dm-card-note' }, t('stat.hit.note', { read: fmtTokens(model.cacheRead), write: fmtTokens(model.cacheWrite) }))),
          h('div', { className: 'dm-card' },
            h('div', { className: 'dm-card-label' }, t('col.cost')),
            h('div', { className: 'dm-card-value' }, fmtCost(model.cost)),
            h('div', { className: 'dm-card-note' }, model.unpricedCalls > 0
              ? t('stat.cost.unpriced', { n: fmtInt(model.unpricedCalls) })
              : model.priceSource === 'custom' ? t('detail.price.custom') : t('detail.price.official')))),
        h('div', { className: 'dm-card-block' },
          h('div', { className: 'dm-row-wrap', style: { marginBottom: '6px' } },
            h('h3', { className: 'dm-section-title' }, t('detail.daily')),
            h('div', { className: 'dm-spacer' }),
            h('div', { className: 'dm-seg' }, metrics.map(([key, label]) => h('button', {
              key, type: 'button',
              'data-on': metric === key ? 'true' : 'false',
              onClick: () => setMetric(key),
            }, label)))),
          h(DailyBars, { days: series, metric, locale: isEn ? 'en' : 'zh' })),
        h('div', { className: 'dm-chart-card' },
          h('div', { className: 'dm-chart-head' },
            h('h3', { className: 'dm-section-title' }, t('detail.composition')),
            h('span', { className: 'dm-muted', style: { fontSize: '11px' } }, t('detail.composition.note'))),
          h(Donut, {
            slices: [
              { key: 'input', label: t('mix.input'), value: model.input || 0, color: PALETTE[0] },
              { key: 'cacheRead', label: t('mix.cacheRead'), value: model.cacheRead || 0, color: PALETTE[1] },
              { key: 'cacheWrite', label: t('mix.cacheWrite'), value: model.cacheWrite || 0, color: PALETTE[2] },
              { key: 'output', label: t('mix.output'), value: model.output || 0, color: PALETTE[3] },
            ],
            metric: 'tokens',
            size: 152,
            center: { value: fmtTokens(model.tokens), label: t('detail.tokens') },
            t,
          }),
          h('div', { className: 'dm-metrics' },
            h('div', { className: 'dm-metric' },
              h('div', { className: 'dm-metric-label' }, t('detail.avgTokens')),
              h('div', { className: 'dm-metric-value' }, model.calls > 0 ? fmtTokens(Math.round(model.tokens / model.calls)) : '—')),
            h('div', { className: 'dm-metric' },
              h('div', { className: 'dm-metric-label' }, t('detail.avgOutput')),
              h('div', { className: 'dm-metric-value' }, model.calls > 0 ? fmtTokens(Math.round((model.output || 0) / model.calls)) : '—')),
            h('div', { className: 'dm-metric' },
              h('div', { className: 'dm-metric-label' }, t('detail.avgCost')),
              h('div', { className: 'dm-metric-value' }, model.calls > 0 && model.cost !== null ? fmtCost(model.cost / model.calls) : '—')),
            h('div', { className: 'dm-metric' },
              h('div', { className: 'dm-metric-label' }, t('detail.firstAt')),
              h('div', { className: 'dm-metric-value' }, model.firstAt ? fmtClock(model.firstAt) : '—')),
            h('div', { className: 'dm-metric' },
              h('div', { className: 'dm-metric-label' }, t('detail.lastAt')),
              h('div', { className: 'dm-metric-value' }, model.lastAt ? fmtClock(model.lastAt) : '—')),
            h('div', { className: 'dm-metric' },
              h('div', { className: 'dm-metric-label' }, t('detail.unpriced')),
              h('div', { className: 'dm-metric-value' }, fmtInt(model.unpricedCalls || 0))))),
        h('div', { className: 'dm-section' },
          h('h3', { className: 'dm-section-title' }, t('detail.tasks', { n: fmtInt(model.tasks.length) })),
          h('div', { className: 'dm-table' },
            h('div', { className: 'dm-table-scroll' },
              h('div', {
                className: 'dm-grid-head',
                style: { gridTemplateColumns: 'minmax(240px, 2fr) 150px 74px 96px 96px' },
              },
                h('span', null, t('col.task')),
                h('span', null, t('col.project')),
                h('span', { className: 'dm-right' }, t('col.calls')),
                h('span', { className: 'dm-right' }, t('col.tokens')),
                h('span', { className: 'dm-right' }, t('col.cost'))),
              model.tasks.map((row) => {
                const task = taskById.get(row.taskId)
                return h('div', {
                  key: row.taskId,
                  className: 'dm-grid-row',
                  style: { gridTemplateColumns: 'minmax(240px, 2fr) 150px 74px 96px 96px' },
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => onOpenTask(row.taskId),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenTask(row.taskId)
                    }
                  },
                },
                  h('span', { className: 'dm-task-title', title: task ? task.title : row.taskId }, task ? task.title : row.taskId),
                  h('span', { className: 'dm-muted', title: task ? task.project : '' }, task ? task.project : '—'),
                  h('span', { className: 'dm-num' }, fmtInt(row.calls)),
                  h('span', { className: 'dm-num' }, fmtTokens(row.tokens)),
                  h('span', { className: 'dm-num' }, fmtCost(row.cost)))
              })))))
    }

    function TaskView({ t, groups, search, setSearch, openTasks, setOpenTasks, openProjects, setOpenProjects, onOpenModel }) {
      return h('div', { className: 'dm-section' },
        h('div', { className: 'dm-row-wrap' },
          h('h3', { className: 'dm-section-title' }, t('tasks.title', { groups: fmtInt(groups.length) })),
          h('div', { className: 'dm-spacer' }),
          h('input', {
            className: 'dm-search',
            type: 'search',
            value: search,
            placeholder: t('tasks.search'),
            'aria-label': t('tasks.search'),
            onChange: (event) => setSearch(event.target.value),
          })),
        groups.length === 0 ? h('div', { className: 'dm-empty' }, t('tasks.empty')) : null,
        groups.map((group) => {
          const projectOpen = Boolean(openProjects[group.project])
          return h('div', { className: 'dm-project', key: group.project },
            h('div', { className: 'dm-project-head' },
              h('h3', { className: 'dm-project-name', title: group.cwd || group.project }, group.project),
              h('div', { className: 'dm-project-meta' },
                h('span', null, t('tasks.tasksN', { n: fmtInt(group.tasks.length) })),
                h('span', null, t('tasks.callsN', { n: fmtInt(group.calls) })),
                h('span', null, t('tasks.tokensN', { n: fmtTokens(group.tokens) })),
                h('span', null, t('tasks.costN', { n: fmtCost(group.cost) })),
                group.unpriced > 0 ? h(Pill, { tone: 'warn' }, t('badge.unpriced')) : null),
              h('div', { className: 'dm-spacer' }),
              h('button', {
                className: 'dm-btn',
                onClick: () => setOpenProjects((prev) => ({ ...prev, [group.project]: !prev[group.project] })),
              }, projectOpen ? t('tasks.hideModels') : t('tasks.showModels'))),
            h(Collapse, { open: projectOpen },
              h('div', { className: 'dm-task-models', style: { paddingTop: '8px' } },
                h(Donut, {
                  slices: [...group.models]
                    .sort((left, right) => (right.tokens || 0) - (left.tokens || 0))
                    .slice(0, 5)
                    .map((row, index) => ({
                      key: row.key,
                      label: `${row.model} · ${row.providerLabel}`,
                      value: row.tokens || 0,
                      color: PALETTE[index % PALETTE.length],
                    })),
                  metric: 'tokens',
                  size: 148,
                  center: { value: fmtTokens(group.tokens), label: t('chart.total') },
                  t,
                }),
                h('div', { className: 'dm-mini-grid', 'data-head': 'true' },
                  h('span', null, t('col.model')),
                  h('span', { className: 'dm-right' }, t('col.calls')),
                  h('span', { className: 'dm-right' }, t('col.tokens')),
                  h('span', { className: 'dm-right' }, t('col.cost')),
                  h('span', null, t('col.hit'))),
                group.models.map((model) => h('div', { className: 'dm-mini-grid', key: model.key },
                  h('div', { className: 'dm-stack' },
                    h('span', { className: 'dm-model-name', style: { fontSize: '11.5px' } }, model.model),
                    h('span', { className: 'dm-provider' }, model.providerLabel)),
                  h('span', { className: 'dm-num' }, fmtInt(model.calls)),
                  h('span', { className: 'dm-num' }, fmtTokens(model.tokens)),
                  h('span', { className: 'dm-num' }, fmtCost(model.priced > 0 ? model.cost : null)),
                  h('button', { className: 'dm-btn', style: { padding: '2px 6px', fontSize: '10.5px' }, onClick: () => onOpenModel(model.key) }, t('tasks.openModel')))))),
            h('div', { className: 'dm-project-body' },
              group.tasks.map((task) => {
                const open = Boolean(openTasks[task.id])
                return h('div', { className: 'dm-task', key: task.id },
                  h('div', {
                    className: 'dm-task-row',
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => setOpenTasks((prev) => ({ ...prev, [task.id]: !prev[task.id] })),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setOpenTasks((prev) => ({ ...prev, [task.id]: !prev[task.id] }))
                      }
                    },
                  },
                    h('span', { className: 'dm-chevron' }, open ? '▾' : '▸'),
                    h('div', { className: 'dm-task-main' },
                      h('span', { className: 'dm-task-title', title: task.title }, task.title),
                      h('span', { className: 'dm-task-sub' },
                        t('tasks.taskSub', { when: fmtClock(task.lastAt), models: fmtInt(task.models.length) }))),
                    h('div', { className: 'dm-task-nums' },
                      h('span', null, t('col.calls'), ' ', h('b', null, fmtInt(task.calls))),
                      h('span', null, t('col.tokens'), ' ', h('b', null, fmtTokens(task.tokens))),
                      h('span', null, t('col.hit'), ' ', h('b', null, fmtPct(task.hitRate))),
                      h('span', null, t('col.cost'), ' ', h('b', null, fmtCost(task.cost))))),
                  h(Collapse, { open },
                    h('div', { className: 'dm-task-models' },
                      h('div', { className: 'dm-mini-grid', 'data-head': 'true' },
                        h('span', null, t('col.model')),
                        h('span', { className: 'dm-right' }, t('col.calls')),
                        h('span', { className: 'dm-right' }, t('col.tokens')),
                        h('span', { className: 'dm-right' }, t('col.cost')),
                        h('span', null, t('col.hit'))),
                      task.models.map((model) => h('div', { className: 'dm-mini-grid', key: model.key },
                        h('div', { className: 'dm-stack' },
                          h('span', { className: 'dm-model-name', style: { fontSize: '11.5px' } }, model.model),
                          h('span', { className: 'dm-provider' }, model.providerLabel)),
                        h('span', { className: 'dm-num' }, fmtInt(model.calls)),
                        h('span', { className: 'dm-num' }, fmtTokens(model.tokens)),
                        h('span', { className: 'dm-num' }, fmtCost(model.cost)),
                        h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, fmtPct(model.hitRate)))))
                  ))
              })))
        }))
    }

    /* ------------------------------------------------------------------ */
    /* 文案                                                               */
    /* ------------------------------------------------------------------ */

    const ZH = {
      'panel.title': '监控台',
      'panel.subtitle': '每个模型、每个任务的调用量、缓存命中率与花费。官方 DeepSeek 模型按官方价自动计价，第三方模型可在「定价」里补充单价。',
      'range.today': '今天',
      'range.7': '7 天',
      'range.30': '30 天',
      'range.all': '全部',
      'range.label': '统计范围',
      'common.refresh': '刷新',
      'common.loading': '加载中…',
      'common.back': '返回',
      'common.cancel': '取消',
      'common.save': '保存',
      'common.saving': '保存中…',
      'common.close': '关闭',
      'stat.calls': '总调用',
      'stat.calls.note': '涉及 {models} 个模型 · {tasks} 个任务',
      'stat.tokens': '总 Tokens',
      'stat.tokens.note': '输入 {input} · 输出 {output}',
      'stat.hit': '平均缓存命中率',
      'stat.hit.note': '缓存读 {read} · 缓存写 {write}',
      'stat.cost': '估算花费',
      'stat.cost.note': '按价格表计算，单位人民币',
      'stat.cost.unpriced': '{n} 次调用未定价，未计入花费',
      'stat.projects': '项目',
      'stat.projects.note': '共 {tasks} 个任务',
      'tab.models': '按模型 · {n}',
      'tab.tasks': '按任务 · {n}',
      'col.model': '模型 / 来源',
      'col.calls': '调用',
      'col.tokens': 'Tokens',
      'col.hit': '缓存命中',
      'col.cost': '花费',
      'col.task': '任务',
      'col.project': '项目',
      'badge.unpriced': '未定价',
      'badge.official': '官方计价',
      'badge.custom': '自定义价',
      'metric.tokens': 'Tokens',
      'metric.calls': '调用',
      'metric.cost': '花费',
      'detail.tokens.note': '输入 {input} · 输出 {output} · 缓存读 {read} · 缓存写 {write}',
      'detail.price.custom': '使用你保存的自定义价格',
      'detail.price.official': '使用官方计价（按调用时间自动区分高峰 / 空闲）',
      'detail.daily': '每日用量',
      'detail.tokens': 'Tokens 合计',
      'detail.composition': 'tokens 构成',
      'detail.composition.note': '输入 / 缓存读 / 缓存写 / 输出 的占比',
      'detail.avgTokens': '平均每次调用 tokens',
      'detail.avgOutput': '平均每次输出',
      'detail.avgCost': '平均每次花费',
      'detail.firstAt': '首次调用',
      'detail.lastAt': '最近调用',
      'detail.unpriced': '未定价调用',
      'mix.input': '输入',
      'mix.cacheRead': '缓存读',
      'mix.cacheWrite': '缓存写',
      'mix.output': '输出',
      'chart.share': '模型占比',
      'chart.trend': '每日趋势',
      'chart.trend.note': '按天对比前 4 个模型',
      'chart.total': '合计',
      'chart.other': '其他模型',
      'chart.empty': '暂无足够数据画图',
      'detail.tasks': '按任务拆分 · {n}',
      'tasks.title': '按任务 · {groups} 个项目',
      'tasks.search': '搜索任务或项目',
      'tasks.empty': '没有匹配的任务',
      'tasks.tasksN': '{n} 个任务',
      'tasks.callsN': '{n} 次调用',
      'tasks.tokensN': '{n} tokens',
      'tasks.costN': '{n}',
      'tasks.showModels': '项目模型',
      'tasks.hideModels': '收起模型',
      'tasks.openModel': '查看',
      'tasks.taskSub': '{when} · {models} 个模型 · 展开看明细',
      'price.button': '定价',
      'price.title': '价格表（人民币 / 百万 tokens）',
      'price.note': '官方 DeepSeek 模型自动按官方价计费：高峰（北京时间周一至周五 9:00-12:00、14:00-18:00）与空闲价自动切换，无需填写。其他模型留空表示未定价，用量照常统计但花费不计入。保存的自定义单价优先于官方价。',
      'price.empty': '当前范围内还没有可定价的模型。',
      'price.official': '官方计价',
      'price.custom': '自定义',
      'price.none': '未定价',
      'price.reset': '清空',
      'price.fields': '顺序：输入 / 输出 / 缓存读 / 缓存写',
      'price.invalid': '价格必须是不小于 0 的数字',
      'price.unit': '输入 ¥{input} · 输出 ¥{output} · 缓存读 ¥{cacheRead} · 缓存写 ¥{cacheWrite}',
      'price.officialUnit': '官方计价 · 高峰输入 ¥{inP}/输出 ¥{outP}，空闲输入 ¥{inO}/输出 ¥{outO}',
      'price.unpriced': '未定价，可在「定价」里补充',
      'empty.title': '这个时间范围内还没有用量记录',
      'empty.body': '正常聊天、调用模型后这里会自动累计。历史会话会在后台补录，也可以手动触发一次重新扫描。',
      'empty.rescan': '重新扫描历史',
      'empty.range': '这个范围内没有模型用量',
      'error.load': '读取失败：{message}',
      'footer.note': '共 {records} 条用量记录 · {sessions} 个会话 · 更新于 {when}',
      'footer.scanning': '正在扫描历史会话…',
      'footer.official': '官方用量页',
      'footer.pricing': '官方价格页',
    }

    const EN = {
      'panel.title': 'Monitor',
      'panel.subtitle': 'Calls, cache hit rate and cost per model and per task. Official DeepSeek models are priced automatically at official peak / off-peak rates; third-party models can take custom prices under Pricing.',
      'range.today': 'Today',
      'range.7': '7 days',
      'range.30': '30 days',
      'range.all': 'All',
      'range.label': 'Time range',
      'common.refresh': 'Refresh',
      'common.loading': 'Loading…',
      'common.back': 'Back',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.saving': 'Saving…',
      'common.close': 'Close',
      'stat.calls': 'Total calls',
      'stat.calls.note': '{models} models · {tasks} tasks',
      'stat.tokens': 'Total tokens',
      'stat.tokens.note': 'input {input} · output {output}',
      'stat.hit': 'Avg cache hit rate',
      'stat.hit.note': 'cache read {read} · cache write {write}',
      'stat.cost': 'Estimated cost',
      'stat.cost.note': 'computed from the price table, CNY',
      'stat.cost.unpriced': '{n} calls unpriced, excluded from cost',
      'stat.projects': 'Projects',
      'stat.projects.note': '{tasks} tasks',
      'tab.models': 'By model · {n}',
      'tab.tasks': 'By task · {n}',
      'col.model': 'Model / source',
      'col.calls': 'Calls',
      'col.tokens': 'Tokens',
      'col.hit': 'Cache hit',
      'col.cost': 'Cost',
      'col.task': 'Task',
      'col.project': 'Project',
      'badge.unpriced': 'unpriced',
      'badge.official': 'official',
      'badge.custom': 'custom',
      'metric.tokens': 'Tokens',
      'metric.calls': 'Calls',
      'metric.cost': 'Cost',
      'detail.tokens.note': 'input {input} · output {output} · cache read {read} · cache write {write}',
      'detail.price.custom': 'uses your saved custom prices',
      'detail.price.official': 'uses official pricing (peak / off-peak picked by call time)',
      'detail.daily': 'Daily usage',
      'detail.tokens': 'Total tokens',
      'detail.composition': 'Token mix',
      'detail.composition.note': 'Share of input / cache read / cache write / output',
      'detail.avgTokens': 'Tokens per call',
      'detail.avgOutput': 'Output per call',
      'detail.avgCost': 'Cost per call',
      'detail.firstAt': 'First call',
      'detail.lastAt': 'Last call',
      'detail.unpriced': 'Unpriced calls',
      'mix.input': 'Input',
      'mix.cacheRead': 'Cache read',
      'mix.cacheWrite': 'Cache write',
      'mix.output': 'Output',
      'chart.share': 'Model share',
      'chart.trend': 'Daily trend',
      'chart.trend.note': 'Top 4 models compared by day',
      'chart.total': 'Total',
      'chart.other': 'Other models',
      'chart.empty': 'Not enough data for a chart',
      'detail.tasks': 'Breakdown by task · {n}',
      'tasks.title': 'By task · {groups} projects',
      'tasks.search': 'Search tasks or projects',
      'tasks.empty': 'No matching tasks',
      'tasks.tasksN': '{n} tasks',
      'tasks.callsN': '{n} calls',
      'tasks.tokensN': '{n} tokens',
      'tasks.costN': '{n}',
      'tasks.showModels': 'Project models',
      'tasks.hideModels': 'Hide models',
      'tasks.openModel': 'Open',
      'tasks.taskSub': '{when} · {models} models · expand for detail',
      'price.button': 'Pricing',
      'price.title': 'Price table (CNY per million tokens)',
      'price.note': 'Official DeepSeek models are priced automatically at official rates: peak (Beijing time Mon-Fri 9:00-12:00, 14:00-18:00) and off-peak switch by call time, no input needed. Leave other rows empty to keep a model unpriced: usage is still counted, cost is not. Saved custom prices take precedence over official rates.',
      'price.empty': 'No models in the current range yet.',
      'price.official': 'official',
      'price.custom': 'custom',
      'price.none': 'unpriced',
      'price.reset': 'Clear',
      'price.fields': 'Order: input / output / cache read / cache write',
      'price.invalid': 'Prices must be numbers greater than or equal to 0',
      'price.unit': 'input ¥{input} · output ¥{output} · cache read ¥{cacheRead} · cache write ¥{cacheWrite}',
      'price.officialUnit': 'official · peak input ¥{inP}/output ¥{outP}, off-peak input ¥{inO}/output ¥{outO}',
      'price.unpriced': 'unpriced — add a price under Pricing',
      'empty.title': 'No usage recorded in this range',
      'empty.body': 'Usage accumulates automatically as you chat. Historical sessions are backfilled in the background, or you can trigger a rescan.',
      'empty.rescan': 'Rescan history',
      'empty.range': 'No model usage in this range',
      'error.load': 'Failed to load: {message}',
      'footer.note': '{records} usage records · {sessions} sessions · updated {when}',
      'footer.scanning': 'scanning historical sessions…',
      'footer.official': 'Official usage page',
      'footer.pricing': 'Official pricing page',
    }

    /* ------------------------------------------------------------------ */
    /* 注册                                                               */
    /* ------------------------------------------------------------------ */

    exports.inject = ['slots', 'locale']
    exports.apply = (ctx) => {
      installStyles(ctx)
      const locale = ctx.locale
      const isEn = () => /^en/i.test(String((locale.getLocale() && locale.getLocale().active) || 'zh'))
      const tr = (key) => ((isEn() ? EN : ZH)[key] || ZH[key] || key)

      const Icon = (props) => {
        const size = props && Number.isFinite(props.size) ? props.size : 18
        const active = Boolean(props && props.active)
        return h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          'aria-hidden': 'true',
          style: { color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor', display: 'block' },
        },
          h('path', { d: 'M3 16.2V9.4', stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round' }),
          h('path', { d: 'M7.7 16.2V5.2', stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round' }),
          h('path', { d: 'M12.4 16.2v-4.1', stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round' }),
          h('path', { d: 'M17.1 16.2V3.4', stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round' }))
      }

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
      }, (props) => h(Boundary, null, h(MonitorPanel, { ...props, locale }))))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_KEY,
        order: -10,
        label: () => tr('panel.title'),
      }, Icon))
    }

    return module.exports
  },
})
