import { Router, Request, Response } from 'express';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const router = Router();

const FETCH_TIMEOUT_MS = 20_000;

// SSRF guard: reject private/internal addresses
function validateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }

  const host = parsed.hostname.toLowerCase();

  // Block internal Railway hostnames and localhost variants
  if (
    host === 'localhost' ||
    host.endsWith('.railway.internal') ||
    host.endsWith('.local') ||
    host === '0.0.0.0'
  ) {
    throw new Error('That URL is not allowed.');
  }

  // Block private IPv4 ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new Error('That URL is not allowed.');
    }
  }

  return parsed;
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

router.post('/', async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let validatedUrl: URL;
  try {
    validatedUrl = validateUrl(url);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  let html: string;
  try {
    html = await fetchHtml(validatedUrl.toString());
  } catch (err: any) {
    const msg =
      err?.name === 'AbortError'
        ? 'Request timed out — the site took too long to respond.'
        : `Could not fetch the article: ${err?.message ?? 'unknown error'}`;
    return res.status(502).json({ error: msg });
  }

  let title = '';
  let textContent = '';

  try {
    const dom = new JSDOM(html, { url: validatedUrl.toString() });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.textContent && article.textContent.trim().length > 150) {
      title = article.title ?? '';
      textContent = article.textContent.replace(/\n{3,}/g, '\n\n').trim();
    }
  } catch {
    // Readability failed — fall through to plain text fallback
  }

  if (!textContent) {
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (stripped.length < 150) {
      return res.status(422).json({
        error:
          'No article text could be extracted. The page may be paywalled, JavaScript-rendered, or behind a login.',
      });
    }
    textContent = stripped;
  }

  return res.json({ title, textContent });
});

export default router;
