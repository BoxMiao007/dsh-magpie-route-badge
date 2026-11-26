/**
 * magpie 路由状态的 Client 半。
 *
 * 在 `conversation.composer.dock`（输入框下方统计行，与 activity、usage、
 * 上下文圆环同一行）注册一个小读数，显示本地 magpie 网关最近一次把本会话
 * 路由到的「厂商 · 模型」；当最新请求是压缩时，末尾再显示压缩读数。点击读数
 * 会弹出本会话用过的 magpie / 非magpie 模型面板。
 *
 * 读数每 3 秒轮询 `/api/magpie.route?session=<id>`（由 index.js 提供）；
 * 两个点的呼吸动画由 Chat 快照实时驱动（流式输出 / 手动压缩），不依赖轮询。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-magpie-route-badge',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    /** DSH 以平台模块提供 react-dom；面板 portal 到 body，才能盖在输入框卡片上方。 */
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (reactDom && typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal
    } catch {
      createPortal = null
    }

    /** 浏览器相对路径，兼容任意反向代理前缀。 */
    const ROUTE = 'api/magpie.route'
    const POLL_MS = 3000
    const REQUEST_TIMEOUT_MS = 4000
    const NS = 'magpieRoute'
    let activityWarned = false
    let routesWarned = false

    const DICTS = {
      zh: {
        title: 'Magpie 路由状态',
        tip: 'Magpie 最近一次把 DSH 请求路由到 {provider} · {model}',
        tipBare: 'Magpie 最近一次把 DSH 请求路由到 {model}',
        aria: 'Magpie 最近一次路由：{provider} · {model}',
        ariaBare: 'Magpie 最近一次路由：{model}',
        compact: '压缩',
        compactAria: 'Magpie 压缩路由：{provider} · {model}',
        compactTip: '本会话压缩由 magpie 路由到 {provider} · {model}',
        compacting: '进行中…',
        panelTitle: '本会话路由模型',
        magpieSection: 'magpie路由模型',
        magpieCompactSection: 'magpie压缩路由模型',
        nonMagpieSection: '非magpie路由模型',
        nonMagpieCompactSection: '非magpie压缩路由模型',
        empty: '暂无',
      },
      en: {
        title: 'Magpie route',
        tip: 'Magpie last routed the DSH request to {provider} · {model}',
        tipBare: 'Magpie last routed the DSH request to {model}',
        aria: 'Magpie last route: {provider} · {model}',
        ariaBare: 'Magpie last route: {model}',
        compact: 'compaction',
        compactAria: 'Magpie compaction route: {provider} · {model}',
        compactTip: 'Compaction of this session routed by magpie to {provider} · {model}',
        compacting: 'running…',
        panelTitle: 'Models this session used',
        magpieSection: 'magpie route models',
        magpieCompactSection: 'magpie compaction route models',
        nonMagpieSection: 'non-magpie route models',
        nonMagpieCompactSection: 'non-magpie compaction route models',
        empty: 'none',
      },
    }

    /* 普通统计读数：与同排文字同字号、tertiary 色；主读数没有药丸背景、
     * 边框、圆角或内边距，只有「压缩」两个字是小药丸，点击面板是原生卡片。 */
    const CSS = `
.dsh-magpie-route-root{display:inline-flex;align-items:center;order:1;position:relative;flex:none;--dsh-magpie-compact:#a970ff}
.dsh-magpie-route-badge{display:inline-flex;align-items:center;gap:0;box-sizing:border-box;flex:none;color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;font-variant-numeric:tabular-nums;user-select:none;background:none;border:0;margin:0;padding:0;font-family:inherit;text-align:left;cursor:pointer}
.dsh-magpie-route-main{display:inline-flex;align-items:center;gap:6px;position:relative;isolation:isolate;color:var(--dsw-alias-label-tertiary)}
.dsh-magpie-route-main::before{content:"";position:absolute;inset:-1px -8px;border-radius:var(--dsw-radius-sm);background:transparent;pointer-events:none;z-index:-1;transition:background-color .12s ease}
.dsh-magpie-route-main:hover::before,
.dsh-magpie-route-badge[aria-expanded="true"] .dsh-magpie-route-main::before{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-magpie-route-main:hover .dsh-magpie-route-name,
.dsh-magpie-route-main:hover .dsh-magpie-route-provider,
.dsh-magpie-route-main:hover .dsh-magpie-route-sep,
.dsh-magpie-route-main:hover .dsh-magpie-route-model,
.dsh-magpie-route-badge[aria-expanded="true"] .dsh-magpie-route-name,
.dsh-magpie-route-badge[aria-expanded="true"] .dsh-magpie-route-provider,
.dsh-magpie-route-badge[aria-expanded="true"] .dsh-magpie-route-sep,
.dsh-magpie-route-badge[aria-expanded="true"] .dsh-magpie-route-model{color:var(--dsw-alias-label-secondary)}
.dsh-magpie-route-badge:focus-visible{outline:none}
.dsh-magpie-route-badge:focus-visible .dsh-magpie-route-main{outline:2px solid var(--dsw-alias-state-success-primary);outline-offset:2px}
.dsh-magpie-route-dotwrap{position:relative;flex:none;width:6px;height:6px;--dot-color:var(--dsw-alias-state-success-primary)}
.dsh-magpie-route-compact-dotwrap{position:relative;flex:none;width:6px;height:6px;--dot-color:var(--dsh-magpie-compact)}
.dsh-magpie-route-dot,.dsh-magpie-route-compact-dot{position:absolute;inset:0;border-radius:50%;background:var(--dot-color)}
@keyframes dsh-magpie-live{50%{opacity:.35;transform:scale(.8)}}
.dsh-magpie-route-badge[data-breathe-green="true"] .dsh-magpie-route-dotwrap .dsh-magpie-route-dot,
.dsh-magpie-route-badge[data-breathe-compact="true"] .dsh-magpie-route-compact-dotwrap .dsh-magpie-route-compact-dot{animation:dsh-magpie-live 1.4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.dsh-magpie-route-badge[data-breathe-green="true"] .dsh-magpie-route-dotwrap .dsh-magpie-route-dot,.dsh-magpie-route-badge[data-breathe-compact="true"] .dsh-magpie-route-compact-dotwrap .dsh-magpie-route-compact-dot{animation:none}}
.dsh-magpie-route-name{flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-magpie-route-text{min-width:auto;overflow:visible;text-overflow:clip}
.dsh-magpie-route-provider{color:var(--dsw-alias-label-tertiary)}
.dsh-magpie-route-sep{margin:0;color:var(--dsw-alias-label-tertiary)}
.dsh-magpie-route-model{color:var(--dsw-alias-label-secondary)}
.dsh-magpie-route-compact{display:inline-flex;align-items:center;gap:5px;margin-left:10px}
.dsh-magpie-route-compact-chip{display:inline-flex;align-items:center;padding:0 7px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsh-magpie-compact) 45%,transparent);background:color-mix(in srgb,var(--dsh-magpie-compact) 16%,transparent);color:var(--dsh-magpie-compact);line-height:18px}
.dsh-magpie-route-compact-model{color:var(--dsw-alias-label-secondary)}
.dsh-magpie-route-popover{z-index:1100;display:flex;flex-direction:column;align-items:flex-end;--dsh-magpie-compact:#a970ff}
.dsh-magpie-route-panel{box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));max-height:min(40vh,calc(100dvh - 24px));overflow-x:hidden;overflow-y:auto;padding:16px;border:0;border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#222));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.4));font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-align:left;white-space:normal;cursor:default}
.dsh-magpie-route-sec{margin-top:16px}
.dsh-magpie-route-sec:first-child{margin-top:0}
.dsh-magpie-route-title{display:flex;align-items:center;gap:6px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-magpie-route-title-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none}
.dsh-magpie-route-title-dot-compact{background:var(--dsh-magpie-compact,#a970ff)}
.dsh-magpie-route-title-count{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-magpie-route-divider{margin:16px 0 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-magpie-route-list{list-style:none;display:grid;gap:6px;margin:0;padding:0;color:var(--dsw-alias-label-tertiary)}
.dsh-magpie-route-list li{display:flex;align-items:baseline;gap:8px;min-width:0;white-space:normal;overflow-wrap:anywhere}
.dsh-magpie-route-list-label{min-width:0}
.dsh-magpie-route-list-count{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none}
.dsh-magpie-route-empty{color:var(--dsw-alias-label-tertiary);opacity:.8;padding:2px 0}
`

    /**
     * 填充 `{name}` 占位符（locale 服务可能已做过插值，此时为 no-op）。
     * @param template - 本地化模板。
     * @param vars - 占位符取值。
     * @returns 填充后的字符串。
     */
    function fill(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) => (
        vars[key] === undefined || vars[key] === null ? whole : String(vars[key])
      ))
    }

    /** 判断一组块里是否已有非空的文本或推理内容。 */
    function hasStreamingText(blocks) {
      return Array.isArray(blocks) && blocks.some((block) => block !== null && block !== undefined
        && ((block.kind === 'text' || block.kind === 'reasoning') ? String(block.text || '').trim() !== '' : false))
    }

    /**
     * 从 Chat 快照读取模型活动状态：
     *  - streaming：兼容投影 `legacy.partial` 就是当前正在流式输出的
     *    assistant，文本/推理非空即算；它在 assistant message settle 时清空，
     *    所以纯工具执行不会触发；
     *  - compacting：最新一个手动压缩命令的 `outcome` 仍为空。
     * 首 token 前的等待、纯工具执行、已完成的压缩都不算。
     * @param snapshot - `useChat` 给出的 Chat 快照。
     * @returns `{ streaming, compacting }`。
     */
    function readActivity(snapshot) {
      let streaming = false
      let compacting = false
      try {
        const partial = snapshot && snapshot.legacy ? snapshot.legacy.partial : undefined
        streaming = partial !== undefined && partial !== null && hasStreamingText(partial.blocks)
        const all = chatNodes(snapshot)
        const start = Math.max(0, all.length - 200)
        let manualSeen = false
        for (let i = all.length - 1; i >= start; i -= 1) {
          const node = all[i]
          const data = node ? node.data : undefined
          if (!data) continue
          if (!manualSeen && node.kind === 'manual-compaction') {
            manualSeen = true
            const command = data.command
            compacting = command !== undefined && command !== null
              && (command.outcome === null || command.outcome === undefined)
          }
          if (!streaming && node.kind === 'assistant-step' && node.visibility !== 'hidden'
            && data.status === 'running' && hasStreamingText(data.blocks)) {
            streaming = true
          }
          if (streaming && manualSeen) break
        }
      } catch (error) {
        if (!activityWarned && typeof console !== 'undefined') {
          activityWarned = true
          console.warn('magpie-route-badge: 读取 Chat 活动失败', error)
        }
        return { streaming, compacting }
      }
      return { streaming, compacting }
    }

    /** 选择器只在两个状态都未变时复用旧结果，避免逐 token 触发重渲染。 */
    function sameActivity(left, right) {
      return left.streaming === right.streaming && left.compacting === right.compacting
    }

    /**
     * 从各 Turn 的精确 tokenUsage 路由汇总本会话用过的模型；count 是该路由
     * 在 tokenUsage.routes 中出现的次数，供非 magpie 分区回退使用。
     * @param snapshot - `useChat` 给出的 Chat 快照。
     * @returns `[{ label, provider, count }]`。
     */
    function readRoutes(snapshot) {
      const seen = new Map()
      try {
        const all = chatNodes(snapshot)
        for (const node of all) {
          if (node === null || node === undefined || node.kind !== 'turn-tail') continue
          const usage = node.data ? node.data.tokenUsage : undefined
          const routes = usage && Array.isArray(usage.routes) ? usage.routes : []
          for (const route of routes) {
            if (route === null || typeof route !== 'object'
              || typeof route.provider !== 'string' || typeof route.model !== 'string') continue
            const label = labelOf(route.provider, route.model)
            const current = seen.get(label)
            if (current === undefined) seen.set(label, { label, provider: route.provider, count: 1 })
            else current.count += 1
          }
        }
      } catch (error) {
        if (!routesWarned && typeof console !== 'undefined') {
          routesWarned = true
          console.warn('magpie-route-badge: 读取 Chat 路由失败', error)
        }
        return []
      }
      return [...seen.values()]
    }

    /** 路由标签列表不变时复用旧值，避免面板无谓重渲染。 */
    function sameRoutes(left, right) {
      return left.length === right.length && left.every((item, index) => item.label === right[index].label
        && item.count === right[index].count && item.provider === right[index].provider)
    }

    function chatNodes(snapshot) {
      return snapshot && snapshot.nodes && typeof snapshot.nodes.values === 'function' ? snapshot.nodes.values() : []
    }

    function labelOf(provider, model) {
      return provider ? `${provider} · ${model}` : model
    }

    function isMagpieProvider(provider) {
      return provider === 'magpie' || provider.startsWith('magpie-')
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'magpie-route-badge: locale')
        const t = ctx.locale.bind(NS)

        function MagpieRouteBadge(props) {
          const [route, setRoute] = React.useState(null)
          const [open, setOpen] = React.useState(false)
          const [coords, setCoords] = React.useState({ right: 12, bottom: 8 })
          const [breatheGreen, setBreatheGreen] = React.useState(false)
          const [breatheCompact, setBreatheCompact] = React.useState(false)
          const rootRef = React.useRef(null)
          const panelRef = React.useRef(null)
          const greenDotRef = React.useRef(null)
          const compactDotRef = React.useRef(null)
          const breatheTimers = React.useRef({ green: null, compact: null })
          const normalSeenRef = React.useRef(new Map())
          const nonMagpieSeenRef = React.useRef(new Map())
          const sessionId = props && props.sessionId !== undefined && props.sessionId !== null ? String(props.sessionId) : ''
          // 来自 DSH Chat 快照的实时状态。
          const useChat = props ? props.useChat : undefined
          const activity = typeof useChat === 'function'
            ? useChat(readActivity, sameActivity)
            : { streaming: false, compacting: false }
          const streaming = activity.streaming
          const compacting = activity.compacting
          const chatModels = typeof useChat === 'function' ? useChat(readRoutes, sameRoutes) : []

          React.useEffect(() => { setOpen(false) }, [sessionId])
          React.useEffect(() => {
            normalSeenRef.current = new Map()
            nonMagpieSeenRef.current = new Map()
          }, [sessionId])
          React.useEffect(() => { if (route === null) setOpen(false) }, [route])

          /**
           * 控制 CSS `dsh-magpie-live` 呼吸类是否生效。停止时读到当前
           * CSS 动画已播放的相位，安排到本周期结束再移除类，因此不会
           * 切断半个周期；开始则直接加类，从周期起点播放。
           */
          function driveBreathe(kind, live, dotRef, setBreathe) {
            const timers = breatheTimers.current
            if (timers[kind] !== null) {
              clearTimeout(timers[kind])
              timers[kind] = null
            }
            if (live) {
              setBreathe(true)
              return
            }
            const el = dotRef.current
            if (el === null || typeof el.getAnimations !== 'function') {
              setBreathe(false)
              return
            }
            const animation = el.getAnimations()[0]
            if (animation === undefined) {
              setBreathe(false)
              return
            }
            const timing = animation.effect && typeof animation.effect.getComputedTiming === 'function'
              ? animation.effect.getComputedTiming()
              : undefined
            const duration = timing && typeof timing.duration === 'number' ? timing.duration : 1400
            const current = typeof animation.currentTime === 'number' ? animation.currentTime : 0
            const phase = current % duration
            // 刚开始就停止时补足一个完整周期；恰好在周期边界则立即移除。
            const remaining = phase === 0 ? (current === 0 ? duration : 0) : duration - phase
            timers[kind] = setTimeout(() => {
              timers[kind] = null
              setBreathe(false)
            }, remaining)
          }

          React.useEffect(() => { driveBreathe('green', streaming, greenDotRef, setBreatheGreen) }, [streaming, route])
          React.useEffect(() => { driveBreathe('compact', compacting, compactDotRef, setBreatheCompact) }, [compacting, route])
          React.useEffect(() => () => {
            for (const kind of ['green', 'compact']) {
              if (breatheTimers.current[kind] !== null) clearTimeout(breatheTimers.current[kind])
            }
          }, [])

          React.useEffect(() => {
            setRoute(null)
            let alive = true
            let inFlight = false
            let warned = false
            let timer
            const base = document.baseURI.endsWith('/') ? document.baseURI : `${document.baseURI}/`
            const target = new URL(ROUTE, base)
            if (sessionId !== '') target.searchParams.set('session', sessionId)
            const url = target.href

            const tick = async () => {
              if (!alive || inFlight || document.hidden) return
              inFlight = true
              const controller = new AbortController()
              const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
              try {
                const response = await fetch(url, {
                  headers: { accept: 'application/json' },
                  cache: 'no-store',
                  credentials: 'same-origin',
                  signal: controller.signal,
                })
                if (!response.ok) {
                  if (!warned && typeof console !== 'undefined') {
                    warned = true
                    console.warn(`magpie-route-badge: 路由轮询返回 HTTP ${response.status}`)
                  }
                  return
                }
                const body = await response.json()
                if (!alive) return
                if (body && body.ok === true && body.model) {
                  const parseModelStats = (value) => Array.isArray(value)
                    ? value.map((item) => item && typeof item.label === 'string' && item.label.length > 0
                      ? { label: item.label, count: Number.isFinite(item.count) && item.count > 0 ? item.count : 1 }
                      : null).filter((item) => item !== null)
                    : []
                  const normalModels = parseModelStats(body.normalModels)
                  const compactionModels = parseModelStats(body.compactionModels)
                  const nonMagpieNormalModels = parseModelStats(body.nonMagpieNormalModels)
                  const nonMagpieCompactionModels = parseModelStats(body.nonMagpieCompactionModels)
                  const compact = body.compact && body.compact !== null && body.compact.provider && body.compact.model
                    ? {
                        provider: String(body.compact.provider),
                        model: String(body.compact.model),
                        label: typeof body.compact.label === 'string' && body.compact.label.length > 0
                          ? body.compact.label
                          : labelOf(String(body.compact.provider), String(body.compact.model)),
                      }
                    : null
                  const next = {
                    provider: String(body.provider || ''),
                    model: String(body.model),
                    compact,
                    normalModels,
                    compactionModels,
                    nonMagpieNormalModels,
                    nonMagpieCompactionModels,
                    signature: '',
                  }
                  next.signature = JSON.stringify({
                    p: next.provider, m: next.model,
                    c: compact === null ? null : [compact.provider, compact.model],
                    n: normalModels,
                    ms: compactionModels,
                    nn: nonMagpieNormalModels,
                    mn: nonMagpieCompactionModels,
                  })
                  setRoute((prev) => (prev && prev.signature === next.signature ? prev : next))
                } else if (body && body.ok === false && body.reason === 'no-route') {
                  setRoute(null)
                }
              } catch (error) {
                if (!warned && typeof console !== 'undefined') {
                  warned = true
                  console.warn('magpie-route-badge: 路由轮询失败', error)
                }
              } finally {
                clearTimeout(timeout)
                inFlight = false
              }
            }

            tick()
            timer = setInterval(tick, POLL_MS)
            return () => {
              alive = false
              if (timer !== undefined) clearInterval(timer)
            }
          }, [sessionId])

          // 面板用固定定位贴在读数上方；点击外部或 Escape 时关闭。
          React.useEffect(() => {
            if (!open) return undefined
            const measure = () => {
              const el = rootRef.current
              if (el === null) return
              const rect = el.getBoundingClientRect()
              setCoords({
                right: Math.max(8, window.innerWidth - rect.right),
                bottom: Math.max(8, window.innerHeight - rect.top + 8),
              })
            }
            const onPointerDown = (event) => {
              const root = rootRef.current
              const panel = panelRef.current
              if (root !== null && root.contains(event.target)) return
              if (panel !== null && panel.contains(event.target)) return
              setOpen(false)
            }
            const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
            measure()
            document.addEventListener('pointerdown', onPointerDown, true)
            document.addEventListener('keydown', onKeyDown)
            window.addEventListener('resize', measure)
            window.addEventListener('scroll', measure, true)
            return () => {
              document.removeEventListener('pointerdown', onPointerDown, true)
              document.removeEventListener('keydown', onKeyDown)
              window.removeEventListener('resize', measure)
              window.removeEventListener('scroll', measure, true)
            }
          }, [open])

          if (route === null) return null

          const vars = { provider: route.provider, model: route.model }
          const textFor = (key, bareKey) => fill(t(route.provider === '' ? bareKey : key), vars)
          const title = textFor('tip', 'tipBare')
          const aria = textFor('aria', 'ariaBare')
          const showCompact = compacting || route.compact !== null
          const compactModelText = route.compact !== null && route.compact.label
            ? route.compact.label
            : (showCompact ? t('compacting') : '')
          if (route.compact === null) normalSeenRef.current.set(labelOf(route.provider, route.model), { label: labelOf(route.provider, route.model), count: 1 })
          for (const item of chatModels) {
            const target = isMagpieProvider(item.provider) ? normalSeenRef : nonMagpieSeenRef
            const current = target.current.get(item.label)
            if (current === undefined) target.current.set(item.label, { label: item.label, count: item.count })
            else current.count += item.count
          }
          const magpieNormalModels = route.normalModels && route.normalModels.length > 0
            ? route.normalModels
            : [...normalSeenRef.current.values()]
          const magpieCompactModels = route.compactionModels && route.compactionModels.length > 0
            ? route.compactionModels
            : (route.compact && route.compact.label ? [{ label: route.compact.label, count: 1 }] : [])
          const nonMagpieNormalModels = route.nonMagpieNormalModels && route.nonMagpieNormalModels.length > 0
            ? route.nonMagpieNormalModels
            : [...nonMagpieSeenRef.current.values()]
          const nonMagpieCompactModels = route.nonMagpieCompactionModels || []

          const renderSection = (key, titleKey, list, compact) => h('div', { key, className: 'dsh-magpie-route-sec' },
            h('div', { className: 'dsh-magpie-route-title' },
              h('span', {
                key: 'dot',
                className: `dsh-magpie-route-title-dot${compact ? ' dsh-magpie-route-title-dot-compact' : ''}`,
                'aria-hidden': 'true',
              }),
              h('span', { key: 'label' }, t(titleKey)),
              h('span', { key: 'count', className: 'dsh-magpie-route-title-count' }, String(list.length))),
            list.length === 0
              ? h('div', { className: 'dsh-magpie-route-empty' }, t('empty'))
              : h('ul', { className: 'dsh-magpie-route-list' },
                  list.map((item, i) => h('li', { key: i, title: item.label },
                    h('span', { key: 'label', className: 'dsh-magpie-route-list-label' }, item.label),
                    h('span', { key: 'count', className: 'dsh-magpie-route-list-count' }, `×${String(item.count)}`)))))

          const extraSections = []
          if (nonMagpieNormalModels.length > 0) {
            extraSections.push(
              h('div', { key: 'divider-2', className: 'dsh-magpie-route-divider', 'aria-hidden': 'true' }),
              renderSection('non-magpie', 'nonMagpieSection', nonMagpieNormalModels, false),
            )
          }
          if (nonMagpieCompactModels.length > 0) {
            extraSections.push(
              h('div', { key: 'divider-3', className: 'dsh-magpie-route-divider', 'aria-hidden': 'true' }),
              renderSection('non-magpie-compact', 'nonMagpieCompactSection', nonMagpieCompactModels, true),
            )
          }

          return h(React.Fragment, null,
            h('style', { key: 'style' }, CSS),
            h('span', { key: 'root', className: 'dsh-magpie-route-root', ref: rootRef },
              h('button', {
                key: 'badge',
                type: 'button',
                className: 'dsh-magpie-route-badge',
                title,
                'data-breathe-green': breatheGreen ? 'true' : 'false',
                'data-breathe-compact': breatheCompact ? 'true' : 'false',
                'aria-haspopup': 'dialog',
                'aria-expanded': open ? 'true' : 'false',
                'aria-label': aria,
                onClick: () => setOpen((value) => !value),
              },
                h('span', { key: 'main', className: 'dsh-magpie-route-main' },
                  h('span', { key: 'dot', className: 'dsh-magpie-route-dotwrap', 'aria-hidden': 'true' },
                    h('span', { key: 'core', className: 'dsh-magpie-route-dot', ref: greenDotRef })),
                  h('span', { key: 'name', className: 'dsh-magpie-route-name' }, 'magpie'),
                  h('span', { key: 'text', className: 'dsh-magpie-route-text' },
                    h('span', { key: 'provider', className: 'dsh-magpie-route-provider' }, route.provider),
                    route.provider !== '' ? h('span', { key: 'sep', className: 'dsh-magpie-route-sep' }, ' · ') : null,
                    h('span', { key: 'model', className: 'dsh-magpie-route-model' }, route.model))),
                showCompact
                  ? h('span', {
                      key: 'compact',
                      className: 'dsh-magpie-route-compact',
                      title: route.compact !== null ? fill(t('compactTip'), route.compact) : t('compact'),
                    },
                      h('span', { key: 'cdot', className: 'dsh-magpie-route-compact-dotwrap', 'aria-hidden': 'true' },
                        h('span', { key: 'ccore', className: 'dsh-magpie-route-compact-dot', ref: compactDotRef })),
                      h('span', { key: 'cchip', className: 'dsh-magpie-route-compact-chip' }, t('compact')),
                      h('span', { key: 'cmodel', className: 'dsh-magpie-route-compact-model' }, compactModelText))
                  : null),
              open
                ? (() => {
                    const popover = h('div', {
                      key: 'popover',
                      ref: panelRef,
                      className: 'dsh-magpie-route-popover',
                      style: { position: 'fixed', right: `${coords.right}px`, bottom: `${coords.bottom}px` },
                    },
                      h('div', {
                        key: 'panel',
                        className: 'dsh-magpie-route-panel',
                        role: 'dialog',
                        'aria-label': t('panelTitle'),
                      },
                        renderSection('magpie', 'magpieSection', magpieNormalModels, false),
                        h('div', { key: 'divider-1', className: 'dsh-magpie-route-divider', 'aria-hidden': 'true' }),
                        renderSection('magpie-compact', 'magpieCompactSection', magpieCompactModels, true),
                        ...extraSections))
                    return createPortal !== null ? createPortal(popover, document.body) : popover
                  })()
                : null),
          )
        }

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'magpie-route-badge',
          order: 2,
          // 插槽的 inject 工厂会收到当前查看的 sessionId，交给组件以便按会话查询。
          inject: (sessionId) => ({ sessionId: sessionId === undefined || sessionId === null ? '' : String(sessionId) }),
        }, MagpieRouteBadge))
      },
    }
  },
})
