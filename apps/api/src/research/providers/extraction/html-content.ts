import * as cheerio from 'cheerio';

const REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'nav',
  'footer',
  'header',
  'aside',
  'form',
  '[hidden]',
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '.cookie-banner',
  '.advertisement',
  '.ads',
].join(',');

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function extractHtmlContent(html: string): {
  title: string;
  text: string;
  description?: string;
  publishedAt?: string;
} {
  const $ = cheerio.load(html);
  const title = cleanText(
    $('meta[property="og:title"]').attr('content') ||
      $('title').first().text() ||
      $('h1').first().text(),
  );
  const description = cleanText(
    $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '',
  );
  const publishedAt = normalizeDate(
    $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="date"]').attr('content') ||
      $('time[datetime]').first().attr('datetime'),
  );

  $(REMOVE_SELECTORS).remove();
  $('p, h1, h2, h3, h4, h5, h6, li, blockquote, br').each((_, element) => {
    $(element).after('\n');
  });
  const candidates = $(
    'article, main, [role="main"], .article-body, .post-content',
  )
    .toArray()
    .map((element) => cleanText($(element).text()))
    .sort((a, b) => b.length - a.length);
  const text =
    candidates[0]?.length >= 160
      ? candidates[0]
      : cleanText($('body').text() || $.root().text());

  return {
    title,
    text,
    ...(description ? { description } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}
