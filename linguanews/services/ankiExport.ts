import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
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

export async function exportNotecardsToAnki(words: UserVocabWord[], filename = 'linguanews-export.txt'): Promise<void> {
  if (words.length === 0) throw new Error('Nothing to export.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');

  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(buildAnkiTsv(words));

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/tab-separated-values',
    dialogTitle: 'Export to Anki',
  });
}
