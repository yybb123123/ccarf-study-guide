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

test('v3 valid backup passes and schema-valid tampering is rejected', async () => {
  const b = await core.makeBackupV3({ units: [1], notes: {} }, '2026-11-23T00:00:00Z')
  assert.equal(b.version, 3)
  assert.equal((await core.validateBackupFull(plain(b))).ok, true)

  const tampered = plain(b)
  tampered.data.units = [2]
  const v = await core.validateBackupFull(tampered)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => /SHA-256/.test(e)), v.errors.join(';'))
})

test('v2 schema-valid tampering is rejected', async () => {
  const b = await core.makeBackupV2({ units: [1] }, '2026-11-23T00:00:00Z')
  assert.equal((await core.validateBackupFull(plain(b))).ok, true)
  const tampered = plain(b)
  tampered.data.units = [3]
  assert.equal((await core.validateBackupFull(tampered)).ok, false)
})

test('v1 keeps FNV and detects schema-valid tampering', async () => {
  const b = core.makeBackup({ units: [1] }, '2026-11-23T00:00:00Z')
  assert.equal((await core.validateBackupFull(plain(b))).ok, true)
  const tampered = plain(b)
  tampered.data.units = [9]
  const v = await core.validateBackupFull(tampered)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => /校验和不匹配/.test(e)))
})

test('version and checksum algorithm must match', async () => {
  const b = await core.makeBackupV3({ units: [1] }, '2026-11-23T00:00:00Z')
  const fnvForV3 = plain(b)
  fnvForV3.checksum = core.makeBackup({ units: [1] }, '2026-11-23T00:00:00Z').checksum
  assert.equal((await core.validateBackupFull(fnvForV3)).ok, false)

  const shaForV1 = core.makeBackup({ units: [1] }, '2026-11-23T00:00:00Z')
  shaForV1.checksum = { alg: 'sha256', value: 'a'.repeat(64) }
  assert.equal((await core.validateBackupFull(shaForV1)).ok, false)

  const badAlg = plain(b)
  badAlg.checksum = { alg: 'sha1', value: 'a'.repeat(40) }
  assert.equal((await core.validateBackupFull(badAlg)).ok, false)

  const missing = plain(b)
  delete missing.checksum
  assert.equal((await core.validateBackupFull(missing)).ok, false)

  const badHex = plain(b)
  badHex.checksum = { alg: 'sha256', value: 'xyz' }
  assert.equal((await core.validateBackupFull(badHex)).ok, false)
})

test('future version is refused before checksum work', async () => {
  const b = await core.makeBackupV3({ units: [1] }, '2026-11-23T00:00:00Z')
  b.version = 4
  const v = await core.validateBackupFull(plain(b))
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => /版本较新/.test(e)))
})
