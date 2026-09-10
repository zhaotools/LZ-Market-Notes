import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import {readJSON,validateMarket,validateContent,esc,safeURL,safeAssetPath,root} from '../scripts/lib.mjs';
import {renderers,pageHTML} from '../scripts/templates.mjs';
import {normalizeMarket} from '../scripts/sync-market.mjs';
import {inferCategory,parseYoutubeFeed} from '../scripts/sync-youtube.mjs';
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
 for(const [name,render]of Object.entries(renderers)){
  const html=pageHTML(name,data,render(data));assert.ok(html.includes('lang="zh-CN"'));assert.ok(html.includes('<main id="main">'));assert.ok(html.includes('aria-current="page"'));assert.ok(html.includes('noindex,nofollow'));
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
