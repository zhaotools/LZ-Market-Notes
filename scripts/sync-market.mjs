/** Read only the PUBLIC global snapshot. Never log in or copy member data. */
import { resolve } from 'node:path';
import { root, fetchJSON, readJSON, atomicJSON, validateMarket } from './lib.mjs';
const SOURCES=[
 'https://zhaotools.github.io/LZ-4Stage-Map/data/dashboard.json',
 'https://raw.githubusercontent.com/zhaotools/LZ-4Stage-Map/main/data/dashboard.json'
];
const symbols={'GSPC.INDEX':'SPX','000300.SH':'CSI300','BTC-USD':'BTC','ETH-USD':'ETH',NDQ:'NDX',XAU:'GOLD',CL:'WTI',STOXX50E:'SX5E',SZ399006:'399006'};
const stageKeys=['S1','S2','S3','S4'];
const cleanCounts=value=>Object.fromEntries(stageKeys.map(stage=>[stage,Number.isInteger(value?.[stage])?value[stage]:0]));
export function normalizeMarket(raw,sourceUrl){
 if(!raw?.markets?.length || raw.interpretation?.viewKey!=='global')throw new Error('Missing public/global snapshot');
 const markets=raw.markets.filter(m=>m.collections?.includes('global')).map(m=>({
  code:m.code,symbol:symbols[m.code]||m.shortCode||m.code,name:m.name,region:m.region,
  stage:m.stage,subStage:m.subStage,weeks:m.weeks,stageDetail:m.stageDetail,
  observationStage:m.observationStage,stageAsOf:m.stageAsOf,marketAsOf:m.marketAsOf,
  completedThrough:m.cryptoQuality?.completedThrough||null,collections:['global']
 }));
 const i=raw.interpretation;
 const publicCodes=new Set(markets.map(m=>m.code));
 const cleanAsset=x=>({code:x.code,name:x.name,subStage:x.subStage??null,weeks:Number.isInteger(x.weeks)?x.weeks:null});
 const cleanChange=x=>({code:x.code,name:x.name,fromStage:x.fromStage,toStage:x.toStage});
 return validateMarket({schemaVersion:'lz-notes-public-market-v1',snapshotType:'public-snapshot',
  generatedAt:raw.generatedAt,syncedAt:new Date().toISOString(),commonStageAsOf:raw.commonStageAsOf,
  analysisPeriod:raw.analysisPeriod,sourceUrl,sourceBlobSha:null,
  sourceNote:'仅同步来源中已公开的全球样本；快照生成时间不等于阶段确认日期。',markets,
  interpretation:{schemaVersion:i.schemaVersion??null,viewKey:'global',mode:i.mode??null,
   generatedAt:i.generatedAt,commonStageAsOf:i.commonStageAsOf,
   sourceSnapshotSha256:i.sourceSnapshotSha256,universeSize:i.universeSize,analyzedSize:i.analyzedSize,
   excludedSize:i.excludedSize,stageCounts:cleanCounts(i.stageCounts),
   previousStageCounts:i.previousStageCounts?cleanCounts(i.previousStageCounts):null,
   stageDistribution:(i.stageDistribution||[]).filter(x=>stageKeys.includes(x.stage)).map(x=>({
    stage:x.stage,season:x.season,count:x.count,percent:x.percent,delta:x.delta
   })),
   marketStructure:(i.marketStructure||[]).map(x=>({label:x.label,summary:x.summary,stageCounts:cleanCounts(x.stageCounts)})),
   keyPositions:(i.keyPositions||[]).filter(x=>stageKeys.includes(x.stage)).map(x=>({
    id:x.id,label:x.label,stage:x.stage,assets:(x.assets||[]).filter(a=>publicCodes.has(a.code)).map(cleanAsset)
   })).filter(x=>x.assets.length),
   confirmedChanges:(i.confirmedChanges||[]).filter(x=>publicCodes.has(x.code)).map(cleanChange),
   observations:(i.observations||[]).filter(x=>publicCodes.has(x.code)).map(x=>({
    ...cleanChange(x),status:x.status,progress:Number.isFinite(x.progress)?x.progress:null
   })),
   headline:i.headline,summary:i.summary,
   insights:(i.insights||[]).map(x=>({id:x.id,label:x.label,text:x.text})),note:i.note}
 });
}
export async function syncMarket(){
 const previous=await readJSON('market.json');let next;
 for(const source of SOURCES){try{next=normalizeMarket(await fetchJSON(source),source);break;}catch{console.warn('A public source could not be read or failed schema validation; trying the next source.');}}
 if(!next)throw new Error('All sources failed; existing market.json was preserved.');
 if(Date.parse(next.generatedAt)<Date.parse(previous.generatedAt))throw new Error('Source is older than the existing snapshot; existing data preserved.');
 if(JSON.stringify(previous)===JSON.stringify({...next,syncedAt:previous.syncedAt})){
  console.log(`Market snapshot is unchanged: ${previous.markets.length} public assets; source generatedAt ${previous.generatedAt}.`);
  return {changed:false};
 }
 await atomicJSON(resolve(root,'data/market.json'),next);
 console.log(`Market snapshot saved: ${next.markets.length} public assets; source generatedAt ${next.generatedAt}.`);
 return {changed:true};
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)){
 syncMarket().catch(err=>{console.error(err.message);process.exitCode=1;});
}
