# AGENTS.md — CCAR-F 学习指导台

继承 `~/.dsh/AGENTS.md` 的全局守则（v1.0.1）。本文件只写本站点特有的部分，不复制全局规则。

## 这个仓库是什么

- 单文件静态站：`index.html`（212 KB，内联 CSS/JS），另有 39 个本地 PDF/MD 学习资料。
- 线上：GitHub Pages（legacy）→ https://yybb123123.github.io/ccarf-study-guide/
- 合并到 `main` 即发布：会触发 Pages 重建。

## 架构决策（2026-11-22）

- **学习数据只保存在本机 Mac**：进度、笔记与 API key 都留在浏览器 local storage 和本机，不上传服务器。
- **不做 GitHub Gist 跨设备同步**：页面里现有的 Gist 相关代码保持现状，但不再投入开发，也不作为承诺功能；不要基于它扩展新功能。
- **不部署云数据库**：学习记录没有服务端存储，不引入后端、数据库或账号体系。
- **GitHub Pages 只发布静态网站**：仓库是公开的，只放站点代码与可公开的资料；私人笔记、密钥、个人信息不得提交。

## 验证

- 命令：`bash scripts/verify.sh --full`
- 覆盖：结构、39 个本地链接、内联 JS 语法（只解析不执行）、远程脚本、占位文案、key 形态
- 证据：`.dsh/evidence/<run_id>/summary.json`
- CI：GitHub Actions，check 名 `verify`；push 到 main 与相关 PR 都会跑

## 硬约束

- 页面运行时使用**用户自己填写的** API key 调 Anthropic / OpenAI / DeepSeek；不得把任何 key、token 写进仓库、workflow 或证据文件。
- 移动或重命名 PDF/MD 后，必须同步 `index.html` 里的链接并跑一次 verify；链接失效会直接失败。
- 保持单文件可直接打开：不引入构建步骤、框架或第三方运行时依赖。
- 不为通过检查而改 `index.html` 的结构或删内容；先判断是链接/结构真的坏了。
- `.dsh/evidence/` 不入库。

## 已知边界

- 静态检查**不等于**页面功能正常：对话、模型列表、Gist 等运行时行为没有自动化覆盖。
- Pages 为 legacy 构建；合并后要确认 `pages-build-deployment` 成功、线上首页 200。
- `scripts/` 会随 Pages 发布（内容仅为校验脚本，无密钥）。

## 变更流程

1. 从 `main` 开分支，改完跑 `bash scripts/verify.sh --full`。
2. 开 PR，等 `verify` 绿后合并。
3. `main` 已受保护：禁止 force push、禁止删除；required check 为 `verify`。
4. owner 直推可绕过检查（`enforce_admins=false`），不要把它当常规路径。
