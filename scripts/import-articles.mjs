/** Import only user-reviewed article metadata. This never copies article bodies. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, readJSON, atomicJSON, validateContent } from './lib.mjs';

export function normalizeArticleImport(input,previous,{replace=false,importedAt=new Date().toISOString()}={}){
 const sourceItems=Array.isArray(input)?input:input?.items;
 if(!Array.isArray(sourceItems)||!sourceItems.length)throw new Error('Import file must contain a non-empty JSON array or an items array.');
 const items=sourceItems.map(x=>({
  id:String(x.id||'').trim(),category:String(x.category||'').trim(),title:String(x.title||'').trim(),summary:String(x.summary||'').trim(),
  date:String(x.date||'').trim(),theme:String(x.theme||'method').trim(),tags:Array.isArray(x.tags)?x.tags.map(String):[],
  featured:Boolean(x.featured),url:String(x.url||'').trim(),status:'published'
 }));
 for(const item of items){if(!item.summary)throw new Error(`Missing summary: ${item.id||item.title||'unknown article'}`);}
 validateContent({items},'articles');
 const urls=new Set();for(const item of items){if(urls.has(item.url))throw new Error(`Duplicate article URL: ${item.url}`);urls.add(item.url);}
 const merged=replace?items:[...items,...previous.items.filter(old=>!items.some(item=>item.id===old.id))];
 merged.sort((a,b)=>String(b.date||b.draftDate||'').localeCompare(String(a.date||a.draftDate||'')));
 const next={schemaVersion:1,status:merged.every(x=>x.status==='published')?'verified-manual-directory':'mixed-verified-and-samples',lastImportedAt:importedAt,
  note:'正式条目由人工核验标题、发布日期与公众号原文 URL 后导入；本站只保存目录和摘要，不搬运正文。',items:merged};
 validateContent(next,'articles');return next;
}

export async function importArticles(){
 const args=process.argv.slice(2),replace=args.includes('--replace'),file=args.find(x=>!x.startsWith('--'));
 if(!file)throw new Error('Usage: npm run import:articles -- /absolute/path/articles.json [--replace]');
 const previous=await readJSON('articles.json'),input=JSON.parse(await readFile(resolve(file),'utf8'));
 const next=normalizeArticleImport(input,previous,{replace});
 await atomicJSON(resolve(root,'data/articles.json'),next);
 console.log(`Imported ${Array.isArray(input)?input.length:input.items.length} verified article entries; ${next.items.length} total entries saved.`);
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))importArticles().catch(err=>{console.error(err.message);process.exitCode=1;});
