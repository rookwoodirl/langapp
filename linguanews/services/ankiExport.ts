import { Platform } from 'react-native';
import { UserVocabWord } from '../types';

function escapeField(s: string): string {
  return s.replace(/[\t\n\r]+/g, ' ').trim();
}

export function buildAnkiTsv(words: UserVocabWord[]): string {
  return words
    .map((w) => {
      const front = escapeField(w.article ? `${w.article} ${w.word}` : w.word);
      const annotation = [w.partOfSpeech, w.gender].filter(Boolean).join(', ');
      const back = escapeField(annotation ? `${w.definition} (${annotation})` : w.definition);
      return `${front}\t${back}`;
    })
    .join('\n');
}

function downloadOnWeb(tsv: string, filename: string): void {
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportNotecardsToAnki(words: UserVocabWord[], filename = 'linguanews-export.txt'): Promise<void> {
  if (words.length === 0) throw new Error('Nothing to export.');
  const tsv = buildAnkiTsv(words);

  if (Platform.OS === 'web') {
    downloadOnWeb(tsv, filename);
    return;
  }

  const { File, Paths } = await import('expo-file-system');
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');

  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(tsv);

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/tab-separated-values',
    dialogTitle: 'Export to Anki',
  });
}
