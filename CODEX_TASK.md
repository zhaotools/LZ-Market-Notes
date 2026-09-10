# 给 Codex 的开发任务书

请基于本项目继续完善“老赵市场笔记”个人网站。**保留现有设计和结构，不要从头重新设计。**

## 项目目标

个人内容入口，聚合公众号文章、YouTube 视频、LZ-4Stage Map 的公开全球市场阶段摘要，并介绍老赵市场工具箱。计划部署到 GitHub Pages。

先阅读 README.md、docs/DESIGN.md、docs/DATA_SOURCES.md，然后构建并预览。主要源码在 assets/、scripts/ 和 data/，site/ 与 preview.html 为生成产物。

## 必须保留

蓝白简约、中文大字与阅读感；四季颜色为春蓝、夏绿、秋橙、冬暗红。个人站不做密集交易终端。

网站品牌为“老赵市场笔记”。公众号为“老赵市场笔记”。YouTube 频道为 https://www.youtube.com/@lzmarketwatch 。

现有站点为 https://zhaotools.github.io/LZ-4Stage-Map/ 与 https://zhaotools.github.io/LZ-Market-Toolkit/ 。它们是独立站点，不要迁移、覆盖或改写其算法、会员权限与核心逻辑。

保留六个页面、分类搜索、数据口径、样例标签和风险说明。未经真实核验，禁止把待接入内容改为“已发布”“已自动同步”或“实时数据”。不虚构原文链接、视频 ID、二维码、播放量、收益数据。

## 优先工作

### 1. 基础验证

执行 npm run build 和 npm test。检查移动端与电脑端布局，保持无横向溢出。独立 preview.html 的六页切换也要继续可用。

### 2. 公众号内容

当前文章仅为选题样例。向用户收集经过确认的文章标题、正式日期和 mp.weixin.qq.com 原文链接，或使用其明确授权的官方接口；先支持手工导入即可。未取得可用权限前，不尝试绕过公众号限制，不保存后台 cookie。

写入 data/articles.json，保持正文不搬运。正式条目必须有 status=published、真实 url、date。链接缺失的条目继续标识 pending，或在用户确认后删除。

### 3. YouTube 内容

使用 scripts/sync-youtube.mjs，在受控环境中提供 YOUTUBE_API_KEY，必要时指定 YOUTUBE_CHANNEL_ID。核对返回的频道确实对应 @lzmarketwatch，分页读取历史公开视频，检查标题、封面和分类。

密钥不得进入前端、公开仓库、日志或构建输出。公开视频数据成功核验后再替换样例。验证允许嵌入的视频可按需播放；不允许嵌入时跳转原视频。网络失败时页面仍应可读。

### 4. Map 公开快照

联调 scripts/sync-market.mjs 中的公开 JSON 地址。只展示 global 公开范围，不调用会员接口，不复制私有算法，不访问其他私有仓库。

核验总数、阶段计数、generatedAt、stageAsOf 与原始 interpretation。stageAsOf 可能是周线起始日等口径日期，不应被误写成阶段确认发生的具体日期。保留 completedThrough，区分已完成周线与观察状态。

请求失败保留最后一次成功快照，拒绝时间倒退、空响应和结构不完整的数据。展示明确的来源、口径和日期，不承诺实时。

### 5. 同步与部署

定时同步已确定为每天北京时间 09:17 和 21:17。YouTube 使用官方 RSS 最近 5 条，Map 使用公开 global 快照；个人订阅号通过 GitHub Actions Secret `WECHAT_FEED_URL` 配置可替换的第三方 RSS/Atom 连接器。仅在真实内容变化时持久化 `data/` 与生成页面；失败保留旧快照，不清空内容，也不保存 Feed 凭据或公众号正文。

确认最终 GitHub 仓库和域名后，在新分支完成。不要假定 zhaotools.github.io 根站可直接覆盖。仓库所有权和部署权限必须明确，未经用户确认不覆盖已有站点。

Pages 工作流只发布 site/，不发布密钥、开发资料或测试快照。运行 npm run release:check；用户确认替换或移除样例后再关闭 previewMode。正式发布前复核托管条款、风险表述、外链以及移动端体验。

## 暂不做

不增加登录、会员支付、数据库、订单系统、复杂 CMS、评论区、付费营销弹窗，不引入沉重框架重写现有页面。不复制 Map 完整功能，不增加高频行情轮询。

## 完成时交付

说明真实接入了哪些数据、仍有哪些待配置项；给出构建与测试结果、可访问预览地址及变更摘要。网络、频道或部署未验证的部分必须明确标注，不用“全部完成”概括。
