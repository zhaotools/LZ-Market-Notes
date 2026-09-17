/** Use the official public RSS feed for the latest videos, or the Data API for
 * the full public directory when YOUTUBE_API_KEY is available. Never expose a
 * key to browser code.
 * https://www.youtube.com/feeds/videos.xml
 * https://developers.google.com/youtube/v3/docs/channels/list
 * https://developers.google.com/youtube/v3/docs/playlistItems/list
 * https://developers.google.com/youtube/v3/docs/videos/list
 */
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root, readJSON, atomicJSON, fetchJSON, validateContent, safeURL } from './lib.mjs';
const execFileAsync=promisify(execFile);
const rssHeaders={
 accept:'application/atom+xml,application/xml;q=0.9,*/*;q=0.5',
 'user-agent':'Mozilla/5.0 (compatible; LZ-Market-Notes/1.0; +https://github.com/zhaotools/LZ-Market-Notes)'
};
const pageHeaders={
 accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
 'accept-language':'en-US,en;q=0.8',
 'user-agent':rssHeaders['user-agent']
};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const usableFeed=xml=>/<feed(?:\s|>)/.test(String(xml))&&/<entry>[\s\S]*?<\/entry>/.test(String(xml));
const usableChannelPage=html=>String(html).includes('ytInitialData')&&String(html).includes('LOCKUP_CONTENT_TYPE_VIDEO');
const usableWatchPage=html=>String(html).includes('ytInitialPlayerResponse');
export const inferCategory=title=>/定投|系统|教程|工具|指标|DCA|Status/i.test(title)?'系统教程':'市场观察';
const youtubeExclusions=site=>{
 const ids=site.youtubeExcludedVideoIds??[];
 if(!Array.isArray(ids)||ids.some(id=>!/^[\w-]{11}$/.test(id)))throw new Error('youtubeExcludedVideoIds must contain valid YouTube video IDs.');
 return new Set(ids);
};
const decodeXML=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const tag=(block,name)=>decodeXML(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1]||'').replace(/<[^>]+>/g,'').trim();
const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
const objectAfterMarker=(source,markers)=>{
 const text=String(source);
 for(const marker of markers){
  let markerAt=text.indexOf(marker);
  while(markerAt!==-1){
   const start=text.indexOf('{',markerAt+marker.length);
   if(start===-1)break;
   let depth=0,inString=false,escaped=false;
   for(let index=start;index<text.length;index++){
    const char=text[index];
    if(inString){
     if(escaped)escaped=false;
     else if(char==='\\')escaped=true;
     else if(char==='"')inString=false;
     continue;
    }
    if(char==='"'){inString=true;continue;}
    if(char==='{')depth++;
    else if(char==='}'&&--depth===0){
     try{return JSON.parse(text.slice(start,index+1));}catch{break;}
    }
   }
   markerAt=text.indexOf(marker,markerAt+marker.length);
  }
 }
 throw new Error('YouTube page did not contain readable public metadata.');
};
const textValue=value=>compact(typeof value==='string'?value:value?.simpleText??value?.content??value?.runs?.map(row=>row.text??row.content??'').join(' ')??'');
export function parseYoutubeChannelPage(html,site){
 if(!String(html).includes(site.youtubeChannelId||''))throw new Error('YouTube channel page identity did not match the configured channel.');
 const data=objectAfterMarker(html,['var ytInitialData = ','window["ytInitialData"] = ','ytInitialData = ']);
 const candidates=[],seen=new Set(),add=(id,title)=>{
  if(!/^[\w-]{11}$/.test(id||'')||!title||seen.has(id))return;
  seen.add(id);candidates.push({id,title});
 };
 const visit=value=>{
  if(Array.isArray(value)){for(const item of value)visit(item);return;}
  if(!value||typeof value!=='object')return;
  const lockup=value.lockupViewModel;
  if(lockup?.contentType==='LOCKUP_CONTENT_TYPE_VIDEO')add(lockup.contentId,textValue(lockup.metadata?.lockupMetadataViewModel?.title));
  const classic=value.videoRenderer;
  if(classic)add(classic.videoId,textValue(classic.title));
  for(const child of Object.values(value))visit(child);
 };
 visit(data);
 if(!candidates.length)throw new Error('YouTube channel page returned no public videos; existing data preserved.');
 return candidates;
}
export function parseYoutubeWatchPage(html,site,expectedId){
 const data=objectAfterMarker(html,['var ytInitialPlayerResponse = ','window["ytInitialPlayerResponse"] = ','ytInitialPlayerResponse = ']);
 const details=data.videoDetails||{},micro=data.microformat?.playerMicroformatRenderer||{};
 const id=details.videoId,channelId=details.channelId,publishedAt=micro.publishDate||micro.uploadDate,title=compact(details.title);
 if(id!==expectedId||channelId!==site.youtubeChannelId||!title||!Number.isFinite(Date.parse(publishedAt)))throw new Error(`YouTube watch metadata failed validation for ${expectedId}.`);
 return {id,title,publishedAt,description:compact(details.shortDescription),thumbnail:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`};
}
const videoItem=(metadata,previous)=>{
 const existing=previous.items.find(x=>x.youtubeId===metadata.id||x.id===metadata.id),title=metadata.title;
 return {id:metadata.id,youtubeId:metadata.id,title,summary:(metadata.description||'来自「老赵市场观察」的公开视频。').slice(0,140),
  category:existing?.editorialCategory||existing?.category||inferCategory(title),editorialCategory:existing?.editorialCategory||null,
  coverTitle:title,theme:existing?.theme||'cross',url:`https://www.youtube.com/watch?v=${metadata.id}`,
  thumbnail:metadata.thumbnail,publishedAt:metadata.publishedAt,duration:null,embeddable:null,status:'published'};
};
export async function buildYoutubeChannelDirectory(html,site,previous,{fetchWatchPage,syncedAt=new Date().toISOString()}={}){
 if(typeof fetchWatchPage!=='function')throw new Error('A YouTube watch-page reader is required.');
 const excluded=youtubeExclusions(site),candidates=parseYoutubeChannelPage(html,site).filter(item=>!excluded.has(item.id)),items=[];
 for(let start=0;start<candidates.length&&items.length<5;start+=5){
  const batch=candidates.slice(start,start+5);
  const results=await Promise.allSettled(batch.map(async candidate=>parseYoutubeWatchPage(await fetchWatchPage(candidate.id),site,candidate.id)));
  for(const result of results){if(result.status==='fulfilled'&&items.length<5)items.push(videoItem(result.value,previous));}
 }
 if(!items.length)throw new Error('YouTube channel page returned no verified public videos; existing data preserved.');
 const next={schemaVersion:1,status:'synced-public-channel-page',lastSyncedAt:syncedAt,channelId:site.youtubeChannelId,
  channelTitle:site.youtubeChannelTitle||null,sourceUrl:`${String(site.youtubeUrl||'').replace(/\/$/,'')}/videos`,
  note:'YouTube 官方 RSS 暂时不可用时，通过公开频道页同步最近 5 条视频，并用公开视频页核验标题、频道和发布日期。',items};
 validateContent(next,'videos');return next;
}
export function parseYoutubeFeed(xml,site,previous,{syncedAt=new Date().toISOString()}={}){
 const excluded=youtubeExclusions(site);
 const entries=[...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(x=>x[1]).filter(entry=>!excluded.has(tag(entry,'yt:videoId'))).slice(0,5);
 if(!entries.length)throw new Error('YouTube RSS feed returned no public videos; existing data preserved.');
 const withoutEntries=String(xml).replace(/<entry>[\s\S]*?<\/entry>/g,'');
 const channelTitle=tag(withoutEntries,'title');
 if(site.youtubeChannelTitle&&channelTitle!==site.youtubeChannelTitle)throw new Error('YouTube RSS channel title did not match the configured channel.');
 const items=entries.map(entry=>{
  const id=tag(entry,'yt:videoId'),channelId=tag(entry,'yt:channelId'),title=tag(entry,'title'),publishedAt=tag(entry,'published');
  if(!/^[\w-]{11}$/.test(id)||channelId!==site.youtubeChannelId||!title||!Number.isFinite(Date.parse(publishedAt)))throw new Error('YouTube RSS entry failed channel or field validation.');
  const existing=previous.items.find(x=>x.youtubeId===id||x.id===id),description=compact(tag(entry,'media:description'));
  return {id,youtubeId:id,title,summary:(description||'来自「老赵市场观察」的公开视频。').slice(0,140),
   category:existing?.editorialCategory||existing?.category||inferCategory(title),editorialCategory:existing?.editorialCategory||null,
   coverTitle:title,theme:existing?.theme||'cross',url:`https://www.youtube.com/watch?v=${id}`,
   thumbnail:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,publishedAt,duration:null,embeddable:null,status:'published'};
 });
 const next={schemaVersion:1,status:'synced-public-rss',lastSyncedAt:syncedAt,channelId:site.youtubeChannelId,channelTitle,
  sourceUrl:`https://www.youtube.com/feeds/videos.xml?channel_id=${site.youtubeChannelId}`,
  note:'通过 YouTube 官方公开 RSS 同步最近公开视频。RSS 不提供完整历史、时长或嵌入权限；配置 Data API 密钥后可同步完整公开视频目录并核验这些字段。',items};
 validateContent(next,'videos');return next;
}
export async function fetchYoutubeFeed(source,{fetchImpl=fetch,waitImpl=wait,delays=[0,3000,10000,25000],timeout=20000,onRetry=message=>console.warn(message)}={}){
 let lastError='unknown error';
 for(let index=0;index<delays.length;index++){
  if(delays[index]>0)await waitImpl(delays[index]);
  try{
   const response=await fetchImpl(source,{headers:rssHeaders,redirect:'follow',signal:AbortSignal.timeout(timeout)});
   if(response.ok){
    const xml=await response.text();
    if(usableFeed(xml))return xml;
    lastError='response did not contain a usable Atom feed';
   }else lastError=`HTTP ${response.status}`;
  }catch(error){lastError=error instanceof Error?`${error.name}: ${error.message}`:String(error);}
  if(index<delays.length-1)onRetry(`YouTube RSS attempt ${index+1}/${delays.length} failed (${lastError}); retrying after ${delays[index+1]}ms.`);
 }
 throw new Error(`YouTube RSS fetch failed after ${delays.length} attempts (${lastError}).`);
}
async function fetchYoutubeFeedWithCurl(source){
 try{
  const {stdout}=await execFileAsync('curl',['--location','--fail','--silent','--show-error','--ipv4',
   '--retry','5','--retry-all-errors','--retry-delay','5','--retry-max-time','120',
   '--connect-timeout','15','--max-time','150','--header',`Accept: ${rssHeaders.accept}`,
   '--user-agent',rssHeaders['user-agent'],source],{encoding:'utf8',maxBuffer:5*1024*1024});
  if(!usableFeed(stdout))throw new Error('curl response did not contain a usable Atom feed');
  return stdout;
 }catch(error){
  const detail=compact(error?.stderr||error?.message||'unknown curl error').slice(0,240);
  throw new Error(`YouTube RSS curl fallback failed after retries (${detail}).`);
 }
}
async function fetchYoutubePage(source,usable,{fetchImpl=fetch,waitImpl=wait,delays=[0,2000,5000],timeout=20000}={}){
 let lastError='unknown error';
 for(let index=0;index<delays.length;index++){
  if(delays[index]>0)await waitImpl(delays[index]);
  try{
   const response=await fetchImpl(source,{headers:pageHeaders,redirect:'follow',signal:AbortSignal.timeout(timeout)});
   if(response.ok){const html=await response.text();if(usable(html))return html;lastError='response did not contain usable public metadata';}
   else {lastError=`HTTP ${response.status}`;if(response.status===404)break;}
  }catch(error){lastError=error instanceof Error?`${error.name}: ${error.message}`:String(error);}
 }
 throw new Error(`YouTube public page fetch failed (${lastError}).`);
}
async function fetchYoutubePageWithCurl(source,usable){
 try{
  const {stdout}=await execFileAsync('curl',['--location','--fail','--silent','--show-error','--ipv4','--retry','3','--retry-connrefused','--retry-delay','3',
   '--connect-timeout','15','--max-time','60','--header',`Accept: ${pageHeaders.accept}`,'--header',`Accept-Language: ${pageHeaders['accept-language']}`,
   '--user-agent',pageHeaders['user-agent'],source],{encoding:'utf8',maxBuffer:20*1024*1024});
  if(!usable(stdout))throw new Error('curl response did not contain usable public metadata');
  return stdout;
 }catch(error){
  const detail=compact(error?.stderr||error?.message||'unknown curl error').slice(0,240);
  throw new Error(`YouTube public page curl fallback failed (${detail}).`);
 }
}
async function loadYoutubePage(source,usable){
 try{return await fetchYoutubePage(source,usable);}
 catch(error){console.warn(`${error.message} Falling back to curl.`);return fetchYoutubePageWithCurl(source,usable);}
}
async function syncYoutubeChannelPage(site,previous){
 const base=safeURL(site.youtubeUrl,['www.youtube.com','youtube.com']);
 if(!base)throw new Error('Set the verified youtubeUrl in site.json; videos.json was preserved.');
 const source=`${base.replace(/\/$/,'')}/videos?hl=en&gl=US`,html=await loadYoutubePage(source,usableChannelPage);
 const next=await buildYoutubeChannelDirectory(html,site,previous,{fetchWatchPage:id=>loadYoutubePage(`https://www.youtube.com/watch?v=${id}&hl=en&gl=US`,usableWatchPage)});
 if(JSON.stringify(previous)===JSON.stringify({...next,lastSyncedAt:previous.lastSyncedAt})){
  console.log('YouTube latest-five directory is unchanged.');return {changed:false};
 }
 await atomicJSON(resolve(root,'data/videos.json'),next);
 console.log(`Saved ${next.items.length} latest public videos. Source: YouTube public channel page fallback.`);
 return {changed:true};
}
async function syncYoutubeRSS(site,previous){
 if(!/^UC[\w-]{22}$/.test(site.youtubeChannelId||''))throw new Error('Set the verified youtubeChannelId in site.json; videos.json was preserved.');
 const source=`https://www.youtube.com/feeds/videos.xml?channel_id=${site.youtubeChannelId}`;
 let xml='';
 try{xml=await fetchYoutubeFeed(source);}
 catch(error){
  if(/HTTP 404/.test(error.message))console.warn(`${error.message} Falling back to the public channel page.`);
  else{
   console.warn(`${error.message} Falling back to curl with IPv4 and transport retries.`);
   try{xml=await fetchYoutubeFeedWithCurl(source);}
   catch(fallbackError){console.warn(`${fallbackError.message} Falling back to the public channel page.`);}
  }
 }
 if(!xml)return syncYoutubeChannelPage(site,previous);
 const next=parseYoutubeFeed(xml,site,previous);
 if(JSON.stringify(previous)===JSON.stringify({...next,lastSyncedAt:previous.lastSyncedAt})){
  console.log('YouTube latest-five directory is unchanged.');return {changed:false};
 }
 await atomicJSON(resolve(root,'data/videos.json'),next);
 console.log(`Saved ${next.items.length} latest public videos. Source: YouTube official RSS.`);
 return {changed:true};
}
async function syncYoutubeAPI(site,previous,key){
 const excluded=youtubeExclusions(site);
 const api=async(endpoint,params)=>{
  const u=new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.entries({...params,key}).forEach(([k,v])=>u.searchParams.set(k,String(v)));
  // Never include request URLs, API response bodies, or credentials in logs.
  try{return await fetchJSON(u.href,{timeout:20000});}catch{throw new Error(`YouTube ${endpoint} request failed; no data was written.`);}
 };
 const channel=await api('channels',{part:'snippet,contentDetails',...(process.env.YOUTUBE_CHANNEL_ID?{id:process.env.YOUTUBE_CHANNEL_ID}:{forHandle:site.youtubeHandle})});
 const info=channel.items?.[0],playlistId=info?.contentDetails?.relatedPlaylists?.uploads;
 if(!info?.id||!playlistId)throw new Error('Channel or uploads playlist was not found; existing data preserved.');
 const ids=new Set();let token='';let pages=0;
 do{
  const p=await api('playlistItems',{part:'contentDetails',playlistId,maxResults:50,...(token?{pageToken:token}:{})});
  if(!Array.isArray(p.items))throw new Error('Malformed playlist response; existing data preserved.');
  for(const item of p.items){const id=item.contentDetails?.videoId;if(/^[\w-]{11}$/.test(id||'')&&!excluded.has(id))ids.add(id);}
  token=p.nextPageToken||'';
  if(++pages>100)throw new Error('Pagination safety limit exceeded; existing data preserved.');
 }while(token);
 if(!ids.size)throw new Error('No public videos returned; existing data preserved instead of clearing the directory.');
 const all=[...ids],items=[];
 for(let start=0;start<all.length;start+=50){
  const response=await api('videos',{part:'snippet,contentDetails,status',id:all.slice(start,start+50).join(','),maxResults:50});
  if(!Array.isArray(response.items))throw new Error('Malformed videos response; existing data preserved.');
  for(const v of response.items){
   if(v.status?.privacyStatus!=='public'||v.snippet?.channelId!==info.id)continue;
   const s=v.snippet,existing=previous.items.find(x=>x.youtubeId===v.id);
   const thumb=s.thumbnails?.high?.url||s.thumbnails?.medium?.url||s.thumbnails?.default?.url;
   items.push({id:v.id,youtubeId:v.id,title:s.title,summary:(s.description||'').replace(/\s+/g,' ').slice(0,140),
    category:existing?.editorialCategory||inferCategory(s.title),editorialCategory:existing?.editorialCategory||null,
    coverTitle:s.title,theme:'cross',url:`https://www.youtube.com/watch?v=${v.id}`,
    thumbnail:safeURL(thumb,['i.ytimg.com','img.youtube.com']),publishedAt:s.publishedAt,
    duration:v.contentDetails?.duration||null,embeddable:v.status?.embeddable!==false,status:'published'});
  }
 }
 if(!items.length)throw new Error('No usable public videos; existing data preserved.');
 items.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
 const latestItems=items.slice(0,5);
 const next={schemaVersion:1,status:'synced-public-directory',lastSyncedAt:new Date().toISOString(),channelId:info.id,
  channelTitle:info.snippet?.title||null,note:'通过 YouTube Data API 同步最近 5 条公开视频。分类是可编辑的规则归类，不是 YouTube 官方分类。',items:latestItems};
 validateContent(next,'videos');
 if(JSON.stringify(previous)===JSON.stringify({...next,lastSyncedAt:previous.lastSyncedAt})){
  console.log('YouTube public directory is unchanged.');return {changed:false};
 }
 await atomicJSON(resolve(root,'data/videos.json'),next);
 console.log(`Saved ${items.length} public videos. Source: YouTube Data API.`);
 return {changed:true};
}
export async function syncYoutube(){
 const site=await readJSON('site.json'),previous=await readJSON('videos.json'),key=process.env.YOUTUBE_API_KEY;
 if(!key)return syncYoutubeRSS(site,previous);
 try{return await syncYoutubeAPI(site,previous,key);}
 catch(error){
  console.warn(`${error.message} Falling back to YouTube RSS and the verified public channel page.`);
  return syncYoutubeRSS(site,previous);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))syncYoutube().catch(err=>{console.error(err.message);process.exitCode=1;});
