import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
export const root = resolve(import.meta.dirname, '..');
export async function readJSON(file) { return JSON.parse(await readFile(resolve(root, 'data', file), 'utf8')); }
export const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value, hosts = []) {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && (!hosts.length || hosts.includes(u.hostname)) ? u.href : null; } catch { return null; }
}
export function safeAssetPath(value) {
 if(typeof value!=='string'||value.includes('..')) return null;
 return /^assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(value)?value:null;
}
export const dateLabel = s => s ? String(s).slice(0,10).replaceAll('-', '.') : '日期待核验';
export const validDate = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
export const stages = {
 S1:{name:'春季',short:'春',color:'#3375d8',soft:'#ecf3ff',note:'结构整理，观察变化'},
 S2:{name:'夏季',short:'夏',color:'#278667',soft:'#eaf5ef',note:'趋势展开，关注节奏'},
 S3:{name:'秋季',short:'秋',color:'#af7426',soft:'#fbf3e7',note:'结构转换，审视风险'},
 S4:{name:'冬季',short:'冬',color:'#9b4e61',soft:'#f7edf1',note:'趋势承压，耐心观察'}
};
export function stageStyle(s) { const v=stages[s]; if(!v) throw new Error(`Invalid stage: ${s}`); return `--stage-color:${v.color};--stage-soft:${v.soft}`; }
export function validateMarket(data) {
 if(!data || !Array.isArray(data.markets) || !data.markets.length || !validDate(data.generatedAt)) throw new Error('Market snapshot is empty or missing generatedAt');
 if(data.interpretation?.viewKey !== 'global') throw new Error('Only public/global interpretations are allowed');
 const codes = new Set(); const counts={S1:0,S2:0,S3:0,S4:0};
 for(const m of data.markets){
  if(!m.code || codes.has(m.code) || !m.name || !stages[m.stage] || !Number.isInteger(m.weeks) || m.weeks<0 || !validDate(m.stageAsOf)) throw new Error(`Invalid market ${m.code}`);
  if(!m.collections?.includes('global')) throw new Error(`Non-public collection: ${m.code}`);
  codes.add(m.code); counts[m.stage]++;
 }
 if(data.interpretation.analyzedSize!==data.markets.length) throw new Error('analyzedSize mismatch');
 for(const s of Object.keys(counts)){if(data.interpretation.stageCounts?.[s]!==counts[s]) throw new Error('Stage count mismatch');}
 const publicCodes=new Set(data.markets.map(m=>m.code));
 const distribution=data.interpretation.stageDistribution||[];
 if(distribution.length){
  if(distribution.length!==4||new Set(distribution.map(x=>x.stage)).size!==4)throw new Error('Invalid stage distribution');
  for(const x of distribution){
   if(!stages[x.stage]||x.count!==counts[x.stage]||!Number.isInteger(x.percent)||x.percent<0||x.percent>100||!Number.isInteger(x.delta))throw new Error('Invalid stage distribution');
  }
 }
 for(const row of data.interpretation.marketStructure||[]){
  if(!row.label||!row.summary||Object.keys(counts).some(stage=>!Number.isInteger(row.stageCounts?.[stage])||row.stageCounts[stage]<0))throw new Error('Invalid market structure');
 }
 for(const group of data.interpretation.keyPositions||[]){
  if(!group.id||!group.label||!stages[group.stage]||!Array.isArray(group.assets)||!group.assets.length)throw new Error('Invalid key positions');
  for(const asset of group.assets){if(!publicCodes.has(asset.code)||!asset.name)throw new Error('Non-public interpretation asset');}
 }
 for(const item of [...(data.interpretation.confirmedChanges||[]),...(data.interpretation.observations||[])]){
  if(!publicCodes.has(item.code)||!stages[item.fromStage]||!stages[item.toStage])throw new Error('Invalid interpretation change');
 }
 return data;
}
export function validateContent(data, type) {
 if(!Array.isArray(data?.items)) throw new Error(`Invalid ${type} data`);
 const seen=new Set();
 for(const x of data.items){
  if(!x.id || seen.has(x.id) || !x.title || !x.category || !['pending','published'].includes(x.status)) throw new Error(`Invalid ${type} item`);
  seen.add(x.id);
  if(x.status==='published'){
   if(!safeURL(x.url,type==='articles'?['mp.weixin.qq.com']:['www.youtube.com','youtube.com','youtu.be'])) throw new Error(`Invalid public URL: ${x.id}`);
   if(!validDate(x.date || x.publishedAt)) throw new Error(`Missing verified publication date: ${x.id}`);
   if(type==='videos' && !/^[\w-]{11}$/.test(x.youtubeId??'')) throw new Error(`Invalid video ID: ${x.id}`);
  }
 }
 return data;
}
export async function atomicJSON(path, data) { const temp=path+'.tmp'; await writeFile(temp,JSON.stringify(data,null,2)+'\n'); await rename(temp,path); }
export async function fetchJSON(url,{headers={},timeout=20000}={}){
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(timeout)});
 if(!response.ok) throw new Error(`HTTP ${response.status}`);
 return response.json();
}
