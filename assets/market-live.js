/* Read and sanitize the public LZ-Map snapshot in the browser. */
(() => {
 'use strict';
 const stageKeys=['S1','S2','S3','S4'];
 const symbols={'GSPC.INDEX':'SPX','000300.SH':'CSI300','BTC-USD':'BTC','ETH-USD':'ETH',NDQ:'NDX',XAU:'GOLD',CL:'WTI',STOXX50E:'SX5E',SZ399006:'399006'};
 const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
 const validStage=value=>stageKeys.includes(value);
 const cleanCounts=value=>Object.fromEntries(stageKeys.map(stage=>[stage,Number.isInteger(value?.[stage])?value[stage]:0]));
 const fail=message=>{throw new Error(message);};
 function approvedSource(value){
  try{
   const parsed=new URL(value);
   return parsed.protocol==='https:'&&parsed.hostname==='zhaotools.github.io'&&parsed.pathname==='/LZ-4Stage-Map/data/dashboard.json';
  }catch{return false;}
 }
 function normalizeMarket(raw,sourceUrl,{syncedAt=new Date().toISOString()}={}){
  if(!raw||raw.schemaVersion!=='lz-4stage-map-v2'||raw.analysisPeriod!=='weekly-completed-bars'||!validDate(raw.generatedAt))fail('Invalid public Map snapshot');
  const interpretation=raw.interpretation;
  if(!interpretation||interpretation.viewKey!=='global'||!Array.isArray(raw.markets))fail('Missing public/global interpretation');
  const markets=raw.markets.filter(m=>m?.collections?.includes('global')).map(m=>{
   if(!m.code||!m.name||!m.region||!validStage(m.stage)||typeof m.subStage!=='string'||!Number.isInteger(m.weeks)||m.weeks<0||!validDate(m.stageAsOf)||!validDate(m.marketAsOf))fail('Invalid public market row');
   return {code:m.code,symbol:symbols[m.code]||m.shortCode||m.code,name:m.name,region:m.region,
    stage:m.stage,subStage:m.subStage,weeks:m.weeks,stageDetail:m.stageDetail||'',
    observationStage:m.observationStage||m.stage,stageAsOf:m.stageAsOf,marketAsOf:m.marketAsOf,
    completedThrough:validDate(m.cryptoQuality?.completedThrough)?m.cryptoQuality.completedThrough:null,collections:['global']};
  });
  if(!markets.length)fail('Empty public market snapshot');
  const codes=new Set(markets.map(m=>m.code));
  if(codes.size!==markets.length)fail('Duplicate public market code');
  const actualCounts=Object.fromEntries(stageKeys.map(stage=>[stage,markets.filter(m=>m.stage===stage).length]));
  const stageCounts=cleanCounts(interpretation.stageCounts);
  if(interpretation.analyzedSize!==markets.length||stageKeys.some(stage=>stageCounts[stage]!==actualCounts[stage]))fail('Public market count mismatch');
  const cleanAsset=value=>({code:value.code,name:value.name,subStage:typeof value.subStage==='string'?value.subStage:null,weeks:Number.isInteger(value.weeks)?value.weeks:null});
  const cleanChange=value=>({code:value.code,name:value.name,fromStage:value.fromStage,toStage:value.toStage});
  const stageDistribution=(interpretation.stageDistribution||[]).map(row=>({
   stage:row.stage,season:row.season,count:row.count,percent:row.percent,delta:row.delta
  }));
  if(stageDistribution.length!==4||new Set(stageDistribution.map(row=>row.stage)).size!==4||stageDistribution.some(row=>!validStage(row.stage)||row.count!==actualCounts[row.stage]||!Number.isInteger(row.percent)||row.percent<0||row.percent>100||!Number.isInteger(row.delta)))fail('Invalid public stage distribution');
  const marketStructure=(interpretation.marketStructure||[]).map(row=>({label:row.label,summary:row.summary,stageCounts:cleanCounts(row.stageCounts)}));
  if(marketStructure.some(row=>!row.label||!row.summary||stageKeys.some(stage=>row.stageCounts[stage]<0)))fail('Invalid public market structure');
  const keyPositions=(interpretation.keyPositions||[]).filter(row=>validStage(row.stage)).map(row=>({
   id:row.id,label:row.label,stage:row.stage,assets:(row.assets||[]).filter(asset=>codes.has(asset.code)).map(cleanAsset)
  })).filter(row=>row.id&&row.label&&row.assets.length);
  const confirmedChanges=(interpretation.confirmedChanges||[]).filter(row=>codes.has(row.code)&&validStage(row.fromStage)&&validStage(row.toStage)).map(cleanChange);
  const observations=(interpretation.observations||[]).filter(row=>codes.has(row.code)&&validStage(row.fromStage)&&validStage(row.toStage)).map(row=>({
   ...cleanChange(row),status:row.status,progress:Number.isFinite(row.progress)?row.progress:null
  }));
  return {schemaVersion:'lz-notes-public-market-v1',snapshotType:'public-snapshot',generatedAt:raw.generatedAt,
   syncedAt,commonStageAsOf:raw.commonStageAsOf,analysisPeriod:raw.analysisPeriod,sourceUrl,sourceBlobSha:null,
   sourceNote:'仅同步来源中已公开的全球样本；快照生成时间不等于阶段确认日期。',markets,
   interpretation:{schemaVersion:interpretation.schemaVersion??null,viewKey:'global',mode:interpretation.mode??null,
    generatedAt:interpretation.generatedAt,commonStageAsOf:interpretation.commonStageAsOf,
    sourceSnapshotSha256:interpretation.sourceSnapshotSha256,universeSize:interpretation.universeSize,
    analyzedSize:interpretation.analyzedSize,excludedSize:interpretation.excludedSize,stageCounts,
    previousStageCounts:interpretation.previousStageCounts?cleanCounts(interpretation.previousStageCounts):null,
    stageDistribution,marketStructure,keyPositions,confirmedChanges,observations,
    headline:interpretation.headline,summary:interpretation.summary,
    insights:(interpretation.insights||[]).map(row=>({id:row.id,label:row.label,text:row.text})),note:interpretation.note}};
 }
 async function loadLatestMarket(current,{sourceUrl,fetchImpl=globalThis.fetch,timeout=8000,now}={}){
  if(!approvedSource(sourceUrl))fail('Unapproved public Map source');
  if(!current||!validDate(current.generatedAt)||!Array.isArray(current.markets)||!current.markets.length)fail('Invalid fallback market snapshot');
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeout):null;
  try{
   const response=await fetchImpl(sourceUrl,{cache:'no-store',headers:{accept:'application/json'},signal:controller?.signal});
   if(!response?.ok)fail(`Public Map HTTP ${response?.status??'error'}`);
   const next=normalizeMarket(await response.json(),sourceUrl,{syncedAt:now||new Date().toISOString()});
   const currentCodes=new Set(current.markets.map(m=>m.code));
   if(currentCodes.size!==next.markets.length||next.markets.some(m=>!currentCodes.has(m.code)))fail('Public Map universe changed');
   if(Date.parse(next.generatedAt)<=Date.parse(current.generatedAt))return {changed:false,market:current};
   return {changed:true,market:next};
  }finally{if(timer)clearTimeout(timer);}
 }
 globalThis.LZMarketLive=Object.freeze({approvedSource,normalizeMarket,loadLatestMarket});
})();
