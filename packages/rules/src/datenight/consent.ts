import { createRng } from '../rng';
import type { Seat } from '../types';
import { TOPICS, type Intensity, type Prompt, type Topic } from './library';

/** One player's own limits. Both players set theirs; the stricter of the two always wins. */
export interface PlayerLimits {
  /** Self-declared 18+ (an age declaration, not verified identity). */
  adult: boolean;
  /** The hottest level this player is comfortable with. */
  ceiling: Intensity;
  topics: Record<Topic, boolean>;
  /** Personal exclusions: any prompt containing one of these words is never shown. */
  exclusions: string[];
}

export type Atmosphere = 'sweet' | 'playful' | 'bold';

export interface DateSettings {
  players: [PlayerLimits, PlayerLimits];
  atmosphere: Atmosphere;
  /** Escalation runs from start to end over the session (end ≥ start). */
  start: Intensity;
  end: Intensity;
  scoring: boolean;
  /** Context only, to keep prompts substance-free and offer social alternatives. Never tracked. */
  drinks: boolean;
  smoking: boolean;
  /** Each player has approved the combined settings. Any change clears both approvals. */
  approved: [boolean, boolean];
}

export const defaultLimits = (): PlayerLimits => ({
  adult: false,
  ceiling: 1,
  topics: { truth: true, dare: true, kissing: true, touch: true, clothing: false },
  exclusions: [],
});

export const defaultSettings = (): DateSettings => ({
  players: [defaultLimits(), defaultLimits()],
  atmosphere: 'playful',
  start: 0,
  end: 1,
  scoring: true,
  drinks: false,
  smoking: false,
  approved: [false, false],
});

/** Why these settings can't start a session yet (empty when ready). */
export function settingsProblems(s: DateSettings): string[] {
  const out: string[] = [];
  if (!s.players[0].adult || !s.players[1].adult) out.push('Both players need to confirm they are 18 or older.');
  if (s.end < s.start) out.push('The ending intensity can’t be lower than the starting one.');
  if (!s.approved[0] || !s.approved[1]) out.push('Both players need to approve the settings.');
  return out;
}

/** The hottest level allowed at all: the session end, capped by both players' ceilings. */
export function ceilingOf(s: DateSettings): Intensity {
  return Math.min(s.end, s.players[0].ceiling, s.players[1].ceiling) as Intensity;
}

/**
 * Current level for a session `progress` (0 → 1): rises gradually from start toward end and
 * never exceeds either player's ceiling.
 */
export function levelAt(s: DateSettings, progress: number): Intensity {
  const cap = ceilingOf(s);
  const start = Math.min(s.start, cap);
  const p = Math.min(1, Math.max(0, progress));
  return Math.min(cap, start + Math.floor((cap - start + 1) * p * 0.999)) as Intensity;
}

/** A topic is on only if both players left it on. */
export function topicOn(s: DateSettings, t: Topic): boolean {
  return s.players[0].topics[t] && s.players[1].topics[t];
}

function excluded(s: DateSettings, p: Prompt): boolean {
  const text = `${p.text} ${p.alt ?? ''}`.toLowerCase();
  return s.players.some((pl) => pl.exclusions.some((w) => w.trim() && text.includes(w.trim().toLowerCase())));
}

/** Whether a prompt may be shown right now (age gate, level, topics, exclusions). */
export function allowed(p: Prompt, s: DateSettings, level: Intensity): boolean {
  if (!s.players[0].adult || !s.players[1].adult) return false;
  if (p.min > level) return false;
  if (p.min > ceilingOf(s)) return false;
  if (!p.tags.every((t) => topicOn(s, t))) return false;
  return !excluded(s, p);
}

export const TOPIC_LIST = TOPICS;

/**
 * Seeded, no-repeat draw: a random eligible prompt not yet in the history. When every eligible
 * prompt has been seen, those are cleared from the history (the deck "reshuffles").
 */
export function drawFrom(candidates: readonly Prompt[], history: readonly string[], seed: number): { prompt: Prompt | null; history: string[]; seed: number } {
  if (!candidates.length) return { prompt: null, history: [...history], seed };
  const rng = createRng(seed);
  let fresh = candidates.filter((p) => !history.includes(p.id));
  let hist = [...history];
  if (!fresh.length) {
    const ids = new Set(candidates.map((p) => p.id));
    hist = hist.filter((id) => !ids.has(id));
    fresh = [...candidates];
  }
  const prompt = fresh[rng.int(fresh.length)]!;
  return { prompt, history: [...hist, prompt.id], seed: rng.state };
}

export const otherSeat = (s: Seat) => (1 - s) as Seat;
