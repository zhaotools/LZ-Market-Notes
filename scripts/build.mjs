import { mkdir, rm, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, readJSON, validateMarket, validateContent } from './lib.mjs';
import { renderers, pageHTML } from './templates.mjs';
const siteSource=await readJSON('site.json');
const {youtubeExcludedVideoIds:_youtubeExcludedVideoIds,...publicSite}=siteSource;
const data={site:publicSite,articles:validateContent(await readJSON('articles.json'),'articles'),videos:validateContent(await readJSON('videos.json'),'videos'),market:validateMarket(await readJSON('market.json'))};
const dest=resolve(root,'site');
await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});
await cp(resolve(root,'assets'),resolve(dest,'assets'),{recursive:true});
await mkdir(resolve(dest,'data'),{recursive:true});
for(const [k,v]of Object.entries(data)){await writeFile(resolve(dest,'data',k+'.json'),JSON.stringify(v,null,2)+'\n');}
const bodies={};
const siteScript='<script src="assets/site.js" defer></script>';
const liveScripts='<script src="assets/market-live.js" defer></script>'+siteScript;
for(const [page,render]of Object.entries(renderers)){
 bodies[page]=render(data);
 const html=pageHTML(page,data,bodies[page]).replace(siteScript,liveScripts);
 await writeFile(resolve(dest,page+'.html'),html);
}
await writeFile(resolve(dest,'.nojekyll'),'');
await writeFile(resolve(dest,'robots.txt'),data.site.previewMode?'User-agent: *\nDisallow: /\n':'User-agent: *\nAllow: /\n');
const css=await readFile(resolve(root,'assets/styles.css'),'utf8');
const marketLive=await readFile(resolve(root,'assets/market-live.js'),'utf8');
const js=await readFile(resolve(root,'assets/site.js'),'utf8');
// Embedded templates, inline styles, and data make file:// preview work without a server.
let preview=pageHTML('index',data,bodies.index,{style:css,standalone:true});
preview=preview.replace(siteScript,()=>Object.entries(bodies).map(([k,v])=>`<template data-preview-template="${k}">${v}</template>`).join('')+`<script>${marketLive}</script><script>${js}</script>`);
await writeFile(resolve(root,'preview.html'),preview);
console.log(`Built ${Object.keys(bodies).length} pages into site/ and a standalone preview.html.`);
