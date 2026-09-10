/**
 * Synchronize article-directory metadata from a configured third-party RSS or
 * Atom feed. Personal subscription accounts cannot list publications through
 * WeChat's official API, so the feed URL is supplied as a repository secret.
 * Never store feed credentials, cookies, article bodies, or the feed URL.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJSON, readJSON, root, safeURL, validateContent } from './lib.mjs';

const execFileAsync = promisify(execFile);
const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
const decodeXML = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
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

export const inferArticleCategory = title => {
  if (/AI|人工智能|智能体|模型|编程/i.test(title)) return 'AI 实践';
  if (/工具|系统|复盘|产品|DCA|Status|4Stage|Map|地图/i.test(title)) return '工具使用';
  if (/投资|趋势|定投|策略|长赢|仓位/i.test(title)) return '投资方法';
  return '市场观察';
};
const inferTheme = category => ({'AI 实践':'coding','工具使用':'toolkit','投资方法':'method','市场观察':'market'}[category] || 'method');
const itemId = url => `wechat-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`;

export function parseWechatFeed(xml, site, previous, { syncedAt = new Date().toISOString() } = {}) {
  const source = String(xml || '');
  const blocks = [...source.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(x => x[1]);
  if (!blocks.length) blocks.push(...[...source.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(x => x[1]));
  if (!blocks.length) throw new Error('WeChat feed returned no entries; existing article data was preserved.');

  const feedTitle = textOnly(source.replace(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi, '').match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]);
  if (feedTitle && !feedTitle.includes(site.wechatName)) throw new Error('WeChat feed title did not match the configured public account.');

  const byUrl = new Map(previous.items.map(item => [item.url, item]));
  let accepted = 0;
  for (const block of blocks.slice(0, 100)) {
    const title = textOnly(tag(block, 'title'));
    const candidates = [tag(block, 'link'), linkAttribute(block), tag(block, 'guid'), tag(block, 'id')];
    const url = candidates.map(value => safeURL(value, ['mp.weixin.qq.com'])).find(Boolean);
    const published = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
    const date = shanghaiDate(published);
    if (!title || !url || !date) continue;
    const existing = byUrl.get(url);
    const rawSummary = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded') || tag(block, 'content');
    const summary = textOnly(rawSummary).slice(0, 140) || existing?.summary || `来自「${site.wechatName}」的文章。`;
    const category = existing?.category || inferArticleCategory(title);
    byUrl.set(url, {
      id: existing?.id || itemId(url), category, title, summary, date,
      theme: existing?.theme || inferTheme(category), tags: existing?.tags || [],
      featured: Boolean(existing?.featured), url, status: 'published'
    });
    accepted++;
  }
  if (!accepted) throw new Error('WeChat feed contained no valid mp.weixin.qq.com article entries; existing data was preserved.');

  const items = [...byUrl.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title, 'zh-CN'));
  const next = {
    schemaVersion: 1, status: 'synced-rss-connector', lastImportedAt: syncedAt,
    note: `通过可替换 RSS 连接器同步「${site.wechatName}」文章目录；只保存标题、摘要、日期和公众号原文链接，不复制正文。`,
    items
  };
  validateContent(next, 'articles');
  return next;
}

const unchangedExceptTimestamp = (previous, next) => JSON.stringify(previous) === JSON.stringify({...next, lastImportedAt: previous.lastImportedAt});

export async function syncWechat({ feedUrl = process.env.WECHAT_FEED_URL } = {}) {
  if (!feedUrl) {
    console.log('WECHAT_FEED_URL is not configured; existing article data was preserved.');
    return { changed: false, skipped: true };
  }
  const parsed = safeURL(feedUrl);
  if (!parsed) throw new Error('WECHAT_FEED_URL must be an HTTPS URL.');
  const site = await readJSON('site.json');
  const previous = await readJSON('articles.json');
  let xml = '';
  try {
    const response = await fetch(parsed, {
      headers: { accept: 'application/atom+xml,application/rss+xml,application/xml;q=0.9' },
      signal: AbortSignal.timeout(15000)
    });
    if (response.ok) xml = await response.text();
  } catch {}
  if (!xml) {
    try {
      ({ stdout: xml } = await execFileAsync('curl', ['-L', '--fail', '--silent', '--show-error', '--max-time', '25', parsed], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }));
    } catch {
      throw new Error('WeChat RSS connector request failed; existing article data was preserved.');
    }
  }
  const next = parseWechatFeed(xml, site, previous);
  if (unchangedExceptTimestamp(previous, next)) {
    console.log('WeChat article directory is unchanged.');
    return { changed: false, skipped: false };
  }
  await atomicJSON(resolve(root, 'data/articles.json'), next);
  console.log(`Saved ${next.items.length} verified article links from the configured WeChat RSS connector.`);
  return { changed: true, skipped: false };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  syncWechat().catch(error => { console.error(error.message); process.exitCode = 1; });
}
