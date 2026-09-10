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
export const inferCategory=title=>/定投|系统|教程|工具|指标|DCA|Status/i.test(title)?'系统教程':'市场观察';
const decodeXML=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const tag=(block,name)=>decodeXML(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1]||'').replace(/<[^>]+>/g,'').trim();
const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
export function parseYoutubeFeed(xml,site,previous,{syncedAt=new Date().toISOString()}={}){
 const entries=[...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(x=>x[1]);
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
async function syncYoutubeRSS(site,previous){
 if(!/^UC[\w-]{22}$/.test(site.youtubeChannelId||''))throw new Error('Set the verified youtubeChannelId in site.json; videos.json was preserved.');
 const source=`https://www.youtube.com/feeds/videos.xml?channel_id=${site.youtubeChannelId}`;
 let xml='';
 try{
  const response=await fetch(source,{headers:{accept:'application/atom+xml,application/xml;q=0.9'},signal:AbortSignal.timeout(12000)});
  if(response.ok)xml=await response.text();
 }catch{}
 if(!xml){
  try{({stdout:xml}=await execFileAsync('curl',['-L','--fail','--silent','--show-error','--max-time','20',source],{encoding:'utf8',maxBuffer:5*1024*1024}));}
  catch{throw new Error('YouTube RSS request failed; videos.json was preserved.');}
 }
 const next=parseYoutubeFeed(xml,site,previous);await atomicJSON(resolve(root,'data/videos.json'),next);
 console.log(`Saved ${next.items.length} latest public videos. Source: YouTube official RSS.`);
}
async function syncYoutubeAPI(site,previous,key){
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
  for(const item of p.items){const id=item.contentDetails?.videoId;if(/^[\w-]{11}$/.test(id||''))ids.add(id);}
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
 const next={schemaVersion:1,status:'synced-public-directory',lastSyncedAt:new Date().toISOString(),channelId:info.id,
  channelTitle:info.snippet?.title||null,note:'通过 YouTube Data API 同步公开视频。分类是可编辑的规则归类，不是 YouTube 官方分类。',items};
 validateContent(next,'videos');await atomicJSON(resolve(root,'data/videos.json'),next);
 console.log(`Saved ${items.length} public videos. Source: YouTube Data API.`);
}
export async function syncYoutube(){
 const site=await readJSON('site.json'),previous=await readJSON('videos.json'),key=process.env.YOUTUBE_API_KEY;
 return key?syncYoutubeAPI(site,previous,key):syncYoutubeRSS(site,previous);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))syncYoutube().catch(err=>{console.error(err.message);process.exitCode=1;});
