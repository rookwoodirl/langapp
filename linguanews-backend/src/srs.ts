export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface SrsState {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
}

export interface SrsResult extends SrsState {
  dueAt: Date;
}

export function gradeCard(state: SrsState, grade: ReviewGrade, now: Date = new Date()): SrsResult {
  let { repetitions, intervalDays, easeFactor } = state;

  switch (grade) {
    case 'again':
      repetitions = 0;
      intervalDays = 0;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      break;
    case 'hard':
      repetitions += 1;
      intervalDays = Math.max(1, intervalDays * 1.2);
      easeFactor = Math.max(1.3, easeFactor - 0.15);
      break;
    case 'good':
      repetitions += 1;
      intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : intervalDays * easeFactor;
      break;
    case 'easy':
      repetitions += 1;
      intervalDays = repetitions === 1 ? 4 : intervalDays * easeFactor * 1.3;
      easeFactor += 0.15;
      break;
  }

  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return { repetitions, intervalDays, easeFactor, dueAt };
}
