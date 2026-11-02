import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';
import type { SrsCard } from './store';

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export type Answer = 'again' | 'hard' | 'good';

const RATING: Record<Answer, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good };

function toCard(c: SrsCard): Card {
  return { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined } as Card;
}

function fromCard(c: Card): SrsCard {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    learning_steps: c.learning_steps,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : undefined,
  };
}

export function review(card: SrsCard | undefined, answer: Answer, at = new Date()): SrsCard {
  const current = card ? toCard(card) : createEmptyCard(at);
  return fromCard(scheduler.next(current, at, RATING[answer]).card);
}
