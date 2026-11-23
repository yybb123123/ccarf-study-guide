import http from 'node:http'

const PORT = Number(process.env.PORT || 8899)

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'not found' } }))
    return
  }
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid json' } }))
    return
  }
  const model = String(body.model || '')
  if (model === 'mock-401') {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
    return
  }
  if (model === 'mock-429') {
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'rate limited' } }))
    return
  }
  const system = (body.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  const lastUser = (body.messages || []).filter((m) => m.role === 'user').slice(-1)[0] || { content: '' }
  let content
  if (/出题器/.test(system)) {
    content = JSON.stringify([
      {
        question: 'Mock 单选题：MCP 的三种角色是什么？',
        type: 'single',
        options: ['Tools、Resources、Prompts', 'Read、Write、Bash', 'Plan、Act、Review', 'Input、Output、Log'],
        correctAnswers: [0],
        explanation: 'MCP 暴露 Tools、Resources 与 Prompts 三种角色。',
        domain: 'D2',
        taskStatementIds: ['D2.1'],
        sourceReferences: [1],
        difficulty: 1
      }
    ])
  } else {
    content = 'Mock 导师回答：依据 [1]，MCP 提供 Tools、Resources、Prompts；没有发送整库。'
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 42, completion_tokens: 7 },
    echo: { lastUserLength: String(lastUser.content || '').length }
  }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-deepseek listening on http://127.0.0.1:${PORT}/v1`)
})

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
