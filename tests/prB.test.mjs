import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const bank = JSON.parse(readFileSync(new URL('../data/question-bank.json', import.meta.url), 'utf8')).questions
const exam = JSON.parse(readFileSync(new URL('../data/exam-objectives.json', import.meta.url), 'utf8'))
const audit = JSON.parse(readFileSync(new URL('../data/question-audit.json', import.meta.url), 'utf8'))
const core = (() => {
  const m = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)
  assert.ok(m)
  const sandbox = { DecompressionStream, Blob, Response, crypto: globalThis.crypto, TextEncoder }
  sandbox.window = sandbox
  vm.runInNewContext(m[1], sandbox)
  return sandbox.window.CCARF_CORE
})()

test('bank has substantial multiple-choice coverage across scenarios', () => {
  const multi = bank.filter((q) => q.type === 'multiple')
  assert.ok(multi.length >= 12, String(multi.length))
  assert.ok(new Set(multi.map((q) => q.scenarioId)).size >= 4)
  for (const q of multi) {
    assert.match(q.question, /选 \d+ 项/, q.id)
    assert.ok(q.correctAnswers.length >= 2)
    assert.equal(q.optionAnalysis.length, 4)
  }
  assert.equal(new Set(bank.map((q) => q.id)).size, bank.length)
})

test('provenance is explicit, not presented as official review', () => {
  for (const q of bank) {
    assert.equal(q.origin, 'original-simulation')
    assert.equal(q.humanReviewed, false)
    assert.equal(q.reviewStatus, 'structure+content-self-checked')
    assert.notEqual(q.evidence, 'official')
  }
  assert.ok(exam.scenarios.length === 6)
})

test('four-scenario composition refuses the current uneven bank', () => {
  const cov = core.scenarioCoverage(bank, 60, 4)
  assert.equal(cov.per, 15)
  assert.ok(cov.eligible.length < 4, JSON.stringify(cov.counts))
  const r = core.buildScenarioExam(bank, { size: 60, scenarioCount: 4, seed: 'x' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'insufficient-scenarios')
})

test('four-scenario composition works when four scenarios have enough items', () => {
  const synthetic = []
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5']) {
    for (let i = 0; i < 16; i++) {
      synthetic.push({
        id: s + '-q' + i, type: 'single', domain: ['D1', 'D2', 'D3', 'D4', 'D5'][i % 5],
        taskStatementIds: ['D1.1'], options: ['a', 'b', 'c', 'd'], correctAnswers: [0],
        question: 'question ' + i, explanation: 'explanation long enough', scenarioId: s,
        evidence: 'official-outline', verified: true, reviewStatus: 'structure+content-self-checked'
      })
    }
  }
  const r = core.buildScenarioExam(synthetic, { size: 60, scenarioCount: 4, seed: 'x' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.questions.length, 60)
  assert.equal(new Set(r.questions.map((q) => q.id)).size, 60)
  assert.equal(new Set(r.questions.map((q) => q.scenarioId)).size, 4)
  const again = core.buildScenarioExam(synthetic, { size: 60, scenarioCount: 4, seed: 'x' })
  assert.deepEqual(again.questions.map((q) => q.id), r.questions.map((q) => q.id))
  const other = core.buildScenarioExam(synthetic, { size: 60, scenarioCount: 4, seed: 'y' })
  assert.notDeepEqual(other.questions.map((q) => q.id), r.questions.map((q) => q.id))
})

test('audit report covers every question and states its limits', () => {
  assert.equal(audit.humanReviewed, false)
  assert.match(audit.disclaimer, /不声称/)
  assert.equal(audit.summary.total, bank.length)
  assert.equal(audit.summary.failed, 0)
  assert.equal(audit.summary.taskStatementsCovered, 30)
  assert.equal(audit.questions.length, bank.length)
  for (const q of audit.questions) {
    assert.equal(q.status, 'self-checked')
    for (const [k, v] of Object.entries(q.checks)) assert.equal(v, true, q.id + ':' + k)
  }
})
