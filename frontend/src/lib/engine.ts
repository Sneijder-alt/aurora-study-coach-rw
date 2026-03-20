export type AnswerEvent = {
  topicId: string;
  correct: boolean;
  difficulty: number;
};

export type SRSState = {
  intervalDays: number;
  ease: number;
  repetitions: number;
  dueAt: string;
};

export function updateMastery(current: number, event: AnswerEvent): number {
  const lr = 0.08 * event.difficulty;
  let next = current;
  if (event.correct) {
    next = current + lr * (1 - current);
  } else {
    next = current - (lr * 0.9) * (current + 0.15);
  }
  return Math.max(0, Math.min(1, next));
}

export function reviewSRS(state: SRSState | undefined, quality: number): SRSState {
  const now = new Date();
  const s: SRSState = state
    ? { ...state }
    : { intervalDays: 1, ease: 2.3, repetitions: 0, dueAt: now.toISOString() };

  if (quality < 3) {
    s.repetitions = 0;
    s.intervalDays = 1;
  } else {
    s.repetitions += 1;
    if (s.repetitions === 1) s.intervalDays = 1;
    else if (s.repetitions === 2) s.intervalDays = 3;
    else s.intervalDays = Math.max(1, Math.floor(s.intervalDays * s.ease));
  }

  s.ease = Math.max(1.3, s.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  const next = new Date(now.getTime() + s.intervalDays * 24 * 60 * 60 * 1000);
  s.dueAt = next.toISOString();
  return s;
}

export function isDue(srs: SRSState | undefined): boolean {
  if (!srs) return false;
  return new Date(srs.dueAt).getTime() <= Date.now();
}

type Question = { id: string; difficulty: number };

export function buildSessionQuestions(
  questions: Question[],
  srsMap: Record<string, SRSState>,
  limit: number
): Question[] {
  const due = questions.filter((q) => isDue(srsMap[q.id]));
  const fresh = questions.filter((q) => !srsMap[q.id]);
  const rest = questions.filter((q) => srsMap[q.id] && !isDue(srsMap[q.id]));

  const pick: Question[] = [];
  const targetDue = Math.ceil(limit * 0.6);

  for (const q of due) if (pick.length < targetDue) pick.push(q);
  for (const q of fresh) if (pick.length < limit) pick.push(q);
  for (const q of rest) if (pick.length < limit) pick.push(q);

  return pick.slice(0, limit);
}

export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
