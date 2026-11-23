import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const htmlUrl = new URL('../index.html', import.meta.url)
const html = readFileSync(htmlUrl, 'utf8')

function loadCore() {
  const m = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)
  assert.ok(m, 'index.html must contain <script id="ccarf-core">')
  const sandbox = { window: {} }
  vm.runInNewContext(m[1], sandbox)
  return sandbox.window.CCARF_CORE
}

const core = loadCore()
const plain = (v) => JSON.parse(JSON.stringify(v))

test('P0: migration keeps progress, notes, theme and chat', () => {
  const res = core.migrateV1({
    units: [1, 4, 9],
    notes: { 1: 'agent loop', 4: 'mcp' },
    theme: 'dark',
    chat: [{ role: 'user', content: 'hi' }],
    ai: { provider: 'deepseek', model: 'deepseek-chat' }
  })
  assert.deepEqual(plain(res.preserved.units), [1, 4, 9])
  assert.deepEqual(plain(res.preserved.notes), { 1: 'agent loop', 4: 'mcp' })
  assert.equal(res.preserved.theme, 'dark')
  assert.equal(res.preserved.chat.length, 1)
})

test('P0: migration strips Gist credentials and settings', () => {
  const res = core.migrateV1({
    units: [2],
    ai: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      ghToken: 'ghp_secret',
      ghSession: 'ghp_session',
      gistId: 'abc123',
      ghEnabled: true
    }
  })
  assert.equal(res.ai.provider, 'deepseek')
  assert.equal(res.ai.model, 'deepseek-chat')
  for (const k of ['ghToken', 'ghSession', 'gistId', 'ghEnabled']) {
    assert.equal(Object.prototype.hasOwnProperty.call(res.ai, k), false, k)
  }
  assert.ok(res.removedKeys.includes('ccarf.ghtoken'))
  assert.ok(res.removedKeys.includes('ccarf.lastsync'))
  assert.ok(res.removedKeys.includes('ccarf.ai.ghToken'))
  assert.deepEqual(plain(res.preserved.units), [2])
})

test('P0: migration tolerates missing or empty state', () => {
  const a = core.migrateV1(null)
  assert.equal(a.ai, null)
  assert.equal(a.preserved.units, null)
  const b = core.migrateV1({})
  assert.equal(b.preserved.notes, null)
  const c = core.migrateV1({ units: [], ai: {} })
  assert.deepEqual(plain(c.preserved.units), [])
  assert.deepEqual(plain(c.ai), {})
})

test('P0: page no longer requests GitHub Gist or stores a token', () => {
  assert.equal(/api\.github\.com\/gists/.test(html), false)
  assert.equal(/ccarf\.ghtoken/.test(html), true, 'only the cleanup path may mention the key')
  assert.equal(/id="ghToken"/.test(html), false)
  assert.equal(/id="gistId"/.test(html), false)
  assert.equal(/id="autoSync"/.test(html), false)
  // the only remaining mention of the legacy key must be the migration cleanup
  const mentions = html.match(/ccarf\.ghtoken/g) || []
  assert.ok(mentions.length <= 3, `unexpected legacy token mentions: ${mentions.length}`)
})
