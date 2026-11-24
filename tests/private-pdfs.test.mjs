import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const chineseStems = [
  '00_CCAR-F_Exam_Guide_v1.1_官方42页',
  '01_CCAR-F_官方认证主页',
  '01_D1_27pct_Multi-agent_Research_System',
  '01_D1_Building_Effective_Agents',
  '02_D1_Claude_Agent_SDK_Overview',
  '02_官方认证FAQ',
  '02_课程_Building_with_the_Claude_API',
  '03_D2_MCP官方介绍',
  '03_专门认证备考课程目录',
  '03_课程_Claude_with_Amazon_Bedrock',
  '04_Anthropic_Academy课程总目录',
  '04_课程_Claude_on_Google_Cloud',
  '05_D4_Anthropic_Prompting指南',
  '05_课程_AI_Fluency',
  '06_课程_Claude_101',
  '07_课程_Claude_Code_101',
  '08_课程_Introduction_to_MCP',
  '09_D5_15pct_Contextual_Retrieval',
  '09_课程_Claude_Code_in_Action',
  '10_D5_15pct_Demystifying_Evals',
  '10_课程_Introduction_to_Agent_Skills',
  '11_课程_Introduction_to_Subagents'
]
const titles = [...new Set([...html.matchAll(/<span class="tfile-title" title="([^"]+\.pdf)"/g)].map(m => m[1]))]
const pdfCode = html.match(/<script id="ccarf-pdf-translations">([\s\S]*?)<\/script>/)?.[1]
assert.ok(pdfCode, 'private PDF reader script present')

function loadPdfModule() {
  const sandbox = {
    window: {}, document: {
      querySelectorAll(selector) {
        return selector.includes('tfile-title') ? titles.map(title => ({ getAttribute: () => title })) : []
      },
      getElementById() { return null },
      addEventListener() {}
    },
    // IndexedDB can fail in private mode; it must not interrupt initial site load.
    indexedDB: { open() { throw new Error('mock unavailable storage') } },
    Blob, Response, TextDecoder, Uint8Array, DataView, Map, Set, Promise, URL,
    DecompressionStream, TextEncoder, setTimeout
  }
  sandbox.window = sandbox
  vm.runInNewContext(pdfCode, sandbox, { timeout: 2000 })
  return sandbox.CCARF_PDF
}

test('all 22 uploaded Chinese PDF translations map to existing source files', () => {
  assert.equal(chineseStems.length, 22)
  assert.equal(new Set(chineseStems).size, 22)
  const pdf = loadPdfModule()
  for (const stem of chineseStems) {
    assert.ok(titles.includes(stem + '.pdf'), 'original not on site: ' + stem)
    assert.equal(pdf.pdfSource(stem + '.zh.pdf'), stem + '.pdf')
    assert.equal(pdf.pdfSource('第一批16份/' + stem + '.zh.pdf'), stem + '.pdf')
  }
  assert.equal(pdf.pdfSource('unknown.zh.pdf'), null)
  assert.equal(pdf.pdfSource('01_D1_Building_Effective_Agents.en.pdf'), null)
})

test('Chinese PDF has first-class local link and import is browser-only', () => {
  assert.match(html, /id="pdfImportBtn"/)
  assert.match(html, /id="pdfImportInput"[^>]*multiple/)
  assert.match(pdfCode, /indexedDB\.open\(DB_NAME,1\)/)
  assert.match(pdfCode, /DecompressionStream\("deflate-raw"\)/)
  assert.match(pdfCode, /URL\.createObjectURL\(rec\.blob\)/)
  assert.match(pdfCode, /stopImmediatePropagation\(\)/)
  assert.match(pdfCode, /source=pdfSource\(name\)/)
  assert.match(pdfCode, /window\.CCARF_PDF=/)
  assert.ok(!pdfCode.includes('fetch('), 'PDFs must not be sent to any network endpoint')
  assert.equal((html.match(/data-bilingual-lang="zh-CN"/g) || []).length, 22)
  assert.ok(html.includes('官网中文'), 'original official Chinese webpage links retained')
})

test('private PDFs are included in exported data and conditionally restored', () => {
  assert.match(html, /pdfTranslations: window\.CCARF_PDF \? await window\.CCARF_PDF\.exportAll\(\) : \[\]/)
  assert.match(html, /if \(has\("pdfTranslations"\)\)/)
  assert.match(html, /window\.CCARF_PDF\.restoreAll\(d\.pdfTranslations\)/)
  assert.match(html, /window\.CCARF_PDF\.restoreSnapshot\(oldPdfs\)/)
  assert.match(html, /if \(!hasKnowledge\) return Promise\.resolve\(\)/)
})

test('SHA-256 covers PDF backup metadata and rejects modified version 3 data', async () => {
  const coreJs = html.match(/<script id="ccarf-core">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(coreJs)
  const sandbox = { DecompressionStream, Blob, Response, crypto: globalThis.crypto, TextEncoder }
  sandbox.window = sandbox
  vm.runInNewContext(coreJs, sandbox)
  const core = sandbox.CCARF_CORE
  const backup = await core.makeBackupV3({
    units: [], knowledge: { docs: [], chunks: [] },
    pdfTranslations: [{
      source: '01_D1_Building_Effective_Agents.pdf',
      name: '01_D1_Building_Effective_Agents.zh.pdf',
      lang: 'zh-CN',
      data: 'JVBERi0xLjQK'
    }]
  }, '2026-11-23T23:00:00Z')
  const good = await core.validateBackupFull(backup)
  assert.equal(good.ok, true, good.errors.join(' | '))
  const tampered = JSON.parse(JSON.stringify(backup))
  tampered.data.pdfTranslations[0].name = 'altered.zh.pdf'
  const bad = await core.validateBackupFull(tampered)
  assert.equal(bad.ok, false, 'v3 checksum must cover PDF metadata')
  const malformed = JSON.parse(JSON.stringify(backup))
  malformed.data.pdfTranslations = { not: 'an array' }
  assert.equal((await core.validateBackupFull(malformed)).ok, false)
})
