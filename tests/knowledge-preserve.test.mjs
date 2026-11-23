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

test('missing knowledge is distinguishable from an explicit empty knowledge', () => {
  assert.equal(core.hasKnowledgePayload({ units: [1] }), false)
  assert.equal(core.hasKnowledgePayload({ units: [1], knowledge: undefined }), false)
  assert.equal(core.hasKnowledgePayload({ knowledge: { docs: [], chunks: [] } }), true)
  assert.equal(core.hasKnowledgePayload({ knowledge: {} }), true)
  assert.equal(core.hasKnowledgePayload(null), false)
})

test('a v3 backup without knowledge still validates, but is flagged as missing', async () => {
  const b = await core.makeBackupV3({ units: [1] }, '2026-11-23T00:00:00Z')
  const v = await core.validateBackupFull(JSON.parse(JSON.stringify(b)))
  assert.equal(v.ok, true, v.errors.join(';'))
  assert.equal(core.hasKnowledgePayload(b.data), false)
})
