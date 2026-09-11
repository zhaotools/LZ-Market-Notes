import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import {readJSON,validateMarket,validateContent,esc,safeURL,safeAssetPath,root} from '../scripts/lib.mjs';
import {renderers,pageHTML,nav} from '../scripts/templates.mjs';
import {normalizeMarket} from '../scripts/sync-market.mjs';
import {inferCategory,parseYoutubeFeed} from '../scripts/sync-youtube.mjs';
import {inferArticleCategory,parseWechatFeed} from '../scripts/sync-wechat.mjs';
import {normalizeArticleImport} from '../scripts/import-articles.mjs';
const data=JSON.parse(await readFile(resolve(root,'tests/fixtures/demo.json'),'utf8'));
const current={site:await readJSON('site.json'),articles:await readJSON('articles.json'),videos:await readJSON('videos.json'),market:await readJSON('market.json')};

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
 assert.equal(current.articles.items.length,5);
 assert.ok(current.articles.items.every(x=>x.status==='published'));
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
 for(const text of ['全球市场阶段解读','市场结构','关键位置','本期变化','阶段净变化：S2 +1｜S4 -1'])assert.ok(html.includes(text));
 assert.ok(!html.includes('私有资产'));assert.ok(!html.includes('来源快照原文'));
});
test('headline follows dominant stage rather than hardcoding summer',()=>{
 const d=structuredClone(data);d.market.interpretation.stageCounts={S1:0,S2:0,S3:0,S4:16};
 const h=renderers.market(d);assert.ok(h.includes('冬季资产占比较高'));assert.ok(h.includes('持续关注阶段变化'));
});
test('video category inference is simple and deterministic',()=>{assert.equal(inferCategory('LZ-DCA 教程'),'系统教程');assert.equal(inferCategory('全球市场周观察'),'市场观察');});
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
test('manual article import requires verified original URLs and never copies bodies',()=>{
 const incoming=[{id:'verified-one',category:'投资方法',title:'核验文章',summary:'经人工核验的目录摘要。',date:'2026-09-10',url:'https://mp.weixin.qq.com/s/example',tags:['方法'],body:'do not copy'}];
 const next=normalizeArticleImport(incoming,{items:[]},{importedAt:'2026-09-10T08:00:00.000Z'});
 assert.equal(next.items[0].status,'published');assert.equal(next.items[0].body,undefined);
 assert.throws(()=>normalizeArticleImport([{...incoming[0],url:'https://example.com/article'}],{items:[]}));
});
test('browser script compiles',async()=>{new vm.Script(await readFile(resolve(root,'assets/site.js'),'utf8'));});
test('generated standalone inline script preserves double-dollar selectors',async()=>{
 const html=await readFile(resolve(root,'preview.html'),'utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
 const js=scripts.find(s=>s.includes('Progressive enhancement'));assert.ok(js);new vm.Script(js);assert.ok(js.includes('$$='));
});
