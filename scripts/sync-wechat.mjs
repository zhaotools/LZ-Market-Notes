/**
 * Synchronize the article directory from the public WeChat collection page.
 *
 * The collection URL is public and belongs to the configured account. We turn
 * its directory metadata into RSS, then feed that RSS through the same strict
 * article normalizer used by optional third-party feeds. No login cookies,
 * backend credentials, or article bodies are requested or stored.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJSON, readJSON, root, safeURL, validateContent } from './lib.mjs';

const execFileAsync = promisify(execFile);
const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const wechatHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
  'user-agent': 'Mozilla/5.0 (compatible; LZ-Market-Notes/1.0; +https://github.com/zhaotools/LZ-Market-Notes)'
};

const decodeXML = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');
const tag = (block, name) => decodeXML(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim();
const linkAttribute = block => decodeXML(block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1] || '').trim();
const textOnly = value => compact(decodeXML(String(value || '')
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')));
const shanghaiDate = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
};
const decodeJSString = value => decodeXML(String(value || '')
  .replace(/\\x([\da-f]{2})/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/\\([\\'"nrtbfv])/g, (_, char) => ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v'}[char] || char)));
const xmlEscape = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const rssDate = value => {
  const source = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? `${value}T00:00:00+08:00` : value;
  const date = new Date(source);
  return Number.isFinite(date.getTime()) ? date.toUTCString() : null;
};

export const inferArticleCategory = title => {
  if (/AI|人工智能|智能体|模型|编程/i.test(title)) return 'AI 实践';
  if (/工具|系统|复盘|产品|DCA|Status|4Stage|Map|地图/i.test(title)) return '工具使用';
  if (/投资|趋势|定投|策略|长赢|仓位/i.test(title)) return '投资方法';
  return '市场观察';
};
const inferTheme = category => ({'AI 实践':'coding','工具使用':'toolkit','投资方法':'method','市场观察':'market'}[category] || 'method');
const itemId = url => `wechat-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`;
const articleIdentity = (title, date) => `${compact(title)}\u0000${date}`;

function albumConfig(site, override) {
  const parsed = safeURL(override || site.wechatAlbumUrl, ['mp.weixin.qq.com']);
  if (!parsed) throw new Error('wechatAlbumUrl must be a public HTTPS mp.weixin.qq.com collection URL.');
  const url = new URL(parsed);
  const biz = url.searchParams.get('__biz');
  const albumId = url.searchParams.get('album_id');
  if (url.pathname !== '/mp/appmsgalbum' || url.searchParams.get('action') !== 'getalbum' || !biz || !/^\d{10,30}$/.test(albumId || '')) {
    throw new Error('wechatAlbumUrl is missing its public account or collection identifier.');
  }
  if (site.wechatBiz && biz !== site.wechatBiz) throw new Error('The WeChat collection account did not match wechatBiz.');
  return {url, biz, albumId};
}

function articleURL(value, expectedBiz) {
  try {
    const url = new URL(decodeJSString(value));
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com' || url.pathname !== '/s') return null;
    if (url.searchParams.get('__biz') !== expectedBiz) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Parse only the public directory fields from window.cgiData; remote JS is never executed. */
export function parseWechatAlbumPage(html, site, overrideUrl, {requireIdentity = true} = {}) {
  const source = String(html || '');
  const config = albumConfig(site, overrideUrl);
  const cgi = source.match(/window\.cgiData\s*=\s*\{([\s\S]*?)\};(?:\s*window\.|\s*<\/script>)/)?.[1];
  if (!cgi || !/\bret:\s*['"]0['"]/.test(cgi)) throw new Error('WeChat collection page did not contain a usable public directory.');
  const albumId = decodeJSString(cgi.match(/\balbumId:\s*'((?:\\.|[^'])*)'/)?.[1]);
  const accountName = decodeJSString(cgi.match(/\bnick_name:\s*'((?:\\.|[^'])*)'/)?.[1]);
  const accountId = decodeJSString(cgi.match(/\buser_name:\s*'((?:\\.|[^'])*)'/)?.[1]);
  const total = Number(cgi.match(/\barticle_count:\s*'(\d+)'/)?.[1]);
  const identityMissing = requireIdentity && (!accountName || (site.wechatAccountId && !accountId));
  const identityMismatch = (accountName && accountName !== site.wechatName) || (site.wechatAccountId && accountId && accountId !== site.wechatAccountId);
  if (albumId !== config.albumId || identityMissing || identityMismatch) {
    throw new Error('WeChat collection identity did not match the configured public account.');
  }
  const list = cgi.match(/\barticleList:\s*\[([\s\S]*?)\],\s*continue_flag:/)?.[1] || '';
  const pattern = /\{\s*title:\s*'((?:\\.|[^'])*)',\s*create_time:\s*'(\d+)',\s*cover_img_1_1:\s*'((?:\\.|[^'])*)',\s*url:\s*'((?:\\.|[^'])*)',[\s\S]*?\bmsgid:\s*'(\d+)',\s*itemidx:\s*'(\d+)'/g;
  const entries = [];
  for (const match of list.matchAll(pattern)) {
    const title = compact(decodeJSString(match[1]));
    const date = shanghaiDate(Number(match[2]) * 1000);
    const url = articleURL(match[4], config.biz);
    if (!title || !date || !url) continue;
    entries.push({
      title, date, url, msgid: match[5], itemidx: match[6],
      summary: `来自「${site.wechatName}」的原创文章。`
    });
  }
  if (!entries.length) throw new Error('WeChat collection returned no valid public article entries.');
  return {
    accountName, accountId, albumId, total: Number.isInteger(total) ? total : entries.length,
    hasMore: /\bcontinue_flag:\s*'1'\s*\*\s*1/.test(cgi), entries
  };
}

export function renderWechatRss(items, site, {lastBuildDate = new Date().toISOString()} = {}) {
  const validItems = [...items]
    .filter(item => item.title && item.date && safeURL(item.url, ['mp.weixin.qq.com']))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title, 'zh-CN'));
  if (!validItems.length) throw new Error('Cannot generate an empty WeChat RSS feed.');
  const channelUrl = safeURL(site.wechatAlbumUrl, ['mp.weixin.qq.com']) || safeURL(site.baseUrl);
  const built = rssDate(lastBuildDate) || rssDate(validItems[0].date);
  const entries = validItems.map(item => `    <item>\n      <title>${xmlEscape(item.title)}</title>\n      <link>${xmlEscape(item.url)}</link>\n      <guid isPermaLink="true">${xmlEscape(item.url)}</guid>\n      <pubDate>${xmlEscape(rssDate(item.date))}</pubDate>\n      <description>${xmlEscape(item.summary || `来自「${site.wechatName}」的原创文章。`)}</description>\n    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${xmlEscape(site.wechatName)}</title>\n    <link>${xmlEscape(channelUrl)}</link>\n    <description>${xmlEscape(`${site.wechatName}公开文章目录；仅含标题、摘要、日期和原文链接。`)}</description>\n    <language>zh-CN</language>\n    <lastBuildDate>${xmlEscape(built)}</lastBuildDate>\n${entries}\n  </channel>\n</rss>\n`;
}

export function parseWechatFeed(xml, site, previous, {syncedAt = new Date().toISOString()} = {}) {
  const source = String(xml || '');
  const blocks = [...source.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(match => match[1]);
  if (!blocks.length) blocks.push(...[...source.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(match => match[1]));
  if (!blocks.length) throw new Error('WeChat feed returned no entries; existing article data was preserved.');

  const feedTitle = textOnly(source.replace(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi, '').match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]);
  if (feedTitle && !feedTitle.includes(site.wechatName)) throw new Error('WeChat feed title did not match the configured public account.');

  const byUrl = new Map(previous.items.map(item => [item.url, item]));
  const byIdentity = new Map(previous.items.map(item => [articleIdentity(item.title, item.date), item]));
  let accepted = 0;
  for (const block of blocks.slice(0, 100)) {
    const title = textOnly(tag(block, 'title'));
    const candidates = [tag(block, 'link'), linkAttribute(block), tag(block, 'guid'), tag(block, 'id')];
    const url = candidates.map(value => safeURL(value, ['mp.weixin.qq.com'])).find(Boolean);
    const published = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
    const date = shanghaiDate(published);
    if (!title || !url || !date) continue;
    const existing = byUrl.get(url) || byIdentity.get(articleIdentity(title, date));
    const rawSummary = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded') || tag(block, 'content');
    const summary = existing?.summary || textOnly(rawSummary).slice(0, 140) || `来自「${site.wechatName}」的原创文章。`;
    const category = existing?.category || inferArticleCategory(title);
    const normalized = {
      id: existing?.id || itemId(url), category, title, summary, date,
      theme: existing?.theme || inferTheme(category), tags: existing?.tags || [],
      featured: Boolean(existing?.featured), url: existing?.url || url, status: 'published'
    };
    byUrl.set(normalized.url, normalized);
    byIdentity.set(articleIdentity(title, date), normalized);
    accepted++;
  }
  if (!accepted) throw new Error('WeChat feed contained no valid mp.weixin.qq.com article entries; existing data was preserved.');

  const items = [...new Map([...byIdentity.values()].map(item => [item.id, item])).values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title, 'zh-CN'));
  const next = {
    schemaVersion: 1, status: 'synced-rss-connector', lastImportedAt: syncedAt,
    note: `通过 RSS 连接器同步「${site.wechatName}」文章目录；只保存标题、摘要、日期和公众号原文链接，不复制正文。`,
    items
  };
  validateContent(next, 'articles');
  return next;
}

async function fetchWechatText(source, {fetchImpl = fetch, waitImpl = wait, delays = [0, 2000, 8000], timeout = 20000, onRetry = message => console.warn(message)} = {}) {
  let lastError = 'unknown error';
  for (let index = 0; index < delays.length; index++) {
    if (delays[index] > 0) await waitImpl(delays[index]);
    try {
      const response = await fetchImpl(source, {headers: wechatHeaders, redirect: 'follow', signal: AbortSignal.timeout(timeout)});
      if (response.ok) {
        const html = await response.text();
        if (/window\.cgiData\s*=/.test(html)) return html;
        lastError = 'response did not contain a public collection directory';
      } else lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    if (index < delays.length - 1) onRetry(`WeChat collection attempt ${index + 1}/${delays.length} failed (${lastError}); retrying after ${delays[index + 1]}ms.`);
  }
  throw new Error(`WeChat collection fetch failed after ${delays.length} attempts (${lastError}).`);
}

async function fetchWechatTextWithCurl(source) {
  try {
    const {stdout} = await execFileAsync('curl', [
      '--location', '--fail', '--silent', '--show-error', '--ipv4',
      '--retry', '4', '--retry-all-errors', '--retry-delay', '4', '--retry-max-time', '90',
      '--connect-timeout', '15', '--max-time', '120', '--header', `Accept: ${wechatHeaders.accept}`,
      '--header', `Accept-Language: ${wechatHeaders['accept-language']}`, '--user-agent', wechatHeaders['user-agent'], source
    ], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
    if (!/window\.cgiData\s*=/.test(stdout)) throw new Error('curl response did not contain a public collection directory');
    return stdout;
  } catch (error) {
    const detail = compact(error?.stderr || error?.message || 'unknown curl error').slice(0, 240);
    throw new Error(`WeChat collection curl fallback failed (${detail}).`);
  }
}

function collectionPageUrl(config, cursor) {
  const url = new URL(config.url);
  url.hash = '';
  url.searchParams.set('action', 'getalbum');
  url.searchParams.set('is_reverse', '1');
  url.searchParams.set('count', '10');
  if (cursor) {
    url.searchParams.set('begin_msgid', cursor.msgid);
    url.searchParams.set('begin_itemidx', cursor.itemidx);
  }
  return url.href;
}

export async function fetchWechatAlbum(site, {albumUrl, fetchPage, maxPages = 10, waitImpl = wait} = {}) {
  const config = albumConfig(site, albumUrl);
  const entries = [];
  const seen = new Set();
  let cursor = null;
  let total = 0;
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    const source = collectionPageUrl(config, cursor);
    let html;
    if (fetchPage) html = await fetchPage(source, page);
    else {
      try { html = await fetchWechatText(source); }
      catch (error) {
        console.warn(`${error.message} Falling back to curl with IPv4 and transport retries.`);
        html = await fetchWechatTextWithCurl(source);
      }
    }
    const parsed = parseWechatAlbumPage(html, site, config.url.href, {requireIdentity: page === 0});
    if (page === 0) total = parsed.total;
    for (const entry of parsed.entries) {
      const key = `${entry.msgid}:${entry.itemidx}`;
      if (!seen.has(key)) { seen.add(key); entries.push(entry); }
    }
    if (!parsed.hasMore || entries.length >= total) { complete = true; break; }
    const last = parsed.entries.at(-1);
    const nextCursor = last && `${last.msgid}:${last.itemidx}`;
    if (!nextCursor || nextCursor === `${cursor?.msgid}:${cursor?.itemidx}`) throw new Error('WeChat collection pagination stopped making progress.');
    cursor = {msgid: last.msgid, itemidx: last.itemidx};
    if (!fetchPage) await waitImpl(250);
  }
  if (!entries.length || !complete) {
    throw new Error('WeChat collection pagination was incomplete; existing article data was preserved.');
  }
  return {entries, total, albumId: config.albumId, accountName: site.wechatName};
}

const unchangedExceptTimestamp = (previous, next) => JSON.stringify(previous) === JSON.stringify({...next, lastImportedAt: previous.lastImportedAt});

export async function syncWechat({feedUrl = process.env.WECHAT_FEED_URL, albumUrl} = {}) {
  const site = await readJSON('site.json');
  const previous = await readJSON('articles.json');
  const syncedAt = new Date().toISOString();
  let xml;
  let sourceStatus = 'synced-rss-connector';
  let note;
  if (albumUrl || site.wechatAlbumUrl) {
    const album = await fetchWechatAlbum(site, {albumUrl});
    xml = renderWechatRss(album.entries, site, {lastBuildDate: syncedAt});
    sourceStatus = 'synced-wechat-album';
    note = `通过公开合集自动同步「${site.wechatName}」文章目录；合集当前公开 ${album.total} 篇，只保存标题、目录摘要、日期和公众号原文链接，不复制正文。`;
  } else if (feedUrl) {
    const parsed = safeURL(feedUrl);
    if (!parsed) throw new Error('WECHAT_FEED_URL must be an HTTPS URL.');
    try {
      const response = await fetch(parsed, {
        headers: {accept: 'application/atom+xml,application/rss+xml,application/xml;q=0.9'},
        signal: AbortSignal.timeout(15000)
      });
      if (response.ok) xml = await response.text();
    } catch {}
    if (!xml) {
      try {
        ({stdout: xml} = await execFileAsync('curl', ['-L', '--fail', '--silent', '--show-error', '--max-time', '25', parsed], {encoding: 'utf8', maxBuffer: 5 * 1024 * 1024}));
      } catch {
        throw new Error('WeChat RSS connector request failed; existing article data was preserved.');
      }
    }
  } else {
    console.log('No WeChat collection or feed is configured; existing article data was preserved.');
    return {changed: false, skipped: true};
  }
  const next = parseWechatFeed(xml, site, previous, {syncedAt});
  next.status = sourceStatus;
  if (note) next.note = note;
  if (unchangedExceptTimestamp(previous, next)) {
    console.log('WeChat article directory is unchanged.');
    return {changed: false, skipped: false};
  }
  await atomicJSON(resolve(root, 'data/articles.json'), next);
  console.log(`Saved ${next.items.length} verified article links and prepared the project RSS source.`);
  return {changed: true, skipped: false};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  syncWechat().catch(error => { console.error(error.message); process.exitCode = 1; });
}
