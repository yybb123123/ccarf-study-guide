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

test('local date uses the browser day, not UTC', () => {
  const lateEvening = new Date(2026, 10, 23, 23, 30, 0)
  assert.equal(core.localISODate(lateEvening), '2026-11-23')
  const earlyMorning = new Date(2026, 10, 24, 0, 5, 0)
  assert.equal(core.localISODate(earlyMorning), '2026-11-24')
})

test('addDays handles month, year, leap day and DST boundaries', () => {
  assert.equal(core.addDays('2026-01-31', 1), '2026-02-01')
  assert.equal(core.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(core.addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(core.addDays('2024-02-28', 2), '2024-03-01')
  assert.equal(core.addDays('2026-03-07', 1), '2026-03-08') // spring forward (US)
  assert.equal(core.addDays('2026-03-08', 1), '2026-03-09')
  assert.equal(core.addDays('2026-10-31', 1), '2026-11-01') // fall back (US)
  assert.equal(core.addDays('2026-11-01', 1), '2026-11-02')
  assert.equal(core.addDays('2026-11-01', 70), '2027-01-10')
})

test('srs: wrong resets to one day, correct lengthens to a cap', () => {
  const day = '2026-11-23'
  const wrong = core.srsNext({ level: 4 }, false, day)
  assert.equal(wrong.level, 0)
  assert.equal(wrong.next, '2026-11-24')
  assert.equal(wrong.interval, 1)

  let card = { level: 0 }
  const seen = []
  let cursor = day
  for (let i = 0; i < 7; i++) {
    card = core.srsNext(card, true, cursor)
    seen.push(card.interval)
    cursor = card.next
  }
  assert.deepEqual(seen, [3, 7, 16, 35, 70, 70, 70])
  assert.equal(card.level, 5)
})

test('srs: a wrong answer after a long streak drops back to one day', () => {
  const card = { level: 5, reps: 9 }
  const r = core.srsNext(card, false, '2026-11-23')
  assert.equal(r.level, 0)
  assert.equal(r.next, '2026-11-24')
  assert.equal(r.reps, 10)
})

test('studyTick only counts eligible time and caps a single tick', () => {
  const start = new Date(2026, 10, 23, 10, 0, 0).getTime()
  let s = core.studyTick({ total: 0, byDate: {} }, start, true, 30000)
  assert.equal(s.total, 0)
  s = core.studyTick(s, start + 10000, true, 30000)
  assert.equal(s.total, 10000)
  assert.equal(s.byDate['2026-11-23'], 10000)
  s = core.studyTick(s, start + 25000, true, 30000)
  assert.equal(s.total, 25000)
  s = core.studyTick(s, start + 100000, true, 30000) // long gap: not counted
  assert.equal(s.total, 25000)
  s = core.studyTick(s, start + 130000, false, 30000) // hidden
  assert.equal(s.total, 25000)
  const t = core.studyTotals(s, '2026-11-23')
  assert.deepEqual(plain(t), { totalMs: 25000, todayMs: 25000 })
})

const base = {
  question: 'MCP 的三种角色是什么？',
  type: 'single',
  options: ['Tools、Resources、Prompts', 'Read、Write、Bash', 'Plan、Act、Review', 'Input、Output、Log'],
  correctAnswers: [0],
  explanation: 'MCP 暴露 Tools、Resources 与 Prompts 三种角色，不替代授权系统。',
  domain: 'D2',
  taskStatementIds: ['D2.1'],
  sourceReferences: [1],
  difficulty: 2
}
const ctx = { sourcesCount: 2, sources: [{ level: 2 }, { level: 4 }], taskIds: ['D2.1', 'D1.1'] }

test('question schema accepts a valid single and a valid multiple', () => {
  const s = core.validateQuestion(base, ctx)
  assert.equal(s.ok, true, s.errors.join(';'))
  assert.equal(s.question.evidence, 'official')
  const m = core.validateQuestion({
    ...base, type: 'multiple', correctAnswers: [0, 2], explanation: '两个正确选项的理由分别说明如下。'
  }, ctx)
  assert.equal(m.ok, true, m.errors.join(';'))
  assert.equal(m.question.correctAnswers.length, 2)
})

test('question schema rejects structural violations', () => {
  const bad = (patch) => core.validateQuestion({ ...base, ...patch }, ctx).ok
  assert.equal(bad({ options: ['a', 'a', 'b', 'c'] }), false)
  assert.equal(bad({ correctAnswers: [9] }), false)
  assert.equal(bad({ correctAnswers: [] }), false)
  assert.equal(bad({ type: 'multiple', correctAnswers: [0] }), false)
  assert.equal(bad({ type: 'single', correctAnswers: [0, 1] }), false)
  assert.equal(bad({ explanation: '短' }), false)
  assert.equal(bad({ domain: 'D9' }), false)
  assert.equal(bad({ taskStatementIds: ['D9.9'] }), false)
  assert.equal(bad({ sourceReferences: [3] }), false)
  assert.equal(bad({ type: 'weird' }), false)
})

test('question schema derives evidence and enforces formal rules', () => {
  const personal = core.validateQuestion(base, { sourcesCount: 1, sources: [{ level: 4 }], taskIds: ['D2.1'] })
  assert.equal(personal.question.evidence, 'personal')
  const formal = core.validateQuestion(base, { sourcesCount: 1, sources: [{ level: 4 }], taskIds: ['D2.1'], formal: true })
  assert.equal(formal.ok, false)
  const noRefs = core.validateQuestion({ ...base, sourceReferences: [] }, { sourcesCount: 0 })
  assert.equal(noRefs.question.evidence, 'model')
})

test('legacy answer field is converted to correctAnswers', () => {
  const q = { ...base }
  delete q.correctAnswers
  q.answer = 0
  const r = core.validateQuestion(q, ctx)
  assert.equal(r.ok, true, r.errors.join(';'))
  assert.deepEqual(plain(r.question.correctAnswers), [0])
})

test('grading is exact for single and set-based for multiple', () => {
  const single = { type: 'single', correctAnswers: [1] }
  assert.equal(core.gradeQuestion(single, [1]).correct, true)
  assert.equal(core.gradeQuestion(single, [0]).correct, false)
  assert.equal(core.gradeQuestion(single, [1, 2]).correct, false)
  const multi = { type: 'multiple', correctAnswers: [0, 2] }
  assert.equal(core.gradeQuestion(multi, [2, 0]).correct, true)
  assert.equal(core.gradeQuestion(multi, [0]).correct, false)
  assert.equal(core.gradeQuestion(multi, [0, 2, 3]).correct, false)
})

test('invalid citations are detected against the sources actually sent', () => {
  assert.deepEqual(plain(core.invalidCitations('见 [1] 与 [2]', 2)), [])
  assert.deepEqual(plain(core.invalidCitations('见 [1] 与 [3]', 2)), [3])
  assert.deepEqual(plain(core.invalidCitations('没有编号', 0)), [])
})

test('payload parser rejects bad JSON and mixed invalid questions', () => {
  assert.equal(core.parseQuestionPayload('not json', ctx).ok, false)
  const mixed = JSON.stringify([base, { ...base, correctAnswers: [99] }])
  const r = core.parseQuestionPayload(mixed, ctx)
  assert.equal(r.ok, false)
  assert.equal(r.questions.length, 1)
  assert.ok(r.errors[0].includes('第 2 题'))
})

test('page copy no longer claims 31 documents or Gist sync', () => {
  assert.equal(/31 份官方文档/.test(html), false)
  assert.equal(/进度云同步/.test(html), false)
})
