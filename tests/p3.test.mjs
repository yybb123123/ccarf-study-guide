import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('six core entries are presented first', () => {
  for (const label of ['今日学习', '考纲目标', '情景训练', '模拟考场', '错题复习', '资料与工具']) {
    assert.ok(html.includes('>' + label + '<'), label)
  }
  assert.ok(html.includes('id="moreTabs"'))
  for (const label of ['知识库', 'AI 导师', '数据管理']) assert.ok(html.includes('>' + label + '<'), label)
})

test('dashboard exposes readiness with an explicit non-official disclaimer', () => {
  assert.ok(html.includes('考试就绪度（本站指标，不是官方概率）'))
  assert.ok(html.includes('已验证 '))
  assert.ok(html.includes('目标考试日期'))
  assert.ok(html.includes('NotebookLM 推荐'))
})

test('reading guidance states Chinese-first and version caveat', () => {
  assert.ok(html.includes('中文标题优先'))
  assert.ok(html.includes('官方中文网页与仓库里的英文 PDF 可能版本不同'))
})

test('AI tutor entry points are labelled rather than duplicated silently', () => {
  assert.ok(html.includes('费曼教学'))
  assert.ok(html.includes('自由问答（页面 AI 导师）'))
})
