<!-- vibe-coding-declaration:begin -->
> [!IMPORTANT]
> 本仓库由 AI 开发与维护，所有代码变更均由 AI 执行。
<!-- vibe-coding-declaration:end -->

# Magpie 路由状态

> 在 DSH 输入框下方的统计行里，显示本机 magpie 网关最近一次把**当前会话**路由到的厂商与模型。

一个 DSH bundle 插件：Host 半负责给请求打会话标记并查询 magpie 的按会话路由，Client 半负责在 `conversation.composer.dock` 渲染读数与弹层。全程只访问本机 `127.0.0.1`，不向外部网络发送任何内容。

## 效果

普通请求：

```text
● magpie DeepSeek · deepseek-v4.1-flash
```

压缩请求：

```text
● magpie DeepSeek · deepseek-v4.1-flash    ● 压缩 DeepSeek · hy4-flash-free
```

- 主读数：绿点 + `magpie` 标识 + `厂商 · 模型`，默认无可见药丸背景、圆角、边框或内边距；悬停/展开时用原生统计按钮底色和 8px 横向内边距（伪元素，不改变布局）。
- 压缩读数：紫色圆点 + 仅「压缩」两字做成小药丸 + 压缩模型普通文本。
- 点击读数：弹出与「上下文已用 / Token 用量」同风格的面板，分「magpie路由模型」「magpie压缩路由模型」「非magpie路由模型」「非magpie压缩路由模型」四段；每段显示模型数和每个模型的请求次数（如 `×152`）。
- 当前会话还没有路由，或 magpie 网关不可用时：路由状态隐藏，不占位置。

## 安装

### 方式一：作为本地 link 依赖

在 DSH profile 的依赖中加入本目录：

```json
{
  "dependencies": {
    "@local/dsh-magpie-route-badge": "link:D:/dev/github/dsh-magpie-route-badge"
  }
}
```

然后重启 DSH Host，并刷新 Web 页面（F5）。

### 方式二：通过 Plugins 安装

在 DSH 的 **Plugins → Add plugin** 里选择本目录安装。安装后同样需要重启 Host。

> 修改了 Host 半 [`index.js`](./index.js) 后必须重启 DSH；只修改 Client 半 [`client.js`](./client.js) 时刷新页面即可。

## 工作原理

```text
DSH pi-ai 请求
  └─ Host: 写入 X-Magpie-Session: <sessionId>
       └─ GET http://127.0.0.1:3425/v1/magpie/route?session=<sessionId>
            └─ Host 只读接口: GET /api/magpie.route?session=<sessionId>
                 └─ Client: conversation.composer.dock 渲染路由状态
```

- **Host 半** [`index.js`](./index.js)
  - 监听 `llm-pi-ai/request-headers`，给 provider 为 `magpie` / `magpie-*` 的请求写入 `X-Magpie-Session` 请求头。
  - 记录当前会话是否处于压缩中；压缩时补采压缩路由，供面板的「magpie压缩路由模型」使用。
  - 记录非 magpie provider 的普通/压缩请求，供面板的「非magpie路由模型」「非magpie压缩路由模型」使用。
  - 通过 `ctx.connection.fetch.register` 暴露只读接口 `GET /api/magpie.route`。
- **Client 半** [`client.js`](./client.js)
  - 在 `conversation.composer.dock` 插槽注册路由状态读数，按 `sessionId` 每 3 秒轮询一次路由。
  - magpie 正常/压缩请求的模型与请求次数从本机 `usage.jsonl` 全量增量索引中按会话聚合；Host 只返回当前会话数据。
  - 非 magpie 模型优先用 Host 运行时计数，历史回退到 DSH Chat 已加载 Turn 的 tokenUsage 路由。
  - 面板用固定定位贴在读数上方，按路由状态位置计算右/下偏移。

## 显示规则

| 状态 | 表现 |
| --- | --- |
| 正常路由 | `● magpie 厂商 · 模型` |
| 手动压缩进行中 | 出现紫色「压缩」读数；压缩模型未知时显示「进行中…」 |
| 压缩完成、下一次普通请求前 | 「压缩」读数继续保留 |
| 下一次普通请求开始 | 「压缩」读数移除 |
| 尚无会话路由 / 网关不可用 | 路由状态隐藏 |

### 动效

- **绿点**：只在模型正在流式输出、且 assistant 已有非空文本或推理内容时呼吸；请求等待首 token、纯工具执行、输出结束时不呼吸。
- **紫点**：只在手动压缩进行中呼吸。
- 呼吸效果复刻 magpie「实时 / Live」的实心点：`1.4s ease-in-out infinite`，50% 关键帧为 `opacity: .35`、`scale(.8)`。
- 开始和停止都不截断动画：开始从完整周期播放，停止时等当前周期播完再移除。

## 目录结构

```text
dsh-magpie-route-badge/
├─ index.js            # Host 半：会话头、压缩记录、只读路由
├─ client.js           # Client 半：路由状态、弹层、轮询、动效
├─ cordis.patch.yml    # DSH bundle 补丁
├─ package.json        # 包声明与 dsh bundle/client 配置
├─ locale/
│  ├─ zh.json          # 插件详情页中文元数据
│  └─ en.json          # 插件详情页英文元数据
├─ icon.svg            # 插件图标
└─ README.md
```

## 已知限制

- 主读数只在通过 magpie 网关的会话显示；面板仍会统计当前会话里的非 magpie 模型（Host 运行期间 + Chat 已加载历史）。
- 按**当前会话**显示：反映该会话最近一次实际路由，不代表未来请求一定会继续使用同一模型。
- 网关重启后、当前会话还没发新请求前，可能查不到该会话路由，此时路由状态隐藏。
- magpie 计数来自本机 `usage.jsonl` 的全量增量索引；非 magpie 普通请求来自 Host 运行期间记录，历史回退到 DSH Chat 已加载 Turn 的 tokenUsage 路由；非 magpie 压缩仅统计 Host 运行期间的记录。
- 面板「magpie压缩路由模型」只统计 `usage.jsonl` 中当前会话的 `kind=compact` 行；Host 存活期间补采的压缩路由会以次数 1 兜底。
- 自动触发的压缩（上下文满而非 `/compact`）没有 `manual-compaction` 节点，紫色点不会呼吸，但压缩读数仍会短暂出现，直到下一次普通请求。
- 系统开启「减少动态效果」时，呼吸动画会按 `prefers-reduced-motion` 停用。
- 路由轮询间隔为 3 秒，极短的压缩可能无法赶上采样窗口。

## 开发

无需构建步骤，直接修改源码即可。修改后至少做：

```bash
node --check index.js
node --check client.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

插件包信息见 [`package.json`](./package.json)，DSH bundle 补丁见 [`cordis.patch.yml`](./cordis.patch.yml)。
