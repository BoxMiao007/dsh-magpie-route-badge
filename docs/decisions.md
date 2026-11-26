# 技术决策

- 2026-11-26：面板的 magpie 请求次数用 `usage.jsonl` 全量增量索引，首次读取全文件、之后只读追加行；DSH Chat `turn-tail.tokenUsage.routes` 只作非 magpie 历史回退。原因：面板需要会话真实计数。放弃：只读尾部的轻量实现。
- 2026-11-26：压缩模型和次数取 `usage.jsonl` 中当前会话的 `kind=compact` 行；Host 在压缩请求期间补采的路由作为次数 1 的兜底。放弃：Host 重启后的内存补采历史。
- 2026-11-26：非 magpie 模型由 Host 在 `llm-pi-ai/request-headers` 中记录普通/压缩请求，历史回退到 Chat tokenUsage。原因：非 magpie 请求不进入 magpie usage 日志。
- 2026-11-26：面板从 CSS anchor + `@position-try` 改为按徽章 rect 计算 `fixed right/bottom`。原因：CSS anchor 在 DSH WebView 下导致面板脱离、内容/高度异常。放弃：原生短视口 `@position-try` 回退。
- 2026-11-26：徽章路由按 DSH 会话 id 查询 magpie 网关，不读取机器级最近路由；原因：满足「当前会话」语义，避免不同会话串味。
