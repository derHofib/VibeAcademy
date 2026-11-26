import type { QuizOptionState } from '@/components/ui/quiz-option';
import type { RingButtonState } from '@/components/ui/ring-button';
import type { QuizAnswer, QuizQuestion } from './api';

/**
 * Zustand einer Antwortoption (Screen 5f/5j): vor der Antwort neutral; danach
 * richtige Option grün (✓), gewählte falsche gelb (✕), alle übrigen gedimmt.
 * `pending` = gewählte Option, deren Auswertung noch läuft.
 */
export function optionState(index: number, answer: QuizAnswer | undefined, pending?: number | null): QuizOptionState {
  if (!answer) return pending === index ? 'selected' : 'idle';
  if (index === answer.correct) return 'correct';
  if (index === answer.option) return 'wrong';
  return 'dimmed';
}

/** Index der ersten unbeantworteten Frage; alle beantwortet → letzte Frage (zum Auswerten). */
export function firstOpenQuestion(questions: Pick<QuizQuestion, 'answer'>[]): number {
  const i = questions.findIndex((q) => !q.answer);
  return i === -1 ? Math.max(0, questions.length - 1) : i;
}

/** Ring-Button im Wissenscheck: „?“ bis eine Antwort ausgewertet ist, dann Pfeil. */
export function quizRingState(answered: boolean): RingButtonState {
  return answered ? 'ready' : 'quiz';
}

/** Anzahl richtiger Antworten, die zum Bestehen nötig sind. */
export function neededCorrect(passPct: number, total: number): number {
  return Math.max(1, Math.ceil((passPct / 100) * total - 1e-9));
}
