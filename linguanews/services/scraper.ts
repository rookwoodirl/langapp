export interface ScrapedArticle {
  title: string;
  textContent: string;
}

function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1].trim();
  const tag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return tag ? tag[1].trim() : '';
}

function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

export async function scrapeArticle(url: string): Promise<ScrapedArticle> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-cache',
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { headers }, 15000);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(
        'The request timed out (15 s). The site may be blocking automated requests.\n\nTip: copy the article text and use "Paste text instead" below.'
      );
    }
    throw new Error(
      'Could not reach the article. The site may block direct requests, or you may be offline.\n\nTip: copy the article text and use "Paste text instead" below.'
    );
  }

  if (!response.ok) {
    throw new Error(
      `The site returned an error (HTTP ${response.status}).\n\nTip: copy the article text and use "Paste text instead" below.`
    );
  }

  const html = await response.text();
  const title = extractTitle(html);

  // Prefer <article> or <main>, fall back to full body
  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(/<div[^>]*class="[^"]*(?:article|content|story|post|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const contentHtml = articleMatch ? articleMatch[1] : html;
  const textContent = stripHtml(contentHtml);

  if (textContent.length < 150) {
    throw new Error(
      'The page loaded but no article text could be extracted — it may be paywalled or JavaScript-rendered.\n\nTip: copy the article text and use "Paste text instead" below.'
    );
  }

  return { title, textContent };
}
