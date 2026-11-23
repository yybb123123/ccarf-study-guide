import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const bankFile = JSON.parse(readFileSync(new URL('../data/question-bank.json', import.meta.url), 'utf8'))
const exam = JSON.parse(readFileSync(new URL('../data/exam-objectives.json', import.meta.url), 'utf8'))
const core = (() => {
  const m = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)
  assert.ok(m)
  const sandbox = { DecompressionStream, Blob, Response, crypto: globalThis.crypto, TextEncoder }
  sandbox.window = sandbox
  vm.runInNewContext(m[1], sandbox)
  return sandbox.window.CCARF_CORE
})()
const plain = (v) => JSON.parse(JSON.stringify(v))
const bank = bankFile.questions

test('question bank is structurally valid and officially mapped', () => {
  assert.equal(bank.length, 60)
  assert.equal(new Set(bank.map((q) => q.id)).size, bank.length)
  const tsIds = new Set(exam.taskStatements.map((t) => t.id))
  const scenarioIds = new Set(exam.scenarios.map((s) => s.id))
  for (const q of bank) {
    assert.equal(q.verified, true, q.id)
    assert.equal(q.evidence, 'official', q.id)
    assert.equal(q.options.length, 4, q.id)
    assert.equal(q.optionAnalysis.length, 4, q.id)
    assert.ok(q.explanation.length >= 12, q.id)
    assert.ok(q.source === 'original', q.id)
    assert.ok(['single', 'multiple'].includes(q.type), q.id)
    assert.ok(q.correctAnswers.length >= (q.type === 'single' ? 1 : 2), q.id)
    for (const id of q.taskStatementIds) assert.ok(tsIds.has(id), q.id + ':' + id)
    if (q.scenarioId) assert.ok(scenarioIds.has(q.scenarioId), q.id + ':' + q.scenarioId)
    const v = core.validateQuestion(q, { sourcesCount: 0, taskIds: [...tsIds], scenarioIds: [...scenarioIds] })
    assert.equal(v.ok, true, q.id + ': ' + v.errors.join(';'))
  }
  assert.deepEqual(new Set(bank.map((q) => q.domain)), new Set(['D1', 'D2', 'D3', 'D4', 'D5']))
  for (const t of exam.taskStatements) {
    assert.ok(bank.some((q) => q.taskStatementIds.includes(t.id)), 'no question for ' + t.id)
  }
})

test('full mock builds 60 items and refuses a short pool', () => {
  const r = core.buildExam(bank, { size: 60, formal: true, seed: 'full' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.questions.length, 60)
  assert.equal(new Set(r.questions.map((q) => q.id)).size, 60)
  const short = core.buildExam(bank.slice(0, 59), { size: 60, formal: true })
  assert.equal(short.ok, false)
  assert.equal(short.reason, 'insufficient')
  assert.equal(short.available, 59)
})

test('a focused test can be built from the current bank without repeats', () => {
  const r = core.buildExam(bank, { size: 30, formal: true, seed: 'a' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.questions.length, 30)
  assert.equal(new Set(r.questions.map((q) => q.id)).size, 30)
  const again = core.buildExam(bank, { size: 30, formal: true, seed: 'a' })
  assert.deepEqual(plain(again.questions.map((q) => q.id)), plain(r.questions.map((q) => q.id)))
})

test('formal mode excludes non-official questions', () => {
  const fake = { ...bank[0], id: 'fake', evidence: 'personal', verified: true }
  const r = core.buildExam([...bank, fake], { size: 61, formal: true, seed: 'x' })
  assert.equal(r.ok, false)
  const mixed = core.buildExam([...bank, fake], { size: 60, formal: true, seed: 'x' })
  assert.equal(mixed.ok, true)
  assert.ok(!mixed.questions.some((q) => q.id === 'fake'))
})

test('exam grading reports domains, types, unanswered and wrong answers', () => {
  const qs = [
    { id: 'a', type: 'single', domain: 'D1', taskStatementIds: ['D1.1'], options: ['1', '2', '3', '4'], correctAnswers: [1], question: 'A' },
    { id: 'b', type: 'multiple', domain: 'D2', taskStatementIds: ['D2.1'], options: ['1', '2', '3', '4'], correctAnswers: [0, 2], question: 'B' },
    { id: 'c', type: 'single', domain: 'D2', taskStatementIds: ['D2.2'], options: ['1', '2', '3', '4'], correctAnswers: [0], question: 'C' }
  ]
  const r = core.gradeExam(qs, { a: [1], b: [2, 0], c: [3] })
  assert.equal(r.total, 3)
  assert.equal(r.correct, 2)
  assert.equal(r.pct, 66.7)
  assert.equal(r.unanswered, 0)
  assert.equal(r.byType.single.correct, 1)
  assert.equal(r.byType.single.total, 2)
  assert.equal(r.byType.multiple.correct, 1)
  assert.equal(r.byDomain.D2.correct, 1)
  assert.equal(r.byTs['D2.2'].correct, 0)
  assert.deepEqual(plain(r.wrong.map((w) => w.id)), ['c'])

  const empty = core.gradeExam(qs, {})
  assert.equal(empty.unanswered, 3)
  assert.equal(empty.correct, 0)
})

test('exam clock and duration helpers', () => {
  const start = 1000000
  assert.equal(core.examRemainingMs(start, 120, start + 60000), 119 * 60000)
  assert.equal(core.examRemainingMs(start, 120, start + 120 * 60000 + 5), 0)
  assert.equal(core.formatDuration(0), '00:00')
  assert.equal(core.formatDuration(61000), '01:01')
  assert.equal(core.formatDuration(3661000), '1:01:01')
})
