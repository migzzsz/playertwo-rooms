import type { BotLevel, GameDef, Outcome, Seat } from '../types';
import { isInt, isObj, shuffle } from '../util';
import { TRIVIA_BANK } from './trivia-bank';

/**
 * Trivia Duel: 10 questions, both players answer each one at the same time. Answers stay hidden
 * until both are in, then the correct answer is revealed. One point per correct answer.
 * Ported from prototype/games.js.
 */
export const TRIVIA_ROUNDS = 10;

export interface TriviaDuelState {
  /** Per round: [bank index, then the four answer slots as bank columns 1–4 in shuffled order]. */
  qs: number[][];
  /** Current round (0-based). */
  n: number;
  /** Each seat's answer this round (0–3), -1 while thinking. */
  ans: [number, number];
  sc: [number, number];
  /** Both answered: the correct answer is showing. */
  rev: boolean;
  w: Outcome;
}

export type TriviaDuelAction = { c: number } | { next: true };

/** Chance the bot answers correctly, by level. */
export const BOT_ACCURACY: Record<BotLevel, number> = { easy: 0.5, normal: 0.7, hard: 0.85 };

/** Index (0–3) of the correct answer in the current round's shuffled order. */
export function correctSlot(s: TriviaDuelState): number {
  return s.qs[s.n]!.indexOf(1, 1) - 1;
}

/** Text for the current round: question and the four answers in display order. */
export function currentQuestion(s: TriviaDuelState): { question: string; answers: string[] } {
  const q = s.qs[s.n]!;
  const row = TRIVIA_BANK[q[0]!]!;
  return { question: row[0], answers: q.slice(1).map((col) => row[col]!) };
}

export const triviaDuel: GameDef<TriviaDuelState, TriviaDuelAction> = {
  id: 'trivia-duel',
  name: 'Trivia Duel',
  simultaneous: true,
  init(rng) {
    const picks = shuffle(
      TRIVIA_BANK.map((_, i) => i),
      rng,
    ).slice(0, TRIVIA_ROUNDS);
    return { qs: picks.map((i) => [i, ...shuffle([1, 2, 3, 4], rng)]), n: 0, ans: [-1, -1], sc: [0, 0], rev: false, w: null };
  },
  turnOf: () => null,
  canAct: (s, seat) => s.w === null && (s.rev || s.ans[seat] < 0),
  apply(s, a, seat) {
    if (!isObj(a) || s.w !== null) return null;
    if ('next' in a) {
      if (a.next !== true || !s.rev) return null;
      const n = s.n + 1;
      if (n >= s.qs.length) return { ...s, w: s.sc[0] > s.sc[1] ? 0 : s.sc[1] > s.sc[0] ? 1 : -1 };
      return { ...s, n, ans: [-1, -1], rev: false };
    }
    if (s.rev || s.ans[seat] >= 0 || !isInt(a.c, 0, 3)) return null;
    const ans: [number, number] = [s.ans[0], s.ans[1]];
    ans[seat] = a.c;
    const sc: [number, number] = [s.sc[0], s.sc[1]];
    let rev = false;
    if (ans[0] >= 0 && ans[1] >= 0) {
      rev = true;
      const k = correctSlot(s);
      if (ans[0] === k) sc[0]++;
      if (ans[1] === k) sc[1]++;
    }
    return { ...s, ans, sc, rev };
  },
  result: (s) => s.w,
  score: (s) => s.sc,
  bot(s, seat, level, rng) {
    if (s.rev) return { next: true };
    const k = correctSlot(s);
    if (rng.next() < BOT_ACCURACY[level]) return { c: k };
    const wrong = [0, 1, 2, 3].filter((x) => x !== k);
    return { c: wrong[rng.int(wrong.length)]! };
  },
};
