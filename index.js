/**
 * dsh-daily-workspace —— host 半身。
 *
 * 只做两件事：
 *
 * 1. 保存用户选择的「日常默认工作区」指针（$DSH_HOME/daily-workspace.json）。
 * 2. 提供 GET/POST /dsh-daily-workspace/state 给浏览器半身读写。
 *
 * 不复制会话、不创建影子工作区；工作区本身仍由 DSH 的 workspaceRegistry 管理。
 * 读取时校验指针仍指向一个存在的工作区，失效则返回空并清掉文件里的旧值。
 *
 * @module dsh-daily-workspace/host
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Route prefix owned by this plugin. */
const API_PREFIX = '/dsh-daily-workspace'
/** File under $DSH_HOME holding the pointer. */
const STATE_FILE = 'daily-workspace.json'

/** Write one JSON response. */
function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** A route failure carrying the HTTP status. */
class RouteError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Read and parse a JSON request body with a small cap. */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new RouteError(413, 'request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new RouteError(400, 'request body is not valid JSON'))
      }
    })
    req.on('error', (error) => reject(error))
  })
}

/** Normalize a workspace id from untrusted JSON. */
function workspaceIdOf(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new RouteError(400, 'workspaceId must be a string or null')
  const id = value.trim()
  if (id.length === 0) return null
  if (id.length > 512) throw new RouteError(400, 'workspaceId is too long')
  return id
}

export default {
  inject: ['webServer', 'workspaceRegistry'],
  apply(ctx) {
    const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    const statePath = join(home, STATE_FILE)

    /** Read the raw file; a missing or unreadable file means "not configured". */
    async function readState() {
      try {
        const text = await readFile(statePath, 'utf8')
        const parsed = JSON.parse(text)
        return { defaultWorkspaceId: workspaceIdOf(parsed?.defaultWorkspaceId) }
      } catch (error) {
        if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { defaultWorkspaceId: null }
        throw error
      }
    }

    /** Atomically replace the state file. */
    async function writeState(state) {
      await mkdir(dirname(statePath), { recursive: true })
      const temp = `${statePath}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8')
      await rename(temp, statePath)
    }

    /** The pointer only counts while its workspace still exists. */
    function liveWorkspace(id) {
      return id === null ? undefined : ctx.workspaceRegistry.get(id)
    }

    /** Current state, dropping a pointer whose workspace is gone. */
    async function liveState() {
      const state = await readState()
      if (state.defaultWorkspaceId === null) return state
      if (liveWorkspace(state.defaultWorkspaceId) !== undefined) return state
      // The workspace was deleted while the app was closed: forget the pointer
      // instead of resurrecting it if a future workspace reuses the id.
      try {
        await writeState({ defaultWorkspaceId: null })
      } catch (error) {
        ctx.logger?.warn?.('dsh-daily-workspace: failed to clear stale pointer', error)
      }
      return { defaultWorkspaceId: null }
    }

    async function handleState(req, res) {
      if (req.method === 'GET') {
        const state = await liveState()
        sendJson(res, 200, { ok: true, defaultWorkspaceId: state.defaultWorkspaceId })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const body = await readJsonBody(req)
      const id = workspaceIdOf(body.workspaceId)
      if (id !== null && liveWorkspace(id) === undefined) {
        throw new RouteError(404, 'workspace not found')
      }
      await writeState({ defaultWorkspaceId: id })
      sendJson(res, 200, { ok: true, defaultWorkspaceId: id })
    }

    let dispose
    try {
      dispose = ctx.webServer.register({
        kind: 'exact',
        path: `${API_PREFIX}/state`,
        handler: async (req, res) => {
          try {
            await handleState(req, res)
          } catch (error) {
            const status = error instanceof RouteError ? error.status : 500
            ctx.logger?.warn?.(`dsh-daily-workspace: ${API_PREFIX}/state failed`, error)
            if (!res.headersSent) sendJson(res, status, { ok: false, error: error?.message || String(error) })
            else res.end()
          }
        },
      })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-daily-workspace: route ${API_PREFIX}/state already served elsewhere`, error)
      return
    }
    ctx.effect(() => dispose)
  },
}
