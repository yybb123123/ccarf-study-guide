// check-site.mjs — 静态学习站的确定性检查（零依赖）。
import { readFileSync, existsSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

const root = process.cwd()
const file = 'index.html'
const html = readFileSync(join(root, file), 'utf8')
const fails = []

if (!/^\s*<!doctype html>/i.test(html)) fails.push('缺少 <!doctype html>')
if (!/<html[^>]*\slang="[a-z]{2}(-[A-Za-z]+)?"/i.test(html)) fails.push('<html> 缺少 lang')
if (!/<meta[^>]+name="viewport"/i.test(html)) fails.push('缺少 viewport meta')
if (!/<title>\s*[^<\s][^<]*<\/title>/i.test(html)) fails.push('缺少有效 <title>')
if (!/<header[\s>]/i.test(html)) fails.push('缺少 <header>')
if (!/<main[\s>]/i.test(html)) fails.push('缺少 <main>')
if (!/<footer[\s>]/i.test(html)) fails.push('缺少 <footer>')
if (/<script[^>]+src="https?:\/\//i.test(html)) fails.push('引入远程 <script>')
if (/\b(TODO|FIXME)\b/.test(html)) fails.push('含 TODO/FIXME')
if (/lorem ipsum/i.test(html)) fails.push('含 Lorem ipsum')
if (/sk-[A-Za-z0-9]{20,}/.test(html)) fails.push('疑似泄露 API key (sk-...)')

// 内联脚本语法检查：只解析，不执行。
const scriptBlocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
let inlineChecked = 0
for (const [i, m] of scriptBlocks.entries()) {
  const attrs = m[1] || ''
  const body = m[2] || ''
  if (/\bsrc\s*=/i.test(attrs)) continue
  const type = (attrs.match(/\btype\s*=\s*"([^"]*)"/i)?.[1] ?? '').toLowerCase()
  if (/^(application\/(ld\+)?json|text\/(template|html))$/.test(type)) continue
  if (!body.trim()) continue
  inlineChecked++
  const htmlLine = html.slice(0, m.index).split('\n').length
  if (type === 'module') {
    const dir = mkdtempSync(join(tmpdir(), 'site-js-'))
    const f = join(dir, `inline-${i}.mjs`)
    try {
      writeFileSync(f, body)
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
      if (r.status !== 0) fails.push(`内联 module 脚本语法错误（index.html≈${htmlLine} 行）: ${(r.stderr || '').split('\n').slice(0, 3).join(' ')}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } else {
    try {
      new vm.Script(body, { filename: `index.html#inline-${i}@${htmlLine}` })
    } catch (e) {
      fails.push(`内联脚本语法错误（index.html≈${htmlLine} 行）: ${e.message}`)
    }
  }
}

const imgs = html.match(/<img\b[^>]*>/gi) ?? []
if (imgs.some((t) => !/\salt\s*=/i.test(t))) fails.push('存在缺少 alt 的 <img>')

const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
const local = [...new Set(hrefs)].filter((h) => !/^(#|https?:|mailto:|tel:|javascript:|data:)/i.test(h))
const missing = []
for (const h of local) {
  const clean = decodeURIComponent(h.split('?')[0].split('#')[0]).replace(/^\//, '')
  if (!clean) continue
  const p = resolve(root, clean)
  if (!p.startsWith(root) || !existsSync(p)) missing.push(h)
  else if (statSync(p).isDirectory() && !existsSync(join(p, 'index.html'))) missing.push(h + ' (目录无 index.html)')
}
if (missing.length) fails.push(`本地链接失效 ${missing.length} 个: ${missing.slice(0, 5).join(', ')}`)


/* ---------- 数据一致性：防止「天数/单元」「计划时长」「考纲页数」再次漂移 ---------- */
const hrs = [...html.matchAll(/data-hrs="([0-9.]+)"/g)].map((m) => Number(m[1]))
const totalHrs = hrs.reduce((a, b) => a + b, 0)
const unitCount = (html.match(/class="tl-item"/g) ?? []).length

if (unitCount === 0) fails.push('未找到学习单元（.tl-item）')
const declaredHours = html.match(/计划\s*([0-9.]+)(?![0-9])/)
if (!declaredHours) fails.push('未找到「计划 N」小时描述')
else if (Math.abs(Number(declaredHours[1]) - totalHrs) > 0.001)
  fails.push(`计划小时 ${declaredHours[1]} 与 data-hrs 合计 ${totalHrs} 不一致`)

for (const n of new Set([...html.matchAll(/(\d+)\s*个单元/g)].map((m) => Number(m[1])))) {
  if (n !== unitCount) fails.push(`页面写 ${n} 个单元，实际 ${unitCount} 个 .tl-item`)
}
if (html.includes('14 天全部完成')) fails.push('仍存在「14 天全部完成」')
if (!html.includes('42 页')) fails.push('缺少「42 页」考纲页数')
if (/49\s*页/.test(html)) fails.push('残留「49 页」考纲页数')
if (/26\.5/.test(html)) fails.push('残留旧的 26.5 小时')
if (/20–25\s*小时/.test(html)) fails.push('残留「20–25 小时」范围描述')


/* ---------- 学习计划资源必须可点击，且指向仓库中的真实文件 ---------- */
const planFileBlocks = [...html.matchAll(/<div class="tl-files">([\s\S]*?)<\/div>/g)]
if (planFileBlocks.length !== unitCount) fails.push(`学习计划资源区数量 ${planFileBlocks.length} 与单元数 ${unitCount} 不一致`)
let planFileCount = 0
for (const [i, block] of planFileBlocks.entries()) {
  const contents = block[1]
  if (/<span\b[^>]*class="tfile"/i.test(contents)) fails.push(`第 ${i + 1} 个单元仍有不可点击的文件标签`)
  const links = [...contents.matchAll(/<a\b([^>]*)>([^<]+)<\/a>/g)]
  if (!links.length) fails.push(`第 ${i + 1} 个单元没有可点击的学习资料`)
  for (const link of links) {
    const attrs = link[1], label = link[2]
    planFileCount++
    if (!/\bclass="tfile"/.test(attrs) || !/\btarget="_blank"/.test(attrs) || !/\brel="noopener noreferrer"/.test(attrs))
      fails.push(`学习计划文件链接缺少正确的 class、target 或 rel：${label}`)
    const href = attrs.match(/\bhref="([^"]+)"/)?.[1]
    if (!href) { fails.push(`学习计划文件缺少 href：${label}`); continue }
    const prefix = 'https://github.com/yybb123123/ccarf-study-guide/blob/main/'
    const officialChinese = [
      'https://code.claude.com/docs/zh-CN/',
      'https://platform.claude.com/docs/zh-CN/',
      'https://py.sdk.modelcontextprotocol.io/zh/'
    ]
    if (officialChinese.some((prefix) => href.startsWith(prefix))) continue
    if (!(href.startsWith(prefix) || !/^https?:/i.test(href))) {
      fails.push(`学习计划资源指向未核验的外部地址：${href}`)
      continue
    }
    const relative = href.startsWith(prefix) ? href.slice(prefix.length) : href
    let path
    try { path = decodeURIComponent(relative.split('?')[0].split('#')[0]) }
    catch { fails.push(`文件路径编码无效：${href}`); continue }
    const abs = resolve(root, path)
    if (!abs.startsWith(root + '/') || !existsSync(abs) || !statSync(abs).isFile()) fails.push(`学习计划文件不存在：${path}`)
  }
}
if (planFileCount === 0) fails.push('学习计划中没有可点击资料链接')
console.log(`  plan: ${planFileBlocks.length} units, ${planFileCount} clickable file links`)

const bilingualPairs = (html.match(/class="tfile-pair"/g) ?? []).length
if (bilingualPairs !== 23) fails.push(`预期学习计划有 23 个中英双语资料入口，实际 ${bilingualPairs}`)
if (!html.includes('id="bilingualReader"') || !html.includes('id="bilingualImportButton"')) fails.push('缺少本机双语译文阅读或导入入口')

const NB = 'notebook.google.com/notebook/c0ddef5c-4758-48a2-bf13-671d108d5933'
if (!html.includes(NB)) fails.push('缺少 NotebookLM 笔记本入口链接')

console.log(`  data: units=${unitCount}, hours=${totalHrs}`)

console.log(`check-site: ${file}`)
const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
console.log(`  size: ${kb} KB, local links: ${local.length}, images: ${imgs.length}, inline scripts: ${inlineChecked}`)
for (const f of fails) console.log(`  FAIL ${f}`)
if (fails.length) process.exit(1)
console.log('  PASS')
