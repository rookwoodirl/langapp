export const SOURCE_ORDER = ['article', 'article-regeneration', 'vocab', 'vocab_selection', 'audio', 'chat'] as const;

export const SOURCE_LABELS: Record<string, string> = {
  'article': 'Articles',
  'article-regeneration': 'Re-translations',
  'vocab': 'Vocab',
  'vocab_selection': 'Vocab picks',
  'audio': 'Audio',
  'chat': 'Chat',
};
