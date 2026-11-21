/**
 * dsh-monitor —— 宿主端（Host half）。
 *
 * 记账来源是 DSH 自己的会话事件日志（session log 是唯一事实来源）：
 *   - 在线：订阅 `session/event`，把 `assistant/message` / `assistant/attempt`
 *     事件里携带的 TokenUsage 落盘；
 *   - 离线补录：启动时用 `sessionPersistence` 逐会话回读已持久化的日志，
 *     把安装插件之前的历史用量也补进来（按 session + seq 去重）。
 *
 * 每条用量记录都带 provider + model（来自 AssistantMessage.source），
 * 所以不同来源的同名模型天然分开；记录只存 session id，任务归属在聚合时
 * 沿 `header.parentSession` 链上溯到根会话，项目归属取根会话的 cwd。
 *
 * 对外只注册三个 HTTP 路由，浏览器端用 fetch 读取：
 *   GET  /dsh-monitor/data    聚合后的用量数据
 *   GET  /dsh-monitor/config  价格表、官方 provider、用量页链接
 *   POST /dsh-monitor/config  保存自定义价格
 *   POST /dsh-monitor/rescan  触发一次历史补录
 */
import { promises as fsp } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

const API = '/dsh-monitor'

/**
 * 官方 DeepSeek 计价（人民币 / 百万 tokens），来源：
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 * 空闲时段是高峰价的一半；高峰 = 北京时间周一至周五 9:00-12:00、14:00-18:00（法定节假日除外，
 * 本插件没有节假日表，节假日会按高峰价算，属已知偏差）。缓存写入按缓存未命中价计。
 */
const OFFICIAL_RATES = [
  {
    match: /v4[-_.]?pro|deepseek-pro/i,
    peak: { input: 9, output: 27, cacheRead: 0.3, cacheWrite: 9 },
    offPeak: { input: 4.5, output: 13.5, cacheRead: 0.15, cacheWrite: 4.5 },
  },
  {
    match: /flash/i,
    peak: { input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 },
    offPeak: { input: 1, output: 4, cacheRead: 0.02, cacheWrite: 1 },
  },
]
const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const OFFICIAL_USAGE_URL = 'https://platform.deepseek.com/usage'
/** 没有价格时绝不当成 0：返回 null，面板显示「未定价」。 */
const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite']

const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
const pad = (value) => String(value).padStart(2, '0')
const dayKey = (ms) => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 读取一段用户消息里的文字，用来当任务标题。 */
function messageText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  const parts = []
  for (const block of message.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').replace(/\s+/g, ' ').trim()
}

/** 从紧凑的 assistant stream 记录里取最后一个 usage。 */
function streamUsage(records) {
  if (!Array.isArray(records)) return undefined
  let usage
  for (const record of records) {
    if (record && record.type === 'chunk' && record.chunk && record.chunk.type === 'usage') {
      usage = record.chunk.usage
    }
  }
  return usage
}

function cleanUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const input = num(usage.inputTokens)
  const output = num(usage.outputTokens)
  const cacheRead = num(usage.cacheReadTokens)
  const cacheWrite = num(usage.cacheWriteTokens)
  const reasoning = num(usage.reasoningTokens)
  if (input + output + cacheRead + cacheWrite === 0) return undefined
  return { input, output, cacheRead, cacheWrite, reasoning }
}

/** 官方 provider：deepseek / deepseek-account / deepseek:* 之类，第三方中转不算。 */
function isOfficialProvider(provider) {
  return /^deepseek(?:$|[-_.:])/i.test(provider)
}

/** 官方模型的高峰 / 空闲价；不是官方模型返回 undefined。 */
function officialRates(provider, model) {
  if (!isOfficialProvider(provider)) return undefined
  const hit = OFFICIAL_RATES.find((entry) => entry.match.test(model))
  if (!hit) return undefined
  return { peak: { ...hit.peak }, offPeak: { ...hit.offPeak } }
}

/** 北京时间是否高峰时段（周一至周五 9:00-12:00、14:00-18:00）。 */
function isPeakHour(ms) {
  const shifted = new Date(ms + 8 * 3600 * 1000)
  const weekday = shifted.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

function normalizePrice(price) {
  if (!price || typeof price !== 'object') return undefined
  const out = {}
  for (const field of PRICE_FIELDS) {
    const value = price[field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
    out[field] = value
  }
  return out
}

export default {
  name: 'dsh-monitor',
  inject: ['webServer', 'sessionPersistence'],
  apply(ctx) {
    const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    const dir = join(home, 'dsh-monitor')
    const usageFile = join(dir, 'usage.jsonl')
    const metaFile = join(dir, 'meta.json')

    /** state.sessions[sid] = { title, cwd, created, parent, origin, lastAt, scanned, scanCount } */
    const state = { sessions: {}, pricing: {} }
    /** 所有已记录的用量（扁平对象，见 record()） */
    const records = []
    /** `${sid}:${seq}` 去重集合；attempt 事件用 `${sid}:a${seq}` */
    const seen = new Set()
    let writeChain = Promise.resolve()
    let metaChain = Promise.resolve()
    let metaTimer
    let scanning = false
    let scannedAt = 0

    const sessionView = (header) => {
      const sid = String(header.id)
      let view = state.sessions[sid]
      if (!view) {
        view = state.sessions[sid] = {
          title: '',
          cwd: typeof header.cwd === 'string' ? header.cwd : '',
          created: typeof header.createdAt === 'number' ? header.createdAt : Date.now(),
          parent: typeof header.parentSession === 'string' ? header.parentSession : '',
          origin: header.origin === 'subagent' ? 'subagent' : '',
          lastAt: 0,
          scanned: false,
          scanCount: 0,
        }
      } else {
        // 头部信息可能后到（例如先读到事件、后读到会话快照），补齐但不覆盖已有值。
        if (!view.cwd && typeof header.cwd === 'string') view.cwd = header.cwd
        if (!view.parent && typeof header.parentSession === 'string') view.parent = header.parentSession
        if (!view.created && typeof header.createdAt === 'number') view.created = header.createdAt
      }
      return view
    }

    const record = (sid, seq, time, kind, provider, model, usage) => {
      return {
        s: sid,
        q: seq,
        t: time,
        k: kind,
        p: provider,
        m: model,
        i: usage.input,
        o: usage.output,
        r: usage.cacheRead,
        w: usage.cacheWrite,
        g: usage.reasoning,
      }
    }

    const pushRecord = (view, item) => {
      records.push(item)
      const key = `${item.s}:${item.k === 'attempt' ? 'a' : ''}${item.q}`
      seen.add(key)
      if (item.t > view.lastAt) view.lastAt = item.t
    }

    /** 把一条会话事件喂进账本；返回是否需要落盘。 */
    const ingest = (header, event, live) => {
      const view = sessionView(header)
      const sid = String(header.id)
      if (event.type === 'user/message') {
        if (!view.title) {
          const text = messageText(event.data)
          if (text) view.title = text.slice(0, 80)
        }
        if (typeof event.time === 'number' && event.time > view.lastAt) view.lastAt = event.time
        return null
      }
      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return null
      const seq = typeof event.seq === 'number' ? event.seq : 0
      const key = `${sid}:${event.type === 'assistant/attempt' ? 'a' : ''}${seq}`
      if (seen.has(key)) return null
      const usage = cleanUsage(
        event.type === 'assistant/message' ? event.data.usage : streamUsage(event.data.stream),
      )
      if (!usage) return null
      let provider = ''
      let model = ''
      if (event.type === 'assistant/message') {
        const source = event.data.message?.source
        if (source && typeof source.provider === 'string') provider = source.provider
        if (source && typeof source.model === 'string') model = source.model
      } else {
        // attempt 不带 message.source，回退到当前请求头（日志里最近一次 request/header）。
        const headerEvent = lastRequestHeader.get(sid)
        if (headerEvent) {
          provider = headerEvent.provider
          model = headerEvent.model
        }
      }
      if (!provider || !model) return null
      const item = record(sid, seq, typeof event.time === 'number' ? event.time : Date.now(),
        event.type === 'assistant/attempt' ? 'attempt' : 'message', provider, model, usage)
      pushRecord(view, item)
      return item
    }

    /** 每个会话最近一次 request/header 的 provider+model，给 attempt 事件兜底。 */
    const lastRequestHeader = new Map()

    const appendLines = async (lines) => {
      if (lines.length === 0) return
      await fsp.mkdir(dir, { recursive: true })
      await fsp.appendFile(usageFile, lines.join('\n') + '\n', 'utf8')
    }

    const flush = (lines) => {
      if (lines.length === 0) return
      writeChain = writeChain.then(() => appendLines(lines)).catch((error) => {
        ctx.logger?.warn?.(`[dsh-monitor] 写入用量失败：${String(error)}`)
      })
    }

    const scheduleMeta = () => {
      if (metaTimer) return
      metaTimer = setTimeout(() => {
        metaTimer = undefined
        saveMeta().catch((error) => ctx.logger?.warn?.(`[dsh-monitor] 写入元数据失败：${String(error)}`))
      }, 2000)
      if (typeof metaTimer.unref === 'function') metaTimer.unref()
    }

    const saveMeta = () => {
      const snapshot = JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        pricing: state.pricing,
        sessions: state.sessions,
      })
      metaChain = metaChain.then(async () => {
        await fsp.mkdir(dir, { recursive: true })
        const temp = join(tmpdir(), `dsh-monitor-meta-${process.pid}-${Date.now()}.json`)
        await fsp.writeFile(temp, snapshot, 'utf8')
        await fsp.rename(temp, metaFile)
      })
      return metaChain
    }

    /** 读盘：恢复价格表、会话元数据、以及已有的用量记录。 */
    const load = async () => {
      await fsp.mkdir(dir, { recursive: true })
      try {
        const raw = await fsp.readFile(metaFile, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          if (parsed.pricing && typeof parsed.pricing === 'object') state.pricing = parsed.pricing
          if (parsed.sessions && typeof parsed.sessions === 'object') state.sessions = parsed.sessions
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') ctx.logger?.warn?.(`[dsh-monitor] 读取元数据失败：${String(error)}`)
      }
      try {
        const raw = await fsp.readFile(usageFile, 'utf8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          let item
          try {
            item = JSON.parse(line)
          } catch {
            continue
          }
          if (!item || typeof item.s !== 'string' || typeof item.p !== 'string') continue
          const key = `${item.s}:${item.k === 'attempt' ? 'a' : ''}${item.q}`
          if (seen.has(key)) continue
          seen.add(key)
          if (item.t > (state.sessions[item.s]?.lastAt ?? 0)) {
            if (state.sessions[item.s]) state.sessions[item.s].lastAt = item.t
          }
          records.push(item)
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') ctx.logger?.warn?.(`[dsh-monitor] 读取用量失败：${String(error)}`)
      }
    }

    /** 回读已持久化的会话日志，补上插件启动之前的用量。 */
    const scan = async (force) => {
      if (scanning) return
      scanning = true
      try {
        const snapshots = await ctx.sessionPersistence.list()
        for (const snapshot of snapshots) {
          const header = snapshot?.header
          if (!header || typeof header.id !== 'string') continue
          const view = sessionView(header)
          const stored = typeof snapshot.eventCount === 'number' ? snapshot.eventCount : -1
          if (!force && view.scanned && stored >= 0 && view.scanCount === stored) continue
          let handle
          try {
            handle = await ctx.sessionPersistence.open(header.id, 'read')
            const result = await handle.read()
            const events = Array.isArray(result?.events) ? result.events : []
            const lines = []
            for (const event of events) {
              if (!event) continue
              if (event.type === 'request/header') {
                const config = event.data?.header?.config
                if (config && typeof config.provider === 'string' && typeof config.model === 'string') {
                  lastRequestHeader.set(String(header.id), { provider: config.provider, model: config.model })
                }
              }
              const item = ingest(header, event, false)
              if (item) lines.push(JSON.stringify(item))
            }
            view.scanned = true
            view.scanCount = events.length
            if (lines.length > 0) flush(lines)
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-monitor] 扫描会话 ${header.id} 失败：${String(error)}`)
          } finally {
            try {
              await handle?.close?.()
            } catch {
              // 读句柄关闭失败不影响账本
            }
          }
        }
        scannedAt = Date.now()
        scheduleMeta()
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-monitor] 扫描历史会话失败：${String(error)}`)
      } finally {
        scanning = false
      }
    }

    const providerLabels = () => {
      const labels = new Map()
      const add = (id, name) => {
        if (typeof id === 'string' && id && typeof name === 'string' && name) labels.set(id, name)
      }
      const llm = ctx.get('llm')
      try {
        for (const info of llm?.listProviders?.() ?? []) add(info.id, info.name)
      } catch {
        // llm 服务不可用时只要 provider id
      }
      try {
        for (const info of llm?.listConfigurableProviders?.() ?? []) add(info.provider, info.displayName)
      } catch {
        // 同上
      }
      return labels
    }

    /**
     * 价格解析：自定义价格优先（固定单价）；官方模型按调用时间取高峰 / 空闲价；其余未定价。
     * 返回的 unit 是「按时间取价」用的单价，display 是给面板展示的价格描述。
     */
    const priceFor = (provider, model) => {
      const key = `${provider}::${model}`
      const custom = normalizePrice(state.pricing[key])
      if (custom) return { source: 'custom', unit: custom, display: custom }
      const official = officialRates(provider, model)
      if (official) return { source: 'official', official, display: official }
      return { source: 'none' }
    }

    const costOf = (item, resolved) => {
      let price = resolved.unit
      if (!price && resolved.official) {
        price = isPeakHour(item.t) ? resolved.official.peak : resolved.official.offPeak
      }
      if (!price) return null
      return (item.i * price.input + item.o * price.output + item.r * price.cacheRead + item.w * price.cacheWrite) / 1e6
    }

    const resolveRoot = (sid) => {
      let cursor = sid
      for (let depth = 0; depth < 16; depth += 1) {
        const view = state.sessions[cursor]
        if (!view || !view.parent || view.parent === cursor) break
        cursor = view.parent
      }
      return cursor
    }

    const emptyBucket = () => ({
      calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
      cost: 0, pricedCalls: 0, unpricedCalls: 0,
    })

    const addTo = (bucket, item, cost) => {
      bucket.calls += 1
      bucket.input += item.i
      bucket.output += item.o
      bucket.cacheRead += item.r
      bucket.cacheWrite += item.w
      bucket.reasoning += item.g
      if (cost === null) bucket.unpricedCalls += 1
      else {
        bucket.cost += cost
        bucket.pricedCalls += 1
      }
    }

    const hitRateOf = (bucket) => {
      const denom = bucket.input + bucket.cacheRead + bucket.cacheWrite
      return denom > 0 ? bucket.cacheRead / denom : null
    }

    const publicBucket = (bucket, extra) => ({
      ...extra,
      calls: bucket.calls,
      input: bucket.input,
      output: bucket.output,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      reasoning: bucket.reasoning,
      tokens: bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite,
      cost: bucket.pricedCalls > 0 ? bucket.cost : null,
      pricedCalls: bucket.pricedCalls,
      unpricedCalls: bucket.unpricedCalls,
      hitRate: hitRateOf(bucket),
    })

    const projectLabel = (cwd) => cwd || '(未知项目)'

    const build = (query) => {
      const now = Date.now()
      const from = Number.isFinite(Number(query.from)) ? Number(query.from) : 0
      const to = Number.isFinite(Number(query.to)) ? Number(query.to) : now
      const onlyTask = typeof query.task === 'string' && query.task ? query.task : ''
      const labels = providerLabels()

      const totals = emptyBucket()
      const models = new Map()
      const tasks = new Map()
      const projects = new Map()
      const dayRows = new Map()

      for (const item of records) {
        if (item.t < from || item.t > to) continue
        const root = resolveRoot(item.s)
        if (onlyTask && root !== onlyTask) continue
        const rootView = state.sessions[root] ?? state.sessions[item.s]
        const cwd = (rootView && rootView.cwd) || ''
        const taskTitle = (rootView && rootView.title) || (cwd ? `${basename(cwd)} · ${root.slice(0, 8)}` : `${root.slice(0, 8)}`)
        const key = `${item.p}::${item.m}`
        const resolved = priceFor(item.p, item.m)
        const cost = costOf(item, resolved)

        let model = models.get(key)
        if (!model) {
          model = {
            key,
            provider: item.p,
            providerLabel: labels.get(item.p) || item.p,
            model: item.m,
            price: resolved.display ?? null,
            priceSource: resolved.source,
            firstAt: item.t,
            lastAt: item.t,
            totals: emptyBucket(),
            days: new Map(),
            tasks: new Map(),
          }
          models.set(key, model)
        }
        if (item.t < model.firstAt) model.firstAt = item.t
        if (item.t > model.lastAt) model.lastAt = item.t
        addTo(model.totals, item, cost)
        addTo(totals, item, cost)

        const day = dayKey(item.t)
        let dayRow = dayRows.get(day)
        if (!dayRow) {
          dayRow = { day, totals: emptyBucket() }
          dayRows.set(day, dayRow)
        }
        addTo(dayRow.totals, item, cost)

        let modelDay = model.days.get(day)
        if (!modelDay) {
          modelDay = emptyBucket()
          model.days.set(day, modelDay)
        }
        addTo(modelDay, item, cost)

        let task = tasks.get(root)
        if (!task) {
          task = {
            id: root,
            title: taskTitle,
            cwd,
            project: projectLabel(cwd),
            createdAt: (rootView && rootView.created) || item.t,
            firstAt: item.t,
            lastAt: item.t,
            totals: emptyBucket(),
            models: new Map(),
          }
          tasks.set(root, task)
        }
        if (item.t > task.lastAt) task.lastAt = item.t
        if (item.t < task.firstAt) task.firstAt = item.t
        addTo(task.totals, item, cost)

        let taskModel = task.models.get(key)
        if (!taskModel) {
          taskModel = { key, provider: item.p, model: item.m, totals: emptyBucket() }
          task.models.set(key, taskModel)
        }
        addTo(taskModel.totals, item, cost)

        let modelTask = model.tasks.get(root)
        if (!modelTask) {
          modelTask = emptyBucket()
          model.tasks.set(root, modelTask)
        }
        addTo(modelTask, item, cost)

        const project = projectLabel(cwd)
        let projectRow = projects.get(project)
        if (!projectRow) {
          projectRow = { project, cwd, calls: 0, cost: 0, pricedCalls: 0, tasks: 0, sessions: 0 }
          projects.set(project, projectRow)
        }
        projectRow.calls += 1
        if (cost !== null) {
          projectRow.cost += cost
          projectRow.pricedCalls += 1
        }
      }

      const taskList = [...tasks.values()]
        .map((task) => ({
          ...publicBucket(task.totals, {
            id: task.id,
            title: task.title,
            cwd: task.cwd,
            project: task.project,
            createdAt: task.createdAt,
            firstAt: task.firstAt,
            lastAt: task.lastAt,
            models: [...task.models.values()]
              .map((entry) => publicBucket(entry.totals, {
                key: entry.key,
                provider: entry.provider,
                providerLabel: labels.get(entry.provider) || entry.provider,
                model: entry.model,
              }))
              .sort((left, right) => right.tokens - left.tokens),
          }),
        }))
        .sort((left, right) => right.lastAt - left.lastAt)

      const projectRows = [...projects.values()]
        .map((row) => ({
          ...row,
          tasks: taskList.filter((task) => task.project === row.project).length,
          tokens: taskList
            .filter((task) => task.project === row.project)
            .reduce((sum, task) => sum + task.tokens, 0),
        }))
        .sort((left, right) => right.calls - left.calls)

      const modelList = [...models.values()]
        .map((model) => ({
          ...publicBucket(model.totals, {
            key: model.key,
            provider: model.provider,
            providerLabel: model.providerLabel,
            model: model.model,
            price: model.price,
            priceSource: model.priceSource,
            firstAt: model.firstAt,
            lastAt: model.lastAt,
            days: [...model.days.entries()]
              .map(([day, bucket]) => publicBucket(bucket, { day }))
              .sort((left, right) => left.day.localeCompare(right.day)),
            tasks: [...model.tasks.entries()]
              .map(([taskId, bucket]) => publicBucket(bucket, { taskId }))
              .sort((left, right) => right.tokens - left.tokens),
          }),
        }))
        .sort((left, right) => (right.cost ?? -1) - (left.cost ?? -1) || right.calls - left.calls)

      const days = [...dayRows.entries()]
        .map(([day, row]) => publicBucket(row.totals, { day }))
        .sort((left, right) => left.day.localeCompare(right.day))

      return {
        ok: true,
        generatedAt: now,
        range: { from, to },
        scanning,
        scannedAt,
        scan: { sessions: Object.keys(state.sessions).length, records: records.length },
        totals: publicBucket(totals, {
          tasks: taskList.length,
          projects: projectRows.length,
          models: modelList.length,
        }),
        days,
        models: modelList,
        tasks: taskList,
        projects: projectRows,
        officialProviders: [...labels.keys()].filter((id) => isOfficialProvider(id)),
        usageUrl: OFFICIAL_USAGE_URL,
        pricingUrl: OFFICIAL_PRICING_URL,
      }
    }

    const json = (res, status, body) => {
      const payload = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(payload),
      })
      res.end(payload)
    }

    const readBody = async (req) => {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 1_000_000) throw new Error('request body too large')
        chunks.push(chunk)
      }
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return {}
      return JSON.parse(text)
    }

    const configView = () => ({
      ok: true,
      pricing: state.pricing,
      official: OFFICIAL_RATES.map((entry) => ({ match: String(entry.match), peak: entry.peak, offPeak: entry.offPeak })),
      officialPricingUrl: OFFICIAL_PRICING_URL,
      usageUrl: OFFICIAL_USAGE_URL,
    })

    const routes = []
    const path = (suffix) => `${API}${suffix}`

    routes.push(ctx.webServer.register({
      kind: 'exact',
      path: path('/data'),
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? path('/data'), 'http://localhost')
          json(res, 200, build(Object.fromEntries(url.searchParams.entries())))
        } catch (error) {
          json(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))

    routes.push(ctx.webServer.register({
      kind: 'exact',
      path: path('/config'),
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            json(res, 200, configView())
            return
          }
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const body = await readBody(req)
          const pricing = {}
          const input = body && typeof body.pricing === 'object' && body.pricing ? body.pricing : {}
          for (const [key, value] of Object.entries(input)) {
            if (!key.includes('::')) continue
            const normalized = normalizePrice(value)
            if (normalized) pricing[key] = normalized
          }
          state.pricing = pricing
          scheduleMeta()
          json(res, 200, { ok: true, pricing: state.pricing })
        } catch (error) {
          json(res, 400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))

    routes.push(ctx.webServer.register({
      kind: 'exact',
      path: path('/rescan'),
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        json(res, 200, { ok: true, accepted: true })
        scan(true).catch((error) => ctx.logger?.warn?.(`[dsh-monitor] 手动补录失败：${String(error)}`))
      },
    }))

    ctx.effect(() => () => {
      for (const dispose of routes) {
        try {
          dispose()
        } catch {
          // 已移除
        }
      }
      if (metaTimer) clearTimeout(metaTimer)
      writeChain.then(() => saveMeta()).catch(() => {})
    })

    ctx.on('session/event', (session, event) => {
      try {
        if (!session || !session.header || !event) return
        if (event.type === 'request/header') {
          const config = event.data?.header?.config
          if (config && typeof config.provider === 'string' && typeof config.model === 'string') {
            lastRequestHeader.set(String(session.header.id), { provider: config.provider, model: config.model })
          }
          return
        }
        const item = ingest(session.header, event, true)
        if (item) {
          flush([JSON.stringify(item)])
          scheduleMeta()
        } else if (event.type === 'user/message') {
          scheduleMeta()
        }
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-monitor] 处理会话事件失败：${String(error)}`)
      }
    })

    load()
      .then(() => {
        scan(false).catch((error) => ctx.logger?.warn?.(`[dsh-monitor] 启动补录失败：${String(error)}`))
      })
      .catch((error) => ctx.logger?.warn?.(`[dsh-monitor] 初始化失败：${String(error)}`))
  },
}
