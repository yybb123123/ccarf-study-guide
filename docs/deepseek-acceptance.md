# DeepSeek 验收记录与步骤

> 状态：**真实 DeepSeek 未验证**（本机没有可用 API Key）。本文只描述已经做过的网络 Mock 验证与需要人工完成的真实验收，不能当作真实调用成功。

## 已完成的自动/网络 Mock 验证

- `scripts/mock-deepseek.mjs`：本地 OpenAI 兼容的 mock 服务，返回 `choices[0].message.content` 与 `usage`。
- `tests/prC.test.mjs`：启动 mock 服务，验证：
  - 普通导师请求返回文本与 token 用量；
  - 出题请求返回的 JSON 可通过 `parseQuestionPayload` 的 Schema 校验；
  - 401 / 429 返回非 2xx，页面会显示错误而不是"成功"。
- 浏览器（本地，非真实 API）：
  - 配置 `baseUrl=http://127.0.0.1:8899/v1` + 占位 Key；
  - 费曼导师收到 mock 文本与 `42 + 7` tokens；
  - 出题收到 mock 题目并通过校验；
  - `mock-401` 模型显示请求失败。

## 仍需你真实验收的步骤

1. 打开站点 → 设置 → 服务商 DeepSeek → 填真实 Key → 模型 `deepseek-chat` → 保存。
2. 导入一份本地资料；导师输入一个知识点并开始。
3. 打开 DevTools → Network → 查看 `/chat/completions` 请求体：
   - 只包含当前步骤、用户回答与最多 4 个资料片段；
   - 不包含整库或其它无关资料；
   - 片段编号与右侧来源一一对应。
4. 确认回复中的 `[n]` 都能在来源列表找到；无来源时会显示"本地学习资料中暂未找到足够依据"。
5. 在「复习」生成 2 道题，确认返回是合法 JSON、通过校验后再展示；非法 JSON 会重试一次后拒绝。
6. 分别观察 401（Key 错误）、429（限流）、超时（60 秒）的提示是否清楚。
7. 记录 `usage.prompt_tokens` / `completion_tokens`，与请求片段数量一起估算成本。

## 成本控制

- 每次导师请求最多 4 个片段 × 900 字；
- 出题每次 2 题；
- `max_tokens` 沿用 1500；
- 不做批量生成，不在开考时调用 AI；
- 真实 token 用量以 API 返回的 `usage` 为准，不手算价格。

## 免责声明

Mock 通过不等于真实服务通过。真实模型可能返回额外文本、非法 JSON、不同字段名或限流；以上步骤必须在真实 Key 下重跑并记录结果。
