import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const exam = JSON.parse(readFileSync(new URL('../data/exam-objectives.json', import.meta.url), 'utf8'))
const map = JSON.parse(readFileSync(new URL('../data/curriculum-map.json', import.meta.url), 'utf8'))
const core = (() => {
  const m = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)
  assert.ok(m)
  const sandbox = { DecompressionStream, Blob, Response, crypto: globalThis.crypto, TextEncoder }
  sandbox.window = sandbox
  vm.runInNewContext(m[1], sandbox)
  return sandbox.window.CCARF_CORE
})()
const plain = (v) => JSON.parse(JSON.stringify(v))

function evidence(over) {
  return { evidence: { attempts: 4, correct: 3, questions: ['a', 'b', 'c'], days: ['2026-11-01', '2026-11-02'], lastAt: '2026-11-02', ...(over || {}) } }
}

test('mastery requires repeated, distinct, accurate evidence', () => {
  assert.equal(core.tsEvidenceStatus(null).eligible, false)
  assert.equal(core.tsEvidenceStatus(evidence()).eligible, true)
  assert.equal(core.tsEvidenceStatus(evidence({ attempts: 3 })).eligible, false)
  assert.equal(core.tsEvidenceStatus(evidence({ questions: ['a', 'b'] })).eligible, false)
  assert.equal(core.tsEvidenceStatus(evidence({ days: ['2026-11-01'] })).eligible, false)
  assert.equal(core.tsEvidenceStatus(evidence({ correct: 2 })).eligible, false)
  assert.equal(core.tsEvidenceStatus(evidence({ correct: 3, attempts: 8 })).accuracy, 0.38)
})

test('recordTsAttempt dedupes questions and days and updates every mapped TS', () => {
  let store = core.recordTsAttempt({}, ['D1.1', 'D1.2'], 'q1', true, '2026-11-01')
  store = core.recordTsAttempt(store, ['D1.1'], 'q1', false, '2026-11-01')
  store = core.recordTsAttempt(store, ['D1.1'], 'q2', true, '2026-11-02')
  const a = plain(store['D1.1'].evidence)
  assert.equal(a.attempts, 3)
  assert.equal(a.correct, 2)
  assert.deepEqual(a.questions, ['q1', 'q2'])
  assert.deepEqual(a.days, ['2026-11-01', '2026-11-02'])
  assert.equal(store['D1.2'].evidence.attempts, 1)
})

test('verified state is derived from evidence, never set manually', () => {
  assert.equal(core.tsDisplayState(undefined), 'new')
  assert.equal(core.tsDisplayState({ manual: 'learning', evidence: {} }), 'learning')
  assert.equal(core.tsDisplayState({ manual: 'review', evidence: {} }), 'review')
  assert.equal(core.tsDisplayState(evidence({ manual: 'learning' })), 'verified')
  assert.throws(() => core.setTsManual({}, 'D1.1', 'verified'))
  const cleared = core.setTsManual({}, 'D1.1', 'new')
  assert.equal(core.tsDisplayState(cleared['D1.1']), 'new')
  const learning = core.setTsManual({}, 'D1.1', 'learning')
  assert.equal(core.tsDisplayState(learning['D1.1']), 'learning')
})

test('official registry exposes Chinese hints for all 30 statements', () => {
  assert.equal(exam.taskStatements.length, 30)
  for (const t of exam.taskStatements) {
    assert.ok(t.chineseHint && t.chineseHint.length >= 8, t.id)
    assert.ok(t.officialText.length > 50, t.id)
  }
})

test('curriculum map covers every statement with units and in-scope resources', () => {
  assert.equal(map.units.length, 15)
  const ids = new Set(exam.taskStatements.map((t) => t.id))
  for (const u of map.units) for (const id of u.taskStatementIds) assert.ok(ids.has(id), `${u.id}:${id}`)
  for (const t of exam.taskStatements) {
    assert.ok(map.units.some((u) => u.taskStatementIds.includes(t.id)), `unit for ${t.id}`)
    assert.ok(map.resources.some((r) => r.scope === 'in-scope' && r.taskStatementIds.includes(t.id)), `resource for ${t.id}`)
  }
  assert.equal(map.resources.length, 39)
  const scopes = new Set(['in-scope', 'related', 'out-of-scope', 'unverified'])
  for (const r of map.resources) {
    assert.ok(scopes.has(r.scope), r.name)
    assert.ok(Array.isArray(r.taskStatementIds))
    if (r.domains.length) assert.ok(r.taskStatementIds.length > 0, r.name)
  }
})

test('backup v2 carries Task Statement evidence', async () => {
  const data = { units: [1], notes: {}, ts: { 'D1.1': evidence() } }
  const b = await core.makeBackupV2(data, '2026-11-23T00:00:00Z')
  const v = await core.validateBackupFull(JSON.parse(JSON.stringify(b)))
  assert.equal(v.ok, true, v.errors.join(';'))
  assert.equal(v.summary.ts, 1)
})
