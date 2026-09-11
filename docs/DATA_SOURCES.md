# 数据来源与核验状态

## 品牌和内容范围

品牌、网站目标、公众号名称与以下三个入口由用户提供：

- YouTube：https://www.youtube.com/@lzmarketwatch
- Map：https://zhaotools.github.io/LZ-4Stage-Map/
- 工具箱：https://zhaotools.github.io/LZ-Market-Toolkit/

公众号目录由用户提供原文链接，并于 2026-09-11 逐页核验页面元数据。5 篇页面均显示公众号“老赵市场笔记”，标题、日期和摘要已写入 `data/articles.json`：

- 2026-09-06：[养成了一个好习惯：每天跟AI聊天](https://mp.weixin.qq.com/s/nFVimLo5FUBodxvXrMr-9g)
- 2026-09-05：[2026年8月复盘：把方法变成系统，把系统变成产品](https://mp.weixin.qq.com/s/Zy5BqgP448L2bcmXb8_WrQ)
- 2026-09-01：[读《长赢》：投资要看季节，不要被天气带走](https://mp.weixin.qq.com/s/uOqKpTflbC8wM2KWo0b8sg)
- 2026-08-29：[大资金和大多数](https://mp.weixin.qq.com/s/KdUiWFxqn-Gm3vin6w0JUA)
- 2026-08-28：[为什么趋势投资更适合普通投资者，成功概率高于价值投资？](https://mp.weixin.qq.com/s/j9WVATPxktg4GHy9rIMTIg)

本站不抓取或保存正文。文章摘要使用公众号页面公开的 `og:description`；分类和标签是本站目录编辑字段。

公众号二维码来自用户提供的 `IMG_1450.JPG`，原样保存为 `assets/wechat-qr.jpg`，尺寸 430×430，SHA-256 为 `0b186f8859ec8f064908d214450ef1e10ade8d72bb3389fd057b5683b693e43a`。

“老赵市场笔记”为个人订阅号，不能使用微信官方发布列表 API。项目提供 `scripts/sync-wechat.mjs` 作为可替换 RSS/Atom 连接器：Feed URL 仅从 GitHub Actions Secret `WECHAT_FEED_URL` 读取，返回条目必须包含 HTTPS 的 `mp.weixin.qq.com` 原文链接、标题和有效发布日期。连接器只保留目录摘要，不保存 Feed 凭据或文章正文；Feed 缺失、失效或账号名称不匹配时保留上一版数据。

YouTube 已核验 `@lzmarketwatch` 对应频道“老赵市场观察”，频道 ID 为 `UCSk0Q0f1xvfyRQCxiFlfNWg`。`data/videos.json` 来自 YouTube 官方公开 RSS 最近目录。2026-09-11 复核发现视频 `1YV4RAFeNXs` 虽仍在 RSS 且页面、缩略图和 oEmbed 返回 HTTP 200，但播放状态为 `LIVE_STREAM_OFFLINE`、页面提示直播尚未开始，且频道视频与直播列表均未展示，因此作为无效旧直播占位页加入 `youtubeExcludedVideoIds`；网站当前展示其余 4 条有效目录信息。

## Map 公开快照

初始设计版通过公开仓库文件建立快照；本次已直接联调并读取以下 GitHub Pages 公开 JSON：

https://zhaotools.github.io/LZ-4Stage-Map/data/dashboard.json

源 generatedAt：2026-09-11T12:49:18.538Z

源 interpretation.sourceSnapshotSha256：7c418e445064fa139a6b7e5735691d627938e5875ea417e99c3b72b23d32417f

同步脚本只保留其中 16 个 `global` 公开资产的展示字段和公开 interpretation v2；结构化解读包含阶段占比、市场结构、关键位置、已确认变化和观察变化，不包含价格、收益率计算、会员数据或算法代码。

计数：S1 1 个，S2 9 个，S3 1 个，S4 5 个。计数之和为 16，用于描述样本结构，不代表配置权重或整个市场的覆盖比例。

传统资产 stageAsOf 为 2026-09-04；加密样本 stageAsOf 为 2026-08-31，cryptoQuality.completedThrough 为 2026-09-06。它们来自上游周线的日期口径，不能把周线起始日误解为实际发生确认的时刻。本版统一显示“阶段口径日期”，并保留加密完成日期说明。

GitHub Pages 公开 JSON 已返回 HTTP 200，`npm run sync:market` 已成功写入经过结构、范围、计数与时间校验的本地快照；若 Pages 不可用，脚本仍会尝试公开 raw 文件。所有来源失败或源时间倒退时保留上一次成功快照。

## 工具箱

产品展示结构参考用户提供的信息以及公开仓库：

https://github.com/zhaotools/LZ-Market-Toolkit/blob/main/index.html

读取时 blob SHA：5a49620fbb8d192d149d58fe7e2fe452b742ba93。

个人站只概述 Map / 4Stage / Status / DCA 的分工，不重复维护完整版本信息或价格。

## 部署工作流与后续接口参考

GitHub Pages 工作流参考通过 GitHub 连接器读取的官方模板：
https://github.com/actions/starter-workflows/blob/main/pages/static.yml

工作流在北京时间 09:17 和 21:17 自动检查 YouTube RSS、Map 公开快照和已配置的公众号 Feed，并在 10:07 和 22:07 分别补偿重试。YouTube RSS 请求会先进行带超时与明确请求头的分级重试；仍失败时使用 IPv4 `curl` 对传输错误和临时 HTTP 错误继续重试，并输出不含凭据的错误摘要。只有实际内容变化才提交 `data/`、`site/` 与 `preview.html`；随后在同一次运行内完成 Pages 部署，避免依赖机器人提交再次触发工作流。同步后依次构建、测试并运行 `release:check`，通过后只上传 `site/`。2026-09-10 已按各 Action 官方最新稳定主版本更新为 checkout@v7、setup-node@v7、configure-pages@v6、upload-pages-artifact@v5 与 deploy-pages@v5。

无密钥路径采用 YouTube 官方公开 RSS：
https://www.youtube.com/feeds/videos.xml?channel_id=UCSk0Q0f1xvfyRQCxiFlfNWg

配置密钥后的完整目录路径采用官方 Data API 的 channels、playlistItems、videos 接口。参考入口：
https://developers.google.com/youtube/v3/docs/channels/list
https://developers.google.com/youtube/v3/docs/playlistItems/list
https://developers.google.com/youtube/v3/docs/videos/list

本次没有使用 API Key。RSS 目录、公开视频页面、缩略图与 oEmbed 已联网核验；Data API 的完整历史、时长、`embeddable` 字段以及真实播放过程尚未验证。

## 不应混淆

生成时间 ≠ 行情日期 ≠ 周线口径日期 ≠ 实际确认时间。

确认阶段 ≠ 观察阶段。

概念示意图 ≠ 历史行情。

公众号目录摘要 ≠ 公众号正文转载。

YouTube RSS 最近目录 ≠ Data API 完整历史目录或播放权限证明。
