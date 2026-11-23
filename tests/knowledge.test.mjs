import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import zlib from 'node:zlib'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const core = (() => {
  const m = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)
  assert.ok(m, 'core block')
  const sandbox = { DecompressionStream, Blob, Response, crypto: globalThis.crypto }
  sandbox.window = sandbox
  vm.runInNewContext(m[1], sandbox)
  return sandbox.window.CCARF_CORE
})()
const plain = (v) => JSON.parse(JSON.stringify(v))

test('chunkText splits long text and keeps all markers', () => {
  const para = 'AGENT LOOP. '.repeat(60)
  const text = [para, 'MARK-B ' + 'x'.repeat(500), 'MARK-C'].join('\n\n')
  const chunks = core.chunkText(text, 1200, 150)
  assert.ok(chunks.length >= 2)
  for (const c of chunks) assert.ok(c.text.length <= 1200, `chunk too long: ${c.text.length}`)
  const all = chunks.map((c) => c.text).join('\n')
  for (const marker of ['MARK-B', 'MARK-C']) assert.ok(all.includes(marker), marker)
})

test('chunkText returns nothing for empty input', () => {
  assert.deepEqual(plain(core.chunkText('   ')), [])
})

test('tokenize handles English terms and CJK bigrams', () => {
  const toks = core.tokenize('MCP 工具设计 mcp，Claude Code')
  assert.ok(toks.includes('mcp'))
  assert.ok(toks.includes('claude'))
  assert.ok(toks.includes('工具'))
  assert.ok(toks.includes('具设'))
  assert.ok(toks.includes('设计'))
})

test('classify maps content to exam domains', () => {
  const byTop = (t) => (core.classify(t)[0] || {}).domain
  assert.equal(byTop('MCP tool schema 最小授权 只读 工具调用'), 'D2')
  assert.equal(byTop('提示词 JSON schema 结构化输出 校验 重试 评测'), 'D4')
  assert.equal(byTop('上下文 压缩 检索 记忆 可靠性 失败'), 'D5')
  assert.equal(byTop('多智能体 编排 subagent 权限 并行 coordinator'), 'D1')
})

test('classify supports multiple domains and empty input', () => {
  const ds = core.classify('MCP tool with prompt JSON schema and context retrieval').map((x) => x.domain)
  assert.ok(ds.length >= 2)
  assert.deepEqual(plain(core.classify('')), [])
  assert.deepEqual(plain(core.classify('zzz qqq')), [])
})

test('BM25 ranks relevant chunks and honours filters', () => {
  const rows = [
    { id: 'a', docId: 'd1', name: 'agent.md', text: 'agent orchestration subagent coordinator', domains: ['D1'] },
    { id: 'b', docId: 'd2', name: 'mcp.md', text: 'mcp tool schema authorization', domains: ['D2'] },
    { id: 'c', docId: 'd2', name: 'mcp.md', text: 'context compression and retrieval reliability', domains: ['D5'] }
  ]
  const idx = core.buildIndex(rows)
  const hit = core.search(idx, 'mcp', {})
  assert.equal(hit[0].id, 'b')
  assert.equal(core.search(idx, 'mcp', { domain: 'D1' }).length, 0)
  assert.equal(core.search(idx, 'context', { docId: 'd2' })[0].id, 'c')
  assert.deepEqual(plain(core.search(idx, '', {})), [])
  assert.deepEqual(plain(core.search(idx, 'term-not-there', {})), [])
})

test('snippet shows the matched area with ellipses', () => {
  const text = 'x'.repeat(300) + ' orchestration ' + 'y'.repeat(300)
  const s = core.snippet(text, 'orchestration', 50)
  assert.ok(s.includes('orchestration'))
  assert.ok(s.startsWith('…') && s.endsWith('…'))
})

test('srsNext schedules deterministic intervals', () => {
  const day = '2026-01-01'
  const wrong = core.srsNext({ level: 2, reps: 4 }, false, day)
  assert.equal(wrong.level, 0)
  assert.equal(wrong.interval, 1)
  assert.equal(wrong.next, '2026-01-02')

  let card = { level: 0, reps: 0 }
  let cursor = day
  const seq = []
  for (let i = 0; i < 5; i++) {
    card = core.srsNext(card, true, cursor)
    seq.push(card.interval)
    cursor = card.next
  }
  assert.deepEqual(seq, [3, 7, 16, 35, 70])
  assert.equal(card.next, '2026-05-12')
})

test('srsDue returns only due cards', () => {
  const cards = [
    { id: 'a', next: '2026-01-01' },
    { id: 'b', next: '2026-01-05' },
    { id: 'c' }
  ]
  assert.deepEqual(core.srsDue(cards, '2026-01-02').map((c) => c.id), ['a', 'c'])
})

test('backup roundtrip validates and detects tampering', () => {
  const data = { units: [1, 2], notes: { 1: 'x' }, cards: [{ id: 'c1' }], knowledge: { docs: [{ id: 'd1' }] } }
  const b = core.makeBackup(data, '2026-01-01T00:00:00Z')
  assert.equal(b.version, 1)
  const ok = core.validateBackup(JSON.parse(JSON.stringify(b)))
  assert.equal(ok.ok, true)
  const summary = plain(ok.summary)
  assert.equal(summary.units, 2)
  assert.equal(summary.notes, 1)
  assert.equal(summary.docs, 1)
  assert.equal(summary.cards, 1)
  assert.equal(summary.time, 0)
  assert.equal(summary.ts, 0)

  const bad = JSON.parse(JSON.stringify(b))
  bad.data.units.push(99)
  const v = core.validateBackup(bad)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('校验和')))

  const wrongApp = core.validateBackup({ app: 'other', version: 1, data: {} })
  assert.equal(wrongApp.ok, false)

  const newer = core.makeBackup({}, '2026-01-01T00:00:00Z')
  newer.version = 99
  assert.ok(core.validateBackup(newer).errors.some((e) => e.includes('版本较新')))
})

test('safeSettings keeps only non-secret fields', () => {
  const s = core.safeSettings({ provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', key: 'sk-secret', ghToken: 'ghp_secret', remember: true })
  assert.deepEqual(plain(s), { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' })
})

test('extractPdfText reads a Flate-compressed text stream', async () => {
  const content = 'BT /F1 12 Tf 72 720 Td (Hello Agent) Tj ET'
  const flate = zlib.deflateSync(Buffer.from(content, 'latin1'))
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + flate.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
    flate,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  ])
  const out = await core.extractPdfText(pdf)
  assert.equal(out.hasText, true)
  assert.match(out.text, /Hello Agent/)
})

test('extractPdfText reports no text for a scan-like PDF', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n%%EOF', 'latin1')
  const out = await core.extractPdfText(pdf)
  assert.equal(out.hasText, false)
})

test('extractPdfText rejects non-PDF bytes', async () => {
  await assert.rejects(() => core.extractPdfText(Buffer.from('not a pdf')), /不是有效的 PDF/)
})
