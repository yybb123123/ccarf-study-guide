import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const exam = JSON.parse(readFileSync(new URL('../data/exam-objectives.json', import.meta.url), 'utf8'))

test('official guide metadata and weights', () => {
  assert.equal(exam.guideVersion, '1.1')
  assert.deepEqual(exam.domains.map((d) => [d.id, d.weight]), [
    ['D1', 27], ['D2', 18], ['D3', 20], ['D4', 20], ['D5', 15]
  ])
  assert.equal(exam.domains.reduce((n, d) => n + d.weight, 0), 100)
  assert.deepEqual(exam.format, {
    items: 60, minutes: 120, itemFormat: 'multiple-choice and multiple-response',
    scenariosShown: 4, scenariosTotal: 6, scaledMin: 100, scaledMax: 1000, scaledCut: 720
  })
})

test('30 task statements with unique IDs and correct domain counts', () => {
  assert.equal(exam.taskStatements.length, 30)
  const ids = new Set(exam.taskStatements.map((t) => t.id))
  assert.equal(ids.size, 30)
  const counts = {}
  for (const t of exam.taskStatements) {
    assert.match(t.id, /^D[1-5]\.\d+$/)
    assert.equal(t.id.split('.')[0], t.domain)
    assert.ok(t.officialTitle.length > 10)
    assert.ok(t.officialText.length > 50)
    counts[t.domain] = (counts[t.domain] || 0) + 1
  }
  assert.deepEqual(counts, { D1: 7, D2: 5, D3: 6, D4: 6, D5: 6 })
})

test('six official scenarios with stable IDs', () => {
  assert.equal(exam.scenarios.length, 6)
  assert.deepEqual(exam.scenarios.map((s) => s.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
  assert.match(exam.scenarios[0].title, /Customer Support/)
})
