const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');

export interface ScrapedArticle {
  title: string;
  textContent: string;
}

export async function scrapeArticle(url: string): Promise<ScrapedArticle> {
  const res = await fetch(`${BACKEND_URL}/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data?.error ??
        `Could not fetch the article (HTTP ${res.status}). The site may be paywalled or blocking requests.`
    );
  }

  return {
    title: data.title ?? '',
    textContent: data.textContent ?? '',
  };
}
