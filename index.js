/**
 * magpie 路由读数的 Host 半。
 *
 * DSH 的 pi-ai 适配器会在每次推理前同步触发 `llm-pi-ai/request-headers`。
 * 本插件给每个 magpie 请求打上 `X-Magpie-Session: <sessionId>`，并在内存里
 * 记录本会话最新一次主请求是普通还是压缩。只读路由向 Client 返回网关按会话
 * 给出的当前路由：
 *
 *   GET /api/magpie.route?session=<id> ->
 *     { ok, provider, model,
 *       compact: { provider, model, label } | null,
 *       normalModels: [{ label, count }],
 *       compactionModels: [{ label, count }],
 *       nonMagpieNormalModels: [{ label, count }],
 *       nonMagpieCompactionModels: [{ label, count }] }
 *
 * `normalModels` / `compactionModels` 的计数来自本机 magpie 的 usage.jsonl；
 * `nonMagpie*` 只记录不经过 magpie 的 pi-ai 请求。Host 增量读取 usage.jsonl，
 * 按会话与模型聚合，不返回其他会话的数据。
 */
import { open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROUTE_PATH = '/api/magpie.route'
const GATEWAY = 'http://127.0.0.1:3425'
const PI_AI_PROVIDER = 'magpie'
const GATEWAY_TIMEOUT_MS = 3000
const NO_STORE = { 'cache-control': 'no-store' }

function routeLabel(provider, model) {
  return provider ? `${provider} · ${model}` : model
}

function splitRoute(value) {
  const slash = value.indexOf('/')
  return slash > 0 ? { provider: value.slice(0, slash), model: value.slice(slash + 1) } : { provider: '', model: value }
}

function normSession(value) {
  return typeof value === 'string' ? value.trim().replace(/^session-/, '') : ''
}

const usageCache = { offset: 0, sessions: new Map() }

function magpieUsageFile() {
  const base = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'magpie')
    : join(homedir(), '.config', 'magpie')
  return join(base, 'usage.jsonl')
}

function canonicalLabel(label) {
  return label.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
}

function ensureModelCount(list, label, count = 1) {
  const key = canonicalLabel(label)
  if (!list.some((item) => canonicalLabel(item.label) === key)) list.unshift({ label, count })
}

/** 把一批 usage JSONL 行并入会话计数；只统计主请求和压缩请求。 */
function aggregateUsageLines(text, sessions) {
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row === null || typeof row !== 'object' || row.agent !== 'dsh') continue
    const kind = row.kind === undefined || row.kind === null ? 'normal' : row.kind
    if (kind !== 'normal' && kind !== 'compact') continue
    const key = normSession(row.session)
    if (key.length === 0) continue
    const provider = typeof row.provider === 'string' ? row.provider : ''
    const model = typeof row.served === 'string' && row.served.length > 0
      ? row.served
      : (typeof row.model === 'string' ? row.model : '')
    if (model.length === 0) continue
    let byKind = sessions.get(key)
    if (byKind === undefined) {
      byKind = { normal: new Map(), compact: new Map() }
      sessions.set(key, byKind)
    }
    const counts = byKind[kind]
    const label = routeLabel(provider, model)
    const labelKey = canonicalLabel(label)
    const current = counts.get(labelKey)
    if (current === undefined) counts.set(labelKey, { label, count: 1 })
    else current.count += 1
  }
}

/** 增量读取 usage.jsonl：首次全量建立索引，之后只解析追加行。 */
async function readUsageStats(session, warn) {
  try {
    const file = magpieUsageFile()
    const info = await stat(file)
    if (info.size < usageCache.offset) {
      usageCache.offset = 0
      usageCache.sessions = new Map()
    }
    if (info.size > usageCache.offset) {
      const length = info.size - usageCache.offset
      const handle = await open(file, 'r')
      try {
        const buffer = Buffer.alloc(length)
        await handle.read(buffer, 0, length, usageCache.offset)
        const lastNewline = buffer.lastIndexOf(10)
        if (lastNewline >= 0) {
          aggregateUsageLines(buffer.subarray(0, lastNewline).toString('utf8'), usageCache.sessions)
          usageCache.offset += lastNewline + 1
        }
      } finally {
        await handle.close()
      }
    }
    const byKind = usageCache.sessions.get(normSession(session))
    if (byKind === undefined) return { normal: [], compact: [] }
    const toList = (counts) => [...counts.values()].sort((a, b) => b.count - a.count)
    return { normal: toList(byKind.normal), compact: toList(byKind.compact) }
  } catch (error) {
    warn('magpie-route-badge: 读取 usage 统计失败', error)
    return { normal: [], compact: [] }
  }
}

/**
 * 请求一个精确会话 key 的实时路由。
 * @param session - magpie 存储的会话 key。
 * @returns `{ provider, model, label, inFlight }`；没有路由时为 null。
 */
async function fetchSessionRoute(session) {
  const url = `${GATEWAY}/v1/magpie/route?session=${encodeURIComponent(session)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`magpie 网关返回 HTTP ${response.status}`)
    const body = await response.json()
    const route = body !== null && typeof body === 'object' ? body.route : null
    if (route === null) return null
    if (typeof route !== 'object' || typeof route.model !== 'string' || route.model.length === 0) {
      throw new Error('magpie 路由响应缺少 model 字段')
    }
    const { provider, model } = splitRoute(route.model)
    return { provider, model, label: routeLabel(provider, model), inFlight: route.done === false }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 按会话查实时路由。
 *
 * magpie 用收到的 `X-Magpie-Session` 原值作为 key；不同版本/调用方可能给
 * 裸 uuid 或 `session-<uuid>`，所以精确 key 查不到时用另一种形式重试一次。
 * @param session - DSH 会话 id，可带或不带 `session-` 前缀。
 * @returns `{ provider, model, label, inFlight }`；没有路由时为 null。
 */
async function readSessionRoute(session) {
  const bare = normSession(session)
  if (bare.length === 0) return null
  const alternate = session.startsWith('session-') ? bare : `session-${bare}`
  const keys = alternate === session ? [session] : [session, alternate]
  for (const key of keys) {
    const route = await fetchSessionRoute(key)
    if (route !== null) return route
  }
  return null
}

/** 正在进行压缩的会话；普通 assistant 请求开始时移除。 */
const compactingSessions = new Set()
/** 最近一次普通路由，用于判断快速压缩是否切到了别的模型。 */
const lastNormalRoute = new Map()
/** 每个会话见过的压缩路由，按标签去重，供面板“压缩请求模型”使用。 */
const compactionRoutes = new Map()
/** 非 magpie provider 的运行时模型计数，按会话与普通/压缩分开。 */
const externalRouteCounts = new Map()

function rememberExternalRoute(key, provider, model, purpose) {
  const kind = purpose === 'compaction' ? 'compact' : (purpose === 'assistant' || purpose === undefined || purpose === null ? 'normal' : null)
  if (kind === null || typeof provider !== 'string' || provider.length === 0 || typeof model !== 'string' || model.length === 0) return
  let bucket = externalRouteCounts.get(key)
  if (bucket === undefined) {
    bucket = { normal: new Map(), compact: new Map() }
    externalRouteCounts.set(key, bucket)
  }
  const counts = bucket[kind]
  const label = routeLabel(provider, model)
  const labelKey = canonicalLabel(label)
  const current = counts.get(labelKey)
  if (current === undefined) counts.set(labelKey, { label, count: 1 })
  else current.count += 1
}

function externalRouteList(key, kind) {
  const bucket = externalRouteCounts.get(key)
  if (bucket === undefined) return []
  return [...bucket[kind].values()].sort((a, b) => b.count - a.count)
}

function rememberCompactionRoute(key, route) {
  let byLabel = compactionRoutes.get(key)
  if (byLabel === undefined) {
    byLabel = new Map()
    compactionRoutes.set(key, byLabel)
  }
  byLabel.set(route.label, route)
}

export const inject = ['connection']

/**
 * 给 magpie 请求打会话头、记录最新请求类型，并暴露按会话的路由。
 * @param ctx - Host 插件上下文（需要 `connection` 服务）。
 */
export function apply(ctx) {
  const logger = ctx.get('logger')
  const warnTimes = new Map()
  const warn = (message, error) => {
    const now = Date.now()
    if (now - (warnTimes.get(message) ?? 0) < 30000) return
    warnTimes.set(message, now)
    if (logger !== undefined && typeof logger.warn === 'function') logger.warn(message, error)
  }

  /**
   * 压缩请求开始时补采路由：3 秒轮询可能错过很短的压缩，所以额外在
   * 1 秒、2.5 秒各查一次，只有路由正在执行或已与上次普通路由不同才记录。
   */
  function captureCompactionRoute(sessionId) {
    const key = normSession(sessionId)
    const session = String(sessionId)
    const capture = async () => {
      try {
        const route = await readSessionRoute(session)
        if (route === null) return
        const baseline = lastNormalRoute.get(key)
        const changed = baseline !== undefined
          && (baseline.provider !== route.provider || baseline.model !== route.model)
        if (route.inFlight || changed) rememberCompactionRoute(key, route)
      } catch (error) {
        warn('magpie-route-badge: 补采压缩路由失败', error)
      }
    }
    setTimeout(capture, 1000)
    setTimeout(capture, 2500)
  }

  ctx.effect(() => ctx.on('llm-pi-ai/request-headers', (request, headers, next) => {
    try {
      const provider = request === null || request === undefined ? undefined : request.provider
      const sessionId = request === null || request === undefined ? undefined : request.sessionId
      const magpieProvider = typeof provider === 'string'
        && (provider === PI_AI_PROVIDER || provider.startsWith('magpie-'))
      if (sessionId !== undefined && sessionId !== null && String(sessionId).length > 0) {
        const purpose = request.purpose
        const key = normSession(sessionId)
        if (magpieProvider) {
          headers.set('x-magpie-session', String(sessionId))
          // 只记录主对话请求：压缩、普通 assistant；标题/自动审查等辅助请求不算。
          if (purpose === 'compaction') {
            compactingSessions.add(key)
            captureCompactionRoute(sessionId)
          } else if (purpose === 'assistant' || purpose === undefined || purpose === null) {
            compactingSessions.delete(key)
          }
        } else {
          rememberExternalRoute(key, provider, request.model, purpose)
        }
      }
    } catch (error) {
      warn('magpie-route-badge: 无法写入 x-magpie-session 请求头', error)
    }
    return next()
  }), 'magpie-route-badge: session header')

  ctx.effect(() => {
    const dispose = ctx.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const session = new URL(request.url).searchParams.get('session')
          if (session === null || session.length === 0) {
            return Response.json({ ok: false, reason: 'no-session' }, { headers: NO_STORE })
          }
          const route = await readSessionRoute(session)
          if (route === null) {
            return Response.json({ ok: false, reason: 'no-route', session }, { headers: NO_STORE })
          }
          const key = normSession(session)
          let compact = null
          if (compactingSessions.has(key)) {
            // 只有正在执行的压缩请求才写入压缩历史；已完成的普通路由不能冒充压缩模型。
            if (route.inFlight) rememberCompactionRoute(key, route)
            const byLabel = compactionRoutes.get(key)
            const remembered = byLabel === undefined ? undefined : [...byLabel.values()].at(-1)
            const source = route.inFlight ? route : remembered
            if (source !== undefined && source !== null) {
              compact = { provider: source.provider, model: source.model, label: source.label }
            }
          } else {
            lastNormalRoute.set(key, route)
          }
          const stats = await readUsageStats(session, warn)
          const normalModels = [...stats.normal]
          const compactionModels = [...stats.compact]
          if (compact === null) ensureModelCount(normalModels, route.label)
          else ensureModelCount(compactionModels, compact.label)
          return Response.json({
            ok: true,
            provider: route.provider,
            model: route.model,
            compact,
            normalModels,
            compactionModels,
            nonMagpieNormalModels: externalRouteList(key, 'normal'),
            nonMagpieCompactionModels: externalRouteList(key, 'compact'),
          }, { headers: NO_STORE })
        } catch (error) {
          warn('magpie-route-badge: 路由查询失败', error)
          return Response.json({ ok: false, reason: 'unavailable' }, { headers: NO_STORE })
        }
      },
    })
    return () => { void dispose() }
  }, 'magpie-route-badge: route')
}
