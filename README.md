# 老赵市场笔记 · 正式发布版 v1.2

六个可运行页面、一套蓝白响应式设计、一份可离线打开的交互预览。用于确认设计后交给 Codex 继续接入数据及部署。

**这不是只有效果图的方案。页面、分类筛选、搜索、手机菜单和详情弹窗均已实现。**

## 先看效果

直接用浏览器打开项目根目录的 `preview.html`，无需安装任何东西。顶部六个导航可切换，所有页面都已嵌入此文件。该文件用于设计验收；正常网站源码和独立 HTML 页面也一起提供。

`docs/screenshots/` 中有桌面端、手机端及各页面截图。

## 已包含的页面

| 页面 | 内容与交互 |
| --- | --- |
| 首页 | 个人介绍、四季框架示意、市场摘要、文章、视频、工具箱入口 |
| 文章 | 分类、关键词搜索、排序、无结果状态、文章介绍弹窗 |
| 视频 | 分类与搜索、真实公开视频目录、频道入口；点击后按需加载播放器 |
| 市场看板 | 公开快照、四季分布、市场与阶段组合筛选、资产详情与数据口径 |
| 工具箱 | Map、4Stage、Status、DCA 概览及现有官网链接 |
| 关于 | 个人介绍、理念、公众号名称复制、YouTube 入口 |

## 当前数据状态——必须先知道

公众号：已人工核验并接入 5 篇正式文章的公众号名称、标题、发布日期、页面摘要和原文链接。网站只保存目录信息并跳转至公众号原文，不搬运正文。

YouTube：已核验频道 `@lzmarketwatch` 对应“老赵市场观察”（频道 ID `UCSk0Q0f1xvfyRQCxiFlfNWg`），并通过 YouTube 官方公开 RSS 接入最近 5 个公开视频的真实 ID、标题、发布日期、缩略图与原视频链接。RSS 不提供时长、完整历史或嵌入权限字段；这些字段仍需配置 Data API 后补全。

市场：已从 Map 的 GitHub Pages 公开 JSON 联网同步 16 个全球样本，源生成时间为 2026-09-10T04:15:53.783Z，不是实时行情。保留来源、阶段、子阶段、阶段持续周数、周线口径日期及原始解读。详见 `docs/DATA_SOURCES.md`。

公众号：关注弹窗使用用户提供的 430×430 原始二维码，并保留公众号名称搜索与复制入口。

**正式发布地址配置为 https://zhaotools.github.io/LZ-Market-Notes/。原有 Map 与工具箱仓库及官网均未修改。**

## 技术方案

HTML + CSS + 原生 JavaScript，Node.js 负责静态生成，不依赖 React、数据库、构建插件或第三方 npm 包。第一版没有必要引入 Astro 的运行依赖；当前结构仍保留数据与模板分离，后续可以迁移。

所有正常页面在构建时已经写入 HTML，不需要浏览器临时请求公众号、YouTube 或 Map 才能显示内容。网站不包含服务器代码、跟踪脚本、表单收集或视频文件；不附带字体文件。

## 本地开发

使用 Node.js 22 或以上，无需 `npm install`。

```bash
npm run dev
```

本地地址为 `http://127.0.0.1:4173`。修改源码或数据后重新执行 `npm run build` 并刷新页面；本版不含热重载。

```bash
npm run build       # 生成 site/ 和独立 preview.html
npm test            # 数据、转义、安全边界与模板测试
npm run preview     # 预览已生成的 site/
npm run sync:market # 同步 Map 的公开 global 快照
npm run sync:youtube # 无密钥同步官方 RSS；有密钥时同步完整 Data API 目录
npm run sync:wechat # 从已配置的第三方 RSS/Atom Feed 同步公众号目录
npm run import:articles -- /绝对路径/articles.json # 导入已人工核验的公众号目录
npm run release:check  # 检查正式 URL、二维码和全部内容发布状态
```

## 主要文件

```text
preview.html                 独立交互预览，直接打开
site/                        已生成的 6 个页面，可直接托管
assets/styles.css            蓝白设计、四季色彩、响应式样式
assets/site.js               分类、搜索、弹窗、手机菜单
scripts/templates.mjs        页面结构与组件
scripts/build.mjs            静态生成及打包预览
scripts/serve.mjs            本地静态服务器
scripts/import-articles.mjs  公众号文章元数据人工导入与严格校验
scripts/sync-market.mjs      已联调的 Map 公开 global 快照同步脚本
scripts/sync-youtube.mjs     YouTube 官方 RSS / Data API 双路径同步脚本
scripts/sync-wechat.mjs      个人订阅号的可替换 RSS/Atom 目录连接器
scripts/release-check.mjs    正式发布检查
 data/site.json              品牌、外链、公众号名称、预览状态
 data/articles.json          文章目录
 data/videos.json            视频目录
 data/market.json            公开市场快照
.github/workflows/pages.yml  构建并部署 site/ 的工作流
CODEX_TASK.md                可直接交给 Codex 的开发任务书
```

请编辑 `assets/`、`scripts/` 与 `data/`。不要只修改 `site/` 中的生成文件，否则下次构建会覆盖修改。

## 后续数据接入

公众号没有适合本静态站直接抓取的公开目录接口。将人工核验后的标题、摘要、正式日期和 `mp.weixin.qq.com` 原文 URL 整理为 JSON，然后运行 `npm run import:articles -- /绝对路径/articles.json`；可加 `--replace` 只保留本次导入内容。脚本只接受已发布条目，不复制正文，失败时不会改写现有目录。不要用后台 cookie 模拟抓取。

Map 可以运行 `npm run sync:market`。脚本只尝试公开 JSON，校验 `global` 范围、结构、计数与时间后原子写入；失败保留旧快照，不读取会员接口、不复制算法。GitHub Pages 公开端点已在本次环境中同步成功。

直接运行 `npm run sync:youtube` 会按 `site.json` 中已核验的频道 ID 读取 YouTube 官方 RSS，适合无密钥更新最近公开视频。提供 `YOUTUBE_API_KEY` 后，脚本改用 Data API 分页读取完整公开目录，并补充时长与嵌入权限。密钥不会进入前端、日志或构建输出；获取失败不会清空现有目录。同步后仍应人工核验分类。

个人订阅号没有微信官方“获取已发布文章列表”接口权限。`npm run sync:wechat` 从 GitHub Actions Secret `WECHAT_FEED_URL` 读取一次性配置的第三方 RSS/Atom Feed，只接受 `mp.weixin.qq.com` 原文链接并合并到已有目录；Feed URL、登录信息与文章正文都不会写入仓库或网站。未配置 Feed 时保留现有文章快照。

GitHub Actions 每天北京时间 09:17 和 21:17 自动同步 YouTube RSS、Map 公开快照和已配置的公众号 Feed。同步脚本只有在目录或上游快照发生实际变化时才改写文件；通过构建、测试和正式发布检查后，工作流提交 `data/` 与对应生成页面，并在同一次运行中部署 Pages。任一来源失败时不会清空已有内容，也不会发布未经验证的结果。

## GitHub Pages 发布准备

仓库使用 GitHub Actions 作为 Pages 发布来源。工作流响应 `main` 推送，也按计划同步公开内容；依次执行同步、构建、测试和 `release:check`，全部通过后才上传 `site/`。定时任务仅在公开内容确有变化时提交和部署；开发说明、测试目录、Feed URL 与本地环境文件不会作为网站发布。

所有站内链接和静态资源均采用相对路径，适用于用户根站或项目子路径。`site.json` 的 `baseUrl` 需按最终 HTTPS 地址填写，不预设根站一定空闲，也不覆盖现有两个项目。

本版本已关闭 `previewMode` 并移除 `noindex`。正式内容、URL 与二维码均通过 `release:check`；独立 `preview.html` 仍保留“独立浏览器预览”提示，用于离线验收，不影响线上页面。

本网站按个人分享与作品介绍设计，不设置交易、付费登录或购买流程。托管用途及商业边界应在正式发布时根据 GitHub 当时的条款复核；没有站内收款并不自动意味着所有商业用途都符合规则。

## 测试边界

完成本地构建、18 项 Node 测试、170 项 Chrome 界面检查，包含 6 种宽度下全部页面的内容、导航和横向溢出检查。

浏览器检查覆盖本地多页面站点和独立 `preview.html`，验证 5 篇正式文章、二维码、5 条 RSS 视频、播放器按需创建和关闭、筛选及手机菜单。另行核验 5 个公众号原文页面、Map 公开 JSON 与 YouTube RSS。尚未验证 YouTube 真实播放过程、Safari 或微信内置浏览器。
