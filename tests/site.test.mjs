import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import {readJSON,validateMarket,validateContent,esc,safeURL,safeAssetPath,root} from '../scripts/lib.mjs';
import {renderers,pageHTML,nav} from '../scripts/templates.mjs';
import {normalizeMarket} from '../scripts/sync-market.mjs';
import {buildYoutubeChannelDirectory,fetchYoutubeFeed,inferCategory,parseYoutubeChannelPage,parseYoutubeFeed,parseYoutubeWatchPage} from '../scripts/sync-youtube.mjs';
import {fetchWechatAlbum,inferArticleCategory,parseWechatAlbumPage,parseWechatFeed,renderWechatRss} from '../scripts/sync-wechat.mjs';
import {normalizeArticleImport} from '../scripts/import-articles.mjs';
const data=JSON.parse(await readFile(resolve(root,'tests/fixtures/demo.json'),'utf8'));
const current={site:await readJSON('site.json'),articles:await readJSON('articles.json'),videos:await readJSON('videos.json'),market:await readJSON('market.json')};
const marketLiveSource=await readFile(resolve(root,'assets/market-live.js'),'utf8');
const siteSource=await readFile(resolve(root,'assets/site.js'),'utf8');
const stylesSource=await readFile(resolve(root,'assets/styles.css'),'utf8');
const workflowSource=await readFile(resolve(root,'.github/workflows/pages.yml'),'utf8');
const marketLiveContext=vm.createContext({URL,Date,AbortController,setTimeout,clearTimeout});
new vm.Script(marketLiveSource).runInContext(marketLiveContext);
const marketLive=marketLiveContext.LZMarketLive;
function upstreamMarketFixture(){
 const raw=structuredClone(current.market);raw.schemaVersion='lz-4stage-map-v2';delete raw.snapshotType;delete raw.syncedAt;
 raw.markets=raw.markets.map(row=>{const next={...row};delete next.symbol;delete next.completedThrough;if(row.completedThrough)next.cryptoQuality={completedThrough:row.completedThrough};return next;});
 return raw;
}
function wechatAlbumFixture(entries,{accountName='老赵市场笔记',accountId='gh_a8fb4adf64dc',albumId='4693033529335087106',total=entries.length,hasMore=false}={}){
 const items=entries.map(entry=>`{title: '${entry.title}',create_time: '${entry.createTime}',cover_img_1_1: '',url: '${entry.url.replaceAll('&','&amp;')}',read_count: -1,msgid: '${entry.msgid}',itemidx: '${entry.itemidx}',cover_theme_color: {r: '1',g: '2',b: '3'}}`).join(',');
 return `<script>window.cgiData = {ret: '0',albumId: '${albumId}',nick_name: '${accountName}',user_name: '${accountId}',article_count: '${total}' * 1,articleList: [${items}],continue_flag: '${hasMore?1:0}' * 1,reverse_continue_flag: '0' * 1,};\n</script>`;
}
const wechatSite={
 wechatName:'老赵市场笔记',wechatAccountId:'gh_a8fb4adf64dc',wechatBiz:'MzYzNDI3NDQ0OQ==',
 wechatAlbumUrl:'https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzYzNDI3NDQ0OQ%3D%3D&action=getalbum&album_id=4693033529335087106',
 baseUrl:'https://zhaotools.github.io/LZ-Market-Notes/'
};

test('current datasets and stable design fixtures pass validation',()=>{
 validateMarket(current.market);validateContent(current.articles,'articles');validateContent(current.videos,'videos');
 assert.equal(validateMarket(data.market).markets.length,16);
 assert.equal(validateContent(data.articles,'articles').items.length,6);
 assert.equal(validateContent(data.videos,'videos').items.length,4);
});
test('escaping is safe for HTML attributes and content',()=>{
 assert.equal(esc('<img src="x" onerror=\'x\'>&'),'&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;');
});
test('only HTTPS and approved hosts are accepted',()=>{
 assert.equal(safeURL('javascript:alert(1)'),null);
 assert.equal(safeURL('http://example.com'),null);
 assert.equal(safeURL('https://mp.weixin.qq.com.evil.test',['mp.weixin.qq.com']),null);
 assert.ok(safeURL('https://mp.weixin.qq.com/s/test',['mp.weixin.qq.com']));
});
test('only project-local asset paths are accepted',()=>{
 assert.equal(safeAssetPath('assets/wechat-qr.jpg'),'assets/wechat-qr.jpg');
 assert.equal(safeAssetPath('../wechat-qr.jpg'),null);
 assert.equal(safeAssetPath('assets/../wechat-qr.jpg'),null);
 assert.equal(safeAssetPath('https://example.com/image.jpg'),null);
});
test('production content and public URL are release-ready',()=>{
 assert.equal(current.site.baseUrl,'https://zhaotools.github.io/LZ-Market-Notes/');
 assert.equal(current.site.previewMode,false);
 assert.equal(current.site.wechatQr,'assets/wechat-qr.jpg');
 assert.ok(current.articles.items.length>=7);
 assert.equal(current.site.wechatAlbumUrl,wechatSite.wechatAlbumUrl);
 assert.equal(current.site.wechatAccountId,wechatSite.wechatAccountId);
 assert.ok(current.articles.items.every(x=>x.status==='published'));
 assert.equal(current.articles.items.find(x=>x.id==='foldable-screen-best-solution')?.url,'https://mp.weixin.qq.com/s/ns51z1cjpt3Dl8I2HzuyBw');
 assert.equal(current.articles.items.find(x=>x.id==='market-toolkit-website-2-launch')?.url,'https://mp.weixin.qq.com/s/UtcaIYeRgVDHt1dE_P3NJw');
 assert.equal(current.videos.items.length,5);
});
test('stage counts must match actual public asset samples',()=>{
 const x=structuredClone(data.market);x.interpretation.stageCounts.S2++;
 assert.throws(()=>validateMarket(x),/mismatch/);
});
test('duplicate, invalid and member-only assets are rejected',()=>{
 for(const mutate of [x=>x.markets[1].code=x.markets[0].code,x=>x.markets[0].weeks=-2,x=>x.markets[0].collections=['usSelected']]){
  const x=structuredClone(data.market);mutate(x);assert.throws(()=>validateMarket(x));
 }
});
test('published content needs a verified URL, date and video ID',()=>{
 const a=structuredClone(data.articles);a.items[0].status='published';assert.throws(()=>validateContent(a,'articles'));
 const v=structuredClone(data.videos);v.items[0].status='published';assert.throws(()=>validateContent(v,'videos'));
});
test('pending article and video samples remain explicitly labelled',()=>{
 const h=renderers.index(data);assert.ok(h.includes('选题版式预览'));assert.ok(h.includes('视频版式预览'));assert.ok(h.includes('内置历史快照'));
 assert.ok(!h.includes('youtube.com/watch?v=null'));assert.ok(!h.includes('实时行情'));
});
test('all six pages render semantic main content and shared navigation',()=>{
 assert.deepEqual(nav.map(([page])=>page),['index','market','articles','videos','tools','about']);
 for(const [name,render]of Object.entries(renderers)){
  const html=pageHTML(name,data,render(data));assert.ok(html.includes('lang="zh-CN"'));assert.ok(html.includes('<main id="main">'));assert.ok(html.includes('aria-current="page"'));assert.ok(html.includes('noindex,nofollow'));
  if(name!=='index')assert.ok(html.includes(`page-intro-art-${name}`));
 }
});
test('optimized brand artwork is wired to site, PWA, Apple and favicon surfaces',async()=>{
 const assets=['logo.png','icon-192.png','icon-512.png','icon-512-maskable.png','apple-touch-icon.png','favicon-32.png','favicon.ico'];
 for(const file of assets)assert.ok((await readFile(resolve(root,'assets',file))).length>100,`${file} should contain image data`);
 const manifest=JSON.parse(await readFile(resolve(root,'assets/manifest.webmanifest'),'utf8'));
 assert.equal(manifest.name,'老赵市场笔记');assert.equal(manifest.display,'standalone');assert.equal(manifest.icons.length,3);
 const html=pageHTML('index',current,renderers.index(current));
 for(const path of ['assets/logo.png','assets/favicon.ico','assets/favicon-32.png','assets/apple-touch-icon.png','assets/manifest.webmanifest'])assert.ok(html.includes(path));
 assert.ok(renderers.index(current).includes('class="about-emblem" src="assets/logo.png"'));
 assert.ok(renderers.about(current).includes('class="about-brand-logo" src="assets/logo.png"'));
});
test('scheduled source failures are isolated and the optional YouTube API secret is wired',()=>{
 for(const name of ['Synchronize YouTube videos','Synchronize market snapshot','Synchronize WeChat articles']){
  const start=workflowSource.indexOf(`- name: ${name}`),next=workflowSource.indexOf('\n      - name:',start+1),step=workflowSource.slice(start,next===-1?undefined:next);
  assert.ok(start>=0,`${name} step should exist`);assert.ok(step.includes('continue-on-error: true'),`${name} should not block other sources`);
 }
 assert.ok(workflowSource.includes('YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}'));
 assert.ok(workflowSource.includes('Report synchronization warnings'));
 assert.ok(workflowSource.indexOf('Synchronize YouTube videos')<workflowSource.indexOf('Synchronize market snapshot'));
 assert.ok(workflowSource.indexOf('Synchronize market snapshot')<workflowSource.indexOf('Synchronize WeChat articles'));
});
test('article cards omit decorative covers and use subtle category tones',()=>{
 const homeHTML=renderers.index(data),articleHTML=renderers.articles(data);
 const homeArticles=homeHTML.slice(homeHTML.indexOf('<div class="article-home-grid">'),homeHTML.indexOf('<div class="article-extra">'));
 assert.ok(!homeArticles.includes('class="cover '));
 assert.ok(!articleHTML.includes('class="cover cover-'));
 for(const [category,tone] of Object.entries({'市场观察':'market','投资方法':'method','工具使用':'tool','AI 实践':'ai'})){
  assert.ok(articleHTML.includes(`article-tone-${tone}`));assert.ok(articleHTML.includes(`data-article-category="${category}"`));assert.ok(stylesSource.includes(`.article-tone-${tone}{--article-bg:`));
 }
});
test('detail-page actions sit beneath their themed intro artwork',()=>{
 for(const page of ['market','articles','videos','tools']){
  const html=renderers[page](data);assert.ok(html.indexOf(`page-intro-art-${page}`)<html.indexOf('page-intro-action'));
 }
});
test('malicious content cannot break out of embedded JSON scripts',()=>{
 const d=structuredClone(data);d.site.description='</script><script>alert(1)</script>';
 const h=pageHTML('index',d,renderers.index(d));assert.ok(h.includes('\\u003c/script>'));assert.ok(!h.includes('<script>alert(1)</script>'));
});
test('public synchronization strips non-public assets and unrelated fields',()=>{
 const d=structuredClone(data.market);d.markets[0].privateKey='secret';d.markets.push({...d.markets[0],code:'PRIVATE',collections:['member']});
 const n=normalizeMarket(d,'https://example.com/public.json');assert.equal(n.markets.length,16);assert.equal(n.markets[0].privateKey,undefined);
});
test('browser loads, sanitizes and accepts a newer public LZ-Map snapshot',async()=>{
 const raw=upstreamMarketFixture(),requested=[];
 raw.generatedAt=new Date(Date.parse(current.market.generatedAt)+60_000).toISOString();raw.interpretation.generatedAt=raw.generatedAt;
 const syncedAt=new Date(Date.parse(raw.generatedAt)+1000).toISOString();
 raw.markets[0].privateKey='secret';raw.markets.push({...raw.markets[0],code:'PRIVATE',collections:['member']});
 const result=await marketLive.loadLatestMarket(current.market,{
  sourceUrl:'https://zhaotools.github.io/LZ-4Stage-Map/data/dashboard.json',now:syncedAt,
  fetchImpl:async(url,options)=>{requested.push({url,options});return {ok:true,status:200,json:async()=>raw};}
 });
 assert.equal(result.changed,true);assert.equal(result.market.generatedAt,raw.generatedAt);assert.equal(result.market.syncedAt,syncedAt);
 assert.equal(result.market.markets.length,current.market.markets.length);assert.equal(result.market.markets[0].privateKey,undefined);
 assert.equal(requested[0].options.cache,'no-store');assert.equal(requested[0].options.headers.accept,'application/json');
});
test('browser live Map loader rejects bad sources and preserves the fallback on unchanged data',async()=>{
 const raw=upstreamMarketFixture();
 await assert.rejects(()=>marketLive.loadLatestMarket(current.market,{sourceUrl:'https://example.com/dashboard.json',fetchImpl:async()=>({ok:true,json:async()=>raw})}),/Unapproved/);
 const unchanged=await marketLive.loadLatestMarket(current.market,{sourceUrl:'https://zhaotools.github.io/LZ-4Stage-Map/data/dashboard.json',fetchImpl:async()=>({ok:true,status:200,json:async()=>raw})});
 assert.equal(unchanged.changed,false);assert.equal(unchanged.market,current.market);
 raw.interpretation.stageCounts.S2++;
 await assert.rejects(()=>marketLive.loadLatestMarket(current.market,{sourceUrl:'https://zhaotools.github.io/LZ-4Stage-Map/data/dashboard.json',fetchImpl:async()=>({ok:true,status:200,json:async()=>raw})}),/count mismatch/);
});
test('structured Map interpretation v2 is preserved and rendered without private assets',()=>{
 const d=structuredClone(data.market),codes=d.markets.map(x=>x.code);
 d.interpretation.schemaVersion='lz-market-interpretation-v2';
 d.interpretation.stageDistribution=['S1','S2','S3','S4'].map(stage=>({stage,season:{S1:'春季',S2:'夏季',S3:'秋季',S4:'冬季'}[stage],count:d.interpretation.stageCounts[stage],percent:Math.round(d.interpretation.stageCounts[stage]/16*100),delta:stage==='S2'?1:stage==='S4'?-1:0}));
 d.interpretation.marketStructure=[{label:'美股',summary:'S2为主',stageCounts:{S1:0,S2:3,S3:0,S4:1}}];
 d.interpretation.keyPositions=[{id:'s2Early',label:'S2早期',stage:'S2',assets:[{code:codes[0],name:d.markets[0].name},{code:'PRIVATE',name:'私有资产'}]}];
 d.interpretation.confirmedChanges=[{code:codes[0],name:d.markets[0].name,fromStage:'S4',toStage:'S2'}];
 d.interpretation.observations=[];
 d.interpretation.headline='S2 夏季占优，但市场分化明显';
 d.interpretation.summary='16个代表资产中，9个处于S2（56%）；5个处于S4（31%）。';
 const n=normalizeMarket(d,'https://example.com/public.json'),html=renderers.market({...data,market:n});
 assert.equal(n.interpretation.keyPositions[0].assets.length,1);
 for(const text of ['全球市场四季解读','市场结构','关键位置','本期变化','阶段净变化：S2 +1｜S4 -1'])assert.ok(html.includes(text));
 assert.ok(!html.includes('私有资产'));assert.ok(!html.includes('来源快照原文'));
});
test('requested four-season labels are scoped to their pages and Map URL stays unchanged',()=>{
 const homeHTML=renderers.index(current),marketHTML=renderers.market(current),toolsHTML=renderers.tools(current);
 for(const text of ['查看四季地图','全球四季解读'])assert.ok(homeHTML.includes(text));
 for(const text of ['全球市场四季看板','全球市场四季解读'])assert.ok(marketHTML.includes(text));
 assert.ok(!marketHTML.includes('观察信号尚未等同于阶段确认。'));
 for(const text of ['LZ-4Stage Map','查看四季地图','https://zhaotools.github.io/LZ-4Stage-Map/'])assert.ok(toolsHTML.includes(text));
 assert.ok(homeHTML.includes('<h3>LZ-4Stage Map</h3>'));
});
test('follow dialog shows personal WeChat copy entry without QR or privacy note',()=>{
 for(const text of ['公众号：${e(D.site.wechatName)}','个人微信：老赵','在微信中搜索用户名 guangzdou','data-copy-wechat="personal">复制名称','直播视频：老赵市场观察','const value=personal?\'guangzdou\':D.site.wechatName'])assert.ok(siteSource.includes(text));
 assert.ok(!siteSource.includes('contact-qr'));
 assert.ok(!siteSource.includes('不收集邮箱、手机号或投资信息。'));
});
test('headline follows dominant stage rather than hardcoding summer',()=>{
 const d=structuredClone(data);d.market.interpretation.stageCounts={S1:0,S2:0,S3:0,S4:16};
 const h=renderers.market(d);assert.ok(h.includes('冬季资产占比较高'));assert.ok(h.includes('持续关注阶段变化'));
});
test('video category inference is simple and deterministic',()=>{assert.equal(inferCategory('LZ-DCA 教程'),'系统教程');assert.equal(inferCategory('全球市场周观察'),'市场观察');});
test('YouTube RSS transport retries transient failures before succeeding',async()=>{
 const xml='<feed><entry><title>视频</title></entry></feed>',delays=[],options=[];let calls=0;
 const result=await fetchYoutubeFeed('https://www.youtube.com/feeds/videos.xml?channel_id=test',{
  delays:[0,1,2],waitImpl:async ms=>delays.push(ms),onRetry:()=>{},
  fetchImpl:async(_url,requestOptions)=>{options.push(requestOptions);calls++;return calls<3?{ok:false,status:503}:{ok:true,status:200,text:async()=>xml};}
 });
 assert.equal(result,xml);assert.equal(calls,3);assert.deepEqual(delays,[1,2]);
 assert.match(options[0].headers['user-agent'],/LZ-Market-Notes/);assert.equal(options[0].redirect,'follow');
});
test('official YouTube RSS entries are channel-bound and normalized',()=>{
 const xml=`<feed><title>老赵市场观察</title><entry><yt:videoId>OdzO84ToAlM</yt:videoId><yt:channelId>UCSk0Q0f1xvfyRQCxiFlfNWg</yt:channelId><title>比特币黄金交叉 &amp; 短期节奏</title><published>2026-09-10T07:31:57+00:00</published><media:description>公开说明</media:description></entry></feed>`;
 const site={youtubeChannelId:'UCSk0Q0f1xvfyRQCxiFlfNWg',youtubeChannelTitle:'老赵市场观察'};
 const next=parseYoutubeFeed(xml,site,{items:[]},{syncedAt:'2026-09-10T08:00:00.000Z'});
 assert.equal(next.items[0].title,'比特币黄金交叉 & 短期节奏');assert.equal(next.items[0].status,'published');assert.match(next.items[0].thumbnail,/i\.ytimg\.com/);
 assert.throws(()=>parseYoutubeFeed(xml.replace('UCSk0Q0f1xvfyRQCxiFlfNWg','UCwrongwrongwrongwrong12'),site,{items:[]}));
});
test('YouTube RSS is capped at the latest five entries',()=>{
 const entries=Array.from({length:6},(_,i)=>`<entry><yt:videoId>vid0000000${i}</yt:videoId><yt:channelId>UCSk0Q0f1xvfyRQCxiFlfNWg</yt:channelId><title>视频 ${i}</title><published>2026-09-${String(10-i).padStart(2,'0')}T07:31:57+00:00</published></entry>`).join('');
 const next=parseYoutubeFeed(`<feed><title>老赵市场观察</title>${entries}</feed>`,{youtubeChannelId:'UCSk0Q0f1xvfyRQCxiFlfNWg',youtubeChannelTitle:'老赵市场观察'},{items:[]});
 assert.equal(next.items.length,5);
});
test('configured YouTube exclusions are applied before the latest-five cap',()=>{
 const entries=Array.from({length:6},(_,i)=>`<entry><yt:videoId>vid0000000${i}</yt:videoId><yt:channelId>UCSk0Q0f1xvfyRQCxiFlfNWg</yt:channelId><title>视频 ${i}</title><published>2026-09-${String(10-i).padStart(2,'0')}T07:31:57+00:00</published></entry>`).join('');
 const site={youtubeChannelId:'UCSk0Q0f1xvfyRQCxiFlfNWg',youtubeChannelTitle:'老赵市场观察',youtubeExcludedVideoIds:['vid00000000']};
 const next=parseYoutubeFeed(`<feed><title>老赵市场观察</title>${entries}</feed>`,site,{items:[]});
 assert.equal(next.items.length,5);assert.ok(!next.items.some(x=>x.youtubeId==='vid00000000'));
});
test('modern YouTube channel cards are parsed without executing remote scripts',()=>{
 const html=`<script>var ytInitialData = {"metadata":{"channelId":"UCSk0Q0f1xvfyRQCxiFlfNWg"},"contents":[{"lockupViewModel":{"contentId":"5tCdHTzcB7A","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","metadata":{"lockupMetadataViewModel":{"title":{"content":"老赵市场观察｜趋势投资 从理论到实践｜2026-09-13"}}}}},{"lockupViewModel":{"contentId":"not-a-video","contentType":"LOCKUP_CONTENT_TYPE_PLAYLIST","metadata":{"lockupMetadataViewModel":{"title":{"content":"播放列表"}}}}}]};</script>`;
 const parsed=parseYoutubeChannelPage(html,{youtubeChannelId:'UCSk0Q0f1xvfyRQCxiFlfNWg'});
 assert.deepEqual(parsed,[{id:'5tCdHTzcB7A',title:'老赵市场观察｜趋势投资 从理论到实践｜2026-09-13'}]);
});
test('YouTube watch metadata is bound to the configured channel and video',()=>{
 const site={youtubeChannelId:'UCSk0Q0f1xvfyRQCxiFlfNWg'},html=`<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"5tCdHTzcB7A","channelId":"UCSk0Q0f1xvfyRQCxiFlfNWg","title":"趋势投资 从理论到实践","shortDescription":"公开视频说明"},"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-09-13T07:21:37-07:00"}}};</script>`;
 const item=parseYoutubeWatchPage(html,site,'5tCdHTzcB7A');assert.equal(item.title,'趋势投资 从理论到实践');assert.equal(item.publishedAt,'2026-09-13T07:21:37-07:00');
 assert.throws(()=>parseYoutubeWatchPage(html.replace('UCSk0Q0f1xvfyRQCxiFlfNWg','UCwrongwrongwrongwrong12'),site,'5tCdHTzcB7A'),/failed validation/);
});
test('public YouTube channel fallback verifies and keeps the latest five videos',async()=>{
 const ids=Array.from({length:6},(_,i)=>`vid0000000${i}`),site={youtubeChannelId:'UCSk0Q0f1xvfyRQCxiFlfNWg',youtubeChannelTitle:'老赵市场观察',youtubeUrl:'https://www.youtube.com/@lzmarketwatch',youtubeExcludedVideoIds:[ids[0]]};
 const cards=ids.map((id,i)=>`{"lockupViewModel":{"contentId":"${id}","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","metadata":{"lockupMetadataViewModel":{"title":{"content":"视频 ${i}"}}}}}`).join(',');
 const html=`<script>var ytInitialData = {"channelId":"${site.youtubeChannelId}","contents":[${cards}]};</script>`;
 const next=await buildYoutubeChannelDirectory(html,site,{items:[]},{syncedAt:'2026-09-14T02:00:00.000Z',fetchWatchPage:async id=>`<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${id}","channelId":"${site.youtubeChannelId}","title":"视频 ${id}","shortDescription":"说明"},"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-09-13T07:21:37-07:00"}}};</script>`});
 assert.equal(next.status,'synced-public-channel-page');assert.equal(next.items.length,5);assert.ok(!next.items.some(item=>item.youtubeId===ids[0]));
});
test('source-only YouTube exclusion config is not published',async()=>{
 const publishedSite=JSON.parse(await readFile(resolve(root,'site/data/site.json'),'utf8'));
 const generated=await readFile(resolve(root,'site/videos.html'),'utf8');
 assert.equal(publishedSite.youtubeExcludedVideoIds,undefined);assert.ok(!generated.includes('1YV4RAFeNXs'));assert.ok(!generated.includes('区块链时光直播'));
});
test('WeChat RSS connector keeps only verified original links and no article bodies',()=>{
 const xml=`<rss><channel><title>老赵市场笔记</title><item><title><![CDATA[AI 与投资系统]]></title><link>https://mp.weixin.qq.com/s/new-article</link><pubDate>Thu, 10 Sep 2026 16:30:00 GMT</pubDate><description><![CDATA[<p>只保存目录摘要。</p>]]></description><content:encoded><![CDATA[<p>正文不应保存</p>]]></content:encoded></item></channel></rss>`;
 const next=parseWechatFeed(xml,{wechatName:'老赵市场笔记'},{items:[]},{syncedAt:'2026-09-11T00:30:00.000Z'});
 assert.equal(next.items.length,1);assert.equal(next.items[0].date,'2026-09-11');assert.equal(next.items[0].category,'AI 实践');
 assert.equal(next.items[0].summary,'只保存目录摘要。');assert.equal(next.items[0].body,undefined);assert.equal(next.items[0].status,'published');
 assert.equal(next.status,'synced-rss-connector');assert.equal(inferArticleCategory('全球市场周观察'),'市场观察');
 assert.throws(()=>parseWechatFeed(xml.replace('老赵市场笔记','其他公众号'),{wechatName:'老赵市场笔记'},{items:[]}),/title did not match/);
 assert.throws(()=>parseWechatFeed(xml.replace('https://mp.weixin.qq.com/s/new-article','https://example.com/article'),{wechatName:'老赵市场笔记'},{items:[]}),/no valid/);
});
test('public WeChat collection metadata is identity-bound and normalized without executing remote JS',()=>{
 const html=wechatAlbumFixture([{title:'AI 与投资系统',createTime:'1789176200',url:'http://mp.weixin.qq.com/s?__biz=MzYzNDI3NDQ0OQ==&mid=2247484179&idx=1&sn=abc',msgid:'2247484179',itemidx:'1'}],{total:34,hasMore:true});
 const parsed=parseWechatAlbumPage(html,wechatSite);
 assert.equal(parsed.accountName,'老赵市场笔记');assert.equal(parsed.accountId,'gh_a8fb4adf64dc');assert.equal(parsed.total,34);assert.equal(parsed.hasMore,true);
 assert.equal(parsed.entries[0].date,'2026-09-12');assert.match(parsed.entries[0].url,/^https:\/\/mp\.weixin\.qq\.com\/s\?/);assert.ok(!parsed.entries[0].url.includes('#'));
 assert.throws(()=>parseWechatAlbumPage(html.replace("nick_name: '老赵市场笔记'","nick_name: '其他公众号'"),wechatSite),/identity did not match/);
 assert.throws(()=>parseWechatAlbumPage(html.replace('MzYzNDI3NDQ0OQ==','MzYzNDI3NDQ0OA=='),wechatSite),/valid public article/);
});
test('WeChat collection pagination follows the public cursor and stops at the declared total',async()=>{
 const rows=[
  {title:'新文章',createTime:'1789176200',url:'http://mp.weixin.qq.com/s?__biz=MzYzNDI3NDQ0OQ==&mid=2&idx=1&sn=two',msgid:'2',itemidx:'1'},
  {title:'旧文章',createTime:'1789087262',url:'http://mp.weixin.qq.com/s?__biz=MzYzNDI3NDQ0OQ==&mid=1&idx=1&sn=one',msgid:'1',itemidx:'1'}
 ],requests=[];
 const album=await fetchWechatAlbum(wechatSite,{waitImpl:async()=>{},fetchPage:async source=>{
  requests.push(source);return requests.length===1?wechatAlbumFixture([rows[0]],{total:2,hasMore:true}):wechatAlbumFixture([rows[1]],{total:2,hasMore:false});
 }});
 assert.equal(album.entries.length,2);assert.equal(requests.length,2);assert.match(requests[0],/is_reverse=1/);assert.match(requests[1],/begin_msgid=2/);
 await assert.rejects(()=>fetchWechatAlbum(wechatSite,{maxPages:1,waitImpl:async()=>{},fetchPage:async()=>wechatAlbumFixture([rows[0]],{total:2,hasMore:true})}),/pagination was incomplete/);
});
test('project RSS round-trips into website metadata and preserves hand-edited summaries',()=>{
 const incoming=[{title:'新文章 & 方法',date:'2026-09-13',url:'https://mp.weixin.qq.com/s?__biz=MzYzNDI3NDQ0OQ%3D%3D&mid=3&idx=1&sn=three',summary:'来自合集。'}];
 const rss=renderWechatRss(incoming,wechatSite,{lastBuildDate:'2026-09-13T09:00:00+08:00'});
 assert.match(rss,/&amp; 方法/);assert.ok(!rss.includes('content:encoded'));assert.ok(!rss.includes('<body>'));
 const previous={items:[{id:'kept',title:'新文章 & 方法',date:'2026-09-13',url:'https://mp.weixin.qq.com/s/short',summary:'人工编辑摘要',category:'投资方法',theme:'method',tags:['方法'],featured:true,status:'published'}]};
 const next=parseWechatFeed(rss,wechatSite,previous,{syncedAt:'2026-09-13T01:00:00.000Z'});
 assert.equal(next.items.length,1);assert.equal(next.items[0].id,'kept');assert.equal(next.items[0].url,'https://mp.weixin.qq.com/s/short');assert.equal(next.items[0].summary,'人工编辑摘要');
});
test('generated pages advertise and publish the project-owned WeChat RSS',async()=>{
 const feed=await readFile(resolve(root,'site/feed.xml'),'utf8');
 const home=await readFile(resolve(root,'site/index.html'),'utf8');
 assert.match(feed,/^<\?xml version="1\.0" encoding="UTF-8"\?>/);assert.ok(feed.includes('<title>老赵市场笔记</title>'));assert.ok(!feed.includes('content:encoded'));
 assert.ok(home.includes('<link rel="alternate" type="application/rss+xml"'));assert.ok(home.includes('https://zhaotools.github.io/LZ-Market-Notes/feed.xml'));
});
test('manual article import requires verified original URLs and never copies bodies',()=>{
 const incoming=[{id:'verified-one',category:'投资方法',title:'核验文章',summary:'经人工核验的目录摘要。',date:'2026-09-10',url:'https://mp.weixin.qq.com/s/example',tags:['方法'],body:'do not copy'}];
 const next=normalizeArticleImport(incoming,{items:[]},{importedAt:'2026-09-10T08:00:00.000Z'});
 assert.equal(next.items[0].status,'published');assert.equal(next.items[0].body,undefined);
 assert.throws(()=>normalizeArticleImport([{...incoming[0],url:'https://example.com/article'}],{items:[]}));
});
test('browser scripts compile and generated pages load the live Map sanitizer first',async()=>{
 new vm.Script(marketLiveSource);new vm.Script(siteSource);
 const generated=await readFile(resolve(root,'site/market.html'),'utf8');
 assert.ok(generated.indexOf('assets/market-live.js')<generated.indexOf('assets/site.js'));
 for(const hook of ['data-market-snapshot','data-market-reading','data-market-note'])assert.ok(generated.includes(hook));
});
test('generated standalone inline script preserves double-dollar selectors',async()=>{
 const html=await readFile(resolve(root,'preview.html'),'utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
 const js=scripts.find(s=>s.includes('Progressive enhancement'));assert.ok(js);new vm.Script(js);assert.ok(js.includes('$$='));
});
