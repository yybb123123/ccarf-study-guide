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

console.log(`check-site: ${file}`)
const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
console.log(`  size: ${kb} KB, local links: ${local.length}, images: ${imgs.length}, inline scripts: ${inlineChecked}`)
for (const f of fails) console.log(`  FAIL ${f}`)
if (fails.length) process.exit(1)
console.log('  PASS')
