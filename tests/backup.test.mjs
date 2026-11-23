import { readFileSync } from 'node:fs'
import test from 'node:test'
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
const plain = (v) => JSON.parse(JSON.stringify(v))

const fullData = {
  units: [1, 15],
  notes: { 1: 'note' },
  accept: ['a1', 'a2'],
  chat: [{ role: 'user', content: 'hello' }],
  cards: [{ id: 'card-1', question: 'Q', nextReview: '2026-11-24', level: 0 }],
  mastery: { MCP: 'learning' },
  feynman: { topic: 'MCP', phase: 'restate', messages: [{ role: 'user', content: 'hi' }], sources: [] },
  knowledge: { docs: [{ id: 'doc-1', name: 'a.md' }], chunks: [{ id: 'doc-1:0', docId: 'doc-1', text: 'x' }] },
  settings: { provider: 'deepseek', model: 'deepseek-chat' }
}

test('v2 backup uses SHA-256 and validates', async () => {
  const b = await core.makeBackupV2(fullData, '2026-11-23T00:00:00Z')
  assert.equal(b.version, 2)
  assert.equal(b.checksum.alg, 'sha256')
  assert.match(b.checksum.value, /^[0-9a-f]{64}$/)
  const v = await core.validateBackupFull(JSON.parse(JSON.stringify(b)))
  assert.equal(v.ok, true, v.errors.join(';'))
  assert.equal(v.summary.accept, 2)
  assert.equal(v.summary.chat, 1)
  assert.equal(v.summary.feynman, 1)
  assert.equal(v.summary.chunks, 1)
})

test('tampered v2 backup fails the SHA-256 check', async () => {
  const b = await core.makeBackupV2(fullData, '2026-11-23T00:00:00Z')
  const bad = JSON.parse(JSON.stringify(b))
  bad.data.units.push(99)
  const v = await core.validateBackupFull(bad)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('SHA-256')))
})

test('a v2 backup without a checksum is rejected', async () => {
  const b = await core.makeBackupV2(fullData, '2026-11-23T00:00:00Z')
  delete b.checksum
  const v = await core.validateBackupFull(b)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('缺少校验和')))
})

test('v1 backups remain readable for backward compatibility', async () => {
  const old = core.makeBackup(fullData, '2026-11-23T00:00:00Z')
  assert.equal(old.version, 1)
  const v = await core.validateBackupFull(old)
  assert.equal(v.ok, true, v.errors.join(';'))
  const bad = JSON.parse(JSON.stringify(old))
  bad.data.cards = []
  assert.equal((await core.validateBackupFull(bad)).ok, false)
})

test('structure validation rejects malformed fields', () => {
  const base = { app: 'ccarf-study-guide', version: 2, data: {}, checksum: { alg: 'sha256', value: '0'.repeat(64) } }
  const badUnits = JSON.parse(JSON.stringify(base))
  badUnits.data.units = {}
  assert.ok(core.validateBackup(badUnits).errors.some((e) => e.includes('units')))

  const badKnowledge = JSON.parse(JSON.stringify(base))
  badKnowledge.data.knowledge = { docs: 'x' }
  assert.ok(core.validateBackup(badKnowledge).errors.some((e) => e.includes('knowledge')))

  const badChat = JSON.parse(JSON.stringify(base))
  badChat.data.chat = {}
  assert.ok(core.validateBackup(badChat).errors.some((e) => e.includes('chat')))
})

test('backup payload never contains credentials', () => {
  const settings = core.safeSettings({ provider: 'deepseek', key: 'sk-secret', ghToken: 'ghp_x', remember: true })
  assert.deepEqual(plain(settings), { provider: 'deepseek' })
  assert.equal(core.MAX_BACKUP_BYTES, 50 * 1024 * 1024)
})
