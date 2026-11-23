import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const core = (() => {
  const m = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)
  assert.ok(m)
  const sandbox = { DecompressionStream, Blob, Response, crypto: globalThis.crypto, TextEncoder }
  sandbox.window = sandbox
  vm.runInNewContext(m[1], sandbox)
  return sandbox.window.CCARF_CORE
})()

const port = 8900 + Math.floor(Math.random() * 90)
const base = `http://127.0.0.1:${port}/v1`
let proc

before(async () => {
  proc = spawn(process.execPath, ['scripts/mock-deepseek.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  })
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + '/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'mock', messages: [{ role: 'user', content: 'ping' }] })
      })
      if (r.ok) return
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('mock server did not start')
})

after(() => { if (proc) proc.kill('SIGTERM') })

async function post(body) {
  const res = await fetch(base + '/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk-mock' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  return { status: res.status, text, json: (() => { try { return JSON.parse(text) } catch (e) { return null } })() }
}

test('mock mentor returns text and token usage', async () => {
  const r = await post({ model: 'mock-tutor', messages: [{ role: 'system', content: '导师' }, { role: 'user', content: '解释 MCP' }] })
  assert.equal(r.status, 200)
  assert.match(r.json.choices[0].message.content, /Mock 导师回答/)
  assert.equal(r.json.usage.prompt_tokens, 42)
  assert.equal(r.json.usage.completion_tokens, 7)
})

test('mock question payload passes the real schema parser', async () => {
  const r = await post({ model: 'mock-quiz', messages: [{ role: 'system', content: '出题器' }, { role: 'user', content: '生成' }] })
  assert.equal(r.status, 200)
  const parsed = core.parseQuestionPayload(r.json.choices[0].message.content, {
    sourcesCount: 1, sources: [{ level: 4 }], taskIds: ['D2.1'], scenarioIds: ['S1'], requireTask: false, requireSource: false
  })
  assert.equal(parsed.ok, true, parsed.errors.join(';'))
  assert.equal(parsed.questions.length, 1)
  assert.equal(parsed.questions[0].type, 'single')
})

test('mock 401 and 429 are surfaced as non-2xx', async () => {
  const a = await post({ model: 'mock-401', messages: [{ role: 'user', content: 'x' }] })
  assert.equal(a.status, 401)
  assert.match(a.json.error.message, /api key/i)
  const b = await post({ model: 'mock-429', messages: [{ role: 'user', content: 'x' }] })
  assert.equal(b.status, 429)
})

test('unknown path returns 404 rather than a fake success', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/wrong`)
  assert.equal(res.status, 404)
})
