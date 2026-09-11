/* Progressive enhancement: all content and normal links are already in HTML. */
(() => {
 'use strict';
 const D=JSON.parse(document.getElementById('site-data').textContent);
 const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const url=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:null;}catch{return null;}};
 const asset=v=>{if(typeof v!=='string'||v.includes('..'))return null;return /^assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(v)?v:url(v);};
 const date=v=>v?String(v).slice(0,10).replaceAll('-','.'): '尚未核验';
 const names={S1:'春季',S2:'夏季',S3:'秋季',S4:'冬季'};
 const dialog=$('#contentDialog'); let lastFocus=null; let toastTimer;
 const arrow='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
 const link=(href,label,cls='button secondary')=>url(href)?`<a class="${cls}" href="${e(url(href))}" target="_blank" rel="noopener noreferrer">${e(label)}${arrow}</a>`:'';
 function toast(text){const t=$('.toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,3300);}
 function show(title,body,eyebrow='MARKET NOTES',isVideo=false){
  lastFocus=document.activeElement;
  $('#dialogEyebrow').textContent=eyebrow;
  $('#dialogContent').innerHTML=`<h2 id="dialogTitle">${e(title)}</h2>${body}`;
  dialog.classList.toggle('video-dialog',isVideo);
  if(!dialog.open)dialog.showModal();
  document.body.classList.add('modal-open');
 }
 function close(){dialog.close();}
 dialog.addEventListener('close',()=>{document.body.classList.remove('modal-open');$('#dialogContent').innerHTML='';if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});});
 $('.dialog-close').addEventListener('click',close);
 dialog.addEventListener('click',ev=>{if(ev.target!==dialog)return;const r=dialog.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)close();});
 function follow(){
  const qr=asset(D.site.wechatQr);
  show('在熟悉的平台，继续交流。',`<p>公众号读文章，YouTube 看视频。这个网站把它们整理在一起。</p><div class="follow-options"><div class="follow-option"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11a8 8 0 0 1-8 8H8l-5 3 1-6a8 8 0 1 1 17-5Z"/></svg><div><h3>${e(D.site.wechatName)}</h3><p>在微信中搜索公众号名称</p></div><button data-copy-wechat>复制名称</button></div><div class="follow-option"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg><div><h3>老赵市场观察</h3><p>${e(D.site.youtubeHandle)}</p></div><a href="${e(D.site.youtubeUrl)}" target="_blank" rel="noopener noreferrer">访问 ↗</a></div></div>${qr?`<p style="margin-top:18px"><img class="contact-qr" src="${e(qr)}" alt="${e(D.site.wechatName)}公众号二维码"></p>`:''}<div class="dialog-note">不收集邮箱、手机号或投资信息。${D.site.previewMode?'公众号二维码未提供，因此本版使用搜索名称和复制入口，不生成模拟二维码。':''}</div>`,'FOLLOW / 关注老赵');
 }
 async function copyWechat(button){
  const value=D.site.wechatName;
  try {
   if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);}else{throw new Error('clipboard unavailable');}
   button.textContent='已复制';toast('已复制公众号名称：'+value);
  }catch{
   const textarea=document.createElement('textarea');textarea.value=value;textarea.style.cssText='position:fixed;opacity:0;left:0;top:0';dialog.append(textarea);textarea.select();
   let ok=false;try{ok=document.execCommand('copy');}catch{} textarea.remove();
   if(ok){button.textContent='已复制';toast('已复制公众号名称：'+value);}else{toast('请手动复制公众号名称：'+value);}
  }
 }
 function article(id){const a=D.articles.items.find(x=>x.id===id);if(!a)return;
  show(a.title,`<p>${e(a.summary)}</p><div class="dialog-note">${a.status==='published'?'本文原文发布于公众号，点击下方按钮阅读。':'这是依据已讨论选题制作的版式样例。摘要为编辑示意，正式原文链接和发布日期尚未核实；本页面不是公众号全文，也不假装已经完成抓取。'}</div><div class="dialog-actions">${a.status==='published'?link(a.url,'阅读公众号原文','button primary'):'<button class="button primary" data-follow>查看公众号入口</button>'}<button class="button secondary" data-close>返回列表</button></div>`,'ARTICLE / '+a.category);
 }
 function video(id){const v=D.videos.items.find(x=>x.id===id);if(!v)return;
  const real=v.status==='published'&&/^[\w-]{11}$/.test(v.youtubeId??'');
  if(real&&v.embeddable===false){show(v.title,`<p>该视频未开放站内嵌入，请前往 YouTube 原视频观看。</p><div class="dialog-actions">${link(v.url,'在 YouTube 观看','button primary')}<button class="button secondary" data-close>关闭</button></div>`,'VIDEO / YOUTUBE');}
  else if(real){show(v.title,`<iframe class="video-embed" title="${e(v.title)}" src="https://www.youtube-nocookie.com/embed/${v.youtubeId}?rel=0" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><div class="dialog-note">视频由 YouTube 提供。加载受网络与视频权限影响；无法播放时可尝试前往原视频页面。</div><div class="dialog-actions">${link(v.url,'在 YouTube 打开','button primary')}<button class="button secondary" data-close>关闭视频</button></div>`,'VIDEO / YOUTUBE',true);}
  else {show(v.title,`<p>${e(v.summary)}</p><div class="dialog-note">本条为视频主题与封面的设计样例，尚未关联真实视频 ID。没有虚构播放量、时长或可播放地址。接入真实频道目录后，这里将支持按需加载播放器。</div><div class="dialog-actions">${link(D.site.youtubeUrl,'前往 YouTube 频道','button primary')}<button class="button secondary" data-close>返回列表</button></div>`,'VIDEO / 链接待关联');}
 }
 function market(code){const m=D.market.markets.find(x=>x.code===code);if(!m)return;
  const obs=m.observationStage!==m.subStage&&m.observationStage!==m.stage?`观察阶段 ${m.observationStage}，尚未替代确认阶段 ${m.stage}。`:'请结合资产属性理解阶段含义，不将阶段转换视为收益保证。';
  const fields=[['确认阶段',`${names[m.stage]} ${m.stage}`],['子阶段',m.subStage],['阶段持续',`${m.weeks} 周`],['市场类别',m.region],['阶段口径日期',date(m.stageAsOf)],['行情日期',date(m.marketAsOf)],['来源状态描述',m.stageDetail],['快照生成日期',date(D.market.generatedAt)]];
  show(m.name,`<p>${e(m.symbol||m.code)} · LZ-Map 公开数据快照</p><dl class="detail-list">${fields.map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl><div class="dialog-note">${e(obs)}${m.completedThrough?` 加密周线起始日期为 ${date(m.stageAsOf)}，已完成至 ${date(m.completedThrough)}；不要误读为阶段在前一个日期就已确认。`:''}<br>阶段持续时间不是完成度。数据仅用于辅助观察，不构成投资建议。</div><div class="dialog-actions">${link(D.site.mapUrl,'在 Map 中继续查看','button primary')}<button class="button secondary" data-close>关闭详情</button></div>`,'MARKET / 数据与口径');
 }
 function bindFilters(root){
  if(root.dataset.bound)return;root.dataset.bound='true';
  const initial=$$('[data-filter-item]',root),state={category:'全部',stage:'全部',region:'全部',q:''};
  const list=$('[data-items-container]',root),sort=$('[data-sort]',root);
  const update=()=>{
   let visible=0;
   const ordered=[...initial].sort((a,b)=>sort?.value==='oldest'?(a.dataset.date||'').localeCompare(b.dataset.date||''):(b.dataset.date||'').localeCompare(a.dataset.date||''));
   ordered.forEach(el=>{
    const match=(state.category==='全部'||el.dataset.category===state.category)&&(state.stage==='全部'||el.dataset.stage===state.stage.slice(-2))&&(state.region==='全部'||el.dataset.region===state.region)&&(!state.q||(el.dataset.search||'').toLocaleLowerCase().includes(state.q));
    el.hidden=!match;if(match)visible++;list.append(el);
   });
   $('[data-results-count]',root).textContent=`共 ${visible} ${root.dataset.filterRoot==='market'?'个资产':root.dataset.filterRoot==='articles'?'篇内容':'条内容'}`;
   $('[data-empty]',root).hidden=visible!==0;
  };
  $$('[data-filter]',root).forEach(b=>b.addEventListener('click',()=>{state[b.dataset.group]=b.dataset.filter;$$(`[data-group="${b.dataset.group}"]`,root).forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});update();}));
  $('[data-search-input]',root)?.addEventListener('input',ev=>{state.q=ev.target.value.trim().toLocaleLowerCase();update();});
  $('select[data-region]',root)?.addEventListener('change',ev=>{state.region=ev.target.value;update();});
  sort?.addEventListener('change',update);
  $('[data-reset]',root).addEventListener('click',()=>{Object.assign(state,{category:'全部',stage:'全部',region:'全部',q:''});const input=$('[data-search-input]',root);if(input)input.value='';const reg=$('select[data-region]',root);if(reg)reg.value='全部';$$('[data-filter]',root).forEach(b=>{const a=b.dataset.filter==='全部';b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));});update();input?.focus();});
  update();
 }
 function closeMenu(){const b=$('.menu-button');b.setAttribute('aria-expanded','false');b.setAttribute('aria-label','打开导航菜单');$('#mobileNav').hidden=true;}
 function initPage(){ $$('[data-filter-root]').forEach(bindFilters); $$('img').forEach(img=>{img.addEventListener('error',()=>{img.hidden=true;const t=document.createElement('span');t.className='cover-main';t.textContent=img.alt||'缩略图暂不可用';img.parentNode.append(t);},{once:true});}); }
 document.addEventListener('click',ev=>{
  const t=ev.target;
  if(t.closest('[data-follow]')){follow();return;}
  const copy=t.closest('[data-copy-wechat]');if(copy){copyWechat(copy);return;}
  if(t.closest('[data-close]')){close();return;}
  const a=t.closest('[data-article]');if(a){article(a.dataset.article);return;}
  const v=t.closest('[data-video]');if(v){video(v.dataset.video);return;}
  const m=t.closest('[data-market]');if(m){market(m.dataset.market);return;}
  if(t.closest('.menu-button')){const b=$('.menu-button');const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-label',open?'关闭导航菜单':'打开导航菜单');$('#mobileNav').hidden=!open;return;}
  if(!t.closest('.site-header'))closeMenu();
  if(t.closest('#mobileNav a'))closeMenu();
  if(t.closest('.back-to-top'))window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 });
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeMenu();});
 const topButton=$('.back-to-top');
 window.addEventListener('scroll',()=>topButton.hidden=window.scrollY<700,{passive:true});
 window.addEventListener('resize',()=>{if(innerWidth>650)closeMenu();},{passive:true});
 // The standalone design preview embeds all six pages and switches them locally.
 if(document.querySelector('[data-preview-template]')){
  function switchPage(page){
   const template=document.querySelector(`[data-preview-template="${page}"]`);if(!template)return;
   if(dialog.open)close();closeMenu();
   $('#main').innerHTML=template.innerHTML;document.body.dataset.page=page;
   $$('.desktop-nav a, .mobile-nav a').forEach(a=>{const active=a.getAttribute('href')===page+'.html';a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
   const title=page==='index'?'首页':$('.desktop-nav a.active')?.textContent||'预览';document.title=title+'｜老赵市场笔记';
   initPage();window.scrollTo({top:0,behavior:'instant'});
  }
  document.addEventListener('click',ev=>{
   const a=ev.target.closest('a');if(!a||ev.metaKey||ev.ctrlKey||ev.shiftKey||a.target==='_blank')return;
   const match=/^(index|articles|videos|market|tools|about)\.html(?:#(.*))?$/.exec(a.getAttribute('href')||'');
   if(!match)return;ev.preventDefault();const hash='#/'+match[1];if(location.hash===hash)switchPage(match[1]);else location.hash=hash;
  });
  window.addEventListener('hashchange',()=>{const m=/^#\/(index|articles|videos|market|tools|about)$/.exec(location.hash);if(m)switchPage(m[1]);});
  const match=/^#\/(index|articles|videos|market|tools|about)$/.exec(location.hash);if(match)switchPage(match[1]);
 }
 initPage();
})();
