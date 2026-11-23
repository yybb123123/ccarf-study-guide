import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const core = (() => {
  const m = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)
  assert.ok(m)
  const sandbox = { DecompressionStream, Blob, Response, crypto: globalThis.crypto }
  sandbox.window = sandbox
  vm.runInNewContext(m[1], sandbox)
  return sandbox.window.CCARF_CORE
})()
const plain = (v) => JSON.parse(JSON.stringify(v))

test('cardId is stable for the same question and differs otherwise', () => {
  assert.equal(core.cardId('What is MCP?'), core.cardId('  what is mcp?  '))
  assert.notEqual(core.cardId('A'), core.cardId('B'))
})

test('upsertCard appends new cards and merges existing ones', () => {
  const c1 = { id: core.cardId('Q1'), question: 'Q1', level: 0 }
  const c2 = { id: core.cardId('Q2'), question: 'Q2', level: 1 }
  let list = core.upsertCard([], c1)
  assert.equal(list.length, 1)
  list = core.upsertCard(list, c2)
  assert.equal(list.length, 2)
  list = core.upsertCard(list, { id: c1.id, level: 2 })
  assert.equal(list.length, 2)
  const merged = plain(list).find((c) => c.id === c1.id)
  assert.equal(merged.level, 2)
  assert.equal(merged.question, 'Q1')
})

test('wrong answer schedules tomorrow and a correct streak lengthens', () => {
  const day = '2026-02-01'
  const wrong = core.srsNext({ level: 3 }, false, day)
  assert.equal(wrong.next, '2026-02-02')
  assert.equal(wrong.level, 0)

  let card = { level: 0 }
  let cursor = day
  const intervals = []
  for (let i = 0; i < 3; i++) {
    card = core.srsNext(card, true, cursor)
    intervals.push(card.interval)
    cursor = card.next
  }
  assert.deepEqual(intervals, [3, 7, 16])
})

test('due cards include new cards and exclude future ones', () => {
  const due = core.srsDue([{ id: 'new' }, { id: 'later', next: '2026-03-01' }], '2026-02-01')
  assert.deepEqual(plain(due).map((c) => c.id), ['new'])
})

test('due cards also understand the stored nextReview field', () => {
  const due = core.srsDue([{ id: 'a', nextReview: '2026-02-02' }, { id: 'b', nextReview: '2026-02-09' }], '2026-02-02')
  assert.deepEqual(plain(due).map((c) => c.id), ['a'])
})
