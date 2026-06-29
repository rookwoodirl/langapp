const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');

export interface ScrapedArticle {
  title: string;
  textContent: string;
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    // Server returned HTML (error page, gateway timeout, etc.)
    throw new Error(`Server error (HTTP ${res.status}). The backend may be restarting — try again in a moment.`);
  }
  return res.json();
}

export async function scrapeArticle(url: string): Promise<ScrapedArticle> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }

  const data = await parseJsonSafe(res);

  if (!res.ok) {
    throw new Error(
      (data.error as string) ??
        `Could not fetch the article (HTTP ${res.status}). The site may be paywalled or blocking requests.`
    );
  }

  return {
    title: (data.title as string) ?? '',
    textContent: (data.textContent as string) ?? '',
  };
}
