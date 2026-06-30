// Definite articles by language and gender, used to derive the article field
const DEFINITE_ARTICLES: Record<string, Record<string, string>> = {
  de: { masculine: 'der', feminine: 'die', neuter: 'das' },
  fr: { masculine: 'le', feminine: 'la' },
  es: { masculine: 'el', feminine: 'la' },
  it: { masculine: 'il', feminine: 'la' },
  pt: { masculine: 'o', feminine: 'a' },
  nl: { masculine: 'de', feminine: 'de', neuter: 'het' },
  sv: { common: 'den', neuter: 'det' },
  no: { masculine: 'en', feminine: 'ei', neuter: 'et' },
  da: { common: 'den', neuter: 'det' },
  pl: { masculine: 'ten', feminine: 'ta', neuter: 'to' },
};

export interface WiktionaryResult {
  definition: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
  infinitive?: string;
}

interface WiktionarySense {
  partOfSpeech: string;
  language: string;
  definitions: Array<{ definition: string; examples?: string[] }>;
  grammaticalFeatures?: Array<{ label: string; value: string }>;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

const GENDER_SET = new Set(['masculine', 'feminine', 'neuter', 'common']);

function extractGender(html: string): string | undefined {
  const lower = html.toLowerCase();
  for (const g of GENDER_SET) {
    if (new RegExp(`\\b${g}\\b`).test(lower)) return g;
  }
  return undefined;
}

// Extracts the base verb from conjugated-form definitions like:
// "third-person singular of <a href="/wiki/laufen">laufen</a>"
function extractInfinitive(html: string): string | undefined {
  const m = html.match(/\bof\s+<a\b[^>]*href="\/wiki\/([^"#]+)"[^>]*>([^<]+)<\/a>/i);
  if (!m) return undefined;
  const candidate = m[2].trim();
  // Must start with a lowercase letter — filters out German noun capitalization
  // and disambiguation pages
  if (/^[a-zÀ-ſЀ-ӿ]/.test(candidate)) return candidate;
  return undefined;
}

export async function lookupWiktionary(
  word: string,
  targetLanguage: string,
): Promise<WiktionaryResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
      { headers: { Accept: 'application/json' }, signal: controller.signal }
    );
    if (!res.ok) return null;

    const data = await res.json() as Record<string, WiktionarySense[]>;
    const sections = data[targetLanguage];
    if (!sections?.length) return null;

    const section = sections[0];
    if (!section.definitions?.length) return null;

    const defHtml = section.definitions[0].definition;
    const definition = stripHtml(defHtml);
    if (!definition) return null;

    const partOfSpeech = section.partOfSpeech?.toLowerCase();
    const allHtml = section.definitions.map(d => d.definition).join(' ');

    // Gender: grammaticalFeatures is the cleanest source; fall back to HTML scan
    let gender: string | undefined;
    if (section.grammaticalFeatures?.length) {
      for (const gf of section.grammaticalFeatures) {
        const val = gf.value?.toLowerCase();
        const lbl = gf.label?.toLowerCase();
        if (GENDER_SET.has(val)) { gender = val; break; }
        if (GENDER_SET.has(lbl)) { gender = lbl; break; }
      }
    }
    if (!gender && partOfSpeech === 'noun') {
      gender = extractGender(allHtml);
    }

    // Infinitive: only for verbs / conjugated verb forms
    const infinitive = (partOfSpeech?.includes('verb') || /\bverb\b/i.test(allHtml))
      ? extractInfinitive(allHtml)
      : undefined;

    const article = gender ? DEFINITE_ARTICLES[targetLanguage]?.[gender] : undefined;

    return { definition, partOfSpeech, gender, article, infinitive };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
