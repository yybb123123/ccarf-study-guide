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

function q(id, ts, correct, type = 'single') {
  return { id, type, domain: 'D1', taskStatementIds: ts, options: ['a', 'b', 'c', 'd'], correctAnswers: correct, question: id, explanation: 'x' }
}
const questions = [
  q('q1', ['D1.1'], [0]),
  q('q2', ['D1.1', 'D1.2'], [1, 2], 'multiple'),
  q('q3', ['D1.3'], [3])
]
const answers = { q1: [0], q2: [1, 2], q3: [3] }

test('evidence covers correct, wrong, unanswered and partial multiple', () => {
  const all = core.buildExamEvidence('exam-1', questions, answers, '2026-11-23T12:00:00Z')
  assert.equal(all.length, 3)
  assert.ok(all.every((e) => e.correct && e.answered))
  assert.equal(all[1].type, 'multiple')

  const wrong = core.buildExamEvidence('exam-2', questions, { q1: [2], q2: [1], q3: [0] }, '2026-11-23T12:00:00Z')
  assert.ok(wrong.every((e) => e.answered && !e.correct))

  const skipped = core.buildExamEvidence('exam-3', questions, { q1: [0] }, '2026-11-23T12:00:00Z')
  assert.equal(skipped[0].answered, true)
  assert.equal(skipped[1].answered, false)
  assert.equal(skipped[2].correct, false)
})

test('applying evidence updates every mapped TS exactly once', () => {
  const ev = core.buildExamEvidence('exam-a', questions, answers, '2026-11-23T12:00:00Z')
  const r1 = core.applyExamEvidence({}, {}, ev)
  assert.equal(r1.applied, 3)
  assert.equal(r1.ts['D1.1'].evidence.attempts, 2)
  assert.equal(r1.ts['D1.1'].evidence.correct, 2)
  assert.equal(r1.ts['D1.1'].evidence.questions.length, 2)
  assert.equal(r1.ts['D1.2'].evidence.attempts, 1)
  assert.equal(r1.ts['D1.3'].evidence.attempts, 1)
  assert.equal(Object.keys(r1.ledger).length, 3)

  const r2 = core.applyExamEvidence(r1.ts, r1.ledger, ev)
  assert.equal(r2.applied, 0)
  assert.equal(r2.skipped, 3)
  assert.equal(r2.ts['D1.1'].evidence.attempts, 2, 'no double count')
})

test('unanswered questions never enter evidence or denominators', () => {
  const ev = core.buildExamEvidence('exam-b', questions, { q1: [0] }, '2026-11-23T12:00:00Z')
  const r = core.applyExamEvidence({}, {}, ev)
  assert.equal(r.applied, 1)
  assert.equal(r.skipped, 2)
  assert.equal(r.ts['D1.3'], undefined)
  assert.equal(r.ts['D1.2'], undefined)
})

test('a different exam with the same question adds attempts but not distinct questions', () => {
  const e1 = core.buildExamEvidence('exam-c1', [questions[0]], { q1: [0] }, '2026-11-23T12:00:00Z')
  const e2 = core.buildExamEvidence('exam-c2', [questions[0]], { q1: [0] }, '2026-11-24T12:00:00Z')
  let r = core.applyExamEvidence({}, {}, e1)
  r = core.applyExamEvidence(r.ts, r.ledger, e2)
  assert.equal(r.ts['D1.1'].evidence.attempts, 2)
  assert.equal(r.ts['D1.1'].evidence.correct, 2)
  assert.equal(r.ts['D1.1'].evidence.questions.length, 1)
  assert.equal(r.ts['D1.1'].evidence.days.length, 2)
})

test('legacy TS records are preserved and evidence is merged', () => {
  const legacy = { 'D1.1': { manual: 'review', evidence: { attempts: 4, correct: 3, questions: ['old'], days: ['2026-11-01'], lastAt: '2026-11-01' } } }
  const ev = core.buildExamEvidence('exam-d', [questions[0]], { q1: [0] }, '2026-11-23T12:00:00Z')
  const r = core.applyExamEvidence(legacy, {}, ev)
  assert.equal(r.ts['D1.1'].manual, 'review')
  assert.equal(r.ts['D1.1'].evidence.attempts, 5)
  assert.equal(r.ts['D1.1'].evidence.correct, 4)
  assert.equal(r.ts['D1.1'].evidence.questions.length, 2)
})

test('backup v3 carries exam state, history, date and ledger', async () => {
  const data = {
    units: [1], notes: {},
    tsLedger: { 'e1::q1': { examId: 'e1', questionId: 'q1', correct: true, at: '2026-11-23T12:00:00Z', tsIds: ['D1.1'], type: 'single' } },
    exam: { id: 'e2', startedAt: 123, minutes: 120, questions: [], answers: {}, marked: {}, index: 0, submitted: false },
    exams: [{ examId: 'e1', pct: 80, total: 60 }],
    examDate: '2026-12-31'
  }
  const b = await core.makeBackupV3(data, '2026-11-23T00:00:00Z')
  assert.equal(b.version, 3)
  const v = await core.validateBackupFull(JSON.parse(JSON.stringify(b)))
  assert.equal(v.ok, true, v.errors.join(';'))
  assert.equal(v.summary.ledger, 1)
  assert.equal(v.summary.exams, 1)
  assert.equal(v.summary.inProgressExam, 1)
  assert.equal(v.summary.examDate, '2026-12-31')

  const bad = JSON.parse(JSON.stringify(b))
  bad.data.exams = {}
  assert.equal((await core.validateBackupFull(bad)).ok, false)
})

test('v1 and v2 backups stay readable under schema v3', async () => {
  const v1 = core.makeBackup({ units: [1] }, '2026-11-23T00:00:00Z')
  assert.equal((await core.validateBackupFull(v1)).ok, true)
  const v2 = await core.makeBackupV2({ units: [1] }, '2026-11-23T00:00:00Z')
  assert.equal(v2.version, 2)
  assert.equal((await core.validateBackupFull(v2)).ok, true)
})

test('backup payload excludes credentials', async () => {
  const b = await core.makeBackupV3({ units: [1], settings: core.safeSettings({ provider: 'deepseek', key: 'sk-secret', ghToken: 'ghp_x' }) }, '2026-11-23T00:00:00Z')
  assert.equal(JSON.stringify(b).includes('sk-secret'), false)
  assert.equal(JSON.stringify(b).includes('ghp_x'), false)
  assert.deepEqual(plain(b.data.settings), { provider: 'deepseek' })
})
