import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import {readJSON,validateMarket,validateContent,safeURL,safeAssetPath,root} from './lib.mjs';
const site=await readJSON('site.json');const articles=validateContent(await readJSON('articles.json'),'articles');const videos=validateContent(await readJSON('videos.json'),'videos');validateMarket(await readJSON('market.json'));
const blockers=[];
if(site.previewMode)blockers.push('previewMode is still enabled: review sample content before public release.');
if(!safeURL(site.baseUrl))blockers.push('Set and verify the final HTTPS baseUrl.');
if(!safeAssetPath(site.wechatQr))blockers.push('Set a safe relative path for the WeChat QR image.');
else try{await access(resolve(root,site.wechatQr));}catch{blockers.push('The configured WeChat QR image is missing.');}
if(articles.items.some(x=>x.status!=='published'))blockers.push('Replace or remove pending article samples.');
if(videos.items.some(x=>x.status!=='published'))blockers.push('Replace or remove pending video samples.');
if(blockers.length){console.error('Public release checklist:\n'+blockers.map(x=>' - '+x).join('\n'));process.exitCode=1;}else console.log('Content release checks passed. Verify data freshness, hosting terms, and deployment separately.');
