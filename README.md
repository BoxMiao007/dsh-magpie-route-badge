<!-- vibe-coding-declaration:begin -->
> [!IMPORTANT]
> 本仓库由 AI 开发与维护，所有代码变更均由 AI 执行。
<!-- vibe-coding-declaration:end -->

# Magpie 路由徽章

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

- 主读数：绿点 + `magpie` 标识 + `厂商 · 模型`，无药丸背景、圆角、边框或内边距。
- 压缩读数：紫色圆点 + 仅「压缩」两字做成小药丸 + 压缩模型普通文本。
- 点击读数：弹出与「上下文已用 / Token 用量」同风格的面板，分「正常请求模型」「压缩请求模型」两段。
- 当前会话还没有路由，或 magpie 网关不可用时：徽章隐藏，不占位置。

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
                 └─ Client: conversation.composer.dock 渲染徽章
```

- **Host 半** [`index.js`](./index.js)
  - 监听 `llm-pi-ai/request-headers`，给 provider 为 `magpie` / `magpie-*` 的请求写入 `X-Magpie-Session` 请求头。
  - 记录当前会话是否处于压缩中；压缩时补采压缩路由，供面板的「压缩请求模型」使用。
  - 通过 `ctx.connection.fetch.register` 暴露只读接口 `GET /api/magpie.route`。
- **Client 半** [`client.js`](./client.js)
  - 在 `conversation.composer.dock` 插槽注册徽章，按 `sessionId` 每 3 秒轮询一次路由。
  - 正常请求模型从 DSH Chat 的 `turn-tail.tokenUsage.routes` 读取；压缩模型来自 Host 返回的压缩路由记录。
  - 使用 CSS anchor + `@position-try` 定位弹层，滚动/短视口下会按原生面板的方式回退。

## 显示规则

| 状态 | 表现 |
| --- | --- |
| 正常路由 | `● magpie 厂商 · 模型` |
| 手动压缩进行中 | 出现紫色「压缩」读数；压缩模型未知时显示「进行中…」 |
| 压缩完成、下一次普通请求前 | 「压缩」读数继续保留 |
| 下一次普通请求开始 | 「压缩」读数移除 |
| 尚无会话路由 / 网关不可用 | 徽章隐藏 |

### 动效

- **绿点**：只在模型正在流式输出、且 assistant 已有非空文本或推理内容时呼吸；请求等待首 token、纯工具执行、输出结束时不呼吸。
- **紫点**：只在手动压缩进行中呼吸。
- 呼吸效果复刻 magpie「实时 / Live」的实心点：`1.4s ease-in-out infinite`，50% 关键帧为 `opacity: .35`、`scale(.8)`。
- 开始和停止都不截断动画：开始从完整周期播放，停止时等当前周期播完再移除。

## 目录结构

```text
dsh-magpie-route-badge/
├─ index.js            # Host 半：会话头、压缩记录、只读路由
├─ client.js           # Client 半：徽章、弹层、轮询、动效
├─ cordis.patch.yml    # DSH bundle 补丁
├─ package.json        # 包声明与 dsh bundle/client 配置
├─ locale/
│  ├─ zh.json          # 插件详情页中文元数据
│  └─ en.json          # 插件详情页英文元数据
├─ icon.svg            # 插件图标
└─ README.md
```

## 已知限制

- 只适用于通过 **magpie 网关**使用模型的 DSH 会话；provider 不是 `magpie` / `magpie-*` 时不会显示。
- 按**当前会话**显示：反映该会话最近一次实际路由，不代表未来请求一定会继续使用同一模型。
- 网关重启后、当前会话还没发新请求前，可能查不到该会话路由，此时徽章隐藏。
- 面板「正常请求模型」受 DSH Chat 已加载 Turn 限制，并会累积本次页面会话已见过的模型；未加载且未出现过的更早 Turn 不在列表。
- 面板「压缩请求模型」只保留 Host 存活期间见过的压缩路由；Host 重启后清空。
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
